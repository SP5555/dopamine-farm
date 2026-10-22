import { createRng, type Rng } from '../../harness/author';
import {
  clone,
  findById,
  introducedIds,
  nodeCount,
  num,
  replaceAt,
  walk,
  type Expr,
  type Gen,
} from './expr';
import { rulesFor, type Flavor, type Rule } from './rules';

export type HistoryStep = {
  rule: string;
  rootId: string;
  holeId: string | null;
  before: Expr | null;
  templateIds: string[];
};

export type Rewrite = {
  mode: 'expand' | 'simplify';
  rule: string;
  highlight: string[];
  tree: Expr;
  step: HistoryStep;
  retargetFrom: string | null;
  retargetTo: string | null;
};

export type Run = {
  tree: Expr;
  start: 0 | 1;
  pending: Rewrite | null;
  history: HistoryStep[];
  applied: number;
  collapsed: number;
  peak: number;
  lastRule: string;
  target: number;
  flavor: Flavor;
  rng: Rng;
  gen: Gen;
};

/**
 * A recorded step can collapse when no later rewrite still sits inside it.
 * Hole steps put the live occupant back, not a copy from when the wrapper was added,
 * so a rewrite inside the hole survives the peel.
 */
export function collapsibleSteps(tree: Expr, history: readonly HistoryStep[]): HistoryStep[] {
  const roots = new Set(history.map((step) => step.rootId));
  return history.filter((step) => {
    const node = findById(tree, step.rootId);
    if (!node) return false;
    let nested = false;
    walk(node, (current) => {
      if (current.id !== node.id && roots.has(current.id)) nested = true;
    });
    return !nested;
  });
}

function retarget(history: HistoryStep[], from: string, to: string): void {
  if (from === to) return;
  for (const step of history) {
    if (step.holeId === from) step.holeId = to;
  }
}

export function applyRewrite(history: HistoryStep[], rewrite: Rewrite): { tree: Expr; history: HistoryStep[] } {
  if (rewrite.retargetFrom !== null && rewrite.retargetTo !== null) {
    retarget(history, rewrite.retargetFrom, rewrite.retargetTo);
  }
  if (rewrite.mode === 'expand') history.push(rewrite.step);
  else {
    const index = history.indexOf(rewrite.step);
    if (index >= 0) history.splice(index, 1);
  }
  return { tree: rewrite.tree, history };
}

function labelFor(rule: Rule, node: Expr): string {
  if (rule.id === 'split' && node.type === 'num') return `${node.value} → 1 + ${node.value - 1}`;
  return rule.label;
}

function longestNegation(expr: Expr): number {
  let worst = 0;
  walk(expr, (node) => {
    let depth = 0;
    let current: Expr | undefined = node;
    while (current?.type === 'neg') {
      depth += 1;
      current = current.arg;
      if (depth > worst) worst = depth;
    }
  });
  return worst;
}

function flattened(expr: Expr): Expr[] {
  const nodes: Expr[] = [];
  walk(expr, (node) => nodes.push(node));
  return nodes;
}

function outsideLatest(run: Run, nodes: Expr[]): Expr[] {
  const latest = run.history[run.history.length - 1];
  if (!latest) return [];
  const root = findById(run.tree, latest.rootId);
  if (!root) return [];
  const inside = new Set<string>();
  walk(root, (node) => inside.add(node.id));
  return nodes.filter((node) => !inside.has(node.id));
}

function planExpand(run: Run): Rewrite | null {
  const rules = rulesFor(run.flavor);
  const nodes = flattened(run.tree);
  const elsewhere = outsideLatest(run, nodes);
  const juicy = nodes.filter((node) => rules.some((rule) => rule.kind === 'value' && rule.applies(node)));
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const spread = elsewhere.length > 0 && run.rng.next() < 0.65;
    const wantValue = run.rng.next() < 0.5;
    const valuePool = spread ? juicy.filter((node) => elsewhere.includes(node)) : juicy;
    const spreadPool = spread ? elsewhere : nodes;
    const pool = wantValue && valuePool.length > 0 ? valuePool : spreadPool;
    const node = run.rng.pick(pool);
    const applicable = rules.filter((rule) => rule.applies(node));
    if (applicable.length === 0) continue;
    const valueRules = applicable.filter((rule) => rule.kind === 'value');
    const structural = applicable.filter((rule) => rule.kind === 'structural');
    const choices = valueRules.length > 0 && structural.length > 0 ? (wantValue ? valueRules : structural) : applicable;
    const rule = run.rng.pick(choices);
    const built = rule.build(node, { gen: run.gen, rng: run.rng });
    if (nodeCount(built.expr) <= 1 && !built.hole) continue;
    const tree = replaceAt(run.tree, node.id, built.expr);
    if (longestNegation(tree) > 1) continue;
    const step: HistoryStep = {
      rule: labelFor(rule, node),
      rootId: built.expr.id,
      holeId: built.hole ? node.id : null,
      before: built.hole ? null : clone(node),
      templateIds: introducedIds(built.expr, built.hole ? node : null),
    };
    return {
      mode: 'expand',
      rule: step.rule,
      highlight: [node.id],
      tree,
      step,
      retargetFrom: built.hole ? null : node.id,
      retargetTo: built.hole ? null : built.expr.id,
    };
  }
  return null;
}

function planSimplify(run: Run): Rewrite | null {
  if (run.history.length === 0) return null;
  const ready = collapsibleSteps(run.tree, run.history);
  if (ready.length === 0) {
    throw new Error('Proof by intimidation has history it cannot collapse');
  }
  // Each of these is a leaf of the rewrite nesting: nothing later still sits inside it.
  const step = run.rng.pick(ready);
  if (step.holeId) {
    const hole = findById(run.tree, step.holeId);
    if (!hole) throw new Error('Proof by intimidation lost the live hole');
    return {
      mode: 'simplify',
      rule: step.rule,
      highlight: step.templateIds,
      tree: replaceAt(run.tree, step.rootId, hole),
      step,
      retargetFrom: step.rootId,
      retargetTo: hole.id,
    };
  }
  if (!step.before) throw new Error('Proof by intimidation is missing the snapshot it needs');
  return {
    mode: 'simplify',
    rule: step.rule,
    highlight: step.templateIds,
    tree: replaceAt(run.tree, step.rootId, step.before),
    step,
    retargetFrom: step.rootId,
    retargetTo: step.before.id,
  };
}

export function startRun(seed: number, start: 0 | 1, target: number, flavor: Flavor): Run {
  const gen: Gen = { id: 0, name: 0 };
  return {
    tree: num(gen, start),
    start,
    pending: null,
    history: [],
    applied: 0,
    collapsed: 0,
    peak: 1,
    lastRule: '',
    target,
    flavor,
    rng: createRng(seed),
    gen,
  };
}

export function canSolve(run: Run): boolean {
  return collapsibleSteps(run.tree, run.history).length > 0;
}

export function atSize(run: Run): boolean {
  return nodeCount(run.tree) >= run.target;
}

export function armObfuscate(run: Run): boolean {
  if (run.pending) return false;
  const rewrite = planExpand(run);
  if (!rewrite) return false;
  run.pending = rewrite;
  return true;
}

export function armSolve(run: Run): boolean {
  if (run.pending || !canSolve(run)) return false;
  const rewrite = planSimplify(run);
  if (!rewrite) return false;
  run.pending = rewrite;
  return true;
}

export function commit(run: Run): void {
  const rewrite = run.pending;
  if (!rewrite) return;
  const applied = applyRewrite(run.history, rewrite);
  run.tree = applied.tree;
  run.history = applied.history;
  run.pending = null;
  if (rewrite.mode === 'expand') run.applied += 1;
  else run.collapsed += 1;
  run.peak = Math.max(run.peak, nodeCount(run.tree));
  run.lastRule = rewrite.rule;
}
