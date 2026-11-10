// One take recorder per engine (rehearsal.ts): it follows every state the engine publishes, so the
// talk timer, the rehearsal report and the phone mirror all read the same clock.
import { TakeRecorder, type Engine, type SessionState, type TalkClock } from "@filow/core";

const recorders = new WeakMap<Engine, TakeRecorder>();

/** During a take the prompter sends its clock again this often, for phones that join late. */
export const CLOCK_REFRESH_MS = 5000;

export function takeRecorder(engine: Engine): TakeRecorder {
  let rec = recorders.get(engine);
  if (!rec) {
    const r = new TakeRecorder();
    // Every script load (Reload, Edit, a script from the browser or a phone) goes through this method:
    // the recorder learns of it first, so a take that changes script starts its clock and log again.
    const load = engine.loadScript.bind(engine);
    engine.loadScript = (script) => {
      r.scriptLoading();
      load(script);
    };
    r.observe(engine.getState());
    engine.subscribe((state) => r.observe(state));
    recorders.set(engine, r);
    rec = r;
  }
  return rec;
}

/** What changes the clock: a take starting or stopping, another section showing. */
export function clockKey(clock: TalkClock): string {
  return `${clock.startedAt}|${clock.endedAt}|${clock.entries.length}`;
}

/** The state as the prompter publishes it: the engine's state plus the talk clock. */
export function withClock(engine: Engine, state: SessionState): SessionState {
  const rec = takeRecorder(engine);
  rec.observe(state);
  return { ...state, clock: rec.talkClock() };
}
