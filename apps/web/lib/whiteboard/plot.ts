// A plot on the whiteboard: the model writes an expression in x ("x^2 - 3", "2*sin(x)"), and this
// file reads it with its own small parser and walks the tree to get numbers. The text is never
// turned into code (no eval, no Function): anything the grammar does not know is refused.

export type Expr =
  | { t: "num"; v: number }
  | { t: "x" }
  | { t: "neg"; a: Expr }
  | { t: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Expr; b: Expr }
  | { t: "fn"; name: FnName; a: Expr };

const FNS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  sqrt: Math.sqrt,
  abs: Math.abs,
} as const;
type FnName = keyof typeof FNS;
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

export const MAX_EXPR_LENGTH = 80;
const MAX_NODES = 120;

// Minus signs, dashes, multiplication dots and crosses, the division sign and the letter pi, by code point.
const SIGNS: Record<number, string> = { 0x2212: "-", 0x2013: "-", 0x2014: "-", 0xd7: "*", 0xb7: "*", 0x22c5: "*", 0xf7: "/", 0x3c0: "pi" };

/** "y = x^2", "f(x) = 2x + 1" and unicode signs are brought to the plain form the parser reads. */
export function cleanExpr(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return Array.from(raw, (ch) => SIGNS[ch.codePointAt(0) ?? 0] ?? ch).join("")
    .replace(/\*\*/g, "^")
    .replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, "")
    .trim();
}

/** Reads an expression in x. Null when it is not one (too long, unknown name, unbalanced, empty). */
export function parseExpr(raw: unknown): Expr | null {
  const src = cleanExpr(raw).toLowerCase();
  if (!src || src.length > MAX_EXPR_LENGTH) return null;
  const tokens = src.match(/\d+(?:\.\d+)?|\.\d+|[a-z][a-z0-9]*|[-+*/^()]|\S/g) ?? [];
  let i = 0;
  let nodes = 0;
  let bad = false;
  const made = <T extends Expr>(e: T): T => {
    if (++nodes > MAX_NODES) bad = true;
    return e;
  };
  const peek = () => tokens[i];
  const startsAtom = (t: string | undefined) => t !== undefined && (/^[\d.]/.test(t) || /^[a-z]/.test(t) || t === "(");

  function atom(): Expr | null {
    const t = tokens[i++];
    if (t === undefined) return null;
    if (/^[\d.]/.test(t)) {
      const v = Number(t);
      return Number.isFinite(v) ? made({ t: "num", v }) : null;
    }
    if (t === "(") {
      const e = sum();
      if (tokens[i++] !== ")") return null;
      return e;
    }
    if (t === "x") return made({ t: "x" });
    if (t in CONSTS) return made({ t: "num", v: CONSTS[t] });
    if (Object.prototype.hasOwnProperty.call(FNS, t)) {
      if (tokens[i++] !== "(") return null;
      const a = sum();
      if (!a || tokens[i++] !== ")") return null;
      return made({ t: "fn", name: t as FnName, a });
    }
    return null;
  }
  function power(): Expr | null {
    const base = atom();
    if (!base) return null;
    if (peek() !== "^") return base;
    i++;
    const exp = unary();
    return exp ? made({ t: "bin", op: "^", a: base, b: exp }) : null;
  }
  function unary(): Expr | null {
    if (peek() === "-") {
      i++;
      const a = unary();
      return a ? made({ t: "neg", a }) : null;
    }
    if (peek() === "+") i++;
    return power();
  }
  function product(): Expr | null {
    let left = unary();
    while (left && !bad) {
      const t = peek();
      if (t === "*" || t === "/") {
        i++;
        const right = unary();
        if (!right) return null;
        left = made({ t: "bin", op: t, a: left, b: right });
      } else if (startsAtom(t)) {
        // "2x", "3(x + 1)", "x sin(x)": a product written without its sign
        const right = power();
        if (!right) return null;
        left = made({ t: "bin", op: "*", a: left, b: right });
      } else break;
    }
    return left;
  }
  function sum(): Expr | null {
    let left = product();
    while (left && !bad) {
      const t = peek();
      if (t !== "+" && t !== "-") break;
      i++;
      const right = product();
      if (!right) return null;
      left = made({ t: "bin", op: t, a: left, b: right });
    }
    return left;
  }

  const tree = sum();
  if (!tree || bad || i !== tokens.length) return null;
  return tree;
}

export function evalExpr(e: Expr, x: number): number {
  switch (e.t) {
    case "num": return e.v;
    case "x": return x;
    case "neg": return -evalExpr(e.a, x);
    case "fn": return FNS[e.name](evalExpr(e.a, x));
    case "bin": {
      const a = evalExpr(e.a, x);
      const b = evalExpr(e.b, x);
      switch (e.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return a / b;
        case "^": return Math.pow(a, b);
      }
    }
  }
}

export type PlotCurve = {
  /** Runs of points the pen draws without lifting (a gap where the function has no value). */
  runs: Array<Array<[number, number]>>;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
};

/**
 * Samples the function over [xmin, xmax]. The y range is taken from the middle of the values so
 * one pole (1/x, tan x) does not flatten the rest; points outside it end a run. Null when the
 * function has no value anywhere in the range.
 */
export function sampleCurve(e: Expr, xmin: number, xmax: number, samples = 120): PlotCurve | null {
  const pts: Array<[number, number]> = [];
  for (let k = 0; k <= samples; k++) {
    const x = xmin + ((xmax - xmin) * k) / samples;
    pts.push([x, evalExpr(e, x)]);
  }
  const ys = pts.map((p) => p[1]).filter((y) => Number.isFinite(y)).sort((a, b) => a - b);
  if (ys.length < 2) return null;
  const q = (f: number) => ys[Math.min(ys.length - 1, Math.max(0, Math.round(f * (ys.length - 1))))];
  let lo = q(0.04);
  let hi = q(0.96);
  if (ys[0] >= lo - (hi - lo) * 2 && ys[ys.length - 1] <= hi + (hi - lo) * 2) {
    lo = ys[0];
    hi = ys[ys.length - 1];
  }
  if (hi - lo < 1e-9) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.08;
  const ymin = lo - pad;
  const ymax = hi + pad;
  const runs: PlotCurve["runs"] = [];
  let run: Array<[number, number]> = [];
  for (const [x, y] of pts) {
    if (Number.isFinite(y) && y >= ymin && y <= ymax) run.push([x, y]);
    else if (run.length) {
      if (run.length > 1) runs.push(run);
      run = [];
    }
  }
  if (run.length > 1) runs.push(run);
  if (!runs.length) return null;
  return { runs, xmin, xmax, ymin, ymax };
}

/**
 * The sums a sentence states that do not come out ("(0+1)/2 = 0"), each as it was written. Found by
 * computing them: the left side is read by the same parser as a plot (numbers and + - * / ^ only),
 * and compared with the number on the right at the precision that number is written in.
 */
export function checkArithmetic(text: string): string[] {
  const wrong: string[] = [];
  const signs = Array.from(text, (ch) => SIGNS[ch.codePointAt(0) ?? 0] ?? ch).join("").replace(/pi/g, "#");
  const re = /([\d.()+\-*/^\s]{3,})=\s*(-?\d+(?:\.\d+)?)/g;
  for (let m = re.exec(signs); m; m = re.exec(signs)) {
    const left = m[1].trim();
    // a sum has an operator between numbers; "x = 5" or "2024 = 2024" is not one
    if (!/\d\s*[+\-*/^]\s*[\d(]/.test(left)) continue;
    const tree = parseExpr(left);
    if (!tree) continue;
    const value = evalExpr(tree, 0);
    const stated = Number(m[2]);
    const decimals = (m[2].split(".")[1] ?? "").length;
    const scale = 10 ** decimals;
    if (!Number.isFinite(value) || Math.abs(Math.round(value * scale) / scale - stated) > 1e-9) wrong.push(`${left} = ${m[2]}`);
  }
  return wrong;
}