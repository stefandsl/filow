// Drawing has its own online models (owner, 14/11: "use the best models for drawing and also for 3D").
// Screen answers and pointing keep BUDDY_CLOUD_MODEL (GPT-6 Luna). Measured blind, mean rank, 1 best
// (G:/FILOW/tmp/draw-models, 14/11/2026):
//  - 2D drawing: GPT-6 Astra 1.8, Claude Opus 5.5 3.7, Claude Sonnet 5.5 4.0, Gemini 3.8 Flash 4.6, GPT-6 Luna 5.7.
//  - 3D parts: Gemini 3.8 Flash 2.6 (8 of 8 valid, 7.7 s, $0.004), Opus and Sonnet 2.8, Astra 2.9, Luna 4.5.
//  - Raster illustration: Gemini Nano Banana 2.1, 1.2.
// The app knows in advance with no model call: wantsDrawing (lib/buddy/visuals.ts) and
// wantsIllustration below read the question's words, so a normal question is untouched.
// Pure: the settings page, the panel and the server share these lists.
import { wantsDrawing, type DrawKind } from "./visuals";

export type DrawTask = "draw2d" | "draw3d" | "illustration";
export const DRAW_TASKS: readonly DrawTask[] = ["draw2d", "draw3d", "illustration"];

/** The models offered for each drawing task, the default first. A name not on its list is never sent. */
export const DRAW_MODELS: Record<DrawTask, readonly string[]> = {
  draw2d: ["openai/gpt-6-astra", "anthropic/claude-opus-5.5", "anthropic/claude-sonnet-5.5", "google/gemini-3.8-flash", "openai/gpt-6-luna"],
  draw3d: ["google/gemini-3.8-flash", "anthropic/claude-opus-5.5", "anthropic/claude-sonnet-5.5", "openai/gpt-6-astra", "openai/gpt-6-luna"],
  illustration: ["google/gemini-nano-banana-2.1"],
};

export const isDrawTask = (v: unknown): v is DrawTask => typeof v === "string" && (DRAW_TASKS as readonly string[]).includes(v);
export const isDrawModel = (task: DrawTask, model: unknown): model is string => typeof model === "string" && DRAW_MODELS[task].includes(model);
export const drawTaskOf = (kind: DrawKind): DrawTask => (kind === "3d" ? "draw3d" : "draw2d");

/**
 * The drawing task a question asks for, from its words only (no model call), or null for a normal
 * question. The server and the panel use the same rule, so the notice names the maker that is called.
 */
export function drawTaskFor(question: string): DrawTask | null {
  const kind = wantsDrawing(question);
  return kind ? drawTaskOf(kind) : null;
}

/** The model for a task: the user's choice when it is on the list, else the default. */
export const drawModelFor = (task: DrawTask, chosen?: unknown): string => (isDrawModel(task, chosen) ? chosen : DRAW_MODELS[task][0]);
