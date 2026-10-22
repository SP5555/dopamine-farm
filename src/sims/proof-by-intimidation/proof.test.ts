import { createRng } from '../../harness/author';
import katex from 'katex';
import { describe, expect, it } from 'vitest';
import {
  binderNames,
  clone,
  constant,
  findById,
  fn,
  freeVars,
  freshName,
  idsOf,
  introducedIds,
  latex,
  nodeCount,
  num,
  replaceAt,
  variable,
  walk,
  type Expr,
  type Gen,
} from './expr';
import { evaluate, near, proveValue, sampleEnv } from './eval';
import { applyRewrite, armObfuscate, armSolve, collapsibleSteps, commit, startRun, type HistoryStep } from './engine';
import { RULES, type Rule } from './rules';

function finish(seed: number, start: 0 | 1, target: number, flavor: 'all' | 'trig' | 'calculus' | 'series' | 'complex') {
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
  while (run.history.length > 0) {
    expect(collapsibleSteps(run.tree, run.history).length).toBeGreaterThan(0);
    expect(armSolve(run)).toBe(true);
    commit(run);
    if (++guard > 4000) throw new Error('proof did not finish');
  }
  return run;
}

function trace(seed: number): string[] {
  const run = startRun(seed, 1, 36, 'all');
  const labels: string[] = [];
  let guard = 0;
  while (nodeCount(run.tree) < 36) {
    expect(armObfuscate(run)).toBe(true);
    labels.push(run.pending?.rule ?? '');
    commit(run);
    if (++guard > 4000) throw new Error('proof did not finish');
  }
  while (run.history.length > 0) {
    expect(armSolve(run)).toBe(true);
    labels.push(run.pending?.rule ?? '');
    commit(run);
    if (++guard > 4000) throw new Error('proof did not finish');
  }
  return labels;
}

describe('identities', () => {
  for (const rule of RULES.filter((entry) => entry.kind === 'value')) {
    it(rule.label, () => {
      for (let seed = 1; seed <= 4; seed += 1) {
        const gen: Gen = { id: 0, name: 0 };
        const rng = createRng(seed);
        const literal = literalFor(rule, gen);
        if (!literal || literal.type !== 'num' || !rule.applies(literal)) continue;
        const built = rule.build(literal, { gen, rng });
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
});

function literalFor(rule: Rule, gen: Gen): Expr | null {
  if (rule.id === 'split') return num(gen, 4);
  if (rule.applies(num(gen, 1))) return num(gen, 1);
  if (rule.applies(num(gen, 0))) return num(gen, 0);
  return null;
}

function sampleHoles(gen: Gen) {
  const name = freshName(gen, 'x');
  return [num(gen, 2), variable(gen, name, false), fn(gen, 'sin', variable(gen, name, false))];
}

describe('collapse', () => {
  it('peels a wrapper only after the rewrite inside it is gone', () => {
    const gen: Gen = { id: 0, name: 0 };
    const rng = createRng(2);
    const one = num(gen, 1);
    const plus = RULES.find((entry) => entry.id === 'plus-zero')!;
    const pyth = RULES.find((entry) => entry.id === 'pythagorean')!;
    const wrapped = plus.build(one, { gen, rng });
    const outer: HistoryStep = {
      rule: plus.label,
      rootId: wrapped.expr.id,
      holeId: one.id,
      before: null,
      templateIds: introducedIds(wrapped.expr, one),
    };
    const innerBuilt = pyth.build(one, { gen, rng });
    const inner: HistoryStep = {
      rule: pyth.label,
      rootId: innerBuilt.expr.id,
      holeId: null,
      before: clone(one),
      templateIds: introducedIds(innerBuilt.expr, null),
    };
    const grafted = applyRewrite([outer], {
      mode: 'expand',
      rule: inner.rule,
      highlight: [one.id],
      tree: replaceAt(wrapped.expr, one.id, innerBuilt.expr),
      step: inner,
      retargetFrom: one.id,
      retargetTo: innerBuilt.expr.id,
    });
    expect(outer.holeId).toBe(innerBuilt.expr.id);
    expect(collapsibleSteps(grafted.tree, grafted.history).map((step) => step.rootId)).toEqual([inner.rootId]);
    const restored = applyRewrite(grafted.history, {
      mode: 'simplify',
      rule: inner.rule,
      highlight: inner.templateIds,
      tree: replaceAt(grafted.tree, inner.rootId, inner.before!),
      step: inner,
      retargetFrom: inner.rootId,
      retargetTo: inner.before!.id,
    });
    expect(restored.tree.type).toBe('add');
    expect(outer.holeId).toBe(one.id);
    const hole = findById(restored.tree, one.id);
    const peeled = applyRewrite(restored.history, {
      mode: 'simplify',
      rule: outer.rule,
      highlight: outer.templateIds,
      tree: replaceAt(restored.tree, outer.rootId, hole!),
      step: outer,
      retargetFrom: outer.rootId,
      retargetTo: hole!.id,
    });
    expect(peeled.tree).toMatchObject({ type: 'num', value: 1 });
    expect(peeled.history).toHaveLength(0);
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
      const run = startRun(seed, 1, 60, 'all');
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
      const run = startRun(seed, 1, 48, 'all');
      let guard = 0;
      let wide = false;
      while (nodeCount(run.tree) < 48) {
        expect(armObfuscate(run)).toBe(true);
        commit(run);
        if (collapsibleSteps(run.tree, run.history).length > 1) wide = true;
        if (++guard > 4000) throw new Error('proof did not finish');
      }
      if (wide) branched += 1;
    }
    expect(branched).toBeGreaterThanOrEqual(8);
  });

  it('solves an exposed piece that is not always the latest one', () => {
    const peeledLatest: boolean[] = [];
    for (const seed of [1, 2, 3, 4, 5, 7, 11, 19, 23, 42]) {
      const run = startRun(seed, 1, 80, 'all');
      let guard = 0;
      while (collapsibleSteps(run.tree, run.history).length < 2) {
        expect(armObfuscate(run)).toBe(true);
        commit(run);
        if (++guard > 4000) throw new Error('proof did not branch');
      }
      const latest = run.history[run.history.length - 1]!.rootId;
      const ready = collapsibleSteps(run.tree, run.history).map((step) => step.rootId);
      expect(armSolve(run)).toBe(true);
      const peeled = run.pending?.step.rootId;
      expect(ready).toContain(peeled);
      peeledLatest.push(peeled === latest);
    }
    expect(peeledLatest.some((hit) => !hit)).toBe(true);
  });

  it('returns to the exact start for every flavor', () => {
    for (const flavor of ['all', 'trig', 'calculus', 'series', 'complex'] as const) {
      for (const start of [0, 1] as const) {
        const run = finish(flavor === 'all' ? 7 : 3, start, 42, flavor);
        expect(run.tree).toMatchObject({ type: 'num', value: start });
        expect(run.history).toHaveLength(0);
        expect(run.applied).toBeGreaterThan(0);
        expect(run.collapsed).toBe(run.applied);
        expect(run.peak).toBeGreaterThanOrEqual(42);
      }
    }
  });

  it('keeps the value through a whole pass', () => {
    for (const start of [0, 1] as const) {
      const run = startRun(11, start, 28, 'all');
      let guard = 0;
      while (nodeCount(run.tree) < 28) {
        expect(armObfuscate(run)).toBe(true);
        commit(run);
        const verdict = proveValue(run.tree, start);
        expect(verdict.ok, `${start} after ${run.lastRule}: ${verdict.text}`).toBe(true);
        if (++guard > 4000) throw new Error('proof did not finish');
      }
      while (run.history.length > 0) {
        expect(armSolve(run)).toBe(true);
        commit(run);
        const verdict = proveValue(run.tree, start);
        expect(verdict.ok, `${start} after ${run.lastRule}: ${verdict.text}`).toBe(true);
        if (++guard > 4000) throw new Error('proof did not finish');
      }
    }
  });

  it('repeats a seed exactly', () => {
    expect(trace(19)).toEqual(trace(19));
    expect(trace(19)).not.toEqual(trace(23));
  });
});

describe('latex', () => {
  it('typesets the monster', () => {
    const run = startRun(5, 1, 48, 'all');
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
