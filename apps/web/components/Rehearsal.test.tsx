import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildRehearsalReport, Engine, parseScript, t, TakeRecorder, type Lang, type SessionState, type TalkClock } from "@filow/core";
import { LangProvider } from "@filow/ui";
import { TimerCue } from "./TimerCue";
import { TimerSettings, readMinutes } from "./TimerSettings";
import { RehearsalReport } from "./RehearsalReport";
import { TimerMirror } from "./TimerMirror";
import { clockKey, takeRecorder, withClock } from "./TimerClock";

const MIN = 60_000;
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const inLang = (lang: Lang, node: React.ReactNode) => renderToStaticMarkup(<LangProvider lang={lang}>{node}</LangProvider>);
const script = parseScript("<!-- target: 6 min -->\n# Intro (2 min)\n- a\n- b\n# Body (2 min)\n- c\n# End (2 min)\n- d");

describe("talk timer line", () => {
  it("shows the time, the target, a calm cue, the section's time and the points left", () => {
    const clock: TalkClock = { startedAt: 0, endedAt: null, entries: [{ idx: 0, at: 0 }, { idx: 1, at: 3 * MIN }], sentAt: 0 };
    const text = plain(inLang("en", <TimerCue script={script} clock={clock} sectionIdx={1} points={{}} now={() => 3.5 * MIN} />));
    expect(text).toContain("3:30");
    expect(text).toContain("of 6:00");
    expect(text).toContain("1 min behind");
    expect(text).toContain("This section: 1:30 left");
    expect(text).toContain("Points left here: 1");
    const html = inLang("en", <TimerCue script={script} clock={clock} sectionIdx={1} points={{}} now={() => 3.5 * MIN} />);
    expect(html).toContain('role="timer"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('class="timer-badge behind"');
  });

  it("before a take shows only the target, and nothing at all without one but the button", () => {
    expect(plain(inLang("it", <TimerCue script={script} clock={null} sectionIdx={0} points={{}} />))).toContain("0:00 su 6:00");
    const bare = parseScript("# A\n- x");
    expect(inLang("en", <TimerCue script={bare} clock={null} sectionIdx={0} points={{}} />)).toBe("");
    expect(plain(inLang("en", <TimerCue script={bare} clock={null} sectionIdx={0} points={{}} action={<button>Talk length</button>} />)).trim()).toBe("Talk length");
  });

  it("on the phone uses the prompter's clock", () => {
    const clock: TalkClock = { startedAt: 0, endedAt: 65_000, entries: [{ idx: 0, at: 0 }], sentAt: 70_000 };
    const state = { ...new Engine({ decide: async () => ({}) as never }).getState(), script, clock } as SessionState;
    const html = renderToStaticMarkup(<LangProvider lang="en"><TimerMirror state={state} /></LangProvider>);
    expect(plain(html)).toContain("1:05 of 6:00");
    expect(html).toContain("timer-cue phone");
  });
});

describe("talk length dialog", () => {
  it("reads minutes plainly", () => {
    expect([readMinutes(""), readMinutes(" 5 "), readMinutes("2,5"), readMinutes("0"), readMinutes("abc"), readMinutes("601")]).toEqual([null, 5, 2.5, "invalid", "invalid", "invalid"]);
  });

  it("offers a box for the talk and one per section, filled from the script", () => {
    const html = inLang("en", <TimerSettings script={script} text="" onSave={() => {}} onCancel={() => {}} />);
    expect(html.match(/<input/g)).toHaveLength(4);
    expect(html).toContain(`aria-label="${t("timer.talkMinutes", "en")}"`);
    expect(html).toContain('aria-label="Minutes for &quot;Body&quot;"');
    expect(html).toContain('value="6"');
    expect(plain(html)).toContain("Whole talk");
    expect(plain(html)).toContain("Planned so far: 6 min");
    const partial = parseScript("<!-- target: 10 min -->\n# A (2 min)\n- a\n# B\n- b\n# C\n- c");
    expect(plain(inLang("en", <TimerSettings script={partial} text="" onSave={() => {}} onCancel={() => {}} />))).toContain("The 2 sections without a target share the other 8 min.");
    const over = parseScript("<!-- target: 3 min -->\n# A (2 min)\n- a\n# B (2 min)\n- b");
    expect(plain(inLang("it", <TimerSettings script={over} text="" onSave={() => {}} onCancel={() => {}} />))).toContain("Le sezioni sommano 4 min, più dei 3 min di tutto il discorso.");
  });
});

describe("rehearsal report view", () => {
  const rec = new TakeRecorder(() => now);
  let now = 0;
  const st = (recording: boolean, sectionIdx: number, points: SessionState["points"] = {}) => ({ sectionIdx, points, engine: { recording, backend: null } });
  rec.observe(st(true, 0));
  now = 40_000;
  rec.transcript({ committed: "Um, we start with the intro and then we go on." });
  rec.observe(st(true, 0, { s0b0: { status: "started", confidence: 1 } }));
  now = 7 * MIN;
  rec.observe(st(false, 0, { s0b0: { status: "started", confidence: 1 } }));
  const report = buildRehearsalReport(rec.result()!, script, { lang: "en" });

  it("shows the advice first, then the numbers, the sections and the points not reached, with the three actions", () => {
    const text = plain(inLang("en", <RehearsalReport report={report} onClose={() => {}} />));
    expect(text.indexOf("Try next")).toBeLessThan(text.indexOf("At a glance"));
    expect(text).toContain("The talk ran 1 min over its 6 min.");
    expect(text).toContain("7:00 of 6:00");
    expect(text).toContain("Intro 7:00 (+5:00) 2:00 1 covered, 1 not reached");
    expect(text).toContain("Body not shown 2:00 1 not reached");
    expect(text).toContain("Points you did not get to (the take ended first) (3) b c d");
    for (const k of ["report.saveMd", "report.print", "report.close"] as const) expect(text).toContain(t(k, "en"));
  });

  it("speaks Italian when the interface does", () => {
    const text = plain(inLang("it", <RehearsalReport report={report} onClose={() => {}} />));
    expect(text).toContain("Resoconto della prova");
    expect(text).toContain("Tempo per sezione");
  });
});

describe("talk clock sent to the phone", () => {
  it("rides on the published state and changes key when a take starts, moves on and stops", () => {
    const engine = new Engine({ decide: async () => ({}) as never, setInterval: () => 0, clearInterval: () => {} });
    engine.loadScript(script);
    const keys = [clockKey(withClock(engine, engine.getState()).clock!)];
    engine.start();
    keys.push(clockKey(takeRecorder(engine).talkClock()));
    engine.dispatch({ type: "nextSection" });
    keys.push(clockKey(takeRecorder(engine).talkClock()));
    engine.stop();
    const last = withClock(engine, engine.getState()).clock!;
    keys.push(clockKey(last));
    expect(new Set(keys).size).toBe(4);
    expect(last.entries.map((e) => e.idx)).toEqual([0, 1]);
    expect(takeRecorder(engine)).toBe(takeRecorder(engine));
  });
});
