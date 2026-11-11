/**
 * The online models the whiteboard offers, the default first. Measured on the ten proof questions,
 * two paid runs each, strict review (docs/whiteboard/PROOF.md): Claude Sonnet 5.5 passed 9 and 9
 * of 10, Gemini 2.5 Flash 6 and 6. OK Filow's own answers keep their model (BUDDY_CLOUD_MODEL).
 * Kept apart from the server code so that the page and Settings can list them.
 */
export const WHITEBOARD_MODELS = ["anthropic/claude-sonnet-5.5", "google/gemini-2.5-flash"] as const;
export type WhiteboardModel = (typeof WHITEBOARD_MODELS)[number];
export const isWhiteboardModel = (v: unknown): v is WhiteboardModel => typeof v === "string" && (WHITEBOARD_MODELS as readonly string[]).includes(v);

/** Where the user's choice is kept (this profile). */
export const WHITEBOARD_MODEL_KEY = "filow.whiteboard.model";
/** The model chosen in this profile, or the default: storage may be unavailable, and an old or foreign value is not a choice. */
export function chosenWhiteboardModel(read: () => string | null = () => localStorage.getItem(WHITEBOARD_MODEL_KEY)): WhiteboardModel {
  try {
    const kept = read();
    return isWhiteboardModel(kept) ? kept : WHITEBOARD_MODELS[0];
  } catch {
    return WHITEBOARD_MODELS[0];
  }
}