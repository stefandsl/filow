// Which model does each task: the tasks a power user can pin, and what a model must be able to do
// for each. Pure, so the settings page, the server pickers and the tests share one rule.
//
// Three engines:
//  - "ollama": an Ollama model on this PC or on one of the user's servers (lib/modelRoles/resolve.ts).
//  - "speech": a speech model of the desktop app (apps/desktop/stt.js), on this PC only.
//  - "single": one model can do it (dictation cleanup, punctuation, the natural voice): shown, not pinned.

export type OllamaTaskId = "okfilowAnswers" | "okfilowPointing" | "whiteboard" | "translate" | "generate" | "decision";
export type SpeechTaskId = "tracking" | "questions" | "dictation";
export type SingleTaskId = "cleanup" | "punctuation" | "voice";
export type TaskId = OllamaTaskId | SpeechTaskId | SingleTaskId;

/** What a model must do for a task: read pictures, write text, or be a Clef decision model. */
export type Need = "vision" | "chat" | "clef";

export type TaskDef = { id: TaskId; engine: "ollama" | "speech" | "single"; need?: Need };

/** In the order the settings page lists them: what people use most first. */
export const TASKS: TaskDef[] = [
  { id: "tracking", engine: "speech" },
  { id: "questions", engine: "speech" },
  { id: "dictation", engine: "speech" },
  { id: "cleanup", engine: "single" },
  { id: "punctuation", engine: "single" },
  { id: "okfilowAnswers", engine: "ollama", need: "vision" },
  { id: "okfilowPointing", engine: "ollama", need: "vision" },
  { id: "whiteboard", engine: "ollama", need: "chat" },
  { id: "translate", engine: "ollama", need: "chat" },
  { id: "generate", engine: "ollama", need: "vision" },
  { id: "decision", engine: "ollama", need: "clef" },
  { id: "voice", engine: "single" },
];

export const OLLAMA_TASKS = TASKS.filter((t) => t.engine === "ollama").map((t) => t.id as OllamaTaskId);
export const SPEECH_TASKS = TASKS.filter((t) => t.engine === "speech").map((t) => t.id as SpeechTaskId);
export const isTaskId = (v: unknown): v is TaskId => typeof v === "string" && TASKS.some((t) => t.id === v);
export const isOllamaTask = (v: unknown): v is OllamaTaskId => typeof v === "string" && (OLLAMA_TASKS as string[]).includes(v);
export const isSpeechTask = (v: unknown): v is SpeechTaskId => typeof v === "string" && (SPEECH_TASKS as string[]).includes(v);
export const taskDef = (id: TaskId): TaskDef => TASKS.find((t) => t.id === id)!;

/**
 * What Ollama says a model can do (GET /api/show `capabilities`: "completion", "vision",
 * "embedding", "tools", "thinking"); null when the server is older and does not say.
 */
export type OllamaModelInfo = { name: string; capabilities: string[] | null; sizeBytes?: number };

/** Families that read pictures, for an Ollama too old to report capabilities. */
const VISION_NAMES = /(llava|moondream|minicpm-v|vision|qwen2\.5vl|-vl\b|gemma3|gemma4|mistral-small3\.[12])/i;
const EMBEDDING_NAMES = /(embed|^bge|^all-minilm|^mxbai|^snowflake-arctic-embed)/i;

export function canSee(m: OllamaModelInfo): boolean {
  if (m.capabilities) return m.capabilities.includes("vision");
  // gemma3:1b and gemma3:270m are text only; the other Gemma 3 and 4 sizes read pictures
  if (/^gemma3:(1b|270m)/i.test(m.name)) return false;
  return VISION_NAMES.test(m.name);
}

export function canChat(m: OllamaModelInfo): boolean {
  if (m.capabilities) return m.capabilities.includes("completion");
  return !EMBEDDING_NAMES.test(m.name);
}

/** Clef answers through Ollama's System One endpoint; no other model can tick points there. */
export const isClef = (name: string) => /^clef(-flash)?(:|$)/i.test(name);

/** Why a model cannot do a task, in a word the page turns into a sentence; null when it can. */
export type Unfit = "vision" | "chat" | "clef";

export function unfitFor(need: Need, m: OllamaModelInfo): Unfit | null {
  if (need === "clef") return isClef(m.name) ? null : "clef";
  if (!canChat(m)) return "chat";
  if (need === "vision" && !canSee(m)) return "vision";
  return null;
}

/** Ollama reads a name without a tag as ":latest". */
export const tagged = (name: string) => (name.includes(":") ? name : `${name}:latest`);
export const sameModel = (a: string | null | undefined, b: string | null | undefined) => Boolean(a) && Boolean(b) && tagged(a!) === tagged(b!);
