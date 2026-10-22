import {
  dependsOn,
  freeVars,
  type Expr,
  type FnName,
} from './expr';

export type C = { re: number; im: number };

const EPS = 1e-4;
const MAX_DEPTH = 11;
const SERIES_TERMS = 40;
const SAMPLE_BUDGET = 24000;
const BADGE_TOLERANCE = 2e-3;

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

const SAMPLES = [0.35, -0.62, 1.15, 0.2, -1.4, 0.8];

export function c(re: number, im = 0): C {
  return { re, im };
}

export function cadd(a: C, b: C): C {
  return { re: a.re + b.re, im: a.im + b.im };
}

export function csub(a: C, b: C): C {
  return { re: a.re - b.re, im: a.im - b.im };
}

export function cmul(a: C, b: C): C {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

export function cneg(a: C): C {
  return { re: -a.re, im: -a.im };
}

export function cscale(a: C, scale: number): C {
  return { re: a.re * scale, im: a.im * scale };
}

export function cabs(a: C): number {
  return Math.hypot(a.re, a.im);
}

export function cdiv(a: C, b: C): C {
  const den = b.re * b.re + b.im * b.im;
  if (den === 0) return c(NaN, NaN);
  return { re: (a.re * b.re + a.im * b.im) / den, im: (a.im * b.re - a.re * b.im) / den };
}

function cexp(a: C): C {
  if (a.re === Infinity && a.im === 0) return c(Infinity, 0);
  if (a.re === -Infinity && a.im === 0) return c(0, 0);
  const mag = Math.exp(a.re);
  return { re: mag * Math.cos(a.im), im: mag * Math.sin(a.im) };
}

function cln(a: C): C {
  const radius = cabs(a);
  if (radius === 0) return c(NaN, NaN);
  return { re: Math.log(radius), im: Math.atan2(a.im, a.re) };
}

function ipow(base: C, exponent: number): C {
  if (exponent === 0) return c(1, 0);
  let result = c(1, 0);
  let factor = exponent < 0 ? cdiv(c(1), base) : base;
  let bits = Math.abs(exponent);
  while (bits > 0) {
    if (bits & 1) result = cmul(result, factor);
    bits >>= 1;
    if (bits) factor = cmul(factor, factor);
  }
  return result;
}

function cpow(base: C, exponent: C): C {
  if (exponent.re === 0 && exponent.im === 0) return c(1, 0);
  if (base.re === 0 && base.im === 0) return c(0, 0);
  if (
    Math.abs(exponent.im) < 1e-12 &&
    Math.abs(exponent.re - Math.round(exponent.re)) < 1e-9 &&
    Math.abs(exponent.re) <= 32
  ) {
    return ipow(base, Math.round(exponent.re));
  }
  return cexp(cmul(exponent, cln(base)));
}

function gammaReal(z: number): number {
  if (Number.isInteger(z) && z >= 1 && z <= 20) {
    let product = 1;
    for (let n = 2; n < z; n += 1) product *= n;
    return product;
  }
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gammaReal(1 - z));
  const shifted = z - 1;
  let sum = LANCZOS[0]!;
  for (let n = 1; n < LANCZOS.length; n += 1) sum += LANCZOS[n]! / (shifted + n);
  const t = shifted + 7.5;
  return Math.sqrt(2 * Math.PI) * t ** (shifted + 0.5) * Math.exp(-t) * sum;
}

function factorial(z: C): C {
  if (Math.abs(z.im) > 1e-8 || !Number.isFinite(z.re)) return c(NaN, NaN);
  const n = z.re;
  if (Number.isInteger(n) && n >= 0 && n <= 20) {
    let product = 1;
    for (let k = 2; k <= n; k += 1) product *= k;
    return c(product);
  }
  return c(gammaReal(n + 1));
}

function binomial(n: C, k: C): C {
  if (Math.abs(n.im) > 1e-6 || Math.abs(k.im) > 1e-6) return c(NaN, NaN);
  const nn = Math.round(n.re);
  const kk = Math.round(k.re);
  if (Math.abs(n.re - nn) > 1e-6 || Math.abs(k.re - kk) > 1e-6) {
    return c(gammaReal(n.re + 1) / (gammaReal(k.re + 1) * gammaReal(n.re - k.re + 1)));
  }
  if (kk < 0 || nn < 0 || kk > nn) return c(0);
  let product = 1;
  for (let i = 1; i <= kk; i += 1) product = (product * (nn - kk + i)) / i;
  return c(product);
}

function sin(z: C): C {
  const iz = c(0, 1);
  return cdiv(csub(cexp(cmul(iz, z)), cexp(cmul(cneg(iz), z))), c(0, 2));
}

function cos(z: C): C {
  const iz = c(0, 1);
  return cscale(cadd(cexp(cmul(iz, z)), cexp(cmul(cneg(iz), z))), 0.5);
}

function finiteInt(z: C): number | null {
  if (Math.abs(z.im) > 1e-6 || !Number.isFinite(z.re)) return null;
  const n = Math.round(z.re);
  return Math.abs(z.re - n) < 1e-6 ? n : null;
}

type Endpoint = { inf: -1 | 0 | 1; value: number };

function endpoint(z: C): Endpoint | null {
  if (z.re === Infinity && z.im === 0) return { inf: 1, value: Infinity };
  if (z.re === -Infinity && z.im === 0) return { inf: -1, value: -Infinity };
  if (!Number.isFinite(z.re) || Math.abs(z.im) > 1e-5) return null;
  return { inf: 0, value: z.re };
}

function quad(f: (x: number) => C, a: number, b: number, budget: { left: number }): C {
  if (!(b > a) || !Number.isFinite(a) || !Number.isFinite(b)) return c(0);
  const fa = sample(f, a, budget);
  const fb = sample(f, b, budget);
  const mid = (a + b) / 2;
  const fc = sample(f, mid, budget);
  const whole = cscale(cadd(cadd(fa, cscale(fc, 4)), fb), (b - a) / 6);
  return adapt(f, a, b, EPS, MAX_DEPTH, whole, fa, fb, fc, budget);
}

function sample(f: (x: number) => C, x: number, budget: { left: number }): C {
  budget.left -= 1;
  if (budget.left < 0) return c(NaN, NaN);
  return f(x);
}

function adapt(
  f: (x: number) => C,
  a: number,
  b: number,
  eps: number,
  depth: number,
  whole: C,
  fa: C,
  fb: C,
  fc: C,
  budget: { left: number },
): C {
  const mid = (a + b) / 2;
  const leftMid = (a + mid) / 2;
  const rightMid = (mid + b) / 2;
  const fl = sample(f, leftMid, budget);
  const fr = sample(f, rightMid, budget);
  const left = cscale(cadd(cadd(fa, cscale(fl, 4)), fc), (mid - a) / 6);
  const right = cscale(cadd(cadd(fc, cscale(fr, 4)), fb), (b - mid) / 6);
  const sum = cadd(left, right);
  if (depth <= 0 || budget.left < 0 || cabs(csub(sum, whole)) <= 15 * eps) {
    return cadd(sum, cscale(csub(sum, whole), 1 / 15));
  }
  return cadd(
    adapt(f, a, mid, eps / 2, depth - 1, left, fa, fc, fl, budget),
    adapt(f, mid, b, eps / 2, depth - 1, right, fc, fb, fr, budget),
  );
}

function improper(f: (x: number) => C, lo: Endpoint, hi: Endpoint, budget: { left: number }): C {
  const edge = 1e-3;
  if (lo.inf === 0 && hi.inf === 1) {
    return quad(
      (u) => cscale(f(u / (1 - u)), 1 / (1 - u) ** 2),
      0,
      1 - edge,
      budget,
    );
  }
  if (lo.inf === -1 && hi.inf === 0) {
    return quad(
      (u) => cscale(f(hi.value - u / (1 - u)), 1 / (1 - u) ** 2),
      0,
      1 - edge,
      budget,
    );
  }
  if (lo.inf === -1 && hi.inf === 1) {
    return quad(
      (u) => {
        const den = 1 - u * u;
        return cscale(f(u / den), (1 + u * u) / (den * den));
      },
      -1 + edge,
      1 - edge,
      budget,
    );
  }
  if (lo.inf === 0 && hi.inf === 0) {
    if (hi.value === lo.value) return c(0);
    if (hi.value < lo.value) return cneg(quad(f, hi.value, lo.value, budget));
    return quad(f, lo.value, hi.value, budget);
  }
  if (lo.inf === 0 && hi.inf === -1) return cneg(improper(f, hi, lo, budget));
  if (lo.inf === 1 && hi.inf === 0) return cneg(improper(f, hi, lo, budget));
  return c(NaN, NaN);
}

export function evaluate(root: Expr, env: Record<string, C>): C {
  const cache = new Map<string, C>();
  const active: string[] = [];
  const budget = { left: SAMPLE_BUDGET };

  function independent(expr: Expr): boolean {
    return active.every((name) => !dependsOn(expr, name));
  }

  function ev(expr: Expr): C {
    switch (expr.type) {
      case 'num':
        return c(expr.value);
      case 'var':
        return env[expr.name] ?? c(NaN, NaN);
      case 'const':
        if (expr.name === 'pi') return c(Math.PI);
        if (expr.name === 'i') return c(0, 1);
        return c(Infinity, 0);
      case 'add':
        return expr.args.reduce((sum, arg) => cadd(sum, ev(arg)), c(0));
      case 'mul':
        return expr.args.reduce((product, arg) => cmul(product, ev(arg)), c(1));
      case 'neg':
        return cneg(ev(expr.arg));
      case 'div':
        return cdiv(ev(expr.num), ev(expr.den));
      case 'pow':
        return cpow(ev(expr.base), ev(expr.exp));
      case 'fn':
        return applyFn(expr.name, ev(expr.arg));
      case 'fact':
        return factorial(ev(expr.arg));
      case 'binom':
        return binomial(ev(expr.n), ev(expr.k));
      case 'det':
        return csub(cmul(ev(expr.a), ev(expr.d)), cmul(ev(expr.b), ev(expr.c)));
      case 'integral':
        return cached(expr, () => integrate(expr));
      case 'sum':
        return cached(expr, () => series(expr));
      case 'lim':
        return limit(expr);
      case 'deriv':
        return derivative(expr);
    }
  }

  function cached(expr: Expr, compute: () => C): C {
    const cacheable = independent(expr);
    if (cacheable) {
      const hit = cache.get(expr.id);
      if (hit) return hit;
    }
    const value = compute();
    if (cacheable) cache.set(expr.id, value);
    return value;
  }

  function withVar(name: string, value: C, body: Expr): C {
    const previous = env[name];
    env[name] = value;
    active.push(name);
    const result = ev(body);
    active.pop();
    if (previous === undefined) delete env[name];
    else env[name] = previous;
    return result;
  }

  function integrate(expr: Extract<Expr, { type: 'integral' }>): C {
    const lo = endpoint(ev(expr.lo));
    const hi = endpoint(ev(expr.hi));
    if (!lo || !hi) return c(NaN, NaN);
    return improper((t) => withVar(expr.v, c(t), expr.body), lo, hi, budget);
  }

  function series(expr: Extract<Expr, { type: 'sum' }>): C {
    const lo = endpoint(ev(expr.lo));
    const hi = endpoint(ev(expr.hi));
    if (!lo || !hi) return c(NaN, NaN);
    const start = lo.inf === 0 ? finiteInt(c(lo.value)) : null;
    if (start === null) return c(NaN, NaN);
    const end = hi.inf === 0 ? finiteInt(c(hi.value)) : null;
    if (hi.inf === 0 && end === null) return c(NaN, NaN);
    const last = end === null ? start + SERIES_TERMS - 1 : end;
    if (last < start) return c(0);
    if (last - start > 80) return c(NaN, NaN);
    let total = c(0);
    for (let n = start; n <= last; n += 1) total = cadd(total, withVar(expr.v, c(n), expr.body));
    return total;
  }

  function limit(expr: Extract<Expr, { type: 'lim' }>): C {
    const to = ev(expr.to);
    if (Math.abs(to.im) > 1e-6 || !Number.isFinite(to.re)) return c(NaN, NaN);
    const at = withVar(expr.v, c(to.re), expr.body);
    if (Number.isFinite(at.re) && Number.isFinite(at.im)) return at;
    const right = withVar(expr.v, c(to.re + 1e-5), expr.body);
    const left = withVar(expr.v, c(to.re - 1e-5), expr.body);
    const rightOk = Number.isFinite(right.re) && Number.isFinite(right.im);
    const leftOk = Number.isFinite(left.re) && Number.isFinite(left.im);
    if (rightOk && leftOk) return cscale(cadd(left, right), 0.5);
    if (rightOk) return right;
    if (leftOk) return left;
    return c(NaN, NaN);
  }

  function derivative(expr: Extract<Expr, { type: 'deriv' }>): C {
    const h = 1e-4;
    const plus = withVar(expr.v, c(0.4 + h), expr.body);
    const minus = withVar(expr.v, c(0.4 - h), expr.body);
    return cscale(csub(plus, minus), 1 / (2 * h));
  }

  return ev(root);
}

function applyFn(name: FnName, arg: C): C {
  switch (name) {
    case 'sin':
      return sin(arg);
    case 'cos':
      return cos(arg);
    case 'sinh':
      return cscale(csub(cexp(arg), cexp(cneg(arg))), 0.5);
    case 'cosh':
      return cscale(cadd(cexp(arg), cexp(cneg(arg))), 0.5);
    case 'ln':
      return cln(arg);
    case 'exp':
      return cexp(arg);
    case 'gamma':
      if (Math.abs(arg.im) > 1e-8 || !Number.isFinite(arg.re)) return c(NaN, NaN);
      return c(gammaReal(arg.re));
    default:
      return c(NaN, NaN);
  }
}

export function sampleEnv(expr: Expr, salt = 0): Record<string, C> {
  const env: Record<string, C> = {};
  freeVars(expr).forEach((name, index) => {
    env[name] = c(SAMPLES[(index + salt) % SAMPLES.length]!);
  });
  return env;
}

export type Verdict = { ok: boolean; text: string };

export function formatComplex(value: C): string {
  if (!Number.isFinite(value.re) || !Number.isFinite(value.im)) return '?';
  const re = Math.abs(value.re) < 5e-7 ? 0 : value.re;
  const im = Math.abs(value.im) < 5e-7 ? 0 : value.im;
  if (Math.abs(im) < 5e-5) return re.toFixed(6);
  const sign = im < 0 ? '−' : '+';
  return `${re.toFixed(4)} ${sign} ${Math.abs(im).toFixed(4)}i`;
}

export function proveValue(expr: Expr, start: number): Verdict {
  const value = evaluate(expr, sampleEnv(expr, 0));
  const ok =
    Number.isFinite(value.re) &&
    Number.isFinite(value.im) &&
    Math.hypot(value.re - start, value.im) < BADGE_TOLERANCE;
  return { ok, text: `value = ${formatComplex(value)} ${ok ? '✓' : '✗'}` };
}

export function near(value: C, expected: number, tolerance = BADGE_TOLERANCE): boolean {
  return Number.isFinite(value.re) && Number.isFinite(value.im) && Math.hypot(value.re - expected, value.im) < tolerance;
}
