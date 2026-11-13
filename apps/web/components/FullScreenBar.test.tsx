// The bar drawn in full screen (FullScreenBar.tsx): three labelled buttons in every language, shown or not.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LANGS, t } from "@filow/core";
import { FullScreenBar, FullScreenBarView } from "./FullScreenBar";

const bridge = () => ({ exitFullScreen: vi.fn(), minimize: vi.fn(), close: vi.fn() });
const view = (over: Partial<Parameters<typeof FullScreenBarView>[0]> = {}) =>
  <FullScreenBarView lang="en" shown={false} bridge={bridge()} onPointer={() => {}} onFocus={() => {}} {...over} />;

/** The props of the first element in the tree whose props match. */
function find(el: React.ReactElement, match: (p: Record<string, unknown>) => boolean): Record<string, unknown> | null {
  const seen: unknown[] = [el];
  while (seen.length) {
    const n = seen.shift() as { type?: unknown; props?: Record<string, unknown> } | null;
    if (!n || typeof n !== "object" || !n.props) continue;
    if (typeof n.type === "function") { seen.push((n.type as (p: unknown) => unknown)(n.props)); continue; }
    if (match(n.props)) return n.props;
    const kids = n.props.children;
    seen.push(...(Array.isArray(kids) ? kids : [kids]));
  }
  return null;
}

describe("the full-screen bar", () => {
  it("names its three buttons in every language", () => {
    for (const lang of LANGS) {
      const html = renderToStaticMarkup(view({ lang }));
      expect(html).toContain(`aria-label="${t("fullscreen.exit", lang)}"`);
      expect(html).toContain(`aria-label="${t("fullscreen.minimize", lang)}"`);
      expect(html).toContain(`aria-label="${t("fullscreen.close", lang)}"`);
      expect(html).toContain(`role="toolbar" aria-label="${t("fullscreen.bar", lang)}"`);
      expect(html.match(/<button type="button"/g)).toHaveLength(3);
      // translated, not the English fallback
      for (const k of ["fullscreen.exit", "fullscreen.minimize", "fullscreen.close", "fullscreen.bar"] as const) {
        expect(t(k, lang), `${k} ${lang}`).not.toBe(k);
        if (lang !== "en") expect(t(k, lang), `${k} ${lang}`).not.toBe(t(k, "en"));
      }
    }
  });
  it("says whether it is shown, for the stylesheet", () => {
    expect(renderToStaticMarkup(view({ shown: false }))).toContain('class="fsbar" data-shown="false"');
    expect(renderToStaticMarkup(view({ shown: true }))).toContain('class="fsbar" data-shown="true"');
  });
  it("each button asks main for its own action only", () => {
    for (const [action, method] of [["exit", "exitFullScreen"], ["minimize", "minimize"], ["close", "close"]] as const) {
      const b = bridge();
      (find(view({ bridge: b }), (p) => p["data-action"] === action)!.onClick as () => void)();
      expect(b[method]).toHaveBeenCalledOnce();
      expect(Object.values(b).filter((f) => f.mock.calls.length)).toHaveLength(1);
    }
  });
  it("hears the pointer on the top edge and the focus inside it", () => {
    const onPointer = vi.fn(), onFocus = vi.fn();
    const zone = find(view({ onPointer, onFocus }), (p) => p.className === "fsbar")!;
    (zone.onPointerEnter as () => void)(); (zone.onPointerLeave as () => void)();
    expect(onPointer.mock.calls).toEqual([[true], [false]]);
    (zone.onFocus as () => void)();
    const inside = { contains: () => true }, outside = { contains: () => false };
    (zone.onBlur as (e: unknown) => void)({ currentTarget: inside, relatedTarget: {} });
    (zone.onBlur as (e: unknown) => void)({ currentTarget: outside, relatedTarget: null });
    expect(onFocus.mock.calls).toEqual([[true], [false]]);
  });
  it("draws nothing outside the desktop app or before full screen", () => {
    expect(renderToStaticMarkup(<FullScreenBar />)).toBe("");
  });
});
