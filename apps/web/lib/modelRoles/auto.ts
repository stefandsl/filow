// What each task would pick on this PC with nothing pinned: the "Automatic (Filow picks: ...)" of
// Settings. Asked from the pickers the features call, never guessed here.
import type { ResolvedSetup } from "@filow/core";
import { CLEF_LOCAL_MODEL } from "@/lib/decide/clef";
import { GENERATE_LOCAL_MODEL } from "@/lib/generate/providers";
import { localHelper } from "@/lib/buddy/providers";
import { pickTranslateModel } from "@/lib/translateLocal";
import { sameModel, type OllamaTaskId } from "./tasks";

/**
 * OK Filow's helper for the setup (lib/buddy/providers.ts localHelper; the whiteboard asks it with
 * "diagram"), the translation list, and the take's script and decision models when installed here.
 */
export function automatic(setup: Pick<ResolvedSetup, "active" | "choices">, names: string[], configured = process.env.BUDDY_LOCAL_MODEL): Record<OllamaTaskId, string | null> {
  const helper = (q: string) => {
    try {
      return localHelper(setup, names, q, configured);
    } catch {
      return null;
    }
  };
  const answer = helper("what is this?");
  const installed = (model: string) => (names.some((n) => sameModel(n, model)) ? model : null);
  return {
    okfilowAnswers: answer?.model ?? null,
    okfilowPointing: answer?.pictures ? answer.pointer ?? null : null,
    whiteboard: helper("diagram")?.model ?? null,
    translate: pickTranslateModel(names),
    generate: installed(GENERATE_LOCAL_MODEL()),
    decision: installed(CLEF_LOCAL_MODEL()),
  };
}
