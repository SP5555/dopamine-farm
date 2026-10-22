export type FnName = 'sin' | 'cos' | 'sinh' | 'cosh' | 'ln' | 'exp' | 'gamma';
export type ConstName = 'pi' | 'i' | 'inf';

export type Expr =
  | { id: string; type: 'num'; value: number }
  | { id: string; type: 'var'; name: string; bound: boolean }
  | { id: string; type: 'const'; name: ConstName }
  | { id: string; type: 'add' | 'mul'; args: Expr[] }
  | { id: string; type: 'neg' | 'fact'; arg: Expr }
  | { id: string; type: 'div'; num: Expr; den: Expr }
  | { id: string; type: 'pow'; base: Expr; exp: Expr }
  | { id: string; type: 'fn'; name: FnName; arg: Expr }
  | { id: string; type: 'integral'; v: string; lo: Expr; hi: Expr; body: Expr }
  | { id: string; type: 'sum'; v: string; lo: Expr; hi: Expr; body: Expr }
  | { id: string; type: 'lim'; v: string; to: Expr; body: Expr }
  | { id: string; type: 'deriv'; v: string; body: Expr }
  | { id: string; type: 'det'; a: Expr; b: Expr; c: Expr; d: Expr }
  | { id: string; type: 'binom'; n: Expr; k: Expr };

export type Gen = { id: number; name: number };

const PREC = { add: 10, mul: 20, unary: 30, pow: 40, fact: 50, atom: 60 };

export function freshId(gen: Gen): string {
  gen.id += 1;
  return `p${gen.id}`;
}

export function freshName(gen: Gen, prefix: string): string {
  gen.name += 1;
  return `${prefix}_{${gen.name}}`;
}

export function num(gen: Gen, value: number): Expr {
  return { id: freshId(gen), type: 'num', value };
}

export function variable(gen: Gen, name: string, bound: boolean): Expr {
  return { id: freshId(gen), type: 'var', name, bound };
}

export function constant(gen: Gen, name: ConstName): Expr {
  return { id: freshId(gen), type: 'const', name };
}

export function add(gen: Gen, args: Expr[]): Expr {
  return { id: freshId(gen), type: 'add', args };
}

export function mul(gen: Gen, args: Expr[]): Expr {
  return { id: freshId(gen), type: 'mul', args };
}

export function neg(gen: Gen, arg: Expr): Expr {
  return { id: freshId(gen), type: 'neg', arg };
}

export function div(gen: Gen, numerator: Expr, denominator: Expr): Expr {
  return { id: freshId(gen), type: 'div', num: numerator, den: denominator };
}

export function pow(gen: Gen, base: Expr, exp: Expr): Expr {
  return { id: freshId(gen), type: 'pow', base, exp };
}

export function fn(gen: Gen, name: FnName, arg: Expr): Expr {
  return { id: freshId(gen), type: 'fn', name, arg };
}

export function integral(gen: Gen, v: string, lo: Expr, hi: Expr, body: Expr): Expr {
  return { id: freshId(gen), type: 'integral', v, lo, hi, body };
}

export function sum(gen: Gen, v: string, lo: Expr, hi: Expr, body: Expr): Expr {
  return { id: freshId(gen), type: 'sum', v, lo, hi, body };
}

export function lim(gen: Gen, v: string, to: Expr, body: Expr): Expr {
  return { id: freshId(gen), type: 'lim', v, to, body };
}

export function deriv(gen: Gen, v: string, body: Expr): Expr {
  return { id: freshId(gen), type: 'deriv', v, body };
}

export function det(gen: Gen, a: Expr, b: Expr, c: Expr, d: Expr): Expr {
  return { id: freshId(gen), type: 'det', a, b, c, d };
}

export function fact(gen: Gen, arg: Expr): Expr {
  return { id: freshId(gen), type: 'fact', arg };
}

export function binom(gen: Gen, n: Expr, k: Expr): Expr {
  return { id: freshId(gen), type: 'binom', n, k };
}

export function children(expr: Expr): Expr[] {
  switch (expr.type) {
    case 'num':
    case 'var':
    case 'const':
      return [];
    case 'add':
    case 'mul':
      return expr.args;
    case 'neg':
    case 'fact':
    case 'fn':
      return [expr.arg];
    case 'div':
      return [expr.num, expr.den];
    case 'pow':
      return [expr.base, expr.exp];
    case 'integral':
    case 'sum':
      return [expr.lo, expr.hi, expr.body];
    case 'lim':
      return [expr.to, expr.body];
    case 'deriv':
      return [expr.body];
    case 'det':
      return [expr.a, expr.b, expr.c, expr.d];
    case 'binom':
      return [expr.n, expr.k];
  }
}

export function walk(expr: Expr, visit: (expr: Expr) => void): void {
  visit(expr);
  switch (expr.type) {
    case 'num':
    case 'var':
    case 'const':
      return;
    case 'add':
    case 'mul':
      for (const arg of expr.args) walk(arg, visit);
      return;
    case 'neg':
    case 'fact':
      walk(expr.arg, visit);
      return;
    case 'fn':
      walk(expr.arg, visit);
      return;
    case 'div':
      walk(expr.num, visit);
      walk(expr.den, visit);
      return;
    case 'pow':
      walk(expr.base, visit);
      walk(expr.exp, visit);
      return;
    case 'integral':
    case 'sum':
      walk(expr.lo, visit);
      walk(expr.hi, visit);
      walk(expr.body, visit);
      return;
    case 'lim':
      walk(expr.to, visit);
      walk(expr.body, visit);
      return;
    case 'deriv':
      walk(expr.body, visit);
      return;
    case 'det':
      walk(expr.a, visit);
      walk(expr.b, visit);
      walk(expr.c, visit);
      walk(expr.d, visit);
      return;
    case 'binom':
      walk(expr.n, visit);
      walk(expr.k, visit);
      return;
  }
}

export function nodeCount(expr: Expr): number {
  let count = 0;
  walk(expr, () => {
    count += 1;
  });
  return count;
}

export function idsOf(expr: Expr): string[] {
  const ids: string[] = [];
  walk(expr, (node) => ids.push(node.id));
  return ids;
}

export function findById(expr: Expr, id: string): Expr | null {
  if (expr.id === id) return expr;
  for (const child of children(expr)) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

export function replaceAt(expr: Expr, id: string, next: Expr): Expr {
  if (expr.id === id) return next;
  switch (expr.type) {
    case 'num':
    case 'var':
    case 'const':
      return expr;
    case 'add':
    case 'mul': {
      let changed = false;
      const args = expr.args.map((arg) => {
        const updated = replaceAt(arg, id, next);
        if (updated !== arg) changed = true;
        return updated;
      });
      return changed ? { ...expr, args } : expr;
    }
    case 'neg':
    case 'fact': {
      const arg = replaceAt(expr.arg, id, next);
      return arg === expr.arg ? expr : { ...expr, arg };
    }
    case 'fn': {
      const arg = replaceAt(expr.arg, id, next);
      return arg === expr.arg ? expr : { ...expr, arg };
    }
    case 'div': {
      const numerator = replaceAt(expr.num, id, next);
      const denominator = replaceAt(expr.den, id, next);
      return numerator === expr.num && denominator === expr.den
        ? expr
        : { ...expr, num: numerator, den: denominator };
    }
    case 'pow': {
      const base = replaceAt(expr.base, id, next);
      const exp = replaceAt(expr.exp, id, next);
      return base === expr.base && exp === expr.exp ? expr : { ...expr, base, exp };
    }
    case 'integral':
    case 'sum': {
      const lo = replaceAt(expr.lo, id, next);
      const hi = replaceAt(expr.hi, id, next);
      const body = replaceAt(expr.body, id, next);
      return lo === expr.lo && hi === expr.hi && body === expr.body ? expr : { ...expr, lo, hi, body };
    }
    case 'lim': {
      const to = replaceAt(expr.to, id, next);
      const body = replaceAt(expr.body, id, next);
      return to === expr.to && body === expr.body ? expr : { ...expr, to, body };
    }
    case 'deriv': {
      const body = replaceAt(expr.body, id, next);
      return body === expr.body ? expr : { ...expr, body };
    }
    case 'det': {
      const a = replaceAt(expr.a, id, next);
      const b = replaceAt(expr.b, id, next);
      const c = replaceAt(expr.c, id, next);
      const d = replaceAt(expr.d, id, next);
      return a === expr.a && b === expr.b && c === expr.c && d === expr.d ? expr : { ...expr, a, b, c, d };
    }
    case 'binom': {
      const n = replaceAt(expr.n, id, next);
      const k = replaceAt(expr.k, id, next);
      return n === expr.n && k === expr.k ? expr : { ...expr, n, k };
    }
  }
}

export function clone(expr: Expr): Expr {
  return JSON.parse(JSON.stringify(expr)) as Expr;
}

export function isReal(expr: Expr): boolean {
  let real = true;
  walk(expr, (node) => {
    if (node.type === 'const' && node.name === 'i') real = false;
  });
  return real;
}

export function dependsOn(expr: Expr, name: string): boolean {
  switch (expr.type) {
    case 'var':
      return expr.name === name;
    case 'num':
    case 'const':
      return false;
    case 'integral':
    case 'sum':
      return dependsOn(expr.lo, name) || dependsOn(expr.hi, name) || (expr.v !== name && dependsOn(expr.body, name));
    case 'lim':
      return dependsOn(expr.to, name) || (expr.v !== name && dependsOn(expr.body, name));
    case 'deriv':
      return expr.v !== name && dependsOn(expr.body, name);
    default:
      return children(expr).some((child) => dependsOn(child, name));
  }
}

export function freeVars(expr: Expr): string[] {
  const names = new Set<string>();
  walk(expr, (node) => {
    if (node.type === 'var' && !node.bound) names.add(node.name);
  });
  return [...names];
}

export function binderNames(expr: Expr): string[] {
  const names: string[] = [];
  walk(expr, (node) => {
    if (node.type === 'integral' || node.type === 'sum' || node.type === 'lim' || node.type === 'deriv') {
      names.push(node.v);
    }
  });
  return names;
}

export function tally(expr: Expr): { nodes: number; integrals: number; sums: number; free: number } {
  let nodes = 0;
  let integrals = 0;
  let sums = 0;
  const free = new Set<string>();
  walk(expr, (node) => {
    nodes += 1;
    if (node.type === 'integral') integrals += 1;
    if (node.type === 'sum') sums += 1;
    if (node.type === 'var' && !node.bound) free.add(node.name);
  });
  return { nodes, integrals, sums, free: free.size };
}

export function introducedIds(expr: Expr, hole: Expr | null): string[] {
  const skip = new Set(hole ? idsOf(hole) : []);
  return idsOf(expr).filter((id) => !skip.has(id));
}

function precedence(expr: Expr): number {
  switch (expr.type) {
    case 'add':
      return PREC.add;
    case 'mul':
      return PREC.mul;
    case 'neg':
      return PREC.unary;
    case 'pow':
      return PREC.pow;
    case 'fact':
      return PREC.fact;
    default:
      return PREC.atom;
  }
}

function tex(expr: Expr, min: number, strict = false): string {
  const body = raw(expr);
  const wrap = strict ? precedence(expr) <= min : precedence(expr) < min;
  const grouped = wrap ? `\\left(${body}\\right)` : body;
  return `\\htmlId{${expr.id}}{${grouped}}`;
}

function raw(expr: Expr): string {
  switch (expr.type) {
    case 'num':
      return Number.isInteger(expr.value) ? String(expr.value) : String(expr.value);
    case 'var':
      return expr.name;
    case 'const':
      if (expr.name === 'pi') return '\\pi';
      if (expr.name === 'i') return 'i';
      return '\\infty';
    case 'add':
      return expr.args.map((arg, index) => addend(arg, index)).join('');
    case 'mul':
      return expr.args.map((arg, index) => (index === 0 ? factor(arg) : `\\cdot ${factor(arg)}`)).join('');
    case 'neg':
      return `-${tex(expr.arg, PREC.unary)}`;
    case 'div':
      if (expr.num.type === 'fn' && expr.num.name === 'ln' && expr.den.type === 'fn' && expr.den.name === 'ln') {
        return `\\htmlId{${expr.num.id}}{\\htmlId{${expr.den.id}}{\\log_{${tex(expr.den.arg, 0)}}{${tex(expr.num.arg, 0)}}}}`;
      }
      return `\\frac{${tex(expr.num, 0)}}{${tex(expr.den, 0)}}`;
    case 'pow':
      return power(expr);
    case 'fn':
      return fnTex(expr);
    case 'integral':
      return `\\int_{${tex(expr.lo, 0)}}^{${tex(expr.hi, 0)}} ${groupSum(expr.body)}\\,d${expr.v}`;
    case 'sum':
      return `\\sum_{${expr.v}=${tex(expr.lo, 0)}}^{${tex(expr.hi, 0)}} ${groupSum(expr.body)}`;
    case 'lim':
      return `\\lim_{${expr.v} \\to ${tex(expr.to, 0)}} ${groupSum(expr.body)}`;
    case 'deriv':
      return `\\frac{d}{d${expr.v}}${tex(expr.body, PREC.mul)}`;
    case 'det':
      return `\\begin{vmatrix} ${tex(expr.a, 0)} & ${tex(expr.b, 0)} \\\\ ${tex(expr.c, 0)} & ${tex(expr.d, 0)} \\end{vmatrix}`;
    case 'fact':
      return `${tex(expr.arg, PREC.fact)}!`;
    case 'binom':
      return `\\binom{${tex(expr.n, 0)}}{${tex(expr.k, 0)}}`;
  }
}

function addend(arg: Expr, index: number): string {
  if (arg.type === 'neg') {
    return `\\htmlId{${arg.id}}{-${tex(arg.arg, PREC.unary)}}`;
  }
  const piece = tex(arg, PREC.add);
  return index === 0 ? piece : `+${piece}`;
}

function factor(arg: Expr): string {
  if (arg.type === 'neg') return tex(arg, PREC.pow);
  return tex(arg, PREC.mul);
}

function groupSum(body: Expr): string {
  if (body.type === 'add' || body.type === 'neg') return tex(body, PREC.pow);
  return tex(body, 0);
}

function power(expr: Extract<Expr, { type: 'pow' }>): string {
  if (expr.base.type === 'fn' && (expr.exp.type === 'num' || expr.exp.type === 'var' || expr.exp.type === 'const')) {
    const base = expr.base;
    return `${fnHead(base)}^{${tex(expr.exp, 0)}}\\htmlId{${base.id}}{\\left(${tex(base.arg, 0)}\\right)}`;
  }
  return `${tex(expr.base, PREC.pow, true)}^{${tex(expr.exp, 0)}}`;
}

function fnTex(expr: Extract<Expr, { type: 'fn' }>): string {
  if (expr.name === 'exp') return `e^{${tex(expr.arg, 0)}}`;
  if (expr.name === 'gamma') return `\\Gamma\\left(${tex(expr.arg, 0)}\\right)`;
  return `${fnHead(expr)}\\left(${tex(expr.arg, 0)}\\right)`;
}

function fnHead(expr: Extract<Expr, { type: 'fn' }>): string {
  if (expr.name === 'gamma') return '\\Gamma';
  if (expr.name === 'exp') return 'e';
  return `\\${expr.name}`;
}

export function latex(expr: Expr): string {
  return tex(expr, 0);
}
