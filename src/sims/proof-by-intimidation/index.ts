import { randomSeed, type ParamSchema, type Params, type SimModule, type SimStatus } from '../../harness/author';
import { tally, latex } from './expr';
import { armObfuscate, armSolve, atSize, canSolve, commit, isStart, startRun, type Rewrite, type Run, type StartName } from './engine';
import { proveValue, type Verdict } from './eval';
import type { Flavor } from './rules';
import { mountProof } from './view';
import 'katex/dist/katex.min.css';
import './proof.css';

const OPEN_SPEED = 1;
const SWAP_AT = 0.34;

type Drive = 'idle' | 'solve-once' | 'solve-all' | 'obfuscate-once' | 'obfuscate-all';

export const params: ParamSchema = {
  start: {
    type: 'select',
    label: 'Start',
    default: '1',
    reset: true,
    group: 'Proof',
    options: [
      { value: '1', label: '1' },
      { value: '0', label: '0' },
      { value: '2', label: '2' },
      { value: 'e', label: 'e' },
      { value: 'pi', label: 'π' },
      { value: 'ln2', label: 'ln 2' },
      { value: 'half', label: '1/2' },
    ],
  },
  size: {
    type: 'number',
    label: 'Size',
    default: 100,
    min: 40,
    max: 100,
    step: 20,
    reset: true,
    group: 'Proof',
    detail: 'Grow to size stops when the expression reaches this many nodes.',
  },
  flavor: {
    type: 'select',
    label: 'Flavor',
    default: 'all',
    reset: true,
    group: 'Proof',
    options: [
      { value: 'all', label: 'Everything' },
      { value: 'trig', label: 'Trig & hyperbolic' },
      { value: 'calculus', label: 'Calculus' },
      { value: 'series', label: 'Series & combinatorics' },
      { value: 'complex', label: 'Complex & exotic' },
    ],
  },
};

export function normalize(params: Params): void {
  params.size = clampInt(params.size, 40, 100, 100);
  if (params.start === 'zero') params.start = '0';
  if (!isStart(params.start)) params.start = '1';
  if (!isFlavor(params.flavor)) params.flavor = 'all';
}

export const sim: SimModule = {
  params,
  normalize,
  chrome: { seed: false },
  create(ctx, host) {
    host.setSpeed(OPEN_SPEED);
    const card = host.card({ caption: 'Tree' });
    const view = mountProof(ctx.canvas, card.body);
    const context = ctx.canvas.getContext('2d');
    let width = ctx.width;
    let height = ctx.height;
    let dpr = ctx.dpr;
    let run: Run = startRun(1, '1', 100, 'all');
    let drive: Drive = 'idle';
    let queued = false;
    let badgeKey = '';
    let badge: Verdict = { ok: true, text: 'value = 1.000000 ✓' };
    let warned = '';

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    function currentBadge(): Verdict {
      const key = `${run.tree.id}:${tally(run.tree).nodes}:${run.start}`;
      if (key !== badgeKey) {
        badgeKey = key;
        badge = proveValue(run.tree, run.start);
        if (!badge.ok && warned !== key) {
          warned = key;
          console.warn(`Proof by intimidation drifted after "${run.lastRule}": ${badge.text}`);
        }
      }
      return badge;
    }

    function armDrive(next: Drive): boolean {
      if (next === 'solve-once' || next === 'solve-all') return armSolve(run);
      if (next === 'obfuscate-once' || next === 'obfuscate-all') return armObfuscate(run);
      return false;
    }

    function playOne(): void {
      host.step();
      queued = true;
    }

    function finishCurrent(): void {
      host.setPaused(true);
      if (host.paused && run.pending && !queued) playOne();
    }

    function request(next: Exclude<Drive, 'idle'>): void {
      if (drive === next && next.endsWith('all')) {
        drive = next === 'solve-all' ? 'solve-once' : 'obfuscate-once';
        finishCurrent();
        return;
      }
      if (!run.pending) {
        if (next === 'obfuscate-all' && atSize(run)) return;
        if (!armDrive(next)) return;
        drive = next;
        if (next.endsWith('all')) host.setPaused(false);
        else playOne();
        return;
      }
      drive = next;
      if (next.endsWith('all')) host.setPaused(false);
      else finishCurrent();
    }

    return {
      reset(next) {
        badgeKey = '';
        drive = 'idle';
        queued = false;
        run = startRun(randomSeed(), startOf(next.start), clampInt(next.size, 40, 100, 100), flavorOf(next.flavor));
        host.setPaused(true);
      },
      step() {
        queued = false;
        const pending = run.pending;
        if (!pending) {
          if (drive !== 'idle') {
            drive = 'idle';
            host.setPaused(true);
          }
          return;
        }
        const committed = pending.mode;
        commit(run);
        const wanted = modeOf(drive);
        if (!wanted) return;
        if (drive.endsWith('all')) {
          const room = drive === 'obfuscate-all' ? !atSize(run) : canSolve(run);
          if (room && armDrive(drive)) return;
          drive = 'idle';
          host.setPaused(true);
          return;
        }
        if (committed !== wanted && armDrive(drive)) {
          playOne();
          return;
        }
        drive = 'idle';
      },
      resize(nextWidth, nextHeight, nextDpr) {
        width = nextWidth;
        height = nextHeight;
        dpr = nextDpr;
        view.resize(nextDpr);
      },
      toolbar() {
        const solvable = canSolve(run) || run.pending?.mode === 'expand';
        const growing = !atSize(run) || run.pending?.mode === 'simplify';
        return [
          {
            type: 'button',
            id: 'obfuscate',
            label: 'Obfuscate',
            onClick: () => request('obfuscate-once'),
          },
          {
            type: 'button',
            id: 'obfuscate-all',
            label: 'Grow to size',
            pressed: drive === 'obfuscate-all',
            toggle: true,
            disabled: !growing && drive !== 'obfuscate-all',
            onClick: () => request('obfuscate-all'),
          },
          {
            type: 'button',
            id: 'solve',
            label: 'Solve',
            disabled: !solvable && drive !== 'solve-once' && drive !== 'solve-all',
            onClick: () => request('solve-once'),
          },
          {
            type: 'button',
            id: 'solve-all',
            label: 'Solve all',
            pressed: drive === 'solve-all',
            toggle: true,
            disabled: !solvable && drive !== 'solve-all',
            onClick: () => request('solve-all'),
          },
          { type: 'button', id: 'fit', label: 'Reset view', onClick: () => view.fit() },
        ];
      },
      render(alpha) {
        if (drive === 'idle' && !host.paused) host.setPaused(true);
        if (context) {
          context.setTransform(dpr, 0, 0, dpr, 0, 0);
          context.fillStyle = '#12141a';
          context.fillRect(0, 0, width, height);
        }
        const pending = run.pending;
        const swapping = pending !== null && alpha >= SWAP_AT;
        const shown = swapping ? pending.tree : run.tree;
        view.frame({
          source: latex(shown),
          hot: pending ? focusOf(pending, swapping) : [],
          alpha,
          flip: swapping && !reducedMotion.matches,
          fade: swapping,
          badge: currentBadge(),
          tree: shown,
          dpr,
        });
      },
      getStatus(): SimStatus {
        const counts = tally(run.tree);
        const verdict = currentBadge();
        return {
          done: false,
          note: pendingNote(run),
          row: [
            { type: 'label', id: 'phase', text: phaseLabel(drive) },
            { type: 'progress', id: 'progress', value: Math.min(1, counts.nodes / Math.max(1, run.target)) },
            { type: 'readout', id: 'nodes', label: 'Nodes', value: String(counts.nodes) },
          ],
          aside: [
            { type: 'readout', id: 'value', label: 'Value', value: verdict.text.replace(/^value = /, '') },
            { type: 'readout', id: 'peak', label: 'Peak', value: String(run.peak) },
            { type: 'readout', id: 'integrals', label: 'Integrals', value: String(counts.integrals) },
            { type: 'readout', id: 'sums', label: 'Sums', value: String(counts.sums) },
            { type: 'readout', id: 'free', label: 'Free', value: String(counts.free) },
          ],
        };
      },
      dispose() {
        view.destroy();
        card.dispose();
      },
    };
  },
};

function focusOf(pending: Rewrite, swapping: boolean): string[] {
  return [swapping ? pending.arrived : pending.focus];
}

function modeOf(drive: Drive): 'simplify' | 'expand' | null {
  if (drive === 'solve-once' || drive === 'solve-all') return 'simplify';
  if (drive === 'obfuscate-once' || drive === 'obfuscate-all') return 'expand';
  return null;
}

function pendingNote(run: Run): string | undefined {
  return run.pending?.rule || run.lastRule || undefined;
}

function phaseLabel(drive: Drive): string {
  if (drive === 'obfuscate-once' || drive === 'obfuscate-all') return 'Obfuscating…';
  if (drive === 'solve-once' || drive === 'solve-all') return 'Solving…';
  return 'Ready';
}

function startOf(value: Params[string]): StartName {
  return isStart(value) ? value : '1';
}

function flavorOf(value: Params[string]): Flavor {
  return isFlavor(value) ? value : 'all';
}

function isFlavor(value: Params[string]): value is Flavor {
  return value === 'all' || value === 'trig' || value === 'calculus' || value === 'series' || value === 'complex';
}

function clampInt(value: Params[string], min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
