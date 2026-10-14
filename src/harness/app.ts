import { resolveChrome, type ResolvedChrome } from './chrome';
import { createLoop, DEFAULT_SPEED } from './loop';
import { createNav } from './nav';
import { applyQuery } from './params';
import { createParamsPanel, type ParamsPanel } from './params-panel';
import { listMetas, loadSim } from './registry';
import { randomSeed } from './rng';
import { buildRoute, parseRoute } from './router';
import { createBar } from './bar';
import { createStatusBar, statusHasBody } from './status-bar';
import { transportPieces } from './transport';
import type { ParamSchema, Params, SimHost, SimInstance, SimMeta, SimStatus } from './types';

const ROUTE_DELAY_MS = 100;
const RESTART_DELAY_MS = 2500;

interface Mounted {
  id: string;
  schema: ParamSchema;
  params: Params;
  chrome: ResolvedChrome;
  instance: SimInstance;
  canvas: HTMLCanvasElement;
  panel: ParamsPanel | null;
  observer: ResizeObserver;
  onWindowResize: () => void;
}

export interface App {
  dispose(): void;
}

export function createApp(root: HTMLElement): App {
  root.replaceChildren();
  root.innerHTML = `
    <div class="app">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true"></div>
          <div>
            <h1>Dopamine Farm</h1>
            <p>Idle simulations</p>
          </div>
        </div>
        <nav class="nav" aria-label="Simulations"></nav>
      </aside>
      <section class="stage">
        <header class="bar-top">
          <div class="bar-top-main">
            <h2 class="sim-title">Dopamine Farm</h2>
            <div class="bar-pieces"></div>
            <span class="bar-seed" hidden></span>
          </div>
          <p class="bar-hints" hidden></p>
        </header>
        <div class="viewport">
          <div class="canvas-host"></div>
          <div class="params-host"></div>
          <div class="done-banner" hidden></div>
          <div class="empty" hidden><p>No sims yet</p></div>
        </div>
        <footer class="bar-bottom"></footer>
      </section>
    </div>
  `;

  const navRoot = required(root, '.nav');
  const title = required(root, '.sim-title');
  const piecesRoot = required(root, '.bar-top .bar-pieces');
  const seedReadout = required(root, '.bar-seed');
  const hints = required(root, '.bar-hints');
  const canvasHost = required(root, '.canvas-host');
  const paramsHost = required(root, '.params-host');
  const banner = required(root, '.done-banner');
  const empty = required(root, '.empty');
  const emptyText = required(empty, 'p');
  const statusRoot = required(root, '.bar-bottom');

  const metas = listMetas();
  const metaById = new Map(metas.map((meta) => [meta.id, meta]));
  let mounted: Mounted | null = null;
  let mountToken = 0;
  let seed = 0;
  let wantPlay = true;
  let runFinished = false;
  let elapsedMs = 0;
  let tickAt = 0;
  let ticking = false;
  let routeTimer = 0;
  let restartTimer = 0;
  let lastRoute = '';

  const nav = createNav(navRoot, metas, (id) => {
    void mount(id, null, {}, true);
  });
  const statusBar = createStatusBar(statusRoot, banner);
  const topBar = createBar(piecesRoot);
  let autoOn = false;

  const loop = createLoop({
    step(dt) {
      mounted?.instance.step(dt);
    },
    render(alpha) {
      mounted?.instance.render(alpha);
    },
    getStatus(): SimStatus {
      return mounted?.instance.getStatus() ?? { done: true };
    },
  });
  const host: SimHost = {
    get paused() {
      return loop.paused;
    },
    get speed() {
      return loop.speed;
    },
    get pace() {
      return mounted?.chrome.pace ?? 'step';
    },
    get autoRestart() {
      return autoOn;
    },
    get seed() {
      return seed;
    },
    setPaused(paused) {
      setPlaying(!paused);
    },
    togglePaused() {
      setPlaying(loop.paused);
    },
    step() {
      loop.requestStep();
    },
    restart() {
      restartRun();
    },
    replay() {
      replayRun();
    },
    setSpeed(speed) {
      loop.setSpeed(speed);
    },
    setAutoRestart(on) {
      autoOn = on;
      if (on) armRestart();
      else clearRestart();
    },
    transport() {
      return transportPieces(host);
    },
  };
  loop.onFrame(({ steps, status }) => {
    if (!mounted) return;
    if (loop.paused && wantPlay) {
      wantPlay = false;
      pauseClock();
      clearRestart();
    }
    syncToolbar(steps > 0);
    statusBar.sync(status, steps > 0);
    statusRoot.hidden = !statusHasBody(status);
    syncHints();
    if (status.done && !runFinished) {
      runFinished = true;
      const elapsed = stopClock();
      if (status.banner) statusBar.showBanner(status.banner, elapsed);
      armRestart();
    }
  });

  const onKeyDown = (event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (!mounted) return;
    if (topBar.handleKey(event)) return;
    statusBar.handleKey(event);
  };

  const onPopState = () => {
    const current = `${location.pathname}${location.search}`;
    if (current === lastRoute) return;
    const route = parseRoute(current);
    if (!route.simId || !metaById.has(route.simId)) return;
    lastRoute = current;
    void mount(route.simId, route.seed, route.params, true);
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('popstate', onPopState);

  if (metas.length === 0) {
    showEmpty('No sims yet');
    topBar.setEnabled(false);
    statusBar.setEnabled(false);
    document.title = 'Dopamine Farm';
  } else {
    // Older links used #/id. The address is the path now.
    const route = parseRoute(location.hash.startsWith('#/') ? location.hash : `${location.pathname}${location.search}`);
    const initial = route.simId && metaById.has(route.simId) ? route.simId : metas[0]!.id;
    const initialSeed = route.simId === initial ? route.seed : null;
    const initialQuery = route.simId === initial ? route.params : {};
    void mount(initial, initialSeed, initialQuery, true);
  }

  return {
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('popstate', onPopState);
      clearRestart();
      window.clearTimeout(routeTimer);
      unmountSim();
      loop.stop();
      root.replaceChildren();
    },
  };

  async function mount(
    id: string,
    nextSeed: number | null,
    query: Record<string, string>,
    play: boolean,
  ): Promise<void> {
    const token = ++mountToken;
    const meta = metaById.get(id);
    if (!meta) return;
    const previousId = mounted?.id ?? null;
    if (previousId !== null && previousId !== id) loop.setSpeed(DEFAULT_SPEED);
    unmountSim();
    showEmpty('');
    empty.hidden = true;
    seed = 0;
    setChrome(meta, true);
    topBar.setEnabled(false);
    statusBar.setEnabled(false);

    let sim;
    try {
      sim = await loadSim(id);
    } catch (error) {
      if (token !== mountToken) return;
      showEmpty(error instanceof Error ? error.message : 'Failed to load sim');
      return;
    }
    if (token !== mountToken) return;

    const schema = sim.params;
    const chrome = resolveChrome(sim);
    if (chrome.seed) seed = (nextSeed ?? randomSeed()) >>> 0;
    const params = applyQuery(schema, query);
    sim.normalize?.(params);
    const canvas = document.createElement('canvas');
    canvasHost.append(canvas);
    const size = measure(canvasHost);
    applyCanvasSize(canvas, size.width, size.height, size.dpr);
    const instance = sim.create(
      {
        canvas,
        width: size.width,
        height: size.height,
        dpr: size.dpr,
      },
      host,
    );
    if (chrome.seed) instance.reset(params, seed);
    else instance.reset(params);

    const resize = () => {
      const next = measure(canvasHost);
      if (next.width < 2 || next.height < 2) return;
      applyCanvasSize(canvas, next.width, next.height, next.dpr);
      instance.resize?.(next.width, next.height, next.dpr);
    };
    const observer = new ResizeObserver(() => resize());
    observer.observe(canvasHost);
    window.addEventListener('resize', resize);

    const panel = chrome.params
      ? createParamsPanel(paramsHost, schema, params, {
          onChange: (key, structural, commit) => {
            sim.normalize?.(params);
            panel?.updateVisibility();
            if (!structural) {
              const value = params[key];
              if (value !== undefined) instance.setParams?.({ [key]: value }, params);
              scheduleRoute();
              return;
            }
            if (!commit) return;
            restartRun();
            scheduleRoute();
          },
          onResetDefaults: () => {
            for (const [key, def] of Object.entries(schema)) params[key] = def.default;
            sim.normalize?.(params);
            panel?.refresh();
            restartRun();
            scheduleRoute();
          },
        })
      : null;

    mounted = {
      id,
      schema,
      params,
      chrome,
      instance,
      canvas,
      panel,
      observer,
      onWindowResize: resize,
    };
    applyShell(chrome);
    topBar.setEnabled(true);
    statusBar.setEnabled(true);
    topBar.clear();
    statusBar.clear();
    autoOn = false;
    wantPlay = play;
    loop.setPaused(!play);
    restartClock();
    loop.setPace(chrome.pace);
    loop.restartTiming();
    loop.start();
    syncToolbar(false);
    const opened = instance.getStatus();
    statusBar.sync(opened, false);
    statusRoot.hidden = !statusHasBody(opened);
    syncHints();
    syncSeed();
    writeRoute();
  }

  function unmountSim(): void {
    clearRestart();
    window.clearTimeout(routeTimer);
    loop.stop();
    loop.setPace('step');
    if (!mounted) return;
    mounted.observer.disconnect();
    window.removeEventListener('resize', mounted.onWindowResize);
    mounted.panel?.dispose();
    mounted.instance.dispose();
    mounted.canvas.remove();
    mounted = null;
  }

  function restartRun(): void {
    if (!mounted) return;
    beginRun(mounted.chrome.seed ? randomSeed() : null);
  }

  function replayRun(): void {
    if (!mounted) return;
    beginRun(mounted.chrome.seed ? seed : null);
  }

  function beginRun(nextSeed: number | null): void {
    if (!mounted) return;
    clearRestart();
    topBar.clear();
    statusBar.clear();
    if (mounted.chrome.seed) {
      seed = (nextSeed ?? randomSeed()) >>> 0;
      mounted.instance.reset(mounted.params, seed);
    } else {
      mounted.instance.reset(mounted.params);
    }
    writeRoute();
    wantPlay = true;
    loop.setPaused(false);
    restartClock();
    loop.restartTiming();
    // Paint in this turn. Otherwise a solved board stays on screen until the
    // next frame, which reads as a click that did nothing.
    mounted.instance.render(0);
    syncToolbar(true);
    const restarted = mounted.instance.getStatus();
    statusBar.sync(restarted, true);
    statusRoot.hidden = !statusHasBody(restarted);
    syncHints();
    syncSeed();
    loop.start();
  }

  function setPlaying(playing: boolean): void {
    wantPlay = playing;
    loop.setPaused(!playing);
    if (playing) {
      resumeClock();
      armRestart();
    } else {
      pauseClock();
      clearRestart();
    }
  }

  function syncToolbar(stepped: boolean): void {
    const bar = mounted?.instance.toolbar?.() ?? [];
    topBar.sync(bar, stepped);
    piecesRoot.hidden = bar.length === 0;
  }

  function syncHints(): void {
    const hint = [topBar.hint(), statusBar.hint()].filter((line) => line.length > 0).join(' · ');
    hints.textContent = hint;
    hints.hidden = hint.length === 0;
  }

  function syncSeed(): void {
    const show = mounted !== null && mounted.chrome.seed;
    seedReadout.hidden = !show;
    seedReadout.textContent = show ? `seed ${seed}` : '';
  }

  function applyShell(chrome: ResolvedChrome): void {
    paramsHost.hidden = !chrome.params;
    canvasHost.classList.toggle('is-full', !chrome.params);
  }

  function setChrome(meta: SimMeta, enabled: boolean): void {
    title.textContent = meta.title;
    document.title = `${meta.title} — Dopamine Farm`;
    nav.setActive(meta.id);
    topBar.setEnabled(enabled);
    statusBar.setEnabled(enabled);
  }

  function showEmpty(text: string): void {
    emptyText.textContent = text;
    empty.hidden = text.length === 0;
    if (text.length > 0) {
      title.textContent = 'Dopamine Farm';
      nav.setActive(null);
      paramsHost.hidden = true;
      canvasHost.classList.add('is-full');
      topBar.sync([]);
      piecesRoot.hidden = true;
      hints.hidden = true;
      seedReadout.hidden = true;
      statusRoot.hidden = true;
      banner.hidden = true;
    }
  }

  function restartClock(): void {
    elapsedMs = 0;
    runFinished = false;
    ticking = wantPlay;
    tickAt = performance.now();
    statusBar.clearBanner();
  }

  function pauseClock(): void {
    if (!ticking) return;
    const now = performance.now();
    elapsedMs += now - tickAt;
    tickAt = now;
    ticking = false;
  }

  function resumeClock(): void {
    if (runFinished || ticking) return;
    tickAt = performance.now();
    ticking = true;
  }

  function stopClock(): number {
    pauseClock();
    runFinished = true;
    ticking = false;
    return elapsedMs;
  }

  function armRestart(): void {
    clearRestart();
    if (!autoOn || !runFinished || loop.paused) return;
    restartTimer = window.setTimeout(() => {
      restartTimer = 0;
      restartRun();
    }, RESTART_DELAY_MS);
  }

  function clearRestart(): void {
    if (!restartTimer) return;
    window.clearTimeout(restartTimer);
    restartTimer = 0;
  }

  function scheduleRoute(): void {
    window.clearTimeout(routeTimer);
    routeTimer = window.setTimeout(writeRoute, ROUTE_DELAY_MS);
  }

  function writeRoute(): void {
    if (!mounted) return;
    window.clearTimeout(routeTimer);
    const next = buildRoute(mounted.id, seed, mounted.schema, mounted.params, mounted.chrome.seed);
    const current = `${location.pathname}${location.search}`;
    // A leftover #/id still needs replacing, even when the path already matches.
    if (current === next && location.hash === '') {
      lastRoute = next;
      return;
    }
    history.replaceState(null, '', next);
    lastRoute = `${location.pathname}${location.search}`;
  }
}

function required(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing ${selector}`);
  }
  return element;
}

function measure(host: HTMLElement): { width: number; height: number; dpr: number } {
  const rect = host.getBoundingClientRect();
  return {
    width: rect.width,
    height: rect.height,
    dpr: window.devicePixelRatio || 1,
  };
}

function applyCanvasSize(canvas: HTMLCanvasElement, width: number, height: number, dpr: number): void {
  const bufferWidth = Math.max(1, Math.floor(width * dpr));
  const bufferHeight = Math.max(1, Math.floor(height * dpr));
  if (canvas.width !== bufferWidth) canvas.width = bufferWidth;
  if (canvas.height !== bufferHeight) canvas.height = bufferHeight;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}
