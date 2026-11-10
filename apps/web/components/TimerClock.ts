// One take recorder per engine (rehearsal.ts): it follows every state the engine publishes, so the
// talk timer, the rehearsal report and the phone mirror all read the same clock.
import { TakeRecorder, type Engine, type SessionState, type TalkClock } from "@filow/core";

const recorders = new WeakMap<Engine, TakeRecorder>();

export function takeRecorder(engine: Engine): TakeRecorder {
  let rec = recorders.get(engine);
  if (!rec) {
    const r = new TakeRecorder();
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
