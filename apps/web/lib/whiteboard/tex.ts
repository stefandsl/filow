// A formula as plain text for the Excalidraw board: Excalidraw has no formula element, and a text
// element is what the user can edit by hand afterwards. The common LaTeX of a lesson ("a^2 + b^2 = c^2",
// "\frac{V}{R}", "A = P(1 + r/n)^{nt}") becomes Unicode ("a² + b² = c²", "V/R", "A = P(1 + r/n)ⁿᵗ").
// Pure: no DOM, no KaTeX. What it does not know it leaves readable rather than dropping it.

const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", t: "ᵗ", x: "ˣ", k: "ᵏ", a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", m: "ᵐ", r: "ʳ", s: "ˢ", y: "ʸ", T: "ᵀ" };
const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉", "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎", a: "ₐ", e: "ₑ", i: "ᵢ", j: "ⱼ", k: "ₖ", n: "ₙ", o: "ₒ", r: "ᵣ", t: "ₜ", x: "ₓ" };
const SYMBOLS: Record<string, string> = {
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓", le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡", propto: "∝",
  to: "→", rightarrow: "→", Rightarrow: "⇒", leftarrow: "←", leftrightarrow: "↔", iff: "⇔", implies: "⇒", infty: "∞", partial: "∂", nabla: "∇",
  sum: "Σ", prod: "Π", int: "∫", sqrt: "√", in: "∈", forall: "∀", exists: "∃", cdots: "⋯", ldots: "…", dots: "…", circ: "°", degree: "°",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", rho: "ρ", sigma: "σ", tau: "τ", phi: "φ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Phi: "Φ", Psi: "Ψ", Omega: "Ω", Omega_: "Ω",
  log: "log", ln: "ln", sin: "sin", cos: "cos", tan: "tan", exp: "exp", max: "max", min: "min", lim: "lim",
};

/** The group that starts at `i` ("{...}" or one character / one command), and where it ends. */
function group(s: string, i: number): { body: string; end: number } {
  while (s[i] === " ") i++;
  if (s[i] === "{") {
    let depth = 0;
    for (let k = i; k < s.length; k++) {
      if (s[k] === "\\") { k++; continue; }
      if (s[k] === "{") depth++;
      else if (s[k] === "}" && --depth === 0) return { body: s.slice(i + 1, k), end: k + 1 };
    }
    return { body: s.slice(i + 1), end: s.length };
  }
  if (s[i] === "\\") {
    const m = /^\\[a-zA-Z]+/.exec(s.slice(i));
    if (m) return { body: m[0], end: i + m[0].length };
    return { body: s.slice(i, i + 2), end: i + 2 };
  }
  return { body: s[i] ?? "", end: i + 1 };
}

/** A short piece in superscript or subscript letters when every character has one, else ^(...) / _(...). */
function script(text: string, table: Record<string, string>, mark: string): string {
  const plain = text.replace(/\s+/g, "");
  if (plain && Array.from(plain).every((ch) => table[ch])) return Array.from(plain).map((ch) => table[ch]).join("");
  return plain.length === 1 ? `${mark}${plain}` : `${mark}(${text})`;
}

/** A bracket around what has an operator inside, so "\frac{a+b}{c}" stays "(a+b)/c". */
const wrap = (t: string) => (/^[\w.²³⁰¹⁴-⁹ⁿᵗ]+$|^\(.*\)$/u.test(t) ? t : `(${t})`);

export function texToText(tex: string): string {
  let out = "";
  const s = tex.replace(/\\left|\\right|\\displaystyle|\\!/g, "").replace(/\\,|\\;|\\:|\\quad|\\qquad/g, " ");
  for (let i = 0; i < s.length; ) {
    const ch = s[i];
    if (ch === "\\") {
      const m = /^\\([a-zA-Z]+)/.exec(s.slice(i));
      if (!m) { out += s[i + 1] ?? ""; i += 2; continue; }
      const name = m[1];
      i += m[0].length;
      if (name === "frac" || name === "dfrac" || name === "tfrac") {
        const a = group(s, i);
        const b = group(s, a.end);
        out += `${wrap(texToText(a.body))}/${wrap(texToText(b.body))}`;
        i = b.end;
      } else if (name === "sqrt") {
        const a = group(s, i);
        out += `√${wrap(texToText(a.body))}`;
        i = a.end;
      } else if (/^(?:text|textrm|textit|textbf|mathrm|mathit|mathbf|operatorname|mbox)$/.test(name)) {
        const a = group(s, i);
        out += a.body;
        i = a.end;
      } else if (name === "hat" || name === "bar" || name === "vec" || name === "overline" || name === "tilde") {
        const a = group(s, i);
        out += texToText(a.body);
        i = a.end;
      } else out += SYMBOLS[name] ?? name;
    } else if (ch === "^" || ch === "_") {
      const a = group(s, i + 1);
      out += script(texToText(a.body), ch === "^" ? SUP : SUB, ch);
      i = a.end;
    } else if (ch === "{" || ch === "}") i++;
    else { out += ch === "*" ? "·" : ch; i++; }
  }
  return out.replace(/\s+/g, " ").replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();
}
