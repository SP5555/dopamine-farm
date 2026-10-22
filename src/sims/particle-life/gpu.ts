import { BETA, MAX_SPEED, type World } from './physics';
import { dotRadius, type Rgb } from './render';

// The DOM lib this project typechecks against has the WebGPU interfaces and not these flag values.
const BUFFER_MAP_READ = 0x0001;
const BUFFER_COPY_SRC = 0x0004;
const BUFFER_COPY_DST = 0x0008;
const BUFFER_UNIFORM = 0x0040;
const BUFFER_STORAGE = 0x0080;
const TEXTURE_BINDING = 0x04;
const TEXTURE_RENDER = 0x10;
const STAGE_VERTEX = 0x1;
const STAGE_FRAGMENT = 0x2;
const STAGE_COMPUTE = 0x4;
const MAP_READ = 0x0001;

/** Buffers are sized once. The live count is whatever the run uploaded. */
const CAPACITY = 50_000;
const MAX_CELLS = 4096;

const COMPUTE = /* wgsl */ `
struct Sim {
  count: u32,
  species: u32,
  cols: u32,
  cellCount: u32,
  rMax: f32,
  invR: f32,
  impulse: f32,
  damp: f32,
  dt: f32,
  beta: f32,
  maxSpeed: f32,
  r2: f32,
}

@group(0) @binding(0) var<uniform> sim: Sim;
@group(0) @binding(1) var<storage, read> posIn: array<vec2f>;
@group(0) @binding(2) var<storage, read_write> posOut: array<vec2f>;
@group(0) @binding(3) var<storage, read> velIn: array<vec2f>;
@group(0) @binding(4) var<storage, read_write> velOut: array<vec2f>;
@group(0) @binding(5) var<storage, read> speciesOf: array<u32>;
@group(0) @binding(6) var<storage, read> rules: array<f32>;
@group(0) @binding(7) var<storage, read_write> counts: array<atomic<u32>>;
@group(0) @binding(8) var<storage, read_write> offsets: array<u32>;
@group(0) @binding(9) var<storage, read_write> cursor: array<atomic<u32>>;
@group(0) @binding(10) var<storage, read_write> indices: array<u32>;
@group(0) @binding(11) var<storage, read_write> speedOut: array<f32>;

fn cellOf(p: vec2f) -> u32 {
  let cx = min(sim.cols - 1u, u32(p.x * f32(sim.cols)));
  let cy = min(sim.cols - 1u, u32(p.y * f32(sim.cols)));
  return cy * sim.cols + cx;
}

fn pairForce(r: f32, attraction: f32) -> f32 {
  if (r >= 1.0) { return 0.0; }
  if (r < sim.beta) { return r / sim.beta - 1.0; }
  let span = 1.0 - sim.beta;
  return attraction * (1.0 - abs(2.0 * r - 1.0 - sim.beta) / span);
}

@compute @workgroup_size(64)
fn clearCounts(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= sim.cellCount) { return; }
  atomicStore(&counts[gid.x], 0u);
}

@compute @workgroup_size(64)
fn countParticles(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= sim.count) { return; }
  atomicAdd(&counts[cellOf(posIn[gid.x])], 1u);
}

@compute @workgroup_size(1)
fn scanCounts() {
  var sum = 0u;
  for (var cell = 0u; cell < sim.cellCount; cell++) {
    offsets[cell] = sum;
    atomicStore(&cursor[cell], sum);
    sum += atomicLoad(&counts[cell]);
  }
  offsets[sim.cellCount] = sum;
}

@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= sim.count) { return; }
  let cell = cellOf(posIn[gid.x]);
  let slot = atomicAdd(&cursor[cell], 1u);
  indices[slot] = gid.x;
}

fn pullFrom(cell: u32, index: u32, xi: f32, yi: f32, row: u32) -> vec2f {
  var force = vec2f(0.0);
  let start = offsets[cell];
  let end = offsets[cell + 1u];
  for (var cursorIndex = start; cursorIndex < end; cursorIndex++) {
    let other = indices[cursorIndex];
    if (other == index) { continue; }
    var delta = posIn[other] - vec2f(xi, yi);
    if (delta.x > 0.5) { delta.x -= 1.0; } else if (delta.x < -0.5) { delta.x += 1.0; }
    if (delta.y > 0.5) { delta.y -= 1.0; } else if (delta.y < -0.5) { delta.y += 1.0; }
    let dist2 = dot(delta, delta);
    if (dist2 >= sim.r2 || dist2 < 1e-12) { continue; }
    let dist = sqrt(dist2);
    let scale = pairForce(dist * sim.invR, rules[row + speciesOf[other]]) / dist;
    force += delta * scale;
  }
  return force;
}

@compute @workgroup_size(64)
fn integrate(@builtin(global_invocation_id) gid: vec3u) {
  let index = gid.x;
  if (index >= sim.count) { return; }
  let pos = posIn[index];
  let row = speciesOf[index] * sim.species;
  let cx = min(sim.cols - 1u, u32(pos.x * f32(sim.cols)));
  let cy = min(sim.cols - 1u, u32(pos.y * f32(sim.cols)));
  var force = vec2f(0.0);
  if (sim.cols >= 3u) {
    for (var oy = -1; oy <= 1; oy++) {
      let ny = u32((i32(cy) + oy + i32(sim.cols)) % i32(sim.cols));
      let base = ny * sim.cols;
      for (var ox = -1; ox <= 1; ox++) {
        let cell = base + u32((i32(cx) + ox + i32(sim.cols)) % i32(sim.cols));
        force += pullFrom(cell, index, pos.x, pos.y, row);
      }
    }
  } else {
    for (var cell = 0u; cell < sim.cellCount; cell++) {
      force += pullFrom(cell, index, pos.x, pos.y, row);
    }
  }
  var velocity = velIn[index] * sim.damp + force * sim.impulse;
  let speed = length(velocity);
  if (speed > sim.maxSpeed) {
    velocity *= sim.maxSpeed / speed;
  }
  velOut[index] = velocity;
  let next = pos + velocity * sim.dt;
  posOut[index] = vec2f(fract(next.x), fract(next.y));
}

var<workgroup> speedScratch: array<f32, 256>;

@compute @workgroup_size(256)
fn sampleSpeed(@builtin(local_invocation_index) lid: u32) {
  let stride = max(1u, (sim.count + 255u) / 256u);
  let index = lid * stride;
  var speed = 0.0;
  if (index < sim.count) {
    speed = length(velOut[index]);
  }
  speedScratch[lid] = speed;
  workgroupBarrier();
  if (lid == 0u) {
    var total = 0.0;
    var seen = 0u;
    for (var i = 0u; i < 256u; i++) {
      let sample = i * stride;
      if (sample < sim.count) {
        total += speedScratch[i];
        seen += 1u;
      }
    }
    speedOut[0] = total / f32(max(seen, 1u));
  }
}
`;

const RENDER = /* wgsl */ `
struct View {
  geom: vec4f,
  frame: vec4f,
  flags: vec4f,
  colors: array<vec4f, 6>,
}

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var history: texture_2d<f32>;
@group(0) @binding(2) var historySampler: sampler;
@group(0) @binding(3) var<storage, read> posIn: array<vec2f>;
@group(0) @binding(4) var<storage, read> speciesOf: array<u32>;

struct FullOut {
  @builtin(position) pos: vec4f,
}

@vertex
fn vsFull(@builtin(vertex_index) vertex: u32) -> FullOut {
  var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: FullOut;
  out.pos = vec4f(positions[vertex], 0.0, 1.0);
  return out;
}

@fragment
fn fsFade(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let bg = vec3f(14.0 / 255.0, 16.0 / 255.0, 20.0 / 255.0);
  let uv = pos.xy / max(view.geom.xy, vec2f(1.0));
  let kept = textureSample(history, historySampler, uv).rgb;
  let keep = select(view.frame.w, 0.0, view.flags.x > 0.5);
  return vec4f(mix(bg, kept, keep), 1.0);
}

@fragment
fn fsBlit(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let uv = pos.xy / vec2f(textureDimensions(history));
  return textureSample(history, historySampler, uv);
}

fn colorOf(id: u32) -> vec3f {
  if (id == 1u) { return view.colors[1].rgb; }
  if (id == 2u) { return view.colors[2].rgb; }
  if (id == 3u) { return view.colors[3].rgb; }
  if (id == 4u) { return view.colors[4].rgb; }
  if (id == 5u) { return view.colors[5].rgb; }
  return view.colors[0].rgb;
}

struct ParticleOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
}

@vertex
fn vsParticle(@builtin(vertex_index) vertex: u32, @builtin(instance_index) inst: u32) -> ParticleOut {
  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
  );
  let particle = inst / 9u;
  let copy = inst % 9u;
  var out: ParticleOut;
  let count = u32(view.flags.y);
  if (particle >= count) {
    out.clip = vec4f(2.0, 2.0, 0.0, 1.0);
    out.uv = vec2f(0.0);
    out.color = vec3f(0.0);
    return out;
  }
  let pos = posIn[particle];
  let ox = i32(copy % 3u) - 1;
  let oy = i32(copy / 3u) - 1;
  let reach = view.frame.z;
  let showX = ox == 0 || (ox == 1 && pos.x < reach) || (ox == -1 && pos.x > 1.0 - reach);
  let showY = oy == 0 || (oy == 1 && pos.y < reach) || (oy == -1 && pos.y > 1.0 - reach);
  if (!showX || !showY) {
    out.clip = vec4f(2.0, 2.0, 0.0, 1.0);
    out.uv = vec2f(0.0);
    out.color = vec3f(0.0);
    return out;
  }
  let world = pos + vec2f(f32(ox), f32(oy));
  let pixel = view.frame.xy + world * view.geom.z + corners[vertex] * view.geom.w;
  let clip = vec2f(pixel.x / view.geom.x * 2.0 - 1.0, 1.0 - pixel.y / view.geom.y * 2.0);
  out.clip = vec4f(clip, 0.0, 1.0);
  out.uv = corners[vertex];
  out.color = colorOf(speciesOf[particle] % 6u);
  return out;
}

@fragment
fn fsParticle(in: ParticleOut) -> @location(0) vec4f {
  let falloff = exp(-dot(in.uv, in.uv) * 3.2);
  return vec4f(in.color * falloff, falloff);
}
`;

export interface GpuDraw {
  width: number;
  height: number;
  dpr: number;
  trails: boolean;
  /** History weight, 1 keeps the previous frame. */
  keep: number;
  clear: boolean;
  dot: number;
  colors: readonly Rgb[];
}

/**
 * The neighbor search and the picture both run on the GPU. Positions stay there.
 * The CPU still owns the matrix, and a sampled speed comes back for the sparkline.
 */
export class ParticleGpu {
  readonly speed = { current: 0 };

  private constructor(
    private readonly device: GPUDevice,
    private readonly context: GPUCanvasContext,
    private readonly format: GPUTextureFormat,
    private readonly pipelines: ComputePipelines,
    private readonly drawPipelines: DrawPipelines,
    private readonly buffers: Buffers,
    private readonly groups: [GPUBindGroup, GPUBindGroup],
    private readonly sampleGroups: [GPUBindGroup, GPUBindGroup],
    private readonly sampler: GPUSampler,
    private readonly simData: ArrayBuffer,
    private readonly viewData: ArrayBuffer,
  ) {}

  static async open(canvas: HTMLCanvasElement): Promise<ParticleGpu | null> {
    const gpu = navigator.gpu;
    if (!gpu) return null;
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter || adapter.limits.maxStorageBuffersPerShaderStage < 11) return null;
    const device = await adapter.requestDevice({
      requiredLimits: { maxStorageBuffersPerShaderStage: 11 },
    });
    const computeModule = device.createShaderModule({ label: 'particle-life-compute', code: COMPUTE });
    const renderModule = device.createShaderModule({ label: 'particle-life-render', code: RENDER });
    const compiled = await Promise.all([computeModule.getCompilationInfo(), renderModule.getCompilationInfo()]);
    const messages = compiled.flatMap((info) => info.messages.filter((message) => message.type === 'error'));
    if (messages.length > 0) {
      device.destroy();
      console.error(messages.map((message) => message.message).join('\n'));
      return null;
    }
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!context) {
      device.destroy();
      return null;
    }
    const format = gpu.getPreferredCanvasFormat();
    const buffers = createBuffers(device);
    const pipelines = createCompute(device, computeModule);
    const drawPipelines = createDraw(device, renderModule, format);
    const groups: [GPUBindGroup, GPUBindGroup] = [
      computeGroup(device, pipelines.layout, buffers, 0),
      computeGroup(device, pipelines.layout, buffers, 1),
    ];
    const sampleGroups: [GPUBindGroup, GPUBindGroup] = [
      sampleGroup(device, pipelines.sampleLayout, buffers, 0),
      sampleGroup(device, pipelines.sampleLayout, buffers, 1),
    ];
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    const gpuSim = new ParticleGpu(
      device,
      context,
      format,
      pipelines,
      drawPipelines,
      buffers,
      groups,
      sampleGroups,
      sampler,
      new ArrayBuffer(256),
      new ArrayBuffer(256),
    );
    gpuSim.configure();
    return gpuSim;
  }

  /** Which buffer holds the positions on screen. Uploads and drawing use this one. */
  private front = 0;
  private count = 0;
  private species = 1;
  private width = 1;
  private height = 1;
  private textures: [GPUTexture, GPUTexture] | null = null;
  private textureFront = 0;
  private readPending = false;
  private frame = 0;

  upload(world: World): void {
    this.count = world.count;
    this.species = world.species;
    this.front = 0;
    const { device, buffers } = this;
    const pos = new Float32Array(world.count * 2);
    const vel = new Float32Array(world.count * 2);
    const species = new Uint32Array(world.count);
    for (let index = 0; index < world.count; index += 1) {
      pos[index * 2] = world.x[index]!;
      pos[index * 2 + 1] = world.y[index]!;
      vel[index * 2] = world.vx[index]!;
      vel[index * 2 + 1] = world.vy[index]!;
      species[index] = world.type[index] ?? 0;
    }
    device.queue.writeBuffer(buffers.pos[0]!, 0, pos);
    device.queue.writeBuffer(buffers.vel[0]!, 0, vel);
    device.queue.writeBuffer(buffers.species, 0, species);
    this.writeRules(world.matrix, world.species);
  }

  writeRules(matrix: ArrayLike<number>, species: number): void {
    this.species = species;
    const packed = new Float32Array(64);
    const count = species * species;
    for (let index = 0; index < count; index += 1) packed[index] = matrix[index] ?? 0;
    this.device.queue.writeBuffer(this.buffers.rules, 0, packed);
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = Math.max(1, Math.floor(width * dpr));
    this.height = Math.max(1, Math.floor(height * dpr));
    this.configure();
    this.textures?.[0].destroy();
    this.textures?.[1].destroy();
    this.textures = null;
    this.textureFront = 0;
  }

  step(count: number, rMax: number, halfLife: number, force: number, dt: number): void {
    if (count === 0 || !(rMax > 0) || !(dt > 0) || !(halfLife > 0)) return;
    this.count = count;
    const cols = Math.max(1, Math.min(64, Math.floor(1 / rMax)));
    const cellCount = cols * cols;
    const sim = new Uint32Array(this.simData);
    const floats = new Float32Array(this.simData);
    sim[0] = count;
    sim[1] = this.species;
    sim[2] = cols;
    sim[3] = cellCount;
    floats[4] = rMax;
    floats[5] = 1 / rMax;
    floats[6] = rMax * force * dt;
    floats[7] = 0.5 ** (dt / halfLife);
    floats[8] = dt;
    floats[9] = BETA;
    floats[10] = MAX_SPEED;
    floats[11] = rMax * rMax;
    this.device.queue.writeBuffer(this.buffers.sim, 0, this.simData);

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    const group = this.groups[this.front]!;
    pass.setBindGroup(0, group);
    const particleGroups = Math.ceil(count / 64);
    const cellGroups = Math.ceil(cellCount / 64);
    pass.setPipeline(this.pipelines.clear);
    pass.dispatchWorkgroups(cellGroups);
    pass.setPipeline(this.pipelines.count);
    pass.dispatchWorkgroups(particleGroups);
    pass.setPipeline(this.pipelines.scan);
    pass.dispatchWorkgroups(1);
    pass.setPipeline(this.pipelines.scatter);
    pass.dispatchWorkgroups(particleGroups);
    pass.setPipeline(this.pipelines.integrate);
    pass.dispatchWorkgroups(particleGroups);
    pass.setPipeline(this.pipelines.sample);
    pass.setBindGroup(0, this.sampleGroups[this.front]!);
    pass.dispatchWorkgroups(1);
    pass.end();
    this.front ^= 1;

    this.frame += 1;
    const readSpeed = !this.readPending && this.frame % 10 === 0;
    if (readSpeed) encoder.copyBufferToBuffer(this.buffers.speed, 0, this.buffers.speedRead, 0, 4);
    this.device.queue.submit([encoder.finish()]);
    if (readSpeed) {
      this.readPending = true;
      const read = this.buffers.speedRead;
      void read.mapAsync(MAP_READ).then(
        () => {
          const values = new Float32Array(read.getMappedRange());
          this.speed.current = values[0] ?? 0;
          read.unmap();
          this.readPending = false;
        },
        () => {
          this.readPending = false;
        },
      );
    }
  }

  render(draw: GpuDraw): void {
    if (this.count === 0 || this.width < 2 || this.height < 2) return;
    this.ensureTextures();
    const target = this.textures?.[this.textureFront];
    const history = this.textures?.[1 - this.textureFront];
    if (!target || !history) return;

    const floats = new Float32Array(this.viewData);
    const radius = dotRadius(draw.dot) * draw.dpr;
    const margin = 28 * draw.dpr;
    const side = Math.max(1, Math.min(this.width, this.height) - margin * 2);
    floats[0] = this.width;
    floats[1] = this.height;
    floats[2] = side;
    floats[3] = radius;
    floats[4] = (this.width - side) / 2;
    floats[5] = (this.height - side) / 2;
    floats[6] = radius / side;
    floats[7] = draw.clear || !draw.trails ? 0 : draw.keep;
    floats[8] = draw.clear || !draw.trails ? 1 : 0;
    floats[9] = this.count;
    for (let index = 0; index < 6; index += 1) {
      const color = draw.colors[index] ?? { r: 0, g: 0, b: 0 };
      const offset = 12 + index * 4;
      floats[offset] = color.r / 255;
      floats[offset + 1] = color.g / 255;
      floats[offset + 2] = color.b / 255;
      floats[offset + 3] = 1;
    }
    this.device.queue.writeBuffer(this.buffers.view, 0, this.viewData);

    const fadeGroup = this.device.createBindGroup({
      layout: this.drawPipelines.fadeLayout,
      entries: [
        { binding: 0, resource: { buffer: this.buffers.view } },
        { binding: 1, resource: history.createView() },
        { binding: 2, resource: this.sampler },
      ],
    });
    const particleGroup = this.device.createBindGroup({
      layout: this.drawPipelines.particleLayout,
      entries: [
        { binding: 0, resource: { buffer: this.buffers.view } },
        { binding: 3, resource: { buffer: this.buffers.pos[this.front]! } },
        { binding: 4, resource: { buffer: this.buffers.species } },
      ],
    });
    const blitGroup = this.device.createBindGroup({
      layout: this.drawPipelines.blitLayout,
      entries: [
        { binding: 1, resource: target.createView() },
        { binding: 2, resource: this.sampler },
      ],
    });

    let swap: GPUTexture;
    try {
      swap = this.context.getCurrentTexture();
    } catch {
      return;
    }
    const encoder = this.device.createCommandEncoder();
    const trail = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: target.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 14 / 255, g: 16 / 255, b: 20 / 255, a: 1 },
        },
      ],
    });
    trail.setPipeline(this.drawPipelines.fade);
    trail.setBindGroup(0, fadeGroup);
    trail.draw(3);
    trail.setPipeline(this.drawPipelines.particle);
    trail.setBindGroup(0, particleGroup);
    trail.draw(6, this.count * 9);
    trail.end();

    const blit = encoder.beginRenderPass({
      colorAttachments: [{ view: swap.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    blit.setPipeline(this.drawPipelines.blit);
    blit.setBindGroup(0, blitGroup);
    blit.draw(3);
    blit.end();
    this.device.queue.submit([encoder.finish()]);
    this.textureFront ^= 1;
  }

  destroy(): void {
    this.textures?.[0].destroy();
    this.textures?.[1].destroy();
    this.textures = null;
    this.device.destroy();
  }

  private configure(): void {
    this.context.configure({ device: this.device, format: this.format, alphaMode: 'opaque' });
  }

  private ensureTextures(): void {
    const current = this.textures?.[0];
    if (current && current.width === this.width && current.height === this.height) return;
    current?.destroy();
    this.textures?.[1].destroy();
    const make = (): GPUTexture =>
      this.device.createTexture({
        size: [this.width, this.height],
        format: 'rgba8unorm',
        usage: TEXTURE_RENDER | TEXTURE_BINDING,
      });
    this.textures = [make(), make()];
    this.textureFront = 0;
  }
}

interface Buffers {
  pos: [GPUBuffer, GPUBuffer];
  vel: [GPUBuffer, GPUBuffer];
  species: GPUBuffer;
  rules: GPUBuffer;
  counts: GPUBuffer;
  offsets: GPUBuffer;
  cursor: GPUBuffer;
  indices: GPUBuffer;
  speed: GPUBuffer;
  speedRead: GPUBuffer;
  sim: GPUBuffer;
  view: GPUBuffer;
}

interface ComputePipelines {
  layout: GPUBindGroupLayout;
  sampleLayout: GPUBindGroupLayout;
  clear: GPUComputePipeline;
  count: GPUComputePipeline;
  scan: GPUComputePipeline;
  scatter: GPUComputePipeline;
  integrate: GPUComputePipeline;
  sample: GPUComputePipeline;
}

interface DrawPipelines {
  fadeLayout: GPUBindGroupLayout;
  particleLayout: GPUBindGroupLayout;
  blitLayout: GPUBindGroupLayout;
  fade: GPURenderPipeline;
  particle: GPURenderPipeline;
  blit: GPURenderPipeline;
}

function storage(device: GPUDevice, size: number, extra = 0): GPUBuffer {
  return device.createBuffer({ size, usage: BUFFER_STORAGE | BUFFER_COPY_DST | extra });
}

function createBuffers(device: GPUDevice): Buffers {
  const vec2 = CAPACITY * 2 * 4;
  return {
    pos: [storage(device, vec2), storage(device, vec2)],
    vel: [storage(device, vec2), storage(device, vec2)],
    species: storage(device, CAPACITY * 4),
    rules: storage(device, 64 * 4),
    counts: storage(device, MAX_CELLS * 4),
    offsets: storage(device, (MAX_CELLS + 1) * 4),
    cursor: storage(device, MAX_CELLS * 4),
    indices: storage(device, CAPACITY * 4),
    speed: storage(device, 4, BUFFER_COPY_SRC),
    speedRead: device.createBuffer({ size: 4, usage: BUFFER_COPY_DST | BUFFER_MAP_READ }),
    sim: device.createBuffer({ size: 256, usage: BUFFER_UNIFORM | BUFFER_COPY_DST }),
    view: device.createBuffer({ size: 256, usage: BUFFER_UNIFORM | BUFFER_COPY_DST }),
  };
}

function createCompute(device: GPUDevice, module: GPUShaderModule): ComputePipelines {
  const layout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: STAGE_COMPUTE, buffer: { type: 'uniform' } },
      { binding: 1, visibility: STAGE_COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 2, visibility: STAGE_COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: STAGE_COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: STAGE_COMPUTE, buffer: { type: 'storage' } },
      { binding: 5, visibility: STAGE_COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 6, visibility: STAGE_COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 7, visibility: STAGE_COMPUTE, buffer: { type: 'storage' } },
      { binding: 8, visibility: STAGE_COMPUTE, buffer: { type: 'storage' } },
      { binding: 9, visibility: STAGE_COMPUTE, buffer: { type: 'storage' } },
      { binding: 10, visibility: STAGE_COMPUTE, buffer: { type: 'storage' } },
      { binding: 11, visibility: STAGE_COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const sampleLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: STAGE_COMPUTE, buffer: { type: 'uniform' } },
      { binding: 4, visibility: STAGE_COMPUTE, buffer: { type: 'storage' } },
      { binding: 11, visibility: STAGE_COMPUTE, buffer: { type: 'storage' } },
    ],
  });
  const pipe = (entry: string, group: GPUBindGroupLayout): GPUComputePipeline =>
    device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [group] }),
      compute: { module, entryPoint: entry },
    });
  return {
    layout,
    sampleLayout,
    clear: pipe('clearCounts', layout),
    count: pipe('countParticles', layout),
    scan: pipe('scanCounts', layout),
    scatter: pipe('scatter', layout),
    integrate: pipe('integrate', layout),
    sample: pipe('sampleSpeed', sampleLayout),
  };
}

function computeGroup(device: GPUDevice, layout: GPUBindGroupLayout, buffers: Buffers, front: number): GPUBindGroup {
  const read = front;
  const write = 1 - front;
  return device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: buffers.sim } },
      { binding: 1, resource: { buffer: buffers.pos[read]! } },
      { binding: 2, resource: { buffer: buffers.pos[write]! } },
      { binding: 3, resource: { buffer: buffers.vel[read]! } },
      { binding: 4, resource: { buffer: buffers.vel[write]! } },
      { binding: 5, resource: { buffer: buffers.species } },
      { binding: 6, resource: { buffer: buffers.rules } },
      { binding: 7, resource: { buffer: buffers.counts } },
      { binding: 8, resource: { buffer: buffers.offsets } },
      { binding: 9, resource: { buffer: buffers.cursor } },
      { binding: 10, resource: { buffer: buffers.indices } },
      { binding: 11, resource: { buffer: buffers.speed } },
    ],
  });
}

function sampleGroup(device: GPUDevice, layout: GPUBindGroupLayout, buffers: Buffers, front: number): GPUBindGroup {
  // After a slice, `front` still names the buffer that was read. The written velocity is the other one.
  return device.createBindGroup({
    layout,
    entries: [
      { binding: 0, resource: { buffer: buffers.sim } },
      { binding: 4, resource: { buffer: buffers.vel[1 - front]! } },
      { binding: 11, resource: { buffer: buffers.speed } },
    ],
  });
}

function createDraw(device: GPUDevice, module: GPUShaderModule, canvasFormat: GPUTextureFormat): DrawPipelines {
  const fadeLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: STAGE_FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: STAGE_FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: STAGE_FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });
  const particleLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: STAGE_VERTEX, buffer: { type: 'uniform' } },
      { binding: 3, visibility: STAGE_VERTEX, buffer: { type: 'read-only-storage' } },
      { binding: 4, visibility: STAGE_VERTEX, buffer: { type: 'read-only-storage' } },
    ],
  });
  const blitLayout = device.createBindGroupLayout({
    entries: [
      { binding: 1, visibility: STAGE_FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 2, visibility: STAGE_FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });
  const blend: GPUBlendState = {
    color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
    alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
  };
  const target: GPUColorTargetState = { format: 'rgba8unorm' };
  const fade = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [fadeLayout] }),
    vertex: { module, entryPoint: 'vsFull' },
    fragment: { module, entryPoint: 'fsFade', targets: [target] },
  });
  const particle = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [particleLayout] }),
    vertex: { module, entryPoint: 'vsParticle' },
    fragment: { module, entryPoint: 'fsParticle', targets: [{ format: 'rgba8unorm', blend }] },
  });
  const blit = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [blitLayout] }),
    vertex: { module, entryPoint: 'vsFull' },
    fragment: { module, entryPoint: 'fsBlit', targets: [{ format: canvasFormat }] },
  });
  return { fadeLayout, particleLayout, blitLayout, fade, particle, blit };
}
