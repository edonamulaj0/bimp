// Safe arithmetic: numbers, + - * / ^, parentheses, and a few functions. No eval.
const FN: Record<string, (...a: number[]) => number> = { ceil: Math.ceil, floor: Math.floor, round: Math.round, sqrt: Math.sqrt, min: Math.min, max: Math.max, abs: Math.abs };

export function calculate(expr: string): number {
  const toks = expr.match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|[a-z]+|[-+*/^(),]/gi) ?? [];
  if (toks.join('') !== expr.replace(/\s+/g, '')) throw new Error('Unsupported characters in expression');
  let i = 0;
  const peek = () => toks[i];
  const eat = (t?: string) => { const v = toks[i++]; if (t && v !== t) throw new Error(`Expected ${t}`); return v; };
  const expr0 = (): number => { let v = term(); while (peek() === '+' || peek() === '-') v = eat() === '+' ? v + term() : v - term(); return v; };
  const term = (): number => { let v = power(); while (peek() === '*' || peek() === '/') v = eat() === '*' ? v * power() : v / power(); return v; };
  const power = (): number => { const b = unary(); return peek() === '^' ? (eat(), b ** power()) : b; };
  const unary = (): number => (peek() === '-' ? (eat(), -unary()) : peek() === '+' ? (eat(), unary()) : atom());
  const atom = (): number => {
    const t = eat();
    if (t === undefined) throw new Error('Unexpected end');
    if (t === '(') { const v = expr0(); eat(')'); return v; }
    if (/^\d/.test(t)) return Number(t);
    const f = FN[t.toLowerCase()];
    if (!f) throw new Error(`Unknown function ${t}`);
    eat('(');
    const args = [expr0()];
    while (peek() === ',') { eat(); args.push(expr0()); }
    eat(')');
    return f(...args);
  };
  const v = expr0();
  if (i !== toks.length) throw new Error('Unexpected token');
  if (!Number.isFinite(v)) throw new Error('Result is not finite');
  return v;
}
