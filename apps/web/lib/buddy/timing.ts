// The speed baseline's server marks (docs/perf/LATENCY-2026-11.md, tools/eval/latency.mjs): the wall
// times of one /api/buddy/ask request and what Ollama reports for it. The desktop shell runs this server
// in its own process and hands it a log function (globalThis.__filowPerfLog, apps/desktop/main.js); the
// line it gets holds fixed names and numbers only, never a word of the question, the answer or the screen.
// Without that function (the web app alone, tests) nothing is written and the marks cost nothing.

export type ServerTiming = {
  /** The panel's run id (X-Filow-Run), "7" for the answer, "7g" for its grounding request. */
  run: string;
  marks: { received?: number; helperResolved?: number; ollamaSent?: number; ollamaFirstByte?: number };
  ollama: { loadMs?: number; promptEvalMs?: number; promptTokens?: number; evalTokens?: number };
  images?: number;
  model?: string;
};

const RUN = /^\d{1,9}g?$/;
const MODEL = /^[a-z0-9.:_-]{1,40}$/;

/** A timing object for the request, or null when the request carries no run id (nothing is measured). */
export function createServerTiming(runHeader: string | null | undefined, now = Date.now()): ServerTiming | null {
  const run = typeof runHeader === "string" ? runHeader.trim() : "";
  if (!RUN.test(run)) return null;
  return { run, marks: { received: now }, ollama: {} };
}

/** Sets a mark once (the first call wins: the first byte, the first send). */
export function mark(t: ServerTiming | null | undefined, name: keyof ServerTiming["marks"], at = Date.now()): void {
  if (t && t.marks[name] === undefined) t.marks[name] = at;
}

/** What Ollama's last streamed line (`done: true`) says about the work: durations in ns, counts. */
export function takeOllamaDone(t: ServerTiming | null | undefined, done: Record<string, unknown>): void {
  if (!t) return;
  const ns = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v / 1e6 : undefined);
  const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined);
  t.ollama = { loadMs: ns(done.load_duration), promptEvalMs: ns(done.prompt_eval_duration), promptTokens: count(done.prompt_eval_count), evalTokens: count(done.eval_count) };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Pure: the log line, from fixed names and numbers only.
 * `okfilow: server run 7 main: received 0, helperResolved 210, ollamaSent 230, ollamaFirstByte 3120 ms; load 0, promptEval 2710 ms, prompt 1840 tok, eval 96 tok; images 1; model lfm3-vl`
 */
export function serverTimingLine(t: ServerTiming): string {
  const run = RUN.test(String(t.run)) ? String(t.run) : "-";
  const base = finite(t.marks.received) ? t.marks.received : null;
  const marks = (["received", "helperResolved", "ollamaSent", "ollamaFirstByte"] as const)
    .filter((k) => base !== null && finite(t.marks[k]))
    .map((k) => `${k} ${Math.round((t.marks[k] as number) - (base as number))}`);
  const o = t.ollama ?? {};
  const work = [
    finite(o.loadMs) ? `load ${Math.round(o.loadMs)}` : "",
    finite(o.promptEvalMs) ? `promptEval ${Math.round(o.promptEvalMs)} ms` : "",
    finite(o.promptTokens) ? `prompt ${Math.round(o.promptTokens)} tok` : "",
    finite(o.evalTokens) ? `eval ${Math.round(o.evalTokens)} tok` : "",
  ].filter(Boolean);
  const model = typeof t.model === "string" && MODEL.test(t.model) ? t.model : "-";
  const images = finite(t.images) && t.images >= 0 ? Math.round(t.images) : 0;
  return `okfilow: server run ${run} ${run.endsWith("g") ? "ground" : "main"}: ${marks.join(", ")} ms; ${work.join(", ")}; images ${images}; model ${model}`;
}

/** Writes the line through the desktop shell's log function, when there is one. Never throws. */
export function logServerTiming(t: ServerTiming | null | undefined): void {
  if (!t) return;
  const log = (globalThis as { __filowPerfLog?: (line: string) => void }).__filowPerfLog;
  if (typeof log !== "function") return;
  try {
    log(serverTimingLine(t));
  } catch {
    /* a log that cannot be written never breaks an answer */
  }
}
