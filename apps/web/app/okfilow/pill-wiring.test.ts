// How the panel and the overlay use the pill's rules (docs/okfilow/PILL.md). The rules themselves are
// tested where they live (lib/buddy/pill.test.ts, voice-pause.test.ts, components/okfilow); this file
// holds the pages to them, so a privacy rule cannot be dropped from a page without a test going red.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (rel: string) => fs.readFileSync(path.join(here, rel), "utf8").replace(/\r\n/g, "\n");
const panel = read("panel/page.tsx");
const overlay = read("overlay/page.tsx");

describe("the panel and the eye", () => {
  it("the eye's button and shortcut flip the one setting, as the user's own choice", () => {
    expect(panel).toContain("const got = await b.configure({ seeScreen: eyeToggle(s.seeScreen, askRoute(s), localScreenRef.current) });");
    // the only two writers of the setting in the panel: the eye and the switch, both with on or off
    expect(panel.match(/configure\(\{ seeScreen:/g)).toHaveLength(2);
    expect(panel).toContain('onChange={(next) => void configure({ seeScreen: next ? "on" : "off" })}');
  });

  it("no words open or close it: the question never reaches the setting", () => {
    // Nothing in the page reads the question to decide about the eye, pausing or stopping.
    for (const page of [panel, overlay]) {
      expect(page).not.toMatch(/(question|typed|heard|text)\)?\.?(match|test|includes|search)\([^)]*(eye|occhio|pause|pausa|resume|riprendi|stop looking)/i);
      expect(page).not.toMatch(/\/[^/\n]*(close your eye|chiudi l.occhio|stop looking)[^/\n]*\/[a-z]*\.test\(/i);
    }
  });

  it("a screenshot taken before the eye was closed is dropped at the moment of sending: no picture, and the request says so", () => {
    expect(panel).toContain("const withScreen = stillSees(seeing, statusRef.current?.seeScreen);");
    expect(panel).toContain("images: withScreen ? images : [],");
    expect(panel).toContain("sees: withScreen ? askSees(statusRef.current?.seeScreen) : false,");
    // decided after the headers were fetched: nothing is awaited between the decision and the request
    expect(panel).toMatch(/const withScreen = stillSees\(seeing, statusRef\.current\?\.seeScreen\);\n\s*if \(seeing && !withScreen\) setAsksSee\(false\);\n(\s*(markTime|if \(tm\.marks\.fetchStart)[^\n]*\n)*\s*const res = await fetch\("\/api\/buddy\/ask", \{/);
  });

  it("the second request that finds the point is skipped once the eye is closed", () => {
    expect(panel).toMatch(/&& !seesText && stillSees\(seeing, statusRef\.current\?\.seeScreen\)\n\s*\? groundAnswer\(/);
    // and groundAnswer is called from nowhere else
    expect(panel.match(/groundAnswer\(/g)).toHaveLength(1);
  });

  it("a capture is asked for with the eye as it is when the question, or its continuation, starts", () => {
    expect(panel).toContain("const shot = await b.capture({ images: seeing });");
    expect(panel.match(/b\.capture\(/g)).toHaveLength(1);
    expect(panel).toContain("const seeing = seesScreen(statusRef.current?.seeScreen, askRoute(statusRef.current), localScreenRef.current);");
  });
});

describe("the panel, Pause and Resume", () => {
  it("while paused the text is kept and not shown, and what follows it waits for Resume", () => {
    expect(panel).toContain("if (!turn.current.progress(id, shown)) continue;");
    expect(panel).toMatch(/if \(raw === null\) return sendTimings\(tm, "superseded", b\);\n\s*\/\/[^\n]*\n\s*if \(!\(await turn\.current\.unpaused\(id\)\)\) return sendTimings\(tm, "superseded", b\);/);
  });

  it("one speech queue: the answer's voice waits for Resume before each chunk and tells the pill each chunk's place", () => {
    expect(panel).toContain("unpaused: () => turn.current.unpaused(id),");
    expect(panel).toContain("await speak(sentence, id, answerLang, base);");
    expect(panel).toContain("voice.update(shown, false, moreFollows(partial, arrived));");
    // a continuation's voice starts after what the user heard, not at the top
    expect(panel).toContain("said: resume?.said,");
    // the voice is created once per answer, and the old whole-answer call is gone
    expect(panel.match(/createProgressiveSpeech\(/g)).toHaveLength(1);
    expect(panel).not.toContain("await speak(text, id, answerLang);");
  });

  it("an error that comes during a pause is held until Resume", () => {
    expect(panel).toMatch(/if \(abort\.signal\.aborted \|\| run\.current !== id\) return sendTimings\(tm, "superseded", b\);\n\s*\/\/[^\n]*\n\s*if \(!\(await turn\.current\.unpaused\(id\)\)\) return sendTimings\(tm, "superseded", b\);\n\s*turn\.current\.end\(id\);\n\s*sendTimings\(tm, "error", b\);\n\s*fail\(/);
  });

  it("Pause holds the text, the voice and the pen; Resume lets all three go", () => {
    expect(panel).toMatch(/turn\.current\.pause\(\);\n\s*speaker\.pause\(\);\n\s*drawClock\.current\.pause\(performance\.now\(\)\);/);
    expect(panel).toMatch(/drawClock\.current\.resume\(performance\.now\(\)\);\n\s*const text = turn\.current\.resume\(\);\n\s*if \(text\) \{ setAnswer\(text\); b\.text\(text\); \}\n\s*speaker\.resume\(\);/);
  });

  it("a continuation carries the flag and the conversation, and is joined to the part shown without repeats", () => {
    expect(panel).toContain("...(resume ? { resume: true } : {}) }),");
    expect(panel).toContain("history: history.current,");
    expect(panel).toContain("const shown = resume ? joinContinuation(resume.shown, arrived, { partial: true }) : arrived;");
    expect(panel).toContain("const text = resume ? joinContinuation(resume.shown, parsed.text) : parsed.text;");
    expect(panel).toContain("turn.current.begin(id, question, abort, { resumable: wantsDrawing(question) === null, continues: resume?.shown });");
  });

  it("Resume after Stop shows every mark of the answer again: the marks went with the stopped answer's bubble", () => {
    expect(panel).toContain("if (info.marks.length) b.draw(info.marks, info.from);");
    expect(panel).not.toContain("if (info.from < info.marks.length) b.draw(");
  });

  it("a new question, spoken or typed, and a cleared conversation withdraw the offer to resume", () => {
    expect(panel.match(/turn\.current\.discard\(\);/g)!.length).toBeGreaterThanOrEqual(4);
    expect(panel).toMatch(/endAnswer\(\);\n\s*\/\/ A new question: the stopped answer can no longer be carried on\.\n\s*turn\.current\.discard\(\);\n\s*setResumable\(false\);/);
    expect(panel).toContain("history.current = []; saveHistory([]); turn.current.discard(); setResumable(false);");
  });

  it("the pill is told the eye as it is now, paused and resumable, whenever one changes", () => {
    expect(panel).toMatch(/useEffect\(\(\) => \{\n\s*bridge\?\.pill\?\.\(\{ sees: seesNow, paused, resumable \}\);\n\s*\}, \[bridge, seesNow, paused, resumable\]\);/);
    expect(panel).toContain("const seesNow = seesScreen(status?.seeScreen, askRoute(status), localScreen);");
  });

  it("the controls from the pill and the shortcuts reach the same functions as the panel's own buttons", () => {
    expect(panel).toContain('b.onControl?.((p) => { if (p && (p.action === "eye" || p.action === "pause" || p.action === "resume")) control(p.action); })');
    expect(panel).toMatch(/if \(action === "eye"\) void toggleEye\(\);\n\s*else if \(action === "pause"\) pauseAnswer\(\);\n\s*else if \(action === "resume"\) resumeAnswer\(\);\n\s*else stopAnswer\(\);/);
  });
});

describe("the overlay's pill", () => {
  it("is outside the part hidden from screen readers, and its controls are the shared ones", () => {
    const hidden = overlay.indexOf('aria-hidden onPointerDown');
    const hiddenEnd = overlay.indexOf("\n    </div>\n", hidden);
    const pillAt = overlay.indexOf('data-testid="okf-pill"');
    expect(hidden).toBeGreaterThan(0);
    expect(hiddenEnd).toBeGreaterThan(hidden);
    expect(pillAt).toBeGreaterThan(hiddenEnd);
    expect(overlay.indexOf("okf-notch--out")).toBeGreaterThan(hiddenEnd);
    expect(overlay).toContain('<EyeButton open={pill.sees} t={t} keyLabel={keys.eye} onToggle={() => act("eye")} />');
    expect(overlay).toContain("<AnswerControls pill view={view} t={t} pauseKey={keys.pause} onAction={act} />");
  });

  it("the eye shows the setting as it is now, not what the last question took", () => {
    expect(overlay).toContain("open={pill.sees}");
    expect(overlay).not.toMatch(/EyeButton open=\{sees\}/);
  });

  it("a click on a control goes to main: Stop ends the answer, the others are passed to the panel", () => {
    expect(overlay).toMatch(/if \(action === "stop"\) b\?\.stopAnswer\?\.\("button"\);\n\s*else b\?\.control\?\.\(action\);/);
  });

  it("takes the mouse while the pointer is on any control, and tells main again whenever the pill changes", () => {
    expect(overlay).toContain('overControls(p, Array.from(pillSpot.current?.querySelectorAll("button") ?? [], (el) => el.getBoundingClientRect()))');
    // (the answer bubble takes the mouse the same way: components/okfilow/bubble.test.tsx)
    expect(overlay).toContain("const over = overB || onControl(p);");
    expect(overlay).toMatch(/tellHover\(cursor\.current, true\);\n\s*\}, \[mode, going, here, sees, lang, stopped, pill, keys, text, closed, tellHover\]\);/);
  });

  it("a pause freezes the flight and the pen on one clock", () => {
    expect(overlay).toContain("const now = clock.current.at(real);");
    expect(overlay).toMatch(/if \(pill\.paused\) clock\.current\.pause\(performance\.now\(\)\);\n\s*else clock\.current\.resume\(performance\.now\(\)\);/);
    expect(overlay).toContain('(pill.paused ? " okf-paused" : "")');
    expect(overlay).toContain("marksAt.current = clock.current.at(performance.now());");
    const css = read("okfilow.css");
    expect(css).toMatch(/\.okf-paused \.okf-mark path[^{]*\{ animation-play-state: paused; \}/);
    expect(css).toMatch(/\.okf-slot \{ display: inline-grid;/);
    expect(css).toMatch(/\.okf-slot-off \{ visibility: hidden; \}/);
  });

  it("the pill's buttons keep their dark look under the pointer in the light theme, and the panel's row does not grow when its status wraps", () => {
    const css = read("okfilow.css");
    // seen in the real app: the app's own button hover rule (light theme) hid the white words on the dark pill
    expect(css).toContain(":root .okf-notch .okf-ctl:hover { background: rgba(255, 255, 255, 0.2);");
    expect(css).toContain(":root .okf-notch .okf-stop:hover { background: rgba(255, 107, 91, 0.28);");
    expect(css).toContain(".okf-status-row { min-height: 44px; }");
  });
});
