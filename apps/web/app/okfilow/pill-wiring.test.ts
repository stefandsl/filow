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
    expect(panel).toMatch(/const withScreen = stillSees\(seeing, statusRef\.current\?\.seeScreen\);\n\s*if \(seeing && !withScreen\) setAsksSee\(false\);\n\s*const res = await fetch\("\/api\/buddy\/ask", \{/);
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
    expect(panel).toMatch(/if \(raw === null\) return;\n\s*\/\/[^\n]*\n\s*if \(!\(await turn\.current\.unpaused\(id\)\)\) return;/);
  });

  it("an error that comes during a pause is held until Resume", () => {
    expect(panel).toMatch(/if \(abort\.signal\.aborted \|\| run\.current !== id\) return;\n\s*\/\/[^\n]*\n\s*if \(!\(await turn\.current\.unpaused\(id\)\)\) return;\n\s*turn\.current\.end\(id\);\n\s*fail\(/);
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
    expect(overlay).toMatch(/const over = onControl\(cursor\.current\);\n\s*overStop\.current = over;\n\s*okFilowBridge\(\)\?\.overlayHover\?\.\(over\);\n\s*\}, \[mode, going, here, sees, lang, stopped, pill, keys, onControl\]\);/);
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
});
