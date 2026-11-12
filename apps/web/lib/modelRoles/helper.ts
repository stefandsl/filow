// OK Filow and the whiteboard on "Answers from: Local": the user's per-task choice applied on top of
// what the setup for this computer picked (lib/buddy/providers.ts localHelper). Kept out of
// providers.ts so that file only asks for it.
import type { LocalHelper } from "@/lib/buddy/providers";
import { readRoles, type RolesFile } from "./store";
import { placeOnly, taskTarget, type Place } from "./resolve";

export type PinOptions = {
  /** "okfilowAnswers": a question to OK Filow; "whiteboard": a whiteboard lesson. */
  task: "okfilowAnswers" | "whiteboard";
  /** A narrow "where is it" question that the setup sends to its pointing model. */
  pointOnly: boolean;
  /** The setup's own pointing model, if it has one. */
  setupPointer?: string | null;
  /** "Look at my screen" as the user set it; absent, the setup decides. */
  sees?: boolean;
  roles?: RolesFile;
};

const at = (place: Place): Pick<LocalHelper, "at"> => ({ at: placeOnly(place) });

/**
 * The helper with the user's pins: the answering model, and the model that places the points. A pin
 * that cannot be used now (deleted, server down, unable to see, no yes for the server) leaves the
 * automatic choice in place. A pin also keeps a feature alive where the setup had no model at all.
 * `auto` is the setup's helper, or the error that says why there is none.
 */
export async function pinHelper(auto: LocalHelper | Error, o: PinOptions): Promise<LocalHelper> {
  const roles = o.roles ?? readRoles();
  const base: LocalHelper | null = auto instanceof Error ? null : auto;
  if (o.task === "whiteboard") {
    if (!roles.pins.whiteboard) return orThrow(base, auto);
    const t = await taskTarget("whiteboard", base?.model ?? null, roles);
    if (!t.pinned || !t.model) return orThrow(base, auto);
    // a lesson without the screenshot: the pin changes the model, not how the lesson is drawn
    return { ...(base ?? { pictures: true }), model: t.model, pointer: undefined, ...at(t) };
  }
  const pointing = roles.pins.okfilowPointing ? await taskTarget("okfilowPointing", o.setupPointer ?? null, roles) : null;
  const pointPinned = Boolean(pointing?.pinned && pointing.model);
  // the "where is it" question goes to the model the user chose for pointing
  if (o.pointOnly && o.sees !== false && pointPinned) return { model: pointing!.model!, pictures: true, ...at(pointing!) };
  // the setup already sent this "where is it" question to its own pointing model: the answering pin is not for it
  const redirected = o.pointOnly && Boolean(o.setupPointer) && base?.model === o.setupPointer && !base?.pointer;
  let helper = base;
  if (roles.pins.okfilowAnswers && !redirected) {
    const t = await taskTarget("okfilowAnswers", base?.model ?? null, roles);
    if (t.pinned && t.model) helper = { ...(base ?? { pictures: o.sees ?? true }), model: t.model, ...at(t) };
  }
  if (helper && pointPinned && helper.pictures && !redirected) helper = { ...helper, pointer: pointing!.model!, pointerAt: placeOnly(pointing!) };
  return orThrow(helper, auto);
}

function orThrow(helper: LocalHelper | null, auto: LocalHelper | Error): LocalHelper {
  if (helper) return helper;
  throw auto;
}
