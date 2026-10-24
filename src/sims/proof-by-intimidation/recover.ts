import {
  binom,
  constant,
  div,
  fn,
  isReal,
  neg,
  num,
  pow,
  sameShape,
  type Expr,
  type FnName,
  type Gen,
} from './expr';
import type { Rule } from './rules';

type SquareName = 'sin' | 'cos' | 'sinh' | 'cosh';

/**
 * Read a rule backwards off the formula on screen.
 * Both copies of a duplicated piece have to agree. The obfuscation log is not consulted.
 */
export function invert(rule: Rule, node: Expr, gen: Gen): Expr | null {
  switch (rule.id) {
    case 'pythagorean':
      return squarePair(node, 'sin', 'cos') ? num(gen, 1) : null;
    case 'hyperbolic':
      return hypDifference(node) ? num(gen, 1) : null;
    case 'cos-zero':
      return fnNum(node, 'cos', 0) ? num(gen, 1) : null;
    case 'sin-pi':
      return fnConst(node, 'sin', 'pi') ? num(gen, 0) : null;
    case 'unit-interval':
      return unitInterval(node) ? num(gen, 1) : null;
    case 'exponential-integral':
      return exponentialIntegral(node) ? num(gen, 1) : null;
    case 'sine-integral':
      return sineIntegral(node) ? num(gen, 1) : null;
    case 'gaussian':
      return gaussian(node) ? num(gen, 1) : null;
    case 'sinc-limit':
      return sincLimit(node) ? num(gen, 1) : null;
    case 'derivative':
      return node.type === 'deriv' && isBound(node.body, node.v) ? num(gen, 1) : null;
    case 'exp-zero':
      return fnNum(node, 'exp', 0) ? num(gen, 1) : null;
    case 'ln-one':
      return fnNum(node, 'ln', 1) ? num(gen, 0) : null;
    case 'odd-integral':
      return oddIntegral(node) ? num(gen, 0) : null;
    case 'geometric':
      return geometric(node, 1) ? num(gen, 1) : null;
    case 'binomial-average':
      return binomialAverage(node) ? num(gen, 1) : null;
    case 'alternating-binomial':
      return alternatingBinomial(node) ? num(gen, 0) : null;
    case 'gamma-one':
      return fnNum(node, 'gamma', 1) ? num(gen, 1) : null;
    case 'zero-factorial':
      return node.type === 'fact' && isNum(node.arg, 0) ? num(gen, 1) : null;
    case 'log-two':
      return node.type === 'div' && isLn2(node.num) && isLn2(node.den) ? num(gen, 1) : null;
    case 'euler':
      return euler(node) ? num(gen, 1) : null;
    case 'i-fourth':
      return node.type === 'pow' && isConst(node.base, 'i') && isNum(node.exp, 4) ? num(gen, 1) : null;
    case 'hyperbolic-det':
      return hyperbolicDet(node) ? num(gen, 1) : null;
    case 'split':
      return splitBack(node, gen);
    case 'plus-zero':
      return plusZero(node);
    case 'times-one':
      return timesOne(node);
    case 'power-one':
      return node.type === 'pow' && isNum(node.exp, 1) ? node.base : null;
    case 'double-neg':
      return node.type === 'neg' && node.arg.type === 'neg' ? node.arg.arg : null;
    case 'cancel-scale':
      return cancelScale(node);
    case 'ln-exp':
      return lnExp(node);
    case 'reciprocal':
      return reciprocal(node);
    case 'two-geometric':
      return geometric(node, 0) ? num(gen, 2) : null;
    case 'two-gamma-integral':
      return gammaIntegral(node) ? num(gen, 2) : null;
    case 'two-factorial':
      return node.type === 'fact' && isNum(node.arg, 2) ? num(gen, 2) : null;
    case 'two-gamma':
      return fnNum(node, 'gamma', 3) ? num(gen, 2) : null;
    case 'two-hyperbolic':
      return twoHyperbolic(node) ? num(gen, 2) : null;
    case 'e-power':
      return fnNum(node, 'exp', 1) ? constant(gen, 'e') : null;
    case 'ln-e':
      return fnConst(node, 'ln', 'e') ? num(gen, 1) : null;
    case 'e-series':
      return eSeries(node) ? constant(gen, 'e') : null;
    case 'e-hyperbolic':
      return eHyperbolic(node) ? constant(gen, 'e') : null;
    case 'e-limit':
      return eLimit(node) ? constant(gen, 'e') : null;
    case 'pi-lorentz':
      return node.type === 'integral' && isNegInf(node.lo) && isConst(node.hi, 'inf') && lorentz(node.body, node.v) ? constant(gen, 'pi') : null;
    case 'pi-gaussian':
      return node.type === 'pow' && gaussianIntegral(node.base) && isNum(node.exp, 2) ? constant(gen, 'pi') : null;
    case 'pi-gamma':
      return piGamma(node) ? constant(gen, 'pi') : null;
    case 'pi-arctan':
      return arctan(node) ? constant(gen, 'pi') : null;
    case 'pi-leibniz':
      return leibniz(node) ? constant(gen, 'pi') : null;
    case 'pi-basel':
      return basel(node) ? constant(gen, 'pi') : null;
    case 'ln2-integral':
      return ln2Integral(node) ? fn(gen, 'ln', num(gen, 2)) : null;
    case 'ln2-alternating':
      return alternatingHarmonic(node) ? fn(gen, 'ln', num(gen, 2)) : null;
    case 'half-sine':
      return halfSine(node) ? div(gen, num(gen, 1), num(gen, 2)) : null;
    case 'half-integral':
      return halfIntegral(node) ? div(gen, num(gen, 1), num(gen, 2)) : null;
    case 'exp-hyperbolic':
      return expHyperbolic(node, gen);
    case 'sin-cofunction':
      return cofunction(node, 'cos', 'sin', gen);
    case 'cos-cofunction':
      return cofunction(node, 'sin', 'cos', gen);
    case 'cos-square':
      return oneMinusSquare(node, 'sin', 'cos', gen);
    case 'sin-square':
      return oneMinusSquare(node, 'cos', 'sin', gen);
    case 'cosh-square':
      return onePlusSinh(node, gen);
    case 'cos-difference':
      return cosDifference(node, gen);
    case 'sin-difference':
      return sinDifference(node, gen);
    case 'pascal':
      return pascal(node, gen);
    case 'binom-symmetry':
      return symmetry(node, gen);
    default:
      return null;
  }
}

function isNum(node: Expr, value: number): boolean {
  return node.type === 'num' && node.value === value;
}

function isConst(node: Expr, name: 'pi' | 'e' | 'i' | 'inf'): boolean {
  return node.type === 'const' && node.name === name;
}

function isBound(node: Expr, name: string): boolean {
  return node.type === 'var' && node.bound && node.name === name;
}

function isLn2(node: Expr): boolean {
  return node.type === 'fn' && node.name === 'ln' && isNum(node.arg, 2);
}

function isHalf(node: Expr): boolean {
  return node.type === 'div' && isNum(node.num, 1) && isNum(node.den, 2);
}

function isHalfPi(node: Expr): boolean {
  return node.type === 'div' && isConst(node.num, 'pi') && isNum(node.den, 2);
}

function isNegInf(node: Expr): boolean {
  return node.type === 'neg' && isConst(node.arg, 'inf');
}

function add2(node: Expr): [Expr, Expr] | null {
  if (node.type !== 'add' || node.args.length !== 2) return null;
  return [node.args[0]!, node.args[1]!];
}

function mul2(node: Expr): [Expr, Expr] | null {
  if (node.type !== 'mul' || node.args.length !== 2) return null;
  return [node.args[0]!, node.args[1]!];
}

function fnArg(node: Expr, name: FnName): Expr | null {
  return node.type === 'fn' && node.name === name ? node.arg : null;
}

function fnNum(node: Expr, name: FnName, value: number): boolean {
  const arg = fnArg(node, name);
  return arg !== null && isNum(arg, value);
}

function fnConst(node: Expr, name: FnName, constantName: 'pi' | 'e' | 'i' | 'inf'): boolean {
  const arg = fnArg(node, name);
  return arg !== null && isConst(arg, constantName);
}

function squareArg(node: Expr, name: SquareName): Expr | null {
  if (node.type !== 'pow' || !isNum(node.exp, 2)) return null;
  return fnArg(node.base, name);
}

function squarePair(node: Expr, left: SquareName, right: SquareName): boolean {
  const parts = add2(node);
  if (!parts) return false;
  const x = squareArg(parts[0], left);
  const y = squareArg(parts[1], right);
  return x !== null && y !== null && sameShape(x, y);
}

function hypDifference(node: Expr): boolean {
  const parts = add2(node);
  if (!parts || parts[1].type !== 'neg') return false;
  const u = squareArg(parts[0], 'cosh');
  const v = squareArg(parts[1].arg, 'sinh');
  return u !== null && v !== null && sameShape(u, v);
}

function unitInterval(node: Expr): boolean {
  if (node.type !== 'integral' || !isNum(node.lo, 0) || !isNum(node.hi, 1)) return false;
  const factors = mul2(node.body);
  return factors !== null && isNum(factors[0], 2) && isBound(factors[1], node.v);
}

function exponentialIntegral(node: Expr): boolean {
  if (node.type !== 'integral' || !isNum(node.lo, 0) || !isConst(node.hi, 'inf')) return false;
  const arg = fnArg(node.body, 'exp');
  return arg !== null && arg.type === 'neg' && isBound(arg.arg, node.v);
}

function sineIntegral(node: Expr): boolean {
  if (node.type !== 'integral' || !isNum(node.lo, 0) || !isHalfPi(node.hi)) return false;
  const arg = fnArg(node.body, 'sin');
  return arg !== null && isBound(arg, node.v);
}

function gaussianIntegral(node: Expr): boolean {
  if (node.type !== 'integral' || !isNegInf(node.lo) || !isConst(node.hi, 'inf')) return false;
  const arg = fnArg(node.body, 'exp');
  return arg !== null && arg.type === 'neg' && arg.arg.type === 'pow' && isBound(arg.arg.base, node.v) && isNum(arg.arg.exp, 2);
}

function piToMinusHalf(node: Expr): boolean {
  if (node.type !== 'pow' || !isConst(node.base, 'pi') || node.exp.type !== 'div') return false;
  return node.exp.num.type === 'neg' && isNum(node.exp.num.arg, 1) && isNum(node.exp.den, 2);
}

function gaussian(node: Expr): boolean {
  const factors = mul2(node);
  return factors !== null && piToMinusHalf(factors[0]) && gaussianIntegral(factors[1]);
}

function sincLimit(node: Expr): boolean {
  if (node.type !== 'lim' || !isNum(node.to, 0) || node.body.type !== 'div') return false;
  const arg = fnArg(node.body.num, 'sin');
  return arg !== null && isBound(arg, node.v) && isBound(node.body.den, node.v);
}

function oddIntegral(node: Expr): boolean {
  if (node.type !== 'integral' || node.lo.type !== 'neg' || node.hi.type !== 'var') return false;
  const bound = node.lo.arg;
  if (bound.type !== 'var' || bound.bound || node.hi.bound || node.hi.name !== bound.name) return false;
  return node.body.type === 'pow' && isBound(node.body.base, node.v) && isNum(node.body.exp, 3);
}

function geometric(node: Expr, lower: 0 | 1): boolean {
  if (node.type !== 'sum' || !isNum(node.lo, lower) || !isConst(node.hi, 'inf') || node.body.type !== 'div') return false;
  const den = node.body.den;
  return isNum(node.body.num, 1) && den.type === 'pow' && isNum(den.base, 2) && isBound(den.exp, node.v);
}

function binomialAverage(node: Expr): boolean {
  if (node.type !== 'div' || node.num.type !== 'sum' || !isNum(node.num.lo, 0) || node.num.hi.type !== 'num') return false;
  const n = node.num.hi.value;
  const term = node.num.body;
  const scale = node.den;
  return (
    Number.isInteger(n) &&
    n >= 2 &&
    n <= 5 &&
    term.type === 'binom' &&
    isNum(term.n, n) &&
    isBound(term.k, node.num.v) &&
    scale.type === 'pow' &&
    isNum(scale.base, 2) &&
    isNum(scale.exp, n)
  );
}

function alternatingSign(node: Expr, v: string): boolean {
  return node.type === 'pow' && node.base.type === 'neg' && isNum(node.base.arg, 1) && isBound(node.exp, v);
}

function alternatingBinomial(node: Expr): boolean {
  if (node.type !== 'sum' || !isNum(node.lo, 0) || node.hi.type !== 'num') return false;
  const n = node.hi.value;
  const factors = mul2(node.body);
  if (!Number.isInteger(n) || n < 1 || n > 4 || !factors) return false;
  const choose = factors[1];
  return alternatingSign(factors[0], node.v) && choose.type === 'binom' && isNum(choose.n, n) && isBound(choose.k, node.v);
}

function euler(node: Expr): boolean {
  const parts = add2(node);
  if (!parts || !isNum(parts[1], 2)) return false;
  const arg = fnArg(parts[0], 'exp');
  const factors = arg && mul2(arg);
  return factors !== null && isConst(factors[0], 'i') && isConst(factors[1], 'pi');
}

function hyperbolicDet(node: Expr): boolean {
  if (node.type !== 'det') return false;
  const u = fnArg(node.a, 'cosh');
  const v = fnArg(node.b, 'sinh');
  const w = fnArg(node.c, 'sinh');
  const z = fnArg(node.d, 'cosh');
  return u !== null && v !== null && w !== null && z !== null && sameShape(u, v) && sameShape(u, w) && sameShape(u, z);
}

function splitBack(node: Expr, gen: Gen): Expr | null {
  const parts = add2(node);
  if (!parts || !isNum(parts[0], 1) || parts[1].type !== 'num' || !Number.isInteger(parts[1].value)) return null;
  const value = parts[1].value + 1;
  if (value < 2 || value > 6) return null;
  return num(gen, value);
}

function plusZero(node: Expr): Expr | null {
  const parts = add2(node);
  return parts && isNum(parts[1], 0) ? parts[0] : null;
}

function timesOne(node: Expr): Expr | null {
  const factors = mul2(node);
  return factors && isNum(factors[1], 1) ? factors[0] : null;
}

function cancelScale(node: Expr): Expr | null {
  if (node.type !== 'div' || node.den.type !== 'num' || !Number.isInteger(node.den.value)) return null;
  const scale = node.den.value;
  if (scale < 2 || scale > 4) return null;
  const factors = mul2(node.num);
  return factors && isNum(factors[1], scale) ? factors[0] : null;
}

function lnExp(node: Expr): Expr | null {
  const arg = fnArg(node, 'ln');
  if (!arg || arg.type !== 'fn' || arg.name !== 'exp' || !isReal(arg.arg)) return null;
  return arg.arg;
}

function reciprocal(node: Expr): Expr | null {
  if (node.type !== 'div' || !isNum(node.num, 1) || node.den.type !== 'div' || !isNum(node.den.num, 1)) return null;
  return node.den.den;
}

function gammaIntegral(node: Expr): boolean {
  if (node.type !== 'integral' || !isNum(node.lo, 0) || !isConst(node.hi, 'inf')) return false;
  const factors = mul2(node.body);
  if (!factors || factors[0].type !== 'pow' || !isBound(factors[0].base, node.v) || !isNum(factors[0].exp, 2)) return false;
  const arg = fnArg(factors[1], 'exp');
  return arg !== null && arg.type === 'neg' && isBound(arg.arg, node.v);
}

function twoHyperbolic(node: Expr): boolean {
  const parts = add2(node);
  if (!parts) return false;
  const left = fnArg(parts[0], 'cosh');
  const right = fnArg(parts[1], 'sinh');
  return left !== null && right !== null && isLn2(left) && isLn2(right);
}

function eSeries(node: Expr): boolean {
  if (node.type !== 'sum' || !isNum(node.lo, 0) || !isConst(node.hi, 'inf') || node.body.type !== 'div') return false;
  return isNum(node.body.num, 1) && node.body.den.type === 'fact' && isBound(node.body.den.arg, node.v);
}

function eHyperbolic(node: Expr): boolean {
  const parts = add2(node);
  if (!parts) return false;
  const left = fnArg(parts[0], 'cosh');
  const right = fnArg(parts[1], 'sinh');
  return left !== null && right !== null && isNum(left, 1) && isNum(right, 1);
}

function eLimit(node: Expr): boolean {
  if (node.type !== 'lim' || !isConst(node.to, 'inf') || node.body.type !== 'pow' || !isBound(node.body.exp, node.v)) return false;
  const base = add2(node.body.base);
  return base !== null && isNum(base[0], 1) && base[1].type === 'div' && isNum(base[1].num, 1) && isBound(base[1].den, node.v);
}

function lorentz(body: Expr, v: string): boolean {
  if (body.type !== 'div' || !isNum(body.num, 1)) return false;
  const parts = add2(body.den);
  return parts !== null && isNum(parts[0], 1) && parts[1].type === 'pow' && isBound(parts[1].base, v) && isNum(parts[1].exp, 2);
}

function piGamma(node: Expr): boolean {
  if (node.type !== 'pow' || !isNum(node.exp, 2)) return false;
  const arg = fnArg(node.base, 'gamma');
  return arg !== null && isHalf(arg);
}

function arctan(node: Expr): boolean {
  const factors = mul2(node);
  if (!factors || !isNum(factors[0], 4) || factors[1].type !== 'integral') return false;
  const whole = factors[1];
  return isNum(whole.lo, 0) && isNum(whole.hi, 1) && lorentz(whole.body, whole.v);
}

function leibniz(node: Expr): boolean {
  const factors = mul2(node);
  if (!factors || !isNum(factors[0], 4) || factors[1].type !== 'sum') return false;
  const series = factors[1];
  if (!isNum(series.lo, 0) || !isConst(series.hi, 'inf') || series.body.type !== 'div') return false;
  const den = add2(series.body.den);
  const scaled = den && mul2(den[0]);
  return alternatingSign(series.body.num, series.v) && den !== null && scaled !== null && isNum(scaled[0], 2) && isBound(scaled[1], series.v) && isNum(den[1], 1);
}

function basel(node: Expr): boolean {
  if (node.type !== 'pow' || !isHalf(node.exp)) return false;
  const factors = mul2(node.base);
  if (!factors || !isNum(factors[0], 6) || factors[1].type !== 'sum') return false;
  const series = factors[1];
  if (!isNum(series.lo, 1) || !isConst(series.hi, 'inf') || series.body.type !== 'div') return false;
  const den = series.body.den;
  return isNum(series.body.num, 1) && den.type === 'pow' && isBound(den.base, series.v) && isNum(den.exp, 2);
}

function alternatingHarmonic(node: Expr): boolean {
  if (node.type !== 'sum' || !isNum(node.lo, 1) || !isConst(node.hi, 'inf') || node.body.type !== 'div') return false;
  const sign = node.body.num;
  if (sign.type !== 'pow' || sign.base.type !== 'neg' || !isNum(sign.base.arg, 1)) return false;
  const exp = add2(sign.exp);
  return exp !== null && isBound(exp[0], node.v) && isNum(exp[1], 1) && isBound(node.body.den, node.v);
}

function ln2Integral(node: Expr): boolean {
  if (node.type !== 'integral' || !isNum(node.lo, 0) || !isNum(node.hi, 1) || node.body.type !== 'div') return false;
  const parts = add2(node.body.den);
  return isNum(node.body.num, 1) && parts !== null && isNum(parts[0], 1) && isBound(parts[1], node.v);
}

function halfSine(node: Expr): boolean {
  const arg = fnArg(node, 'sin');
  return arg !== null && arg.type === 'div' && isConst(arg.num, 'pi') && isNum(arg.den, 6);
}

function halfIntegral(node: Expr): boolean {
  return node.type === 'integral' && isNum(node.lo, 0) && isNum(node.hi, 1) && isBound(node.body, node.v);
}

function expHyperbolic(node: Expr, gen: Gen): Expr | null {
  const parts = add2(node);
  if (!parts) return null;
  const left = fnArg(parts[0], 'cosh');
  const right = fnArg(parts[1], 'sinh');
  if (!left || !right || !sameShape(left, right) || isLn2(left)) return null;
  return fn(gen, 'exp', left);
}

function cofunction(node: Expr, outer: 'sin' | 'cos', inner: 'sin' | 'cos', gen: Gen): Expr | null {
  const arg = fnArg(node, outer);
  const parts = arg && add2(arg);
  if (!parts || !isHalfPi(parts[0])) return null;
  const shifted = parts[1];
  if (shifted.type === 'neg') return fn(gen, inner, shifted.arg);
  return fn(gen, inner, neg(gen, shifted));
}

function oneMinusSquare(node: Expr, from: SquareName, to: SquareName, gen: Gen): Expr | null {
  const parts = add2(node);
  if (!parts || !isNum(parts[0], 1) || parts[1].type !== 'neg') return null;
  const arg = squareArg(parts[1].arg, from);
  return arg ? pow(gen, fn(gen, to, arg), num(gen, 2)) : null;
}

function onePlusSinh(node: Expr, gen: Gen): Expr | null {
  const parts = add2(node);
  if (!parts || !isNum(parts[0], 1)) return null;
  const arg = squareArg(parts[1], 'sinh');
  return arg ? pow(gen, fn(gen, 'cosh', arg), num(gen, 2)) : null;
}

function cosDifference(node: Expr, gen: Gen): Expr | null {
  const quotient = differenceQuotient(node);
  if (!quotient) return null;
  const moved = fnArg(quotient.left, 'sin');
  const kept = quotient.right.type === 'neg' ? fnArg(quotient.right.arg, 'sin') : null;
  const parts = moved && add2(moved);
  if (!parts || !kept || !isBound(parts[1], quotient.v) || !sameShape(parts[0], kept)) return null;
  return fn(gen, 'cos', kept);
}

function sinDifference(node: Expr, gen: Gen): Expr | null {
  const quotient = differenceQuotient(node);
  if (!quotient || quotient.right.type !== 'neg') return null;
  const kept = fnArg(quotient.left, 'cos');
  const moved = fnArg(quotient.right.arg, 'cos');
  const parts = moved && add2(moved);
  if (!kept || !parts || !isBound(parts[1], quotient.v) || !sameShape(kept, parts[0])) return null;
  return fn(gen, 'sin', kept);
}

function differenceQuotient(node: Expr): { v: string; left: Expr; right: Expr } | null {
  if (node.type !== 'lim' || !isNum(node.to, 0) || node.body.type !== 'div' || !isBound(node.body.den, node.v)) return null;
  const parts = add2(node.body.num);
  if (!parts) return null;
  return { v: node.v, left: parts[0], right: parts[1] };
}

function predShape(node: Expr, k: Expr): boolean {
  if (k.type === 'num' && node.type === 'num') return node.value === k.value - 1;
  const parts = add2(node);
  return parts !== null && sameShape(parts[0], k) && parts[1].type === 'neg' && isNum(parts[1].arg, 1);
}

function pascal(node: Expr, gen: Gen): Expr | null {
  const parts = add2(node);
  if (!parts || parts[0].type !== 'binom' || parts[1].type !== 'binom') return null;
  const [left, right] = parts;
  if (left.n.type !== 'num' || !sameShape(left.n, right.n) || !predShape(right.k, left.k)) return null;
  return binom(gen, num(gen, left.n.value + 1), left.k);
}

function symmetry(node: Expr, gen: Gen): Expr | null {
  if (node.type !== 'binom' || node.n.type !== 'num' || !Number.isInteger(node.n.value)) return null;
  const n = node.n.value;
  if (node.k.type === 'num' && Number.isInteger(node.k.value) && node.k.value > n / 2 && node.k.value <= n) {
    return binom(gen, num(gen, n), num(gen, n - node.k.value));
  }
  const parts = add2(node.k);
  if (!parts || !isNum(parts[0], n)) return null;
  if (parts[1].type === 'neg') return binom(gen, num(gen, n), parts[1].arg);
  return binom(gen, num(gen, n), neg(gen, parts[1]));
}
