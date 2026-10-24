import { createRng } from '../../harness/author';
import katex from 'katex';
import { describe, expect, it } from 'vitest';
import {
  add,
  binderNames,
  binom,
  constant,
  div,
  findById,
  fn,
  freeVars,
  freshName,
  idsOf,
  latex,
  nodeCount,
  num,
  pow,
  sameShape,
  variable,
  walk,
  type Expr,
  type Gen,
} from './expr';
import { evaluate, near, sampleEnv } from './eval';
import { armObfuscate, armSolve, canSolve, commit, solvableCount, startRun, type StartName } from './engine';
import { invert } from './recover';
import { RULES, type Rule } from './rules';

function finish(seed: number, start: StartName, target: number, flavor: 'all' | 'trig' | 'calculus' | 'series' | 'complex') {
  const run = startRun(seed, start, target, flavor);
  let guard = 0;
  while (nodeCount(run.tree) < target) {
    const names = binderNames(run.tree);
    expect(new Set(names).size).toBe(names.length);
    expect(new Set(freeVars(run.tree)).size).toBe(freeVars(run.tree).length);
    expect(armObfuscate(run)).toBe(true);
    commit(run);
    if (++guard > 4000) throw new Error('proof did not finish');
  }
  while (canSolve(run)) {
    expect(armSolve(run)).toBe(true);
    commit(run);
    if (++guard > 4000) throw new Error('proof did not finish');
  }
  return run;
}

function trace(seed: number): string[] {
  const run = startRun(seed, '1', 36, 'all');
  const labels: string[] = [];
  let guard = 0;
  while (nodeCount(run.tree) < 36) {
    expect(armObfuscate(run)).toBe(true);
    labels.push(run.pending?.rule ?? '');
    commit(run);
    if (++guard > 4000) throw new Error('proof did not finish');
  }
  while (canSolve(run)) {
    expect(armSolve(run)).toBe(true);
    labels.push(run.pending?.rule ?? '');
    commit(run);
    if (++guard > 4000) throw new Error('proof did not finish');
  }
  return labels;
}

function expectRoundTrip(rule: Rule, node: Expr, built: Expr, gen: Gen): void {
  const back = invert(rule, built, gen);
  expect(back, rule.id).not.toBeNull();
  expect(sameShape(back!, node), rule.id).toBe(true);
}

const SLOW = new Set(['pi-leibniz', 'pi-basel', 'ln2-alternating', 'pi-lorentz']);

const specimens: Record<string, (gen: Gen) => Expr> = {
  'e-power': (gen) => constant(gen, 'e'),
  'e-series': (gen) => constant(gen, 'e'),
  'e-hyperbolic': (gen) => constant(gen, 'e'),
  'e-limit': (gen) => constant(gen, 'e'),
  'pi-lorentz': (gen) => constant(gen, 'pi'),
  'pi-gaussian': (gen) => constant(gen, 'pi'),
  'pi-gamma': (gen) => constant(gen, 'pi'),
  'pi-arctan': (gen) => constant(gen, 'pi'),
  'pi-leibniz': (gen) => constant(gen, 'pi'),
  'pi-basel': (gen) => constant(gen, 'pi'),
  'ln2-integral': (gen) => fn(gen, 'ln', num(gen, 2)),
  'ln2-alternating': (gen) => fn(gen, 'ln', num(gen, 2)),
  'half-sine': (gen) => div(gen, num(gen, 1), num(gen, 2)),
  'half-integral': (gen) => div(gen, num(gen, 1), num(gen, 2)),
  'exp-hyperbolic': (gen) => fn(gen, 'exp', variable(gen, freshName(gen, 'x'), false)),
  'sin-cofunction': (gen) => fn(gen, 'sin', variable(gen, freshName(gen, 'x'), false)),
  'cos-cofunction': (gen) => fn(gen, 'cos', variable(gen, freshName(gen, 'x'), false)),
  'cos-square': (gen) => pow(gen, fn(gen, 'cos', variable(gen, freshName(gen, 'x'), false)), num(gen, 2)),
  'sin-square': (gen) => pow(gen, fn(gen, 'sin', variable(gen, freshName(gen, 'x'), false)), num(gen, 2)),
  'cosh-square': (gen) => pow(gen, fn(gen, 'cosh', variable(gen, freshName(gen, 'x'), false)), num(gen, 2)),
  'cos-difference': (gen) => fn(gen, 'cos', variable(gen, freshName(gen, 'x'), false)),
  'sin-difference': (gen) => fn(gen, 'sin', variable(gen, freshName(gen, 'x'), false)),
  pascal: (gen) => binom(gen, num(gen, 5), num(gen, 2)),
  'binom-symmetry': (gen) => binom(gen, num(gen, 5), num(gen, 2)),
};

describe('identities', () => {
  for (const rule of RULES.filter((entry) => entry.kind === 'value' && literalFor(entry, { id: 0, name: 0 })?.type === 'num')) {
    it(rule.label, () => {
      for (let seed = 1; seed <= 4; seed += 1) {
        const gen: Gen = { id: 0, name: 0 };
        const rng = createRng(seed);
        const literal = literalFor(rule, gen);
        if (!literal || literal.type !== 'num' || !rule.applies(literal)) continue;
        const built = rule.build(literal, { gen, rng });
        expectRoundTrip(rule, literal, built.expr, gen);
        for (let salt = 0; salt < 3; salt += 1) {
          const value = evaluate(built.expr, sampleEnv(built.expr, salt));
          expect(near(value, literal.value), `${rule.id} seed ${seed} salt ${salt}`).toBe(true);
        }
      }
    });
  }

  for (const rule of RULES.filter((entry) => entry.kind === 'structural')) {
    it(rule.label, () => {
      for (let seed = 1; seed <= 3; seed += 1) {
        const gen: Gen = { id: 0, name: 0 };
        const rng = createRng(seed);
        for (const hole of sampleHoles(gen)) {
          if (!rule.applies(hole)) continue;
          const built = rule.build(hole, { gen, rng });
          expectRoundTrip(rule, hole, built.expr, gen);
          expect(built.hole).toBe(true);
          expect(findById(built.expr, hole.id)).toBe(hole);
          for (let salt = 0; salt < 2; salt += 1) {
            const env = sampleEnv(built.expr, salt);
            const left = evaluate(hole, env);
            const right = evaluate(built.expr, env);
            expect(Math.hypot(right.re - left.re, right.im - left.im)).toBeLessThan(2e-3);
          }
        }
      }
    });
  }

  it('rejects a complex log-exp', () => {
    const gen: Gen = { id: 0, name: 0 };
    const rule = RULES.find((entry) => entry.id === 'ln-exp')!;
    expect(rule.applies(constant(gen, 'i'))).toBe(false);
  });

  it('has a specimen for every identity that is not a bare number', () => {
    for (const rule of RULES) {
      if (rule.kind !== 'value') continue;
      const gen: Gen = { id: 0, name: 0 };
      if (literalFor(rule, gen)) continue;
      expect(specimens[rule.id], rule.id).toBeTypeOf('function');
    }
  });

  for (const rule of RULES) {
    const make = specimens[rule.id];
    if (!make) continue;
    it(rule.label, () => {
      const gen: Gen = { id: 0, name: 0 };
      const rng = createRng(1);
      const node = make(gen);
      expect(rule.applies(node)).toBe(true);
      const built = rule.build(node, { gen, rng });
      expectRoundTrip(rule, node, built.expr, gen);
      const env = sampleEnv(built.expr, 0);
      const left = evaluate(node, env);
      const right = evaluate(built.expr, env);
      const tolerance = SLOW.has(rule.id) ? 0.06 : 2e-3;
      expect(Math.hypot(right.re - left.re, right.im - left.im), rule.id).toBeLessThan(tolerance);
    });
  }
});

function startShape(name: StartName): string {
  switch (name) {
    case '0':
      return '0';
    case '1':
      return '1';
    case '2':
      return '2';
    case 'e':
      return 'e';
    case 'pi':
      return 'pi';
    case 'ln2':
      return 'ln(2)';
    case 'half':
      return '1/2';
  }
}

function shape(expr: Expr): string {
  if (expr.type === 'num') return String(expr.value);
  if (expr.type === 'const') return expr.name;
  if (expr.type === 'fn' && expr.name === 'ln') return `ln(${shape(expr.arg)})`;
  if (expr.type === 'div' && expr.num.type === 'num' && expr.den.type === 'num') return `${expr.num.value}/${expr.den.value}`;
  return expr.type;
}

function literalFor(rule: Rule, gen: Gen): Expr | null {
  if (rule.id === 'split') return num(gen, 4);
  for (const value of [1, 0, 2]) {
    const literal = num(gen, value);
    if (rule.applies(literal)) return literal;
  }
  return null;
}

function sampleHoles(gen: Gen) {
  const name = freshName(gen, 'x');
  return [num(gen, 2), variable(gen, name, false), fn(gen, 'sin', variable(gen, name, false))];
}

describe('collapse', () => {
  it('refuses an identity whose two copies disagree', () => {
    const gen: Gen = { id: 0, name: 0 };
    const long = add(gen, [num(gen, 1), num(gen, 0)]);
    const expr = add(gen, [
      pow(gen, fn(gen, 'sin', long), num(gen, 2)),
      pow(gen, fn(gen, 'cos', num(gen, 1)), num(gen, 2)),
    ]);
    const run = startRun(1, '1', 40, 'all');
    run.tree = expr;
    run.gen = gen;
    expect(armSolve(run)).toBe(true);
    commit(run);
    expect(shape(run.tree)).not.toBe('1');
    expect(canSolve(run)).toBe(true);
  });

  it('peels an identity whose two copies still agree', () => {
    const gen: Gen = { id: 0, name: 0 };
    const name = freshName(gen, 'x');
    const arg = variable(gen, name, false);
    const expr = add(gen, [
      pow(gen, fn(gen, 'sin', arg), num(gen, 2)),
      pow(gen, fn(gen, 'cos', variable(gen, name, false)), num(gen, 2)),
    ]);
    const run = startRun(1, '1', 40, 'all');
    run.tree = expr;
    run.gen = gen;
    expect(armSolve(run)).toBe(true);
    commit(run);
    expect(run.tree).toMatchObject({ type: 'num', value: 1 });
  });

  it('does not stack minuses', () => {
    const depth = (expr: Expr): number => {
      let worst = 0;
      walk(expr, (node) => {
        let run = 0;
        let current: Expr | undefined = node;
        while (current?.type === 'neg') {
          run += 1;
          current = current.arg;
        }
        worst = Math.max(worst, run);
      });
      return worst;
    };
    for (const seed of [1, 2, 3, 4, 5, 7, 11, 19]) {
      const run = startRun(seed, '1', 60, 'all');
      let guard = 0;
      while (nodeCount(run.tree) < 60) {
        expect(armObfuscate(run)).toBe(true);
        commit(run);
        expect(depth(run.tree)).toBeLessThanOrEqual(1);
        if (++guard > 4000) throw new Error('proof did not finish');
      }
    }
  });

  it('opens more than one solvable piece', () => {
    let branched = 0;
    for (const seed of [1, 2, 3, 4, 5, 7, 11, 19, 23, 42]) {
      const run = startRun(seed, '1', 48, 'all');
      let guard = 0;
      let wide = false;
      while (nodeCount(run.tree) < 48) {
        expect(armObfuscate(run)).toBe(true);
        commit(run);
        if (solvableCount(run) > 1) wide = true;
        if (++guard > 4000) throw new Error('proof did not finish');
      }
      if (wide) branched += 1;
    }
    expect(branched).toBeGreaterThanOrEqual(8);
  });

  it('solves a piece that is not always the one just written', () => {
    const peeledLatest: boolean[] = [];
    const rewroteRestored: boolean[] = [];
    for (const seed of [1, 2, 3, 4, 5, 7, 11, 19, 23, 42]) {
      const run = startRun(seed, '1', 80, 'all');
      let guard = 0;
      let latest = '';
      while (solvableCount(run) < 2) {
        expect(armObfuscate(run)).toBe(true);
        latest = run.pending?.arrived ?? '';
        commit(run);
        if (++guard > 4000) throw new Error('proof did not branch');
      }
      expect(armSolve(run)).toBe(true);
      const peeled = run.pending?.focus;
      const restored = run.pending?.arrived ?? '';
      peeledLatest.push(peeled === latest);
      commit(run);
      expect(armObfuscate(run)).toBe(true);
      rewroteRestored.push(run.pending?.focus === restored);
    }
    expect(peeledLatest.some((hit) => !hit)).toBe(true);
    expect(rewroteRestored.some((hit) => !hit)).toBe(true);
  });

  it('returns to the exact start for every flavor', () => {
    for (const flavor of ['all', 'trig', 'calculus', 'series', 'complex'] as const) {
      for (const start of ['0', '1'] as const) {
        const run = finish(flavor === 'all' ? 7 : 3, start, 42, flavor);
        expect(run.tree).toMatchObject({ type: 'num', value: Number(start) });
        expect(canSolve(run)).toBe(false);
        expect(run.applied).toBeGreaterThan(0);
        expect(run.collapsed).toBeGreaterThan(0);
        expect(run.peak).toBeGreaterThanOrEqual(42);
      }
    }
  });

  it('stays near the start through a whole pass', () => {
    for (const start of ['0', '1'] as const) {
      const run = startRun(11, start, 28, 'all');
      let guard = 0;
      while (nodeCount(run.tree) < 28) {
        expect(armObfuscate(run)).toBe(true);
        commit(run);
        const value = evaluate(run.tree, sampleEnv(run.tree, 0));
        expect(Math.hypot(value.re - run.start, value.im), `${start} after ${run.lastRule}`).toBeLessThan(0.5);
        if (++guard > 4000) throw new Error('proof did not finish');
      }
      while (canSolve(run)) {
        expect(armSolve(run)).toBe(true);
        commit(run);
        const value = evaluate(run.tree, sampleEnv(run.tree, 0));
        expect(Math.hypot(value.re - run.start, value.im), `${start} after ${run.lastRule}`).toBeLessThan(0.5);
        if (++guard > 4000) throw new Error('proof did not finish');
      }
    }
  });

  it('returns to every other start', () => {
    for (const start of ['2', 'e', 'pi', 'ln2', 'half'] as const) {
      const run = finish(5, start, 24, 'all');
      expect(shape(run.tree)).toBe(startShape(start));
      expect(canSolve(run)).toBe(false);
    }
  });

  it('repeats a seed exactly', () => {
    expect(trace(19)).toEqual(trace(19));
    expect(trace(19)).not.toEqual(trace(23));
  });
});

describe('latex', () => {
  it('typesets the monster', () => {
    const run = startRun(5, '1', 48, 'all');
    let guard = 0;
    while (nodeCount(run.tree) < 48) {
      expect(armObfuscate(run)).toBe(true);
      commit(run);
      if (++guard > 4000) throw new Error('proof did not finish');
    }
    const source = latex(run.tree);
    for (const id of idsOf(run.tree)) expect(source).toContain(`\\htmlId{${id}}`);
    expect(() => katex.renderToString(source, { throwOnError: true, trust: true, displayMode: true })).not.toThrow();
  });
});
