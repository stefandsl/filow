// "Report a problem", section "Dictation and keys" (docs/dictation/SPEC.md): what the last dictations did,
// stage by stage, so the next bug on another system can be read from the issue alone.
import { readFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import path from "node:path";
import { runInThisContext } from "node:vm";
import * as i18n from "../../packages/core/src/i18n";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Diag = { begin(kind: string): void; handsFree(): void; mark(name: string, facts?: Record<string, unknown>, o?: { once?: boolean }): void; result(what: string): void; runs(): Array<{ kind: string; result: string; stages: Array<{ name: string; ms: number }> }> };
const { createDictationDiag, reportText, problemCode } = require("./dictation-diag.js") as {
  createDictationDiag(o?: { now?: () => number; max?: number }): Diag;
  reportText(facts: Record<string, unknown>): string;
  problemCode(o: { hookReady: boolean; run: unknown }): string;
};

function clocked() {
  let t = Date.UTC(2026, 10, 11, 10, 46, 54);
  const d = createDictationDiag({ now: () => t });
  return { d, tick: (ms: number) => { t += ms; } };
}
const FACTS = { settings: { enabled: true, chord: "ctrl+meta", mode: "hold", insert: "paste", language: "auto" }, hook: { ready: true }, model: { ready: true, language: "auto" }, mic: "access granted", helper: true, session: ["Windows, remote desktop session no, Filow runs as administrator no"] };

describe("dictation: what the report says", () => {
  it("issue #7, a press too short to say anything: the stages and the code FD-H1-SHORT", () => {
    const { d, tick } = clocked();
    d.begin("hold"); tick(2); d.mark("listening"); tick(210); d.mark("audio", {}, { once: true }); tick(350); d.mark("keys-up"); tick(2000); d.result("nothing");
    const text = reportText({ ...FACTS, runs: d.runs() });
    expect(text).toContain("problem code: FD-H1-SHORT");
    expect(text).toContain("hold: keys down +0 ms, microphone asked +2 ms, first sound +212 ms, keys up +562 ms => nothing");
    expect(text).toContain("keyboard hook: registered");
  });

  it("0.9.37, a microphone that is slow to open: the stages say when it opened and the code is FD-H1-MIC, not SHORT or NOTEXT", () => {
    // the keys went up after 3 s with the microphone still not open
    const a = clocked();
    a.d.begin("hold"); a.tick(2); a.d.mark("listening"); a.tick(3000); a.d.mark("keys-up"); a.tick(100); a.d.result("nothing");
    let text = reportText({ ...FACTS, runs: a.d.runs() });
    expect(text).toContain("problem code: FD-H1-MIC");
    expect(text).toContain("hold: keys down +0 ms, microphone asked +2 ms, keys up +3002 ms => nothing");
    // it opened in the end, far too late: the report shows the 15 s
    a.tick(12_000); a.d.mark("open", {}, { once: true });
    text = reportText({ ...FACTS, runs: a.d.runs() });
    expect(text).toContain("microphone asked +2 ms, keys up +3002 ms, microphone open +15102 ms => nothing");
    expect(text).toContain("problem code: FD-H1-MIC");
    // open after 4 s with the keys still down, and then no words
    const b = clocked();
    b.d.begin("hold"); b.tick(2); b.d.mark("listening"); b.tick(4000); b.d.mark("open", {}, { once: true }); b.tick(500); b.d.mark("keys-up"); b.tick(900); b.d.result("nothing");
    expect(problemCode({ hookReady: true, run: b.d.runs()[0] })).toBe("FD-H1-MIC");
    // a microphone that opens at once keeps the old codes
    const c = clocked();
    c.d.begin("hold"); c.tick(2); c.d.mark("listening"); c.tick(90); c.d.mark("open", {}, { once: true }); c.tick(400); c.d.mark("keys-up"); c.tick(900); c.d.result("nothing");
    expect(problemCode({ hookReady: true, run: c.d.runs()[0] })).toBe("FD-H1-SHORT");
    expect(reportText({ ...FACTS, runs: c.d.runs() })).toContain("microphone asked +2 ms, microphone open +92 ms, keys up +492 ms => nothing");
    const e = clocked();
    e.d.begin("hold"); e.tick(2); e.d.mark("listening"); e.tick(90); e.d.mark("open", {}, { once: true }); e.tick(4000); e.d.mark("keys-up"); e.tick(900); e.d.result("nothing");
    expect(problemCode({ hookReady: true, run: e.d.runs()[0] })).toBe("FD-H1-NOTEXT");
    // a run recorded without the microphone stages at all (nothing known): the old codes
    const f = clocked();
    f.d.begin("hold"); f.tick(300); f.d.mark("keys-up"); f.tick(900); f.d.result("nothing");
    expect(problemCode({ hookReady: true, run: f.d.runs()[0] })).toBe("FD-H1-SHORT");
  });

  it("a dictation that was pasted: target program and window class, never the words", () => {
    const { d, tick } = clocked();
    d.begin("hold"); tick(2032); d.mark("keys-up"); tick(600); d.mark("recognised", { chars: 36 }); tick(40);
    d.mark("target", { line: "Notepad.exe [Notepad > RichEditD2DPT]", method: "paste" }); tick(20); d.mark("done", { what: "pasted" }); d.result("pasted"); tick(1500); d.mark("clipboard", { back: true });
    const text = reportText({ ...FACTS, runs: d.runs() });
    expect(text).toContain("problem code: FD-H1-OK");
    expect(text).toContain("recognised 36 chars +2632 ms, target Notepad.exe [Notepad > RichEditD2DPT] -> paste +2672 ms, pasted +2692 ms, clipboard put back +4192 ms => pasted");
  });

  it("the hook that never registered, an administrator window, a password box, refused keys: one code each", () => {
    const run = (result: string, kind = "hold", up = 3000) => ({ kind, result, stages: [{ name: "keys-down", ms: 0 }, { name: "keys-up", ms: up }] });
    expect(problemCode({ hookReady: false, run: null })).toBe("FD-H0-NONE");
    expect(problemCode({ hookReady: true, run: run("copied:elevated") })).toBe("FD-H1-COPY-ELEVATED");
    expect(problemCode({ hookReady: true, run: run("refused:password") })).toBe("FD-H1-PW");
    expect(problemCode({ hookReady: true, run: run("copied:blocked") })).toBe("FD-H1-KEYS");
    expect(problemCode({ hookReady: true, run: run("nothing") })).toBe("FD-H1-NOTEXT");
    expect(problemCode({ hookReady: true, run: run("nothing", "handsfree", 400) })).toBe("FD-H1-NOTEXT");
    expect(problemCode({ hookReady: true, run: run("") })).toBe("FD-H1-OPEN");
    const text = reportText({ ...FACTS, hook: { ready: false, error: "Failed to register low level windows hook.", failures: 7, lastTryAt: Date.UTC(2026, 10, 11, 10, 0, 0) }, runs: [] });
    expect(text).toContain("keyboard hook: NOT registered (Failed to register low level windows hook.), 7 failed tries, last try");
    expect(text).toContain("last dictations: none since Filow started");
  });

  it("keeps the last five dictations, newest first, and a hold that went on hands-free is one run", () => {
    const { d, tick } = clocked();
    for (let i = 0; i < 7; i++) { d.begin("hold"); tick(1000); d.mark("keys-up"); d.result(i === 6 ? "pasted" : "nothing"); }
    expect(d.runs()).toHaveLength(5);
    d.begin("hold"); d.handsFree(); d.result("pasted");
    const lines = reportText({ ...FACTS, runs: d.runs() }).split("\n").filter((l) => l.startsWith("- "));
    expect(lines[0]).toContain("handsfree:");
    expect(lines).toHaveLength(5);
  });

  it("unknown stage names and facts that are not short names never get in", () => {
    const { d } = clocked();
    d.begin("hold");
    d.mark("words", { text: "what I said" });
    d.result("pasted but this result is far too long to be one of ours and gets cut off here");
    const text = reportText({ ...FACTS, runs: d.runs() });
    expect(text).not.toContain("what I said");
    expect(d.runs()[0].result.length).toBeLessThanOrEqual(40);
  });

  it("the GitHub issue link keeps this section whole when the logs are cut to fit", () => {
    // about.js reads its texts from vendor/i18n, a build that is not in git: hand it the source, as about.test.ts does.
    const aboutFile = path.resolve(__dirname, "about.js");
    const aboutOwn = createRequire(aboutFile);
    const aboutMod = { exports: {} as Record<string, unknown> };
    runInThisContext(Module.wrap(readFileSync(aboutFile, "utf8")), { filename: aboutFile }).call(aboutMod.exports, aboutMod.exports, (id: string) => (id === "./vendor/i18n" ? i18n : aboutOwn(id)), aboutMod, aboutFile, path.dirname(aboutFile));
    const { issueUrl } = aboutMod.exports as { issueUrl(o: Record<string, unknown>): { url: string; body: string; cut: boolean } };
    const { d, tick } = clocked();
    for (let i = 0; i < 5; i++) { d.begin("hold"); tick(2000); d.mark("keys-up"); tick(600); d.mark("recognised", { chars: 36 }); d.mark("target", { line: "Notepad.exe [Notepad > RichEditD2DPT]", method: "paste" }); d.mark("done", { what: "pasted" }); d.result("pasted"); tick(1500); d.mark("clipboard", { back: true }); }
    const dict = reportText({ ...FACTS, runs: d.runs() });
    expect(dict.length).toBeGreaterThan(1400);
    const sections = [{ id: "system", text: "Filow 1 on a test PC" }, { id: "dictation", text: dict, keep: true }, { id: "take", text: "" }, { id: "log", text: "2026-11-11T10:46:54.809Z a start-up log line\n".repeat(900) }];
    const r = issueUrl({ lang: "en", description: "Dictation does not type", sections, version: "1", limit: 3600 });
    expect(r.cut).toBe(true);
    expect(r.url.length).toBeLessThanOrEqual(3600);
    expect(r.body).toContain("### Dictation and keys");
    expect(r.body).toContain(dict);
    // Without `keep` a long section loses its first lines (the problem code is the first one).
    const long = { id: "dictation", text: `problem code: FD-H1-OK\n${"x".repeat(30)}\n`.repeat(400) };
    expect(issueUrl({ lang: "en", description: "", sections: [long], version: "1" }).body.startsWith("### What happened")).toBe(true);
    // A kept section has its own ceiling: the newest lines stay (the problem code first), the oldest go, and the link still carries the words.
    const kept = issueUrl({ lang: "en", description: "My words", sections: [{ ...long, keep: true }], version: "1" });
    expect(kept.body).toContain("My words");
    expect(kept.body).toContain("```\nproblem code: FD-H1-OK\n");
    expect(kept.cut).toBe(true);
    expect(kept.url.length).toBeLessThanOrEqual(6000);
  });

  it("a brief press the next press overtook is closed as nothing, and its late empty answer does not mark the new run", () => {
    const { d, tick } = clocked();
    const diag = d as Diag & { nothing(): void; begin(kind: string, agoMs?: number): void };
    diag.begin("hold", 250); tick(250); d.mark("keys-up");
    expect(d.runs()[0].stages.at(-1)).toMatchObject({ name: "keys-up", ms: 500 }); // counted from the key press, not from the start delay
    tick(350);
    diag.begin("hold", 250); // the second brief press, before the first one's words (none) came back
    diag.nothing(); // the first press's empty answer arrives now: the new run is still listening
    expect(d.runs().map((r) => r.result)).toEqual(["nothing", ""]);
    d.handsFree(); tick(4000); d.result("pasted"); tick(9000); d.mark("keys-up"); diag.nothing();
    expect(d.runs()[1]).toMatchObject({ kind: "handsfree", result: "pasted" });
  });

  it("a long hands-free dictation stays short in the report: first stages, a count, the last ones", () => {
    const { d, tick } = clocked();
    d.begin("handsfree");
    for (let i = 0; i < 12; i++) { tick(5000); d.mark("recognised", { chars: 30 }); d.mark("target", { line: "Notepad.exe [Notepad]", method: "paste" }); d.mark("done", { what: "pasted" }); d.result("pasted"); }
    tick(1000); d.mark("keys-up");
    const text = reportText({ ...FACTS, runs: [d.runs()[0], d.runs()[0], d.runs()[0], d.runs()[0], d.runs()[0]] });
    expect(text).toMatch(/\(\d+ more stages\)/);
    expect(text).toContain("keys up +61000 ms => pasted");
    expect(text.length).toBeLessThan(4000); // five such runs still fit a GitHub link with room for the logs
  });
});