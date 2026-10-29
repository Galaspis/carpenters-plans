// Tiny expression evaluator for parametric designs.
// Expressions are plain JS arithmetic over named variables, e.g. "W - 2*ov".

const MATH = {
  min: Math.min, max: Math.max, floor: Math.floor, ceil: Math.ceil,
  round: Math.round, abs: Math.abs, sqrt: Math.sqrt, cbrt: Math.cbrt, pow: Math.pow, PI: Math.PI,
  clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  snap: (v, step) => Math.round(v / step) * step,
};
const MATH_KEYS = Object.keys(MATH);
const MATH_VALS = Object.values(MATH);
const cache = new Map();

export function evalExpr(expr, scope) {
  if (typeof expr === 'number') return expr;
  if (typeof expr !== 'string') throw new Error('Bad expression: ' + JSON.stringify(expr));
  const keys = Object.keys(scope);
  const sig = keys.join(',') + '|' + expr;
  let fn = cache.get(sig);
  if (!fn) {
    try {
      fn = new Function(...MATH_KEYS, ...keys, `"use strict"; return (${expr});`);
    } catch (e) {
      throw new Error(`Syntax error in "${expr}": ${e.message}`);
    }
    cache.set(sig, fn);
  }
  let v;
  try {
    v = fn(...MATH_VALS, ...keys.map(k => scope[k]));
  } catch (e) {
    throw new Error(`Cannot evaluate "${expr}": ${e.message}`);
  }
  if (typeof v === 'boolean') v = v ? 1 : 0;
  if (typeof v !== 'number' || !isFinite(v)) throw new Error(`Expression "${expr}" gave ${v}`);
  return v;
}
