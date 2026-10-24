import { createRng, type Rng } from '../../harness/author';
import {
  children,
  constant,
  div,
  fn,
  nodeCount,
  num,
  replaceAt,
  walk,
  type Expr,
  type Gen,
} from './expr';
import { invert } from './recover';
import { rulesFor, type Flavor, type Rule } from './rules';

export type Rewrite = {
  mode: 'expand' | 'simplify';
  rule: string;
  /** The piece on screen before the swap. */
  focus: string;
  /** The piece that arrives with the swap. */
  arrived: string;
  tree: Expr;
};

export const STARTS = ['1', '0', '2', 'e', 'pi', 'ln2', 'half'] as const;
export type StartName = (typeof STARTS)[number];

export function isStart(value: unknown): value is StartName {
  return typeof value === 'string' && (STARTS as readonly string[]).includes(value);
}

export function startValue(name: StartName): number {
  switch (name) {
    case '0':
      return 0;
    case '1':
      return 1;
    case '2':
      return 2;
    case 'e':
      return Math.E;
    case 'pi':
      return Math.PI;
    case 'ln2':
      return Math.LN2;
    case 'half':
      return 0.5;
  }
}

function startTree(gen: Gen, name: StartName): Expr {
  switch (name) {
    case '0':
      return num(gen, 0);
    case '1':
      return num(gen, 1);
    case '2':
      return num(gen, 2);
    case 'e':
      return constant(gen, 'e');
    case 'pi':
      return constant(gen, 'pi');
    case 'ln2':
      return fn(gen, 'ln', num(gen, 2));
    case 'half':
      return div(gen, num(gen, 1), num(gen, 2));
  }
}

export type Run = {
  tree: Expr;
  start: number;
  pending: Rewrite | null;
  applied: number;
  collapsed: number;
  peak: number;
  lastRule: string;
  target: number;
  flavor: Flavor;
  rng: Rng;
  gen: Gen;
};

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

function depthsOf(expr: Expr): Map<string, number> {
  const depths = new Map<string, number>();
  const visit = (node: Expr, depth: number): void => {
    depths.set(node.id, depth);
    for (const child of children(node)) visit(child, depth + 1);
  };
  visit(expr, 0);
  return depths;
}

function pickWeighted(rng: Rng, pool: readonly Expr[], depthOf: Map<string, number>): Expr {
  const weights = pool.map((node) => {
    const depth = depthOf.get(node.id) ?? 0;
    const leaf = children(node).length === 0;
    return (leaf ? 4 : 1) * 0.5 ** depth;
  });
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = rng.next() * total;
  for (let index = 0; index < pool.length; index += 1) {
    cursor -= weights[index] ?? 0;
    if (cursor < 0) return pool[index]!;
  }
  return pool[pool.length - 1]!;
}

function planExpand(run: Run): Rewrite | null {
  const rules = rulesFor(run.flavor);
  const nodes = flattened(run.tree);
  const depthOf = depthsOf(run.tree);
  const juicy = nodes.filter((node) => rules.some((rule) => rule.kind === 'value' && rule.applies(node)));
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const wantValue = run.rng.next() < 0.5;
    const pool = wantValue && juicy.length > 0 ? juicy : nodes;
    const node = pickWeighted(run.rng, pool, depthOf);
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
    return {
      mode: 'expand',
      rule: labelFor(rule, node),
      focus: node.id,
      arrived: built.expr.id,
      tree,
    };
  }
  return null;
}

type Opening = { node: Expr; rule: Rule };

function openings(run: Run): Opening[] {
  const rules = rulesFor(run.flavor);
  const scratch: Gen = { id: 1, name: 1 };
  const found: Opening[] = [];
  for (const node of flattened(run.tree)) {
    for (const rule of rules) {
      scratch.id = 1;
      scratch.name = 1;
      if (invert(rule, node, scratch)) found.push({ node, rule });
    }
  }
  return found;
}

export function solvableCount(run: Run): number {
  return openings(run).length;
}

function planSimplify(run: Run): Rewrite | null {
  const ready = openings(run);
  if (ready.length === 0) return null;
  const chosen = run.rng.pick(ready);
  const expr = invert(chosen.rule, chosen.node, run.gen);
  if (!expr) return null;
  return {
    mode: 'simplify',
    rule: chosen.rule.label,
    focus: chosen.node.id,
    arrived: expr.id,
    tree: replaceAt(run.tree, chosen.node.id, expr),
  };
}

export function startRun(seed: number, start: StartName, target: number, flavor: Flavor): Run {
  const gen: Gen = { id: 0, name: 0 };
  const tree = startTree(gen, start);
  return {
    tree,
    start: startValue(start),
    pending: null,
    applied: 0,
    collapsed: 0,
    peak: nodeCount(tree),
    lastRule: '',
    target,
    flavor,
    rng: createRng(seed),
    gen,
  };
}

export function canSolve(run: Run): boolean {
  return solvableCount(run) > 0;
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
  if (run.pending) return false;
  const rewrite = planSimplify(run);
  if (!rewrite) return false;
  run.pending = rewrite;
  return true;
}

export function commit(run: Run): void {
  const rewrite = run.pending;
  if (!rewrite) return;
  run.tree = rewrite.tree;
  run.pending = null;
  if (rewrite.mode === 'expand') run.applied += 1;
  else run.collapsed += 1;
  run.peak = Math.max(run.peak, nodeCount(run.tree));
  run.lastRule = rewrite.rule;
}
