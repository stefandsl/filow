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
  "An announcement like 'I will talk about X' does not count unless X is then actually discussed. " +
  "A single shared keyword is not enough. If the speech matches a covered or upcoming point instead, answer no.";

/** Suffixes of the two verification questions of a point; "__" cannot appear in a point id (s0b1). */
const REAL = "__real";
const PARTY = "__party";

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
      // Script points are often short topic labels ("Launch date Monday"), not claims. Asked whether
      // the speaker "started this idea" and "made this point", Clef answered 0.2 to 0.65 on sentences
      // that say the label word for word. This wording was measured on seven corpora and on 109
      // adversarial cases (docs/gauntlet/BASELINE.md, TRK-2): more true points found, fewer false
      // ticks. The "false" criterion names the cases Clef otherwise accepts; it helps a little
      // (cancelled plans, another company), not fully: see the adversarial numbers before trusting it.
      instructions: `Script point: "${b.text}". Has the speaker said this, or begun saying something about it, in the transcript? ${RUBRIC}`,
      criteria: {
        true: "The speaker stated this point as true for them, or is talking about exactly this topic.",
        false:
          "Not said yet, only promised for later, a different point, only a shared word, about someone else (another company or person), " +
          "a plan that was dropped or did not happen, denied, or said ironically.",
      },
    };
  }
  // Verification (TRK-2): two more questions for each point that is one answer away from a tick.
  // Asked as separate questions because Clef judges one narrow thing well and a broad criterion
  // badly: the same exclusions written into the criterion above removed 3 of 14 false ticks on the
  // adversarial set, these two questions 11 or 12 of 13 (docs/gauntlet/BASELINE.md).
  // The party question names both directions: with only "about us, said of a competitor" as its
  // example, Clef read a point that is itself about others ("Everyone is copying it") said of "all the
  // other companies" as a different party (0.40 to 0.52 in a live take, under the 0.5 line).
  const asked = new Map(req.bullets.map((b) => [b.id, b]));
  for (const id of req.verify ?? []) {
    const b = asked.get(id);
    if (!b) continue;
    questions[`${id}${REAL}`] = {
      type: "noul",
      instructions:
        `The script point is "${b.text}". Does the speaker present it as real: something that is true, is happening, or is planned? ` +
        "Answer no when the speaker says it was cancelled, dropped, never happened or will not happen, denies it, only imagines it, or is clearly being ironic.",
      criteria: {
        true: "The speaker presents it as true, happening or planned.",
        false: "The speaker says it is cancelled, not happening, denied, hypothetical or ironic.",
      },
    };
    questions[`${id}${PARTY}`] = {
      type: "noul",
      instructions:
        `Script point: "${b.text}". Compare who it is about. Is the transcript talking about the same party as the script point? ` +
        'Answer no only when the transcript says it of a different party than the point means: for example the point is about us and the transcript says that a supplier, a competitor or "they" did it, ' +
        "or the point is about others (everyone, competitors, customers, the market) and the transcript says it of us. " +
        "When the point itself is about others, the transcript naming those others is the same party.",
      criteria: {
        true: "The same party as in the script point, or no party is named.",
        false: "The transcript says it of a different party than the script point means.",
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
  const prob = (key: string): number | null => {
    const p = answers[key]?.noul;
    return typeof p === "number" && Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : null;
  };
  const toVerify = new Set(req.verify ?? []);
  const decisions = req.bullets.map((b): Decision => {
    const confidence = prob(b.id) ?? 0;
    const d: Decision = { id: b.id, started: confidence >= threshold, confidence };
    if (toVerify.has(b.id)) {
      const real = prob(`${b.id}${REAL}`);
      const sameParty = prob(`${b.id}${PARTY}`);
      // A missing answer is not a pass: without both numbers the point stays unverified.
      if (real !== null && sameParty !== null) d.verification = { real, sameParty };
    }
    return d;
  });
  const unmentioned = (req.onScreen ?? []).filter((_, i) => {
    const p = answers[`fact_${i}`]?.noul;
    return typeof p === "number" && p < 0.5;
  });
  return { decisions, unmentioned };
}
