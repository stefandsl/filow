// "Remember things about me" in the OK Filow panel: off by default, the list with when and from which
// question each fact was learned, Delete one and Delete all (after one question).
import { type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MemorySettings } from "@/app/okfilow/panel/memory-settings";
import type { OkFilowBridge, OkFilowStatus } from "@/lib/buddy/bridge";
import type { MemoryFact } from "@/lib/buddy/memory";
import { okfText } from "@/lib/buddy/text";

const FACTS: MemoryFact[] = [
  { id: "a", kind: "answer", text: "Answer in short sentences", at: "2026-11-14T09:30:00.000Z", question: "please answer in short sentences" },
  { id: "b", kind: "me", text: "The user's talk is about solar panels", at: "2026-11-13T18:00:00.000Z", question: "my talk is about solar panels" },
];
const api = () => ({ list: vi.fn(async () => FACTS), recall: vi.fn(), learn: vi.fn(), remove: vi.fn(async () => FACTS.slice(1)), clear: vi.fn(async () => []) });
const view = (memory: boolean | undefined, initial: MemoryFact[] = [], memoryApi: ReturnType<typeof api> | undefined = api(), confirmClear = () => true, configure = vi.fn(async () => {})) => (
  <MemorySettings bridge={{ memory: memoryApi } as unknown as OkFilowBridge} status={{ memory } as OkFilowStatus} t={okfText("en")} configure={configure} initial={initial} confirmClear={confirmClear} />
);
const plain = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ").trim();
/** The props of the elements with this data-testid, found while React renders (no DOM library in this repo). */
function handlers(node: ReactElement, testid: string): Array<Record<string, unknown>> {
  const found: Array<Record<string, unknown>> = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const el = n as { type?: unknown; props?: Record<string, unknown> };
    if (!el.props) return;
    if (el.props["data-testid"] === testid) found.push(el.props);
    if (typeof el.type === "function") return walk((el.type as (p: unknown) => unknown)(el.props));
    walk(el.props.children);
  };
  const Probe = () => { walk(node); return null; };
  renderToStaticMarkup(<Probe />);
  return found;
}

describe("Remember things about me", () => {
  it("off by default: the switch is unchecked and no list is shown", () => {
    for (const memory of [undefined, false]) {
      const html = renderToStaticMarkup(view(memory));
      expect(html).toContain('data-testid="memory-on"');
      expect(html).not.toMatch(/data-testid="memory-on"[^>]*checked/);
      expect(html).not.toContain("What OK Filow remembers");
    }
  });

  it("on, nothing yet: says so", () => {
    expect(plain(renderToStaticMarkup(view(true)))).toContain("What OK Filow remembers Nothing remembered yet.");
  });

  it("lists each fact with when and from which question, and a Delete a screen reader can name", () => {
    const html = renderToStaticMarkup(view(true, FACTS));
    const day = new Date(FACTS[0].at).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
    expect(plain(html)).toContain(`Answer in short sentences ${day}, from "please answer in short sentences" Delete`);
    expect(html).toContain('aria-label="Delete: The user&#x27;s talk is about solar panels"');
    expect(html).toContain("Delete all");
    // turned off with facts still kept: the list stays, so they can be deleted
    expect(renderToStaticMarkup(view(false, FACTS))).toContain('data-testid="memory-fact"');
  });

  it("the switch, Delete one and Delete all reach the desktop app; No deletes nothing", async () => {
    const configure = vi.fn(async () => {});
    const bridge = api();
    const asked: string[] = [];
    let answer = false;
    const node = view(true, FACTS, bridge, () => { asked.push("?"); return answer; }, configure);
    (handlers(node, "memory-on")[0].onChange as (e: { target: { checked: boolean } }) => void)({ target: { checked: false } });
    expect(configure).toHaveBeenLastCalledWith({ memory: false });
    (handlers(node, "memory-delete")[1].onClick as () => void)();
    await Promise.resolve();
    expect(bridge.remove).toHaveBeenCalledWith("b");
    (handlers(node, "memory-clear")[0].onClick as () => void)();
    await Promise.resolve();
    expect(bridge.clear).not.toHaveBeenCalled();
    answer = true;
    (handlers(node, "memory-clear")[0].onClick as () => void)();
    await Promise.resolve();
    expect(bridge.clear).toHaveBeenCalledTimes(1);
    expect(asked).toHaveLength(2);
  });

  it("an older desktop app without memory shows nothing", () => {
    expect(renderToStaticMarkup(<MemorySettings bridge={{} as OkFilowBridge} status={{ memory: true } as OkFilowStatus} t={okfText("en")} configure={async () => {}} initial={FACTS} />)).toBe("");
  });
});
