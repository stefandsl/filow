// Script translation on this PC, through Ollama. Nothing leaves the computer on this path: the only
// address it talks to is OLLAMA_URL. A small model cannot be trusted to copy a whole outline's shape,
// so the outline is cut into small chunks of lines and every chunk must come back with exactly its
// own lines (a JSON object with one key per line, held by Ollama's schema-constrained output). A
// chunk that comes back wrong is asked once more; if it is wrong again its lines stay in the
// original language and the caller is told which. Points are never dropped, merged or invented.
import type { Script } from "@filow/core";
import { OLLAMA_URL } from "./decide/clef";

/** Lines per request: small enough that a 1.5 GB model keeps them apart (docs/TRANSLATE-LOCAL.md). */
export const LOCAL_TRANSLATE_CHUNK = 6;

/**
 * Models that translate an outline acceptably, best first (measured, docs/TRANSLATE-LOCAL.md). The
 * first one installed is used; TRANSLATE_LOCAL_MODEL overrides. Every setup that has a text model
 * installs one of these.
 */
export const LOCAL_TRANSLATE_MODELS = ["gemma4:e4b", "gemma4:e2b"];

export type LocalTranslateReason = "ollama_down" | "no_model" | "too_slow" | "failed";

/** A failure of the local path as a whole; `reason` picks the sentence the editor shows. */
export class LocalTranslateError extends Error {
  constructor(
    readonly reason: LocalTranslateReason,
    message: string,
    readonly model = "",
  ) {
    super(message);
    this.name = "LocalTranslateError";
  }
}

const sameModel = (installed: string, wanted: string) => installed === wanted || installed === `${wanted}:latest` || (!wanted.includes(":") && installed.split(":")[0] === wanted);

/** The model translation would use among the installed Ollama tags, or null when none of them is there. */
export function pickTranslateModel(installed: string[], configured = process.env.TRANSLATE_LOCAL_MODEL): string | null {
  if (configured) return installed.some((i) => sameModel(i, configured)) ? configured : null;
  return LOCAL_TRANSLATE_MODELS.find((m) => installed.some((i) => sameModel(i, m))) ?? null;
}

export type LocalTranslateState = { ok: true; model: string } | { ok: false; reason: "ollama_down" | "no_model" };

/** Whether this PC can translate now: Ollama answers and one of the translation models is installed. */
export async function localTranslateState(): Promise<LocalTranslateState> {
  let installed: string[];
  try {
    const res = await fetch(`${OLLAMA_URL()}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, reason: "ollama_down" };
    installed = (((await res.json()) as { models?: Array<{ name: string }> }).models ?? []).map((m) => m.name);
  } catch {
    return { ok: false, reason: "ollama_down" };
  }
  const model = pickTranslateModel(installed);
  return model ? { ok: true, model } : { ok: false, reason: "no_model" };
}

const key = (i: number) => `l${i + 1}`;

const CYRILLIC = /[Ѐ-ӿ]/;
const KANA_OR_HAN = /[぀-ヿ㐀-鿿]/;
const LETTERS = /\p{L}/gu;

/**
 * A line that is plainly not in the language asked for. Small models do this (measured): a section
 * "translated into Japanese" came back in English, a Russian sentence ended in Chinese characters.
 */
function wrongScript(line: string, source: string, language: string): boolean {
  const long = (line.match(LETTERS) ?? []).length >= 12;
  if (language === "Russian" && long && !CYRILLIC.test(line)) return true;
  if (language === "Japanese" && long && !KANA_OR_HAN.test(line)) return true;
  if (language !== "Japanese" && KANA_OR_HAN.test(line) && !KANA_OR_HAN.test(source)) return true;
  if (language !== "Russian" && CYRILLIC.test(line) && !CYRILLIC.test(source)) return true;
  return otherLanguage(line, language);
}

/** Small words that give a language away, for the languages written in Latin letters that a script is translated into. */
const SMALL_WORDS: Record<string, string[]> = {
  English: ["the", "and", "you", "your", "is", "are", "with", "for", "this", "that", "it", "of", "to", "when", "if", "at", "by", "from", "as", "we", "there"],
  Italian: ["il", "lo", "gli", "che", "di", "non", "per", "sono", "con", "del", "della", "una", "sul", "tuo", "tua", "ai", "anche", "senza", "ti", "più", "ci", "nel"],
  Romanian: ["și", "să", "este", "pentru", "cu", "nu", "din", "pe", "care", "mai", "sunt", "îl", "îți", "ești", "cel", "cei", "când", "dacă", "fără", "către"],
  German: ["der", "die", "das", "und", "ist", "nicht", "mit", "für", "ein", "eine", "zu", "auf", "den", "sie", "wenn", "dem", "du", "dein", "ohne", "wir"],
  French: ["le", "les", "et", "est", "pas", "pour", "avec", "une", "des", "du", "vous", "votre", "qui", "sur", "dans", "sans", "nous", "au"],
  Spanish: ["el", "los", "las", "y", "es", "para", "una", "del", "por", "más", "sin", "cuando", "hay", "al", "su", "nos"],
};

/**
 * A sentence in another language than the one asked for: a model that rewords the Italian line in
 * Italian instead of translating it (measured: translategemma:4b through this prompt, lfm3-vl). Kept
 * careful so a good line is never refused: at least five words, none of the target language's small
 * words, and two or more of another language's.
 */
function otherLanguage(line: string, language: string): boolean {
  const target = SMALL_WORDS[language];
  if (!target) return false;
  const words = line.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  if (words.length < 5) return false;
  const hits = (list: string[]) => words.filter((w) => list.includes(w)).length;
  if (hits(target) > 0) return false;
  return Object.entries(SMALL_WORDS).some(([name, list]) => name !== language && hits(list) >= 2);
}

/** One line of an outline as the model returned it, or null when it is not a usable translation of `source`. */
function cleanLine(value: unknown, source: string, language: string): string | null {
  if (typeof value !== "string") return null;
  // one line, without the markers the editor adds itself
  const line = value.replace(/\s+/g, " ").replace(/^(?:[-*•#]+\s+)+/, "").trim();
  if (!line) return null;
  // a "translation" several times longer than its line is the model talking, not translating
  if (line.length > source.length * 4 + 60) return null;
  // nothing that the editor would read as a comment or as the PII guard's placeholder
  if (line.includes("<!--")) return null;
  // a sentence handed back word for word was not translated (a small model does this with whole chunks)
  if (line === source.replace(/\s+/g, " ").trim() && source.trim().split(/\s+/).length >= 3) return null;
  if (wrongScript(line, source, language)) return null;
  return line;
}

/** Ollama's Qwen3-VL tags think for minutes even with think:false; a closed think block skips it (buddy/providers.ts). */
const noThink = (model: string) => (model.startsWith("qwen3-vl") ? [{ role: "assistant", content: "<think>\n\n</think>\n\n" }] : []);

/**
 * One request for a few lines. Null: the answer does not have the chunk's shape. Otherwise one entry
 * per line: its translation, or null when that line came back unusable.
 */
async function translateChunk(lines: string[], language: string, model: string, attempt: number, signal?: AbortSignal): Promise<Array<string | null> | null> {
  const input: Record<string, string> = {};
  const properties: Record<string, { type: "string" }> = {};
  lines.forEach((l, i) => {
    input[key(i)] = l;
    properties[key(i)] = { type: "string" };
  });
  const system = [
    `You translate the lines of a speaker's outline into ${language}.`,
    `The input is a JSON object with ${lines.length} lines under the keys ${key(0)} to ${key(lines.length - 1)}.`,
    `Answer with a JSON object that has exactly the same keys: each value is the ${language} translation of the line under that key.`,
    "Translate every line fully and keep its meaning and tone. Keep names of people, companies and products, numbers and acronyms as they are.",
    "Never merge, split, add, drop or reorder lines. No comments, no explanations.",
  ].join(" ");
  const timeout = AbortSignal.timeout(180_000);
  let res: Response;
  try {
    res = await fetch(`${OLLAMA_URL()}/api/chat`, {
      method: "POST",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        keep_alive: "30m",
        format: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
        // the second try is not the first one again: a little warmer, another seed
        options: { temperature: attempt === 0 ? 0.2 : 0.5, seed: 7 + attempt, num_ctx: 4096, num_predict: 1200 },
        messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(input) }, ...noThink(model)],
      }),
    });
  } catch (e) {
    if (e instanceof Error && e.name === "TimeoutError") throw new LocalTranslateError("too_slow", `The local model ${model} did not answer within three minutes.`, model);
    throw new LocalTranslateError("ollama_down", `Ollama is not running at ${OLLAMA_URL()}.`, model);
  }
  if (res.status === 404) throw new LocalTranslateError("no_model", `The local model ${model} is not installed.`, model);
  if (!res.ok) throw new LocalTranslateError("failed", `Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`, model);
  let parsed: unknown;
  try {
    const content = ((await res.json()) as { message?: { content?: string } }).message?.content ?? "";
    parsed = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const got = parsed as Record<string, unknown>;
  // other keys than the ones asked for: the lines cannot be told apart any more
  if (Object.keys(got).length !== lines.length || lines.some((_, i) => !Object.hasOwn(got, key(i)))) return null;
  return lines.map((source, i) => cleanLine(got[key(i)], source, language));
}

export type LocalTranslation = {
  script: Script;
  model: string;
  /** lines (titles and points) left in the original language because they came back wrong twice */
  untranslated: number;
  /** 1-based numbers of the sections that hold such lines */
  untranslatedSections: number[];
  /** chunks that needed the second try */
  retried: number;
};

/**
 * Translates a parsed script into `language` (an English language name) with a local model. The
 * result always has the source's sections and points, one to one: a line is either translated or
 * the source line itself.
 */
export async function translateScriptLocal(source: Script, language: string, model: string, signal?: AbortSignal): Promise<LocalTranslation> {
  let untranslated = 0;
  let retried = 0;
  const untranslatedSections: number[] = [];
  const sections: Script["sections"] = [];
  for (const [si, s] of source.sections.entries()) {
    const lines = [s.title, ...s.bullets.map((b) => b.text)];
    const done: string[] = [];
    for (let at = 0; at < lines.length; at += LOCAL_TRANSLATE_CHUNK) {
      const chunk = lines.slice(at, at + LOCAL_TRANSLATE_CHUNK);
      let got = (await translateChunk(chunk, language, model, 0, signal)) ?? chunk.map(() => null);
      if (got.includes(null)) {
        // once more, and only for what is still missing: a line that was fine the first time stays
        retried++;
        const again = await translateChunk(chunk, language, model, 1, signal);
        if (again) got = got.map((line, i) => line ?? again[i]);
      }
      const missing = got.filter((line) => line === null).length;
      if (missing) {
        untranslated += missing;
        if (!untranslatedSections.includes(si + 1)) untranslatedSections.push(si + 1);
      }
      done.push(...got.map((line, i) => line ?? chunk[i]));
    }
    sections.push({ ...s, title: done[0], bullets: s.bullets.map((b, i) => ({ ...b, text: done[i + 1] })) });
  }
  return { script: { ...source, sections }, model, untranslated, untranslatedSections, retried };
}
