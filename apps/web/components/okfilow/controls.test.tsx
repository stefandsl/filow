import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LANGS } from "@filow/core";
import { okfText, OKF_TEXT, type OkfKey } from "@/lib/buddy/text";
import { SeeScreenSwitch, StopButton } from "./controls";

const t = okfText("en");
const render = (el: React.ReactElement) => renderToStaticMarkup(el);
/** The element React would call: finds the first handler of that name in the tree. */
function handler(el: React.ReactElement, name: string): ((...a: unknown[]) => void) | null {
  const seen: unknown[] = [el];
  while (seen.length) {
    const n = seen.shift() as { type?: unknown; props?: Record<string, unknown> } | null;
    if (!n || typeof n !== "object" || !n.props) continue;
    if (typeof n.type === "function") { seen.push((n.type as (p: unknown) => unknown)(n.props)); continue; }
    if (typeof n.props[name] === "function") return n.props[name] as (...a: unknown[]) => void;
    const kids = n.props.children;
    seen.push(...(Array.isArray(kids) ? kids : [kids]));
  }
  return null;
}

describe("the Stop button", () => {
  it("is there only while an answer is in progress, and leaves nothing behind when idle", () => {
    expect(render(<StopButton active={false} t={t} onStop={() => {}} />)).toBe("");
    const html = render(<StopButton active t={t} onStop={() => {}} />);
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-label="Stop the answer (Esc)"');
    expect(html).toContain(">Stop</span>");
  });

  it("stops the answer when pressed", () => {
    const onStop = vi.fn();
    handler(<StopButton active t={t} onStop={onStop} />, "onClick")?.();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("next to the pointer it also names the key", () => {
    expect(render(<StopButton active pill t={t} onStop={() => {}} />)).toContain("<kbd>Esc</kbd>");
    expect(render(<StopButton active t={t} onStop={() => {}} />)).not.toContain("<kbd>");
  });
});

describe('the "Look at my screen" switch', () => {
  const sw = (p: Partial<Parameters<typeof SeeScreenSwitch>[0]> = {}) => <SeeScreenSwitch on slow={false} leaves={false} who="" t={t} onChange={() => {}} {...p} />;

  it("is a labelled switch with its state in words, not only an icon or a colour", () => {
    const on = render(sw());
    expect(on).toContain('role="switch"');
    expect(on).toContain('aria-checked="true"');
    expect(on).toContain("Look at my screen");
    expect(on).toContain(">On</span>");
    expect(on).toContain("OK Filow sees your screen and can point at things.");
    const off = render(sw({ on: false }));
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain(">Off</span>");
    expect(off).toContain("OK Filow answers from your words only. It can still draw.");
    // the sentence under it is its description for a screen reader
    const id = /aria-describedby="([^"]+)"/.exec(off)?.[1];
    expect(id).toBeTruthy();
    expect(off).toContain(`id="${id}"`);
  });

  it("writes the other state when pressed", () => {
    const onChange = vi.fn();
    handler(sw({ on: false, onChange }), "onClick")?.();
    expect(onChange).toHaveBeenLastCalledWith(true);
    handler(sw({ on: true, onChange }), "onClick")?.();
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("says that looking is slow on this PC only when it is, in both states", () => {
    expect(render(sw({ on: false, slow: true }))).toContain("On this PC this makes answers slower.");
    expect(render(sw({ on: true, slow: true }))).toContain("On this PC this makes answers slower.");
    expect(render(sw({ on: false }))).not.toContain("slower");
  });

  it("with answers from online it says where the pictures go, with the going-outside mark, or that none leave", () => {
    const going = render(sw({ on: true, leaves: true, who: "OpenRouter and Google" }));
    expect(going).toContain("Pictures of your screen go to OpenRouter and Google with each question.");
    expect(going).toContain("okf-out-icon");
    const kept = render(sw({ on: false, leaves: true, who: "OpenRouter and Google" }));
    expect(kept).toContain("No picture of your screen leaves this PC.");
    expect(kept).not.toContain("okf-out-icon");
    expect(kept).not.toContain("OpenRouter");
    // answers from this PC: nothing about sending at all
    const local = render(sw({ on: true }));
    expect(local).not.toContain("go to");
    expect(local).not.toContain("leaves this PC");
  });

  it("uses everyday words in the five languages: none of the technical ones", () => {
    const keys: OkfKey[] = ["seeScreen", "seeOn", "seeOff", "seeSlow", "seeLeaves", "seeKept", "seeStateOn", "seeStateOff", "stop", "stopHint", "stopped", "mode_thinkingWords", "notchWords", "notchAnswering", "drawFailed"];
    for (const lang of LANGS) {
      for (const k of keys) expect(OKF_TEXT[lang][k], `${lang}.${k}`).not.toMatch(/vision|multimodal|screenshot|prompt|\bmodel\b|модел|modello\b|モデル|Ollama|GPU|\bAI\b/i);
    }
  });
});
