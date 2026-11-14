// The visible "mark as said" button (and its undo) on the prompter and on the phone mirror: the owner
// could not mark a point said, because only a double click or Enter on the row did it.
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Engine, LANGS, parseScript, REMOTE, remoteErrorKey, t, type Command, type SessionState } from "@filow/core";
import { LangProvider, MarkSaidButton, StageView } from "@filow/ui";
import { PointsList } from "./PointsList";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const rule = (selector: string) => css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";

/** Every element of a rendered tree (no DOM: the elements as React returns them). */
function elements(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) for (const n of node) elements(n, out);
  else if (isValidElement(node)) {
    out.push(node);
    elements((node.props as { children?: ReactNode }).children, out);
  }
  return out;
}

/** The outer HTML of the first element carrying role="button" (the row), found by counting nested divs. */
function toggleRow(html: string): string {
  const start = html.lastIndexOf("<div", html.indexOf('role="button"'));
  let depth = 0;
  for (const m of html.slice(start).matchAll(/<div\b|<\/div>/g)) {
    depth += m[0] === "<div" ? 1 : -1;
    if (depth === 0) return html.slice(start, start + (m.index ?? 0) + 6);
  }
  return html.slice(start);
}

describe("the mark as said button", () => {
  it("toggles the point and nothing else: no 'I am here', no event reaching the row", () => {
    const onToggle = vi.fn();
    const el = MarkSaidButton({ done: false, label: "Mark as said", describedBy: "point-text-a", onToggle });
    expect(el.type).toBe("button");
    expect(el.props.type).toBe("button"); // never a form submit
    expect(el.props["aria-label"]).toBe("Mark as said");
    expect(el.props["aria-describedby"]).toBe("point-text-a");
    el.props.onClick({ detail: 1 });
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(); // the caller binds the point; the button passes no event on
  });

  it("sits beside the row on every point of the prompter, never inside it, and says what it will do", () => {
    const html = renderToStaticMarkup(<PointsList onToggle={() => {}} onHere={() => {}} points={[{ id: "a", text: "First point", state: "active", confidence: 0.5 }, { id: "b", text: "Second point", state: "done", confidence: 1, evidence: { source: "manual", fromMs: 0, toMs: 0 } }]} />);
    expect(html.match(/<button type="button" class="point-mark/g)).toHaveLength(2);
    const row = toggleRow(html);
    expect(row).toContain("First point");
    expect(row, "axe nested-interactive: no control inside the row").not.toContain("<button");
    expect(html).toContain('class="point-mark" aria-label="Mark as said" title="Mark as said" aria-describedby="point-text-a"');
    expect(html).toContain('class="point-mark done" aria-label="Undo: not said" title="Undo: not said" aria-describedby="point-text-b"');
    expect(html).toContain('<span class="point-text" id="point-text-a">First point</span>');
    // the row keeps its own gestures: one click "I am here", double click and Enter/Space toggle
    expect(row).toContain('role="button"');
    expect(row).toContain('aria-keyshortcuts="H"');
  });

  it("says what it does: an outlined check to mark, the undo arrow on a said point (always, not only on hover)", () => {
    const html = renderToStaticMarkup(<PointsList onToggle={() => {}} points={[{ id: "a", text: "A", state: "waiting", confidence: 0 }, { id: "b", text: "B", state: "done", confidence: 1 }]} />);
    const [mark, undo] = html.split('<button type="button" class="point-mark').slice(1);
    expect(mark).not.toContain("point-mark-undo");
    expect(mark).toContain('<span class="point-mark-label">Mark</span>');
    expect(undo).toContain("point-mark-check");
    expect(undo).toContain("point-mark-undo");
    expect(undo).toContain('<span class="point-mark-label">Undo</span>');
    expect(rule(".point-mark")).toMatch(/background: var\(--surface\)/); // outlined
    expect(rule(".point-mark-undo, .point-mark-label")).toContain("display: none");
    // a said point shows its action, the undo arrow, at every width and on touch screens (a filled check read as a badge)
    expect(rule(".point-mark.done .point-mark-check")).toContain("display: none");
    expect(rule(".point-mark.done .point-mark-undo")).toContain("display: flex");
    // the short word shows only where the row keeps room for it
    expect(css).toMatch(/@media \(min-width: 1100px\) \{\s*\.prompter \.point-item\.has-mark > \.point-row \{ padding-right: 136px; \}[\s\S]*?\.prompter \.point-mark-label \{ display: inline; \}/);
    // WCAG 2.5.3: the visible word is part of the accessible name, in every language
    for (const lang of LANGS) {
      expect(t("point.markSaid", lang), lang).toContain(t("point.markShort", lang));
      expect(t("point.unmarkSaid", lang), lang).toContain(t("point.unmarkShort", lang));
    }
  });

  it("is not offered where the list cannot toggle", () => {
    expect(renderToStaticMarkup(<PointsList points={[{ id: "a", text: "First", state: "waiting", confidence: 0 }]} />)).not.toContain("point-mark");
  });

  it("is labelled in every interface language", () => {
    for (const lang of LANGS) {
      const html = renderToStaticMarkup(<LangProvider lang={lang}><PointsList onToggle={() => {}} points={[{ id: "a", text: "A", state: "waiting", confidence: 0 }, { id: "b", text: "B", state: "done", confidence: 1 }]} /></LangProvider>);
      for (const key of ["point.markSaid", "point.unmarkSaid"] as const) {
        expect(t(key, lang), `${lang} ${key}`).not.toBe("");
        if (lang !== "en") expect(t(key, lang), `${lang} ${key} is translated`).not.toBe(t(key, "en"));
        expect(html).toContain(t(key, lang).replace(/"/g, "&quot;"));
      }
    }
  });

  it("is reachable with the keyboard with a focus ring, icon only beside the state; a phone gets a 48 px target", () => {
    expect(rule(".point-mark:focus-visible")).toMatch(/outline: 2px solid var\(--accent\)/);
    expect(rule(".point-mark")).not.toMatch(/tabindex|display: none|visibility: hidden/);
    // icon only, 24-28 px, inside the row's right padding: it never covers the state block
    const size = Number(rule(".point-mark").match(/width: (\d+)px/)?.[1]);
    expect(size).toBeGreaterThanOrEqual(24);
    expect(size).toBeLessThanOrEqual(28);
    const pad = Number(rule(".prompter .point-item.has-mark > .point-row").match(/padding-right: (\d+)px/)?.[1]);
    expect(pad, "padding fits the button and both gaps").toBeGreaterThanOrEqual(size + 12 + 12);
    expect(css).not.toContain("point-mark-tip");
    const el = MarkSaidButton({ done: true, label: "Undo: not said", onToggle: () => {} });
    expect(el.props.title).toBe("Undo: not said"); // the tooltip carries the words
    // a narrow window scrolls as a whole: nothing sticky covers the points
    const narrow = css.slice(css.search(/@media \(max-width: 600px\) \{\s*\.prompter \{ height: auto/));
    expect(narrow).toContain(".prompter-content { min-height: 0; overflow: visible; }");
    const phone = rule(".app.stage .point-mark");
    for (const side of ["width", "height"]) expect(Number(phone.match(new RegExp(`${side}: (\\d+)px`))?.[1]), side).toBeGreaterThanOrEqual(44);
    // the done look stays: struck through, green tick
    expect(css).toContain(".point-row.done .point-text, .next-section .done { text-decoration: line-through; }");
  });
});

describe("the same button on the phone mirror", () => {
  const state: SessionState = {
    id: "s", version: 1, sectionIdx: 0, transcriptTail: "",
    script: { sections: [{ title: "Intro", bullets: [{ id: "s0b0", text: "We hired three engineers" }, { id: "s0b1", text: "Revenue doubled" }] }] } as SessionState["script"],
    points: { s0b1: { status: "started", confidence: 1, evidence: { source: "manual", fromMs: 0, toMs: 0 } } } as SessionState["points"],
    stats: { calls: 0, totalMs: 0, avgMs: 0, costUsd: 0, model: "" },
    engine: { backend: null, recording: false },
  };
  const buttons = (props: Partial<Parameters<typeof StageView>[0]>) => {
    // StageView's only hooks are the language ones: rendered outside React, they fall back to English.
    const html = renderToStaticMarkup(<StageView state={state} stage {...props} />);
    return html;
  };

  it("a controller phone gets the button, each beside its row; a view-only phone sees the state without it", () => {
    const controller = buttons({ onCommand: () => {}, markButton: true });
    expect(controller.match(/<button type="button" class="point-mark/g)).toHaveLength(2);
    expect(controller).toContain('class="point-mark done" aria-label="Undo: not said"');
    expect(toggleRow(controller)).not.toContain("<button");
    const viewer = buttons({ onCommand: () => {}, markButton: false });
    expect(viewer).not.toContain("point-mark");
    expect(viewer).toContain("We hired three engineers");
    expect(buttons({ markButton: true }), "read-only view").not.toContain("point-mark");
    // the mirror page asks for it on a controller only
    const mirror = readFileSync(new URL("../../app/mirror/page.tsx", import.meta.url), "utf8");
    expect(mirror.match(/markButton=\{role === "controller"\}/g)).toHaveLength(3);
  });

  it("sends the toggle to the PC through the controller's command path, mark then undo", async () => {
    vi.resetModules();
    vi.doMock("../../../../packages/ui/src/lang", () => ({ useT: () => (key: string) => t(key as never, "en"), useLang: () => "en" }));
    const { StageView: Bare } = await import("../../../../packages/ui/src/StageView");
    const sent: Command[] = [];
    const tree = Bare({ state, onCommand: (c: Command) => sent.push(c), stage: true, markButton: true });
    const marks = elements(tree).filter((e) => (e.props as { className?: string }).className?.startsWith("point-item"));
    expect(marks).toHaveLength(2);
    const button = (i: number) => elements(marks[i]).find((e) => (e.type as { name?: string }).name === "MarkSaidButton")!;
    (button(0).props as { onToggle(): void }).onToggle();
    (button(1).props as { onToggle(): void }).onToggle();
    expect(sent).toEqual([{ type: "markStarted", id: "s0b0" }, { type: "reopen", id: "s0b1" }]);
    vi.doUnmock("../../../../packages/ui/src/lang");
  });

  it("a limited phone (not accepted on the PC yet) is refused with a message that says how to fix it", () => {
    // The session server answers its markStarted / reopen with REMOTE.approveFirst (apps/server phone-sec.test.ts).
    const key = remoteErrorKey(REMOTE.approveFirst);
    expect(key).toBe("mirror.remote.approveFirst");
    for (const lang of LANGS) {
      const text = t(key!, lang);
      expect(text, lang).toContain(t("pair.approve", lang)); // "Allow full control"
      if (lang !== "en") expect(text, `${lang} is translated`).not.toBe(t(key!, "en"));
    }
    expect(t(key!, "en")).toContain("To mark points");
    expect(t(key!, "it")).toContain("Per segnare i punti");
  });
});

it("a mark from the button shows on the PC as a manual mark, with its 'Why?'", () => {
  const e = new Engine({ decide: async () => ({ decisions: [], latencyMs: 1, cost: 0, model: "m" }), now: () => 61_000, setInterval: () => 0, clearInterval: () => {} });
  e.loadScript(parseScript("# Intro\n- We hired three engineers\n- Revenue doubled\n"));
  const id = e.getState().script.sections[0].bullets[0].id;
  e.dispatch({ type: "markStarted", id }); // what the phone's button sends, relayed by the session server
  const p = e.getState().points[id];
  expect(p.evidence).toEqual({ source: "manual", fromMs: 61_000, toMs: 61_000 });
  const html = renderToStaticMarkup(<PointsList onToggle={() => {}} points={[{ id, text: "We hired three engineers", state: "done", confidence: p.confidence, evidence: p.evidence }]} />);
  expect(html).toContain(">Why?</button>");
  expect(html).toContain("Marked by hand at");
  expect(html).toContain('class="point-mark done" aria-label="Undo: not said"');
});
