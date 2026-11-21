import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DEFAULT_DISPLAY, Engine, parseScript, type SessionState } from "@filow/core";
import { takeRecorder } from "../TimerClock";
import { LangProvider, StageView } from "@filow/ui";
import { PointsList } from "./PointsList";
import { keyBelongsToControl } from "./useReanchor";
import { DisplayPanel, displayAttributes } from "./DisplayPanel";
import { ReanchorNotice } from "./ReanchorNotice";

const el = (matches: boolean, editable = false) => ({ closest: () => (matches ? {} : null), isContentEditable: editable }) as unknown as EventTarget;
const doc = (dialogOpen: boolean) => ({ querySelector: () => (dialogOpen ? {} : null) }) as unknown as Document;

it("publishes the recovered section in the first load observed by the real rehearsal clock", () => {
  const engine = () => new Engine({ decide: async () => ({ decisions: [], latencyMs: 0, cost: 0, model: "test" }) });
  const script = parseScript("# One\n- Pilot\n- Owner\n# Two\n- Review");
  const old = engine();
  old.loadScript(script);
  old.dispatch({ type: "reopen", id: "s0b1" });
  old.dispatch({ type: "anchor", idx: 1 });
  old.dispatch({ type: "markStarted", id: "s1b0" });
  const fresh = engine();
  takeRecorder(fresh);
  const seen: SessionState[] = [];
  fresh.subscribe(s => seen.push(s));
  fresh.loadScript({ script, place: old.committedPlace() });
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ sectionIdx: 1, engine: { recording: false }, points: {
    s0b1: { reopened: true }, s1b0: { evidence: { source: "manual" } },
  } });
});

describe("clicker keys and controls", () => {
  it("leaves the keys to text fields, lists, menus, sliders and open dialogs", () => {
    expect(keyBelongsToControl(el(true), doc(false))).toBe(true);
    expect(keyBelongsToControl(el(false, true), doc(false))).toBe(true);
    expect(keyBelongsToControl(el(false), doc(true))).toBe(true);
    expect(keyBelongsToControl(el(false), doc(false))).toBe(false);
    expect(keyBelongsToControl(null, doc(false))).toBe(false);
  });
});

describe("the point the presenter is on", () => {
  const points = [{ id: "a", text: "First", state: "done" as const, confidence: 1 }, { id: "b", text: "Second", state: "waiting" as const, confidence: 0 }];
  it("marks the current point and says how to move there by click or H", () => {
    const html = renderToStaticMarkup(<PointsList points={points} onToggle={() => {}} onHere={() => {}} current="b" />);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toMatch(/class="point point-row waiting here"[^>]*data-point-id="b"/);
    expect(html).toContain('aria-keyshortcuts="H"');
    expect(html).toContain("Click: you are on this point.");
  });
  it("keeps the old row without onHere", () => {
    const html = renderToStaticMarkup(<PointsList points={points} onToggle={() => {}} current="b" />);
    expect(html).not.toContain("aria-keyshortcuts");
    expect(html).toContain("Double-click to toggle");
  });
  it("on the mirror: tap a point, tap the next section", () => {
    const script = parseScript("# One\n- alpha\n- bravo\n\n# Two\n- charlie\n");
    const state: SessionState = {
      id: "x", version: 1, script, sectionIdx: 0, points: { s0b0: { status: "started", confidence: 1 } }, here: "s0b0", transcriptTail: "",
      stats: { calls: 0, totalMs: 0, avgMs: 0, costUsd: 0, model: "" }, engine: { backend: null, recording: true },
    };
    const html = renderToStaticMarkup(<StageView state={state} onCommand={() => {}} stage />);
    expect(html).toMatch(/data-point-id="s0b1"[^>]*class="point[^"]*here/);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain('class="label next-jump"');
    const readOnly = renderToStaticMarkup(<StageView state={state} stage />);
    expect(readOnly).not.toContain("next-jump");
  });
});

describe("Display panel", () => {
  it("shows every choice in plain words, in both languages, with the current one checked", () => {
    for (const [lang, words] of [["en", ["Text size", "Very large", "Line length", "Near the top, under the camera", "Mirror the text", "High contrast", "Back to normal"]], ["it", ["Dimensione del testo", "Molto grande", "Testo a specchio", "Contrasto alto", "Torna normale"]]] as const) {
      const html = renderToStaticMarkup(<LangProvider lang={lang}><DisplayPanel prefs={{ ...DEFAULT_DISPLAY, size: "xl", mirror: true }} onChange={() => {}} onClose={() => {}} /></LangProvider>);
      for (const w of words) expect(html).toContain(w);
      expect(html).toContain('checked="" value="xl"');
      expect(html).toMatch(/<legend>[^<]+<\/legend>/);
    }
  });
  it("offers the points window only where the desktop app provides it", () => {
    const without = renderToStaticMarkup(<DisplayPanel prefs={DEFAULT_DISPLAY} onChange={() => {}} onClose={() => {}} />);
    expect(without).not.toContain("Points window on top");
    const withIt = renderToStaticMarkup(<DisplayPanel prefs={DEFAULT_DISPLAY} onChange={() => {}} onClose={() => {}} pointsWindow={{ available: true, open: true, set: () => {} }} />);
    expect(withIt).toContain("Points window on top");
  });
  it("turns the choice into attributes the CSS reads", () => {
    const a = displayAttributes({ ...DEFAULT_DISPLAY, mirror: true, contrast: true, size: "l" });
    expect(a["data-display-mirror"]).toBe("on");
    expect(a["data-display-contrast"]).toBe("high");
    expect(a["data-display-size"]).toBe("l");
    expect(displayAttributes(DEFAULT_DISPLAY)["data-display-mirror"]).toBeUndefined();
  });
});

describe("a move made by voice", () => {
  it("says where Filow moved and offers the way back, in a live region that is always there", () => {
    const empty = renderToStaticMarkup(<ReanchorNotice notice={null} onUndo={() => {}} onDismiss={() => {}} />);
    expect(empty).toBe('<div class="reanchor-region" role="status" aria-live="polite"></div>');
    const html = renderToStaticMarkup(<ReanchorNotice notice={{ title: "Pricing", to: 1, from: 0 }} onUndo={() => {}} onDismiss={() => {}} />);
    expect(html).toContain("Moved to &quot;Pricing&quot;: you said its name.");
    expect(html).toContain("Go back");
  });
});
