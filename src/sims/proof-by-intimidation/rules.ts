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
  duplicate,
  isReal,
  lim,
  mul,
  neg,
  num,
  pow,
  sum,
  variable,
  type Expr,
  type FnName,
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

function integer(node: Expr): number | null {
  if (node.type !== 'num' || !Number.isInteger(node.value)) return null;
  return node.value;
}

function squareArg(node: Expr, name: FnName): Expr | null {
  if (node.type !== 'pow' || !isNum(node.exp, 2)) return null;
  if (node.base.type !== 'fn' || node.base.name !== name) return null;
  return node.base.arg;
}

function subtract(ctx: RuleCtx, left: Expr, right: Expr): Expr {
  return add(ctx.gen, [left, right.type === 'neg' ? right.arg : neg(ctx.gen, right)]);
}

function pred(ctx: RuleCtx, node: Expr): Expr {
  if (node.type === 'num') return num(ctx.gen, node.value - 1);
  return add(ctx.gen, [node, neg(ctx.gen, num(ctx.gen, 1))]);
}

function isE(node: Expr): boolean {
  return node.type === 'const' && node.name === 'e';
}

function isPi(node: Expr): boolean {
  return node.type === 'const' && node.name === 'pi';
}

function isLn2(node: Expr): boolean {
  return node.type === 'fn' && node.name === 'ln' && isNum(node.arg, 2);
}

function isHalf(node: Expr): boolean {
  return node.type === 'div' && isNum(node.num, 1) && isNum(node.den, 2);
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
  {
    id: 'reciprocal',
    label: 'A → 1/(1/A)',
    tags: ['core'],
    kind: 'structural',
    applies: (node) => !isNum(node, 0),
    build: (node, ctx) => ({
      expr: div(ctx.gen, num(ctx.gen, 1), div(ctx.gen, num(ctx.gen, 1), node)),
      hole: true,
    }),
  },
  {
    id: 'two-geometric',
    label: '2 → Σ 1/2ⁿ',
    tags: ['series'],
    kind: 'value',
    applies: (node) => isNum(node, 2),
    build: (_node, ctx) => {
      const n = freshName(ctx.gen, 'n');
      return {
        expr: sum(ctx.gen, n, num(ctx.gen, 0), constant(ctx.gen, 'inf'), div(ctx.gen, num(ctx.gen, 1), pow(ctx.gen, num(ctx.gen, 2), use(ctx, n, true)))),
        hole: false,
      };
    },
  },
  {
    id: 'two-gamma-integral',
    label: '2 → ∫ t² e⁻ᵗ dt',
    tags: ['calculus'],
    kind: 'value',
    applies: (node) => isNum(node, 2),
    build: (_node, ctx) => {
      const t = freshName(ctx.gen, 't');
      const body = mul(ctx.gen, [
        pow(ctx.gen, use(ctx, t, true), num(ctx.gen, 2)),
        fn(ctx.gen, 'exp', neg(ctx.gen, use(ctx, t, true))),
      ]);
      return {
        expr: integral(ctx.gen, t, num(ctx.gen, 0), constant(ctx.gen, 'inf'), body),
        hole: false,
      };
    },
  },
  {
    id: 'two-factorial',
    label: '2 → 2!',
    tags: ['series'],
    kind: 'value',
    applies: (node) => isNum(node, 2),
    build: (_node, ctx) => ({ expr: fact(ctx.gen, num(ctx.gen, 2)), hole: false }),
  },
  {
    id: 'two-gamma',
    label: '2 → Γ(3)',
    tags: ['series'],
    kind: 'value',
    applies: (node) => isNum(node, 2),
    build: (_node, ctx) => ({ expr: fn(ctx.gen, 'gamma', num(ctx.gen, 3)), hole: false }),
  },
  {
    id: 'two-hyperbolic',
    label: '2 → cosh(ln 2) + sinh(ln 2)',
    tags: ['trig'],
    kind: 'value',
    applies: (node) => isNum(node, 2),
    build: (_node, ctx) => {
      const arg = fn(ctx.gen, 'ln', num(ctx.gen, 2));
      return {
        expr: add(ctx.gen, [fn(ctx.gen, 'cosh', arg), fn(ctx.gen, 'sinh', duplicate(arg, ctx.gen))]),
        hole: false,
      };
    },
  },
  {
    id: 'e-power',
    label: 'e → e¹',
    tags: ['core'],
    kind: 'value',
    applies: isE,
    build: (_node, ctx) => ({ expr: fn(ctx.gen, 'exp', num(ctx.gen, 1)), hole: false }),
  },
  {
    id: 'ln-e',
    label: '1 → ln e',
    tags: ['core'],
    kind: 'value',
    applies: (node) => isNum(node, 1),
    build: (_node, ctx) => ({ expr: fn(ctx.gen, 'ln', constant(ctx.gen, 'e')), hole: false }),
  },
  {
    id: 'e-series',
    label: 'e → Σ 1/n!',
    tags: ['series'],
    kind: 'value',
    applies: isE,
    build: (_node, ctx) => {
      const n = freshName(ctx.gen, 'n');
      return {
        expr: sum(ctx.gen, n, num(ctx.gen, 0), constant(ctx.gen, 'inf'), div(ctx.gen, num(ctx.gen, 1), fact(ctx.gen, use(ctx, n, true)))),
        hole: false,
      };
    },
  },
  {
    id: 'e-hyperbolic',
    label: 'e → cosh 1 + sinh 1',
    tags: ['trig'],
    kind: 'value',
    applies: isE,
    build: (_node, ctx) => ({
      expr: add(ctx.gen, [fn(ctx.gen, 'cosh', num(ctx.gen, 1)), fn(ctx.gen, 'sinh', num(ctx.gen, 1))]),
      hole: false,
    }),
  },
  {
    id: 'e-limit',
    label: 'e → lim (1+1/n)ⁿ',
    tags: ['calculus'],
    kind: 'value',
    applies: isE,
    build: (_node, ctx) => {
      const n = freshName(ctx.gen, 'n');
      const base = add(ctx.gen, [num(ctx.gen, 1), div(ctx.gen, num(ctx.gen, 1), use(ctx, n, true))]);
      return {
        expr: lim(ctx.gen, n, constant(ctx.gen, 'inf'), pow(ctx.gen, base, use(ctx, n, true))),
        hole: false,
      };
    },
  },
  {
    id: 'pi-lorentz',
    label: 'π → ∫ dt/(1+t²)',
    tags: ['calculus'],
    kind: 'value',
    applies: isPi,
    build: (_node, ctx) => {
      const t = freshName(ctx.gen, 't');
      const body = div(ctx.gen, num(ctx.gen, 1), add(ctx.gen, [num(ctx.gen, 1), pow(ctx.gen, use(ctx, t, true), num(ctx.gen, 2))]));
      return {
        expr: integral(ctx.gen, t, neg(ctx.gen, constant(ctx.gen, 'inf')), constant(ctx.gen, 'inf'), body),
        hole: false,
      };
    },
  },
  {
    id: 'pi-gaussian',
    label: 'π → (∫ e^{-t²} dt)²',
    tags: ['calculus'],
    kind: 'value',
    applies: isPi,
    build: (_node, ctx) => {
      const t = freshName(ctx.gen, 't');
      const body = fn(ctx.gen, 'exp', neg(ctx.gen, pow(ctx.gen, use(ctx, t, true), num(ctx.gen, 2))));
      const whole = integral(ctx.gen, t, neg(ctx.gen, constant(ctx.gen, 'inf')), constant(ctx.gen, 'inf'), body);
      return { expr: pow(ctx.gen, whole, num(ctx.gen, 2)), hole: false };
    },
  },
  {
    id: 'pi-gamma',
    label: 'π → Γ(1/2)²',
    tags: ['series'],
    kind: 'value',
    applies: isPi,
    build: (_node, ctx) => ({
      expr: pow(ctx.gen, fn(ctx.gen, 'gamma', div(ctx.gen, num(ctx.gen, 1), num(ctx.gen, 2))), num(ctx.gen, 2)),
      hole: false,
    }),
  },
  {
    id: 'pi-arctan',
    label: 'π → 4 ∫₀¹ dt/(1+t²)',
    tags: ['calculus'],
    kind: 'value',
    applies: isPi,
    build: (_node, ctx) => {
      const t = freshName(ctx.gen, 't');
      const body = div(ctx.gen, num(ctx.gen, 1), add(ctx.gen, [num(ctx.gen, 1), pow(ctx.gen, use(ctx, t, true), num(ctx.gen, 2))]));
      const whole = integral(ctx.gen, t, num(ctx.gen, 0), num(ctx.gen, 1), body);
      return { expr: mul(ctx.gen, [num(ctx.gen, 4), whole]), hole: false };
    },
  },
  {
    id: 'pi-leibniz',
    label: 'π → 4 Σ (−1)ⁿ/(2n+1)',
    tags: ['series'],
    kind: 'value',
    applies: isPi,
    build: (_node, ctx) => {
      const n = freshName(ctx.gen, 'n');
      const sign = pow(ctx.gen, neg(ctx.gen, num(ctx.gen, 1)), use(ctx, n, true));
      const den = add(ctx.gen, [mul(ctx.gen, [num(ctx.gen, 2), use(ctx, n, true)]), num(ctx.gen, 1)]);
      const term = div(ctx.gen, sign, den);
      return {
        expr: mul(ctx.gen, [num(ctx.gen, 4), sum(ctx.gen, n, num(ctx.gen, 0), constant(ctx.gen, 'inf'), term)]),
        hole: false,
      };
    },
  },
  {
    id: 'pi-basel',
    label: 'π → √(6 Σ 1/n²)',
    tags: ['series'],
    kind: 'value',
    applies: isPi,
    build: (_node, ctx) => {
      const n = freshName(ctx.gen, 'n');
      const term = div(ctx.gen, num(ctx.gen, 1), pow(ctx.gen, use(ctx, n, true), num(ctx.gen, 2)));
      const series = sum(ctx.gen, n, num(ctx.gen, 1), constant(ctx.gen, 'inf'), term);
      return {
        expr: pow(ctx.gen, mul(ctx.gen, [num(ctx.gen, 6), series]), div(ctx.gen, num(ctx.gen, 1), num(ctx.gen, 2))),
        hole: false,
      };
    },
  },
  {
    id: 'ln2-integral',
    label: 'ln 2 → ∫₀¹ dt/(1+t)',
    tags: ['calculus'],
    kind: 'value',
    applies: isLn2,
    build: (_node, ctx) => {
      const t = freshName(ctx.gen, 't');
      const body = div(ctx.gen, num(ctx.gen, 1), add(ctx.gen, [num(ctx.gen, 1), use(ctx, t, true)]));
      return { expr: integral(ctx.gen, t, num(ctx.gen, 0), num(ctx.gen, 1), body), hole: false };
    },
  },
  {
    id: 'ln2-alternating',
    label: 'ln 2 → Σ (−1)^{n+1}/n',
    tags: ['series'],
    kind: 'value',
    applies: isLn2,
    build: (_node, ctx) => {
      const n = freshName(ctx.gen, 'n');
      const sign = pow(ctx.gen, neg(ctx.gen, num(ctx.gen, 1)), add(ctx.gen, [use(ctx, n, true), num(ctx.gen, 1)]));
      return {
        expr: sum(ctx.gen, n, num(ctx.gen, 1), constant(ctx.gen, 'inf'), div(ctx.gen, sign, use(ctx, n, true))),
        hole: false,
      };
    },
  },
  {
    id: 'half-sine',
    label: '1/2 → sin(π/6)',
    tags: ['trig'],
    kind: 'value',
    applies: isHalf,
    build: (_node, ctx) => ({
      expr: fn(ctx.gen, 'sin', div(ctx.gen, constant(ctx.gen, 'pi'), num(ctx.gen, 6))),
      hole: false,
    }),
  },
  {
    id: 'half-integral',
    label: '1/2 → ∫₀¹ t dt',
    tags: ['calculus'],
    kind: 'value',
    applies: isHalf,
    build: (_node, ctx) => {
      const t = freshName(ctx.gen, 't');
      return { expr: integral(ctx.gen, t, num(ctx.gen, 0), num(ctx.gen, 1), use(ctx, t, true)), hole: false };
    },
  },
  {
    id: 'exp-hyperbolic',
    label: 'eᴬ → cosh A + sinh A',
    tags: ['trig'],
    kind: 'value',
    applies: (node) => node.type === 'fn' && node.name === 'exp' && isReal(node.arg),
    build: (node, ctx) => ({
      expr: add(ctx.gen, [
        fn(ctx.gen, 'cosh', node.type === 'fn' ? node.arg : node),
        fn(ctx.gen, 'sinh', duplicate(node.type === 'fn' ? node.arg : node, ctx.gen)),
      ]),
      hole: false,
    }),
  },
  {
    id: 'sin-cofunction',
    label: 'sin A → cos(π/2 − A)',
    tags: ['trig'],
    kind: 'value',
    applies: (node) => node.type === 'fn' && node.name === 'sin',
    build: (node, ctx) => ({
      expr: fn(
        ctx.gen,
        'cos',
        subtract(ctx, div(ctx.gen, constant(ctx.gen, 'pi'), num(ctx.gen, 2)), node.type === 'fn' ? node.arg : node),
      ),
      hole: false,
    }),
  },
  {
    id: 'cos-cofunction',
    label: 'cos A → sin(π/2 − A)',
    tags: ['trig'],
    kind: 'value',
    applies: (node) => node.type === 'fn' && node.name === 'cos',
    build: (node, ctx) => ({
      expr: fn(
        ctx.gen,
        'sin',
        subtract(ctx, div(ctx.gen, constant(ctx.gen, 'pi'), num(ctx.gen, 2)), node.type === 'fn' ? node.arg : node),
      ),
      hole: false,
    }),
  },
  {
    id: 'cos-square',
    label: 'cos² A → 1 − sin² A',
    tags: ['trig'],
    kind: 'value',
    applies: (node) => squareArg(node, 'cos') !== null,
    build: (node, ctx) => {
      const arg = squareArg(node, 'cos') ?? node;
      return {
        expr: add(ctx.gen, [num(ctx.gen, 1), neg(ctx.gen, pow(ctx.gen, fn(ctx.gen, 'sin', arg), num(ctx.gen, 2)))]),
        hole: false,
      };
    },
  },
  {
    id: 'sin-square',
    label: 'sin² A → 1 − cos² A',
    tags: ['trig'],
    kind: 'value',
    applies: (node) => squareArg(node, 'sin') !== null,
    build: (node, ctx) => {
      const arg = squareArg(node, 'sin') ?? node;
      return {
        expr: add(ctx.gen, [num(ctx.gen, 1), neg(ctx.gen, pow(ctx.gen, fn(ctx.gen, 'cos', arg), num(ctx.gen, 2)))]),
        hole: false,
      };
    },
  },
  {
    id: 'cosh-square',
    label: 'cosh² A → 1 + sinh² A',
    tags: ['trig'],
    kind: 'value',
    applies: (node) => squareArg(node, 'cosh') !== null,
    build: (node, ctx) => {
      const arg = squareArg(node, 'cosh') ?? node;
      return {
        expr: add(ctx.gen, [num(ctx.gen, 1), pow(ctx.gen, fn(ctx.gen, 'sinh', arg), num(ctx.gen, 2))]),
        hole: false,
      };
    },
  },
  {
    id: 'cos-difference',
    label: 'cos A → lim (sin(A+h) − sin A)/h',
    tags: ['calculus'],
    kind: 'value',
    applies: (node) => node.type === 'fn' && node.name === 'cos',
    build: (node, ctx) => {
      const arg = node.type === 'fn' ? node.arg : node;
      const h = freshName(ctx.gen, 'h');
      const shifted = fn(ctx.gen, 'sin', add(ctx.gen, [duplicate(arg, ctx.gen), use(ctx, h, true)]));
      const diff = add(ctx.gen, [shifted, neg(ctx.gen, fn(ctx.gen, 'sin', arg))]);
      return { expr: lim(ctx.gen, h, num(ctx.gen, 0), div(ctx.gen, diff, use(ctx, h, true))), hole: false };
    },
  },
  {
    id: 'sin-difference',
    label: 'sin A → lim (cos A − cos(A+h))/h',
    tags: ['calculus'],
    kind: 'value',
    applies: (node) => node.type === 'fn' && node.name === 'sin',
    build: (node, ctx) => {
      const arg = node.type === 'fn' ? node.arg : node;
      const h = freshName(ctx.gen, 'h');
      const shifted = fn(ctx.gen, 'cos', add(ctx.gen, [duplicate(arg, ctx.gen), use(ctx, h, true)]));
      const diff = subtract(ctx, fn(ctx.gen, 'cos', arg), shifted);
      return { expr: lim(ctx.gen, h, num(ctx.gen, 0), div(ctx.gen, diff, use(ctx, h, true))), hole: false };
    },
  },
  {
    id: 'pascal',
    label: 'C(n, k) → C(n−1, k) + C(n−1, k−1)',
    tags: ['series'],
    kind: 'value',
    applies: (node) => node.type === 'binom' && (integer(node.n) ?? -1) >= 1,
    build: (node, ctx) => {
      if (node.type !== 'binom') return { expr: node, hole: false };
      const n = integer(node.n) ?? 1;
      return {
        expr: add(ctx.gen, [
          binom(ctx.gen, num(ctx.gen, n - 1), node.k),
          binom(ctx.gen, num(ctx.gen, n - 1), pred(ctx, duplicate(node.k, ctx.gen))),
        ]),
        hole: false,
      };
    },
  },
  {
    id: 'binom-symmetry',
    label: 'C(n, k) → C(n, n−k)',
    tags: ['series'],
    kind: 'value',
    applies: (node) => node.type === 'binom' && (integer(node.n) ?? -1) >= 0,
    build: (node, ctx) => {
      if (node.type !== 'binom') return { expr: node, hole: false };
      const n = integer(node.n) ?? 0;
      const k = node.k.type === 'num' ? num(ctx.gen, n - node.k.value) : subtract(ctx, num(ctx.gen, n), node.k);
      return { expr: binom(ctx.gen, num(ctx.gen, n), k), hole: false };
    },
  },
];

export function rulesFor(flavor: Flavor): Rule[] {
  if (flavor === 'all') return RULES;
  return RULES.filter((rule) => rule.tags.includes('core') || rule.tags.includes(flavor));
}
