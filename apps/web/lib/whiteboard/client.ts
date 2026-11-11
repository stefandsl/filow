// The page's side of a lesson: reading the stream of JSON lines from /api/whiteboard/lesson and
// putting the lesson together as its steps arrive. Pure (no React, no DOM), so it is tested as is.
import type { LessonEvent } from "./generate";
import type { Lesson } from "./lesson";

export type LessonMeta = { provider: "local" | "cloud"; model: string; lang: string; lite: boolean };
export type LessonState = {
  lesson: Lesson | null;
  /** Where the steps of the answer being read go: 0 for a new lesson, the end for a follow-up. */
  base: number;
  /** How many steps the lesson will have when the answer is complete. */
  expected: number;
  meta: LessonMeta | null;
  phase: "idle" | "planning" | "drawing" | "done" | "error";
  error: { code: string; message: string } | null;
  stalled: boolean;
  /** Steps shown as text because their drawing could not be made. */
  cards: number;
};
export type LessonAction =
  | { type: "ask"; more: boolean }
  | { type: "event"; event: LessonEvent }
  | { type: "fail"; code: string; message: string }
  | { type: "cancel" }
  | { type: "clear" };

export const initialLesson: LessonState = { lesson: null, base: 0, expected: 0, meta: null, phase: "idle", error: null, stalled: false, cards: 0 };

export function lessonReducer(s: LessonState, a: LessonAction): LessonState {
  const count = s.lesson?.steps.length ?? 0;
  switch (a.type) {
    case "clear":
      return initialLesson;
    case "ask":
      // a follow-up keeps the lesson and adds to it; a new question starts from an empty board
      return a.more && s.lesson ? { ...s, base: count, expected: count, phase: "planning", error: null, stalled: false } : { ...initialLesson, phase: "planning" };
    case "cancel":
      return { ...s, phase: s.lesson ? "done" : "idle", expected: count };
    case "fail":
      return { ...s, phase: "error", error: { code: a.code, message: a.message }, expected: count };
    case "event": {
      const e = a.event;
      if (s.phase !== "planning" && s.phase !== "drawing") return s; // an answer nobody is waiting for
      if (e.type === "start") return { ...s, meta: { provider: e.provider, model: e.model, lang: e.lang, lite: e.lite } };
      if (e.type === "outline") {
        if (s.base > 0 && s.lesson) return { ...s, expected: s.base + e.says.length, phase: "drawing" };
        return { ...s, lesson: { title: e.title, scene: e.scene, steps: [] }, base: 0, expected: e.says.length, phase: "drawing" };
      }
      if (e.type === "step") {
        // steps come in order; one that does not fit the next slot is ignored
        if (!s.lesson || s.base + e.index !== count) return s;
        return { ...s, lesson: { ...s.lesson, steps: [...s.lesson.steps, e.step] }, phase: "drawing" };
      }
      if (e.type === "done") return { ...s, phase: "done", stalled: s.stalled || e.stalled, cards: s.cards + e.cards, expected: count };
      if (e.type === "error") return { ...s, phase: "error", error: { code: e.code, message: e.message }, expected: count };
      return s;
    }
  }
}

/** Reads the JSON lines of a lesson answer; a line that is not JSON is skipped. */
export async function readLessonStream(body: ReadableStream<Uint8Array>, onEvent: (e: LessonEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const take = (line: string) => {
    if (!line.trim()) return;
    try {
      const e = JSON.parse(line) as LessonEvent;
      if (e && typeof e === "object" && typeof e.type === "string") onEvent(e);
    } catch { /* not a line of ours */ }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      take(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  take(buffer);
}

const TOPIC = [
  // "whiteboard: photosynthesis", "lavagna: la fotosintesi"
  /^\s*(?:on the\s+)?(?:whiteboard|lavagna)\s*[:,-]\s*(.+)$/i,
  // "explain photosynthesis on the whiteboard", "spiegami la fotosintesi alla lavagna"
  /^\s*(.+?)\s+(?:on|at|with|using)\s+(?:the|a)\s+whiteboard[.!?]*\s*$/i,
  /^\s*(.+?)\s+(?:alla|sulla|con la)\s+lavagna[.!?]*\s*$/i,
];
/**
 * The topic when a question to OK Filow asks for the whiteboard ("whiteboard: X", "explain X on the
 * whiteboard", "lavagna: X"); null when it is an ordinary question.
 */
export function whiteboardTopic(question: string): string | null {
  for (const re of TOPIC) {
    const m = re.exec(question);
    if (m && m[1].trim().length >= 2) return m[1].trim().slice(0, 400);
  }
  return null;
}
