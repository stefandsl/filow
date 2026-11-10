import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildRehearsalReport, Engine, parseScript, t, TakeRecorder, type Lang, type SessionState, type TalkClock } from "@filow/core";
import { LangProvider } from "@filow/ui";
import { TimerCue } from "./TimerCue";
import { TimerSettings, readMinutes } from "./TimerSettings";
import { RehearsalReport } from "./RehearsalReport";
import { TimerMirror } from "./TimerMirror";
import { sameScript } from "./RehearsalPanel";
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

describe("talk length on a script from elsewhere", () => {
  it("knows when the prompter's text is not the script on screen", () => {
    expect(sameScript(parseScript("# A\n- x"), parseScript("# A (2 min)\n- x"))).toBe(true);
    expect(sameScript(parseScript("# A\n- x"), parseScript("# A\n- y"))).toBe(false);
  });

  it("offers no box for points that come before the first heading", () => {
    const text = "- loose point\n# A\n- x";
    const html = inLang("en", <TimerSettings script={parseScript(text)} text={text} onSave={() => {}} onCancel={() => {}} />);
    expect(html.match(/<input/g)).toHaveLength(2);
    expect(plain(html)).not.toContain("Untitled");
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
    expect(text).toContain("Points you did not get to (the take ended first) (3) Show b c d");
    const html = inLang("en", <RehearsalReport report={report} onClose={() => {}} />);
    // folded behind a plain button (reachable by Tab inside the dialog), list hidden until opened
    expect(html).toMatch(/<button type="button" class="btn" aria-expanded="false" aria-controls="report-list-notReached-items">Show<\/button>/);
    expect(html).toContain('<ul class="report-points" id="report-list-notReached-items" hidden="">');
    expect(html).not.toContain("nothing was sent");
    for (const k of ["report.saveMd", "report.print", "report.close"] as const) expect(text).toContain(t(k, "en"));
  });

  it("says the pace is approximate when the engine sent only whole phrases", () => {
    // `report` above has one phrase and no pace; this take has twelve, sent whole every 10 s
    expect(plain(inLang("en", <RehearsalReport report={report} onClose={() => {}} />))).not.toContain("approximate");
    let at = 0;
    const whole = new TakeRecorder(() => at);
    whole.observe(st(true, 0));
    for (at = 10_000; at <= 120_000; at += 10_000) whole.transcript({ committed: "one two three four five six seven eight nine ten" });
    whole.observe(st(false, 0));
    const text = plain(inLang("en", <RehearsalReport report={buildRehearsalReport(whole.result()!, script, { lang: "en" })} onClose={() => {}} />));
    expect(text).toContain("60 words a minute slow, usual 120-170 approximate: this speech model sends only whole phrases");
  });

  it("speaks Italian when the interface does", () => {
    const text = plain(inLang("it", <RehearsalReport report={report} onClose={() => {}} />));
    expect(text).toContain("Resoconto della prova");
    expect(text).toContain("Tempo per sezione");
  });
});

describe("report and talk length on a phone (360 px)", () => {
  const css = readFileSync(path.join(__dirname, "Rehearsal.css"), "utf8");
  const globals = readFileSync(path.join(__dirname, "../app/globals.css"), "utf8");
  const rule = (sheet: string, selector: string) => sheet.match(new RegExp(`(^|\\n)\\s*${selector.replace(/[.[\]()>]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[2] ?? "";

  it("sizes both dialogs inside the dialog's padding, not by the viewport", () => {
    // 94vw plus the dialog's 2 x 16 px padding is wider than a 360 px screen
    for (const sel of [".rehearsal-report", ".timer-settings"]) expect(rule(css, sel)).toMatch(/width:\s*min\(\d+px,\s*100%\)/);
    expect(rule(globals, ".accessible-dialog > .modal")).toMatch(/max-width:\s*100%/);
  });

  it("stacks each section's row with labelled cells, and keeps the folded list folded", () => {
    const phone = css.slice(css.search(/@media \(max-width: 480px\) \{\s*\.report-table/));
    expect(phone).toMatch(/\.report-table tr \{[^}]*display: flex; flex-wrap: wrap/);
    expect(phone).toMatch(/\.report-table tbody th \{[^}]*flex: 1 1 100%/);
    expect(phone).toMatch(/td::before \{ content: attr\(data-label\)/);
    expect(rule(css, ".report-points[hidden]")).toMatch(/display:\s*none/);
    const html = inLang("en", <RehearsalReport report={buildRehearsalReport({ clock: { startedAt: 0, endedAt: 1000, entries: [{ idx: 0, at: 0 }], sentAt: 0 }, segments: [], activity: [], stalls: [], pointEvents: [], pointsAtStart: {}, pointsAtEnd: {}, manualAtEnd: [] }, script)} onClose={() => {}} />);
    // block layout drops a table's semantics unless the roles are explicit
    expect(html).toContain('<table class="report-table" role="table">');
    expect(html).toMatch(/<th scope="row" role="rowheader">Intro<\/th><td role="cell" data-label="Time">/);
    expect(html).toContain('data-label="Points"');
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
