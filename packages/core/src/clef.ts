// Cloudflare Clef (System One API) request builder and parser. Pure, no network.
// Shape confirmed on ollama.com/library/clef-flash: POST /v1/systemone
// { model, state, questions: { id: { type: "noul", instructions, criteria } } }
// → { answers: { id: { noul: <probability 0..1> } } }.
import type { DecideRequest, Decision } from "./api";

export type ClefQuestion = {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
};

export type ClefRequest = {
  model: string;
  state: string | Record<string, unknown>;
  questions: Record<string, ClefQuestion>;
};

export type ClefResponse = {
  answers?: Record<string, { noul?: number; choice?: string; score?: number }>;
};

const RUBRIC =
  "Judge the idea, not the wording: paraphrases, synonyms, examples and translations count. " +
  "Only the transcript counts; never assume the speaker will get to it. " +
  "An announcement like 'I will talk about X' is not a start unless X is then actually discussed. " +
  "A single shared keyword is not enough. If the speech matches a covered or upcoming point instead, answer no.";

/** One noul question per open point; the state carries the transcript and the context lists. */
export function buildClefRequest(req: DecideRequest, model: string): ClefRequest {
  const state = {
    section: req.sectionTitle,
    transcript_most_recent_last: req.transcript,
    covered_points_context_only: req.covered ?? [],
    upcoming_points_next_section_context_only: req.upcoming ?? [],
    ...(req.onScreen?.length ? { on_screen_facts_untrusted_context_only: req.onScreen } : {}),
  };
  const questions: Record<string, ClefQuestion> = {};
  for (const b of req.bullets) {
    questions[b.id] = {
      type: "noul",
      instructions: `Has the speaker STARTED talking about this idea: "${b.text}"? ${RUBRIC}`,
      criteria: {
        true: "The transcript shows the speaker making this point, in substance.",
        false: "The point has not been started, is only announced, or only shares vocabulary.",
      },
    };
  }
  // Gap detector: one extra question per on-screen fact. Prefixed so ids cannot collide with point ids.
  for (const [i, fact] of (req.onScreen ?? []).entries()) {
    questions[`fact_${i}`] = {
      type: "noul",
      instructions: `Has the speaker already mentioned this fact from the slide: "${fact}"?`,
    };
  }
  return { model, state, questions };
}

export function parseClefAnswers(
  json: ClefResponse,
  req: DecideRequest,
  threshold = 0.7,
): { decisions: Decision[]; unmentioned: string[] } {
  const answers = json.answers ?? {};
  const decisions = req.bullets.map((b) => {
    const p = answers[b.id]?.noul;
    const confidence = typeof p === "number" && Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 0;
    return { id: b.id, started: confidence >= threshold, confidence };
  });
  const unmentioned = (req.onScreen ?? []).filter((_, i) => {
    const p = answers[`fact_${i}`]?.noul;
    return typeof p === "number" && p < 0.5;
  });
  return { decisions, unmentioned };
}
