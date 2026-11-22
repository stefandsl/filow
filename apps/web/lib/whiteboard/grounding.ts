import { lessonNodes, type Lesson } from "./lesson";
import { checkArithmetic } from "./plot";

// Defined SI prefix factors. Compare in the base unit, including on labelled diagram edges.
const units: Record<string, [string, number]> = {
  mm: ["length", 0.001], cm: ["length", 0.01], m: ["length", 1], km: ["length", 1000],
  ms: ["time", 0.001], s: ["time", 1], min: ["time", 60], h: ["time", 3600],
  mg: ["mass", 0.001], g: ["mass", 1], kg: ["mass", 1000],
};
const quantity = "(-?\\d+(?:\\.\\d+)?)\\s*(mm|cm|km|ms|min|mg|kg|m|s|h|g)\\b";
function wrongConversion(text: string) {
  const re = new RegExp(quantity + "\\s*(?:=|equals?|is equal to|equivale a)\\s*" + quantity, "gi");
  for (const match of text.matchAll(re)) {
    const [, a, unitA, b, unitB] = match;
    const [dimension, scale] = units[unitA.toLowerCase()];
    const [other, factor] = units[unitB.toLowerCase()];
    const left = Number(a) * scale, right = Number(b) * factor;
    if (dimension !== other || Math.abs(left - right) > 1e-10 * Math.max(1, Math.abs(left), Math.abs(right))) return true;
  }
  return false;
}

// A transition is defined by its ordered thermodynamic phases.
const phases: Record<string, string> = {
  solid: "solid", ice: "solid", liquid: "liquid", "liquid water": "liquid",
  gas: "gas", vapor: "gas", vapour: "gas", "water vapor": "gas", "water vapour": "gas",
};
const transitions: Record<string, string> = {
  "solid-liquid": "melt", "liquid-solid": "freez", "liquid-gas": "evapor|vapori|boil",
  "gas-liquid": "condens", "solid-gas": "sublim", "gas-solid": "deposit|deposi",
};
export function groundingReference(question: string) {
  if (/\b(?:phase change|states of matter|condensation|evaporation|melting|sublimation)\b/i.test(question))
    return "Check each labelled change of phase against these definitions: melting solid to liquid, freezing liquid to solid, vaporization liquid to gas, condensation gas to liquid, sublimation solid to gas, deposition gas to solid.";
  if (/\b(?:metric|unit conversion|convert|measurement)\b/i.test(question))
    return "Check every equality in base units: 1 km = 1000 m, 1 m = 100 cm = 1000 mm, 1 kg = 1000 g, 1 min = 60 s.";
  return "";
}

export function groundingErrors(lesson: Lesson): string[] {
  const faults = new Set<string>();
  const names = lessonNodes(lesson);
  const text = (words: string) => {
    if (wrongConversion(words)) faults.add("The stated unit conversion does not preserve the quantity.");
    if (checkArithmetic(words).length) faults.add("The stated calculation does not give the displayed result.");
  };
  const relation = (from: string, verb: string, to: string) => {
    text(from + " " + verb + " " + to);
    const a = phases[from.toLowerCase()], b = phases[to.toLowerCase()];
    if (a && b && Object.values(transitions).some(pattern => new RegExp(pattern, "i").test(verb))) {
      const expected = transitions[a + "-" + b];
      if (!expected || !new RegExp(expected, "i").test(verb)) faults.add("The named transition does not connect these phases in this direction.");
    }
  };
  for (const step of lesson.steps) {
    text(step.say);
    for (const m of step.say.matchAll(/\b(solid|ice|liquid|gas|vapor|vapour)\s+(melts?|freezes?|evaporates?|condenses?|sublimates?)\s+(?:into|to)\s+(?:a |an )?(solid|liquid|gas|vapor|vapour)\b/gi)) relation(m[1], m[2], m[3]);
    for (const item of step.items) {
      if ("text" in item && typeof item.text === "string") text(item.text);
      if (item.kind === "formula") text(item.tex);
      if (item.kind === "edge") relation(names.get(item.from) ?? "", item.text, names.get(item.to) ?? "");
    }
  }
  return [...faults];
}
