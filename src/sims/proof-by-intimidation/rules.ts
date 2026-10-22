import type { Rng } from '../../harness/author';
import {
  add,
  binom,
  constant,
  det,
  deriv,
  div,
  fact,
  fn,
  freshName,
  integral,
  isReal,
  lim,
  mul,
  neg,
  num,
  pow,
  sum,
  variable,
  type Expr,
  type Gen,
} from './expr';

export type Flavor = 'all' | 'trig' | 'calculus' | 'series' | 'complex';
export type Built = { expr: Expr; hole: boolean };
export type RuleCtx = { gen: Gen; rng: Rng };

type Tag = Flavor | 'core';

export type Rule = {
  id: string;
  label: string;
  tags: Tag[];
  kind: 'value' | 'structural';
  applies: (node: Expr) => boolean;
  build: (node: Expr, ctx: RuleCtx) => Built;
};

function isNum(node: Expr, value: number): boolean {
  return node.type === 'num' && node.value === value;
}

function use(ctx: RuleCtx, name: string, bound: boolean): Expr {
  return variable(ctx.gen, name, bound);
}

export const RULES: Rule[] = [
  {
    id: 'pythagorean',
    label: '1 → sin² + cos²',
    tags: ['trig'],
    kind: 'value',
    applies: (node) => isNum(node, 1),
    build: (_node, ctx) => {
      const x = freshName(ctx.gen, 'x');
      return {
        expr: add(ctx.gen, [
          pow(ctx.gen, fn(ctx.gen, 'sin', use(ctx, x, false)), num(ctx.gen, 2)),
          pow(ctx.gen, fn(ctx.gen, 'cos', use(ctx, x, false)), num(ctx.gen, 2)),
        ]),
        hole: false,
      };
    },
  },
  {
    id: 'hyperbolic',
    label: '1 → cosh² − sinh²',
    tags: ['trig'],
    kind: 'value',
    applies: (node) => isNum(node, 1),
    build: (_node, ctx) => {
      const u = freshName(ctx.gen, 'u');
      return {
        expr: add(ctx.gen, [
          pow(ctx.gen, fn(ctx.gen, 'cosh', use(ctx, u, false)), num(ctx.gen, 2)),
          neg(ctx.gen, pow(ctx.gen, fn(ctx.gen, 'sinh', use(ctx, u, false)), num(ctx.gen, 2))),
        ]),
        hole: false,
      };
    },
  },
  {
    id: 'cos-zero',
    label: '1 → cos 0',
    tags: ['trig'],
    kind: 'value',
    applies: (node) => isNum(node, 1),
    build: (_node, ctx) => ({ expr: fn(ctx.gen, 'cos', num(ctx.gen, 0)), hole: false }),
  },
  {
    id: 'sin-pi',
    label: '0 → sin π',
    tags: ['trig'],
    kind: 'value',
    applies: (node) => isNum(node, 0),
    build: (_node, ctx) => ({ expr: fn(ctx.gen, 'sin', constant(ctx.gen, 'pi')), hole: false }),
  },
  {
    id: 'unit-interval',
    label: '1 → ∫₀¹ 2t dt',
    tags: ['calculus'],
    kind: 'value',
    applies: (node) => isNum(node, 1),
    build: (_node, ctx) => {
      const t = freshName(ctx.gen, 't');
      return {
        expr: integral(ctx.gen, t, num(ctx.gen, 0), num(ctx.gen, 1), mul(ctx.gen, [num(ctx.gen, 2), use(ctx, t, true)])),
        hole: false,
      };
    },
  },
  {
    id: 'exponential-integral',
    label: '1 → ∫₀^∞ e⁻ᵗ dt',
    tags: ['calculus'],
    kind: 'value',
    applies: (node) => isNum(node, 1),
    build: (_node, ctx) => {
      const t = freshName(ctx.gen, 't');
      return {
        expr: integral(
          ctx.gen,
          t,
          num(ctx.gen, 0),
          constant(ctx.gen, 'inf'),
          fn(ctx.gen, 'exp', neg(ctx.gen, use(ctx, t, true))),
        ),
        hole: false,
      };
    },
  },
  {
    id: 'sine-integral',
    label: '1 → ∫₀^{π/2} sin t dt',
    tags: ['calculus'],
    kind: 'value',
    applies: (node) => isNum(node, 1),
    build: (_node, ctx) => {
      const t = freshName(ctx.gen, 't');
      return {
        expr: integral(
          ctx.gen,
          t,
          num(ctx.gen, 0),
          div(ctx.gen, constant(ctx.gen, 'pi'), num(ctx.gen, 2)),
          fn(ctx.gen, 'sin', use(ctx, t, true)),
        ),
        hole: false,
      };
    },
  },
  {
    id: 'gaussian',
    label: '1 → Gaussian integral',
    tags: ['calculus'],
    kind: 'value',
    applies: (node) => isNum(node, 1),
    build: (_node, ctx) => {
      const t = freshName(ctx.gen, 't');
      const body = fn(ctx.gen, 'exp', neg(ctx.gen, pow(ctx.gen, use(ctx, t, true), num(ctx.gen, 2))));
      const whole = integral(ctx.gen, t, neg(ctx.gen, constant(ctx.gen, 'inf')), constant(ctx.gen, 'inf'), body);
      const coef = pow(
        ctx.gen,
        constant(ctx.gen, 'pi'),
        div(ctx.gen, neg(ctx.gen, num(ctx.gen, 1)), num(ctx.gen, 2)),
      );
      return { expr: mul(ctx.gen, [coef, whole]), hole: false };
    },
  },
  {
    id: 'sinc-limit',
    label: '1 → lim sin t / t',
    tags: ['calculus'],
    kind: 'value',
    applies: (node) => isNum(node, 1),
    build: (_node, ctx) => {
      const t = freshName(ctx.gen, 't');
      return {
        expr: lim(ctx.gen, t, num(ctx.gen, 0), div(ctx.gen, fn(ctx.gen, 'sin', use(ctx, t, true)), use(ctx, t, true))),
        hole: false,
      };
    },
  },
  {
    id: 'derivative',
    label: '1 → d/dt t',
    tags: ['calculus'],
    kind: 'value',
    applies: (node) => isNum(node, 1),
    build: (_node, ctx) => {
      const t = freshName(ctx.gen, 't');
      return { expr: deriv(ctx.gen, t, use(ctx, t, true)), hole: false };
    },
  },
  {
    id: 'exp-zero',
    label: '1 → e⁰',
    tags: ['calculus'],
    kind: 'value',
    applies: (node) => isNum(node, 1),
    build: (_node, ctx) => ({ expr: fn(ctx.gen, 'exp', num(ctx.gen, 0)), hole: false }),
  },
  {
    id: 'ln-one',
    label: '0 → ln 1',
    tags: ['calculus'],
    kind: 'value',
    applies: (node) => isNum(node, 0),
    build: (_node, ctx) => ({ expr: fn(ctx.gen, 'ln', num(ctx.gen, 1)), hole: false }),
  },
  {
    id: 'odd-integral',
    label: '0 → ∫₋ₐᵃ t³ dt',
    tags: ['calculus'],
    kind: 'value',
    applies: (node) => isNum(node, 0),
    build: (_node, ctx) => {
      const a = freshName(ctx.gen, 'a');
      const t = freshName(ctx.gen, 't');
      return {
        expr: integral(
          ctx.gen,
          t,
          neg(ctx.gen, use(ctx, a, false)),
          use(ctx, a, false),
          pow(ctx.gen, use(ctx, t, true), num(ctx.gen, 3)),
        ),
        hole: false,
      };
    },
  },
  {
    id: 'geometric',
    label: '1 → Σ 1/2ⁿ',
    tags: ['series'],
    kind: 'value',
    applies: (node) => isNum(node, 1),
    build: (_node, ctx) => {
      const n = freshName(ctx.gen, 'n');
      return {
        expr: sum(
          ctx.gen,
          n,
          num(ctx.gen, 1),
          constant(ctx.gen, 'inf'),
          div(ctx.gen, num(ctx.gen, 1), pow(ctx.gen, num(ctx.gen, 2), use(ctx, n, true))),
        ),
        hole: false,
      };
    },
  },
  {
    id: 'binomial-average',
    label: '1 → 2⁻ⁿ Σ C(n, k)',
    tags: ['series'],
    kind: 'value',
    applies: (node) => isNum(node, 1),
    build: (_node, ctx) => {
      const n = 2 + ctx.rng.int(4);
      const k = freshName(ctx.gen, 'k');
      const total = sum(
        ctx.gen,
        k,
        num(ctx.gen, 0),
        num(ctx.gen, n),
        binom(ctx.gen, num(ctx.gen, n), use(ctx, k, true)),
      );
      return {
        expr: div(ctx.gen, total, pow(ctx.gen, num(ctx.gen, 2), num(ctx.gen, n))),
        hole: false,
      };
    },
  },
  {
    id: 'alternating-binomial',
    label: '0 → Σ (−1)ᵏ C(n, k)',
    tags: ['series'],
    kind: 'value',
    applies: (node) => isNum(node, 0),
    build: (_node, ctx) => {
      const n = 1 + ctx.rng.int(4);
      const k = freshName(ctx.gen, 'k');
      return {
        expr: sum(
          ctx.gen,
          k,
          num(ctx.gen, 0),
          num(ctx.gen, n),
          mul(ctx.gen, [
            pow(ctx.gen, neg(ctx.gen, num(ctx.gen, 1)), use(ctx, k, true)),
            binom(ctx.gen, num(ctx.gen, n), use(ctx, k, true)),
          ]),
        ),
        hole: false,
      };
    },
  },
  {
    id: 'gamma-one',
    label: '1 → Γ(1)',
    tags: ['series'],
    kind: 'value',
    applies: (node) => isNum(node, 1),
    build: (_node, ctx) => ({ expr: fn(ctx.gen, 'gamma', num(ctx.gen, 1)), hole: false }),
  },
  {
    id: 'zero-factorial',
    label: '1 → 0!',
    tags: ['series'],
    kind: 'value',
    applies: (node) => isNum(node, 1),
    build: (_node, ctx) => ({ expr: fact(ctx.gen, num(ctx.gen, 0)), hole: false }),
  },
  {
    id: 'log-two',
    label: '1 → log₂ 2',
    tags: ['series'],
    kind: 'value',
    applies: (node) => isNum(node, 1),
    build: (_node, ctx) => ({
      expr: div(ctx.gen, fn(ctx.gen, 'ln', num(ctx.gen, 2)), fn(ctx.gen, 'ln', num(ctx.gen, 2))),
      hole: false,
    }),
  },
  {
    id: 'euler',
    label: '1 → e^{iπ} + 2',
    tags: ['complex'],
    kind: 'value',
    applies: (node) => isNum(node, 1),
    build: (_node, ctx) => ({
      expr: add(ctx.gen, [
        fn(ctx.gen, 'exp', mul(ctx.gen, [constant(ctx.gen, 'i'), constant(ctx.gen, 'pi')])),
        num(ctx.gen, 2),
      ]),
      hole: false,
    }),
  },
  {
    id: 'i-fourth',
    label: '1 → i⁴',
    tags: ['complex'],
    kind: 'value',
    applies: (node) => isNum(node, 1),
    build: (_node, ctx) => ({ expr: pow(ctx.gen, constant(ctx.gen, 'i'), num(ctx.gen, 4)), hole: false }),
  },
  {
    id: 'hyperbolic-det',
    label: '1 → det cosh',
    tags: ['complex'],
    kind: 'value',
    applies: (node) => isNum(node, 1),
    build: (_node, ctx) => {
      const u = freshName(ctx.gen, 'u');
      return {
        expr: det(
          ctx.gen,
          fn(ctx.gen, 'cosh', use(ctx, u, false)),
          fn(ctx.gen, 'sinh', use(ctx, u, false)),
          fn(ctx.gen, 'sinh', use(ctx, u, false)),
          fn(ctx.gen, 'cosh', use(ctx, u, false)),
        ),
        hole: false,
      };
    },
  },
  {
    id: 'split',
    label: 'n → 1 + (n − 1)',
    tags: ['core'],
    kind: 'value',
    applies: (node) => node.type === 'num' && Number.isInteger(node.value) && node.value >= 2 && node.value <= 6,
    build: (node, ctx) => ({
      expr: add(ctx.gen, [num(ctx.gen, 1), num(ctx.gen, node.type === 'num' ? node.value - 1 : 1)]),
      hole: false,
    }),
  },
  {
    id: 'plus-zero',
    label: 'A → A + 0',
    tags: ['core'],
    kind: 'structural',
    applies: () => true,
    build: (node, ctx) => ({ expr: add(ctx.gen, [node, num(ctx.gen, 0)]), hole: true }),
  },
  {
    id: 'times-one',
    label: 'A → A · 1',
    tags: ['core'],
    kind: 'structural',
    applies: () => true,
    build: (node, ctx) => ({ expr: mul(ctx.gen, [node, num(ctx.gen, 1)]), hole: true }),
  },
  {
    id: 'power-one',
    label: 'A → A¹',
    tags: ['core'],
    kind: 'structural',
    applies: () => true,
    build: (node, ctx) => ({ expr: pow(ctx.gen, node, num(ctx.gen, 1)), hole: true }),
  },
  {
    id: 'double-neg',
    label: 'A → −(−A)',
    tags: ['core'],
    kind: 'structural',
    applies: (node) => node.type !== 'neg',
    build: (node, ctx) => ({ expr: neg(ctx.gen, neg(ctx.gen, node)), hole: true }),
  },
  {
    id: 'cancel-scale',
    label: 'A → (A · c) / c',
    tags: ['core'],
    kind: 'structural',
    applies: () => true,
    build: (node, ctx) => {
      const scale = 2 + ctx.rng.int(3);
      return {
        expr: div(ctx.gen, mul(ctx.gen, [node, num(ctx.gen, scale)]), num(ctx.gen, scale)),
        hole: true,
      };
    },
  },
  {
    id: 'ln-exp',
    label: 'A → ln(eᴬ)',
    tags: ['core'],
    kind: 'structural',
    applies: (node) => isReal(node),
    build: (node, ctx) => ({ expr: fn(ctx.gen, 'ln', fn(ctx.gen, 'exp', node)), hole: true }),
  },
];

export function rulesFor(flavor: Flavor): Rule[] {
  if (flavor === 'all') return RULES;
  return RULES.filter((rule) => rule.tags.includes('core') || rule.tags.includes(flavor));
}
