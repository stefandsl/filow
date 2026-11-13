import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Engine, LANGS, PHONE_ASK_OFF, PHONE_QUESTION_MAX, t, type Command, type I18nKey } from "@filow/core";
import { LangProvider } from "@filow/ui";
import { MirrorAsk } from "@/components/MirrorAsk";
import { askTextQuestion, phoneAskLine, phoneQuestion, sessionCommand, PHONE_ASK_ERRORS } from "./phoneAsk";

// "Ask OK Filow" on a paired phone is switched off until it is secured: the page has no box, the
// window holding the session refuses the question, and the panel never asks one.
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const web = path.join(here, "..", "..");
const read = (p: string) => fs.readFileSync(path.join(web, p), "utf8").replace(/\r\n/g, "\n");

describe("a phone's question for OK Filow, switched off", () => {
  it("is text only, one line, capped, and nothing when empty", () => {
    expect(phoneQuestion("  What is\n on   the slide?  ")).toBe("What is on the slide?");
    expect(phoneQuestion("x".repeat(PHONE_QUESTION_MAX + 50))).toHaveLength(PHONE_QUESTION_MAX);
    expect(PHONE_QUESTION_MAX).toBe(300);
    for (const empty of ["", "   \n ", null, undefined, 42, { text: "hi" }]) expect(phoneQuestion(empty)).toBeNull();
  });

  it("on the computer, is refused by the window holding the session: never handed to OK Filow or the engine", () => {
    const dispatch = vi.fn((_: Command) => ({ ok: true }) as const);
    expect(sessionCommand({ type: "askOkFilow", text: "What is on the slide?" }, dispatch)).toEqual({ ok: false, error: PHONE_ASK_OFF });
    expect(sessionCommand({ type: "askOkFilow" } as unknown as Command, dispatch)).toEqual({ ok: false, error: PHONE_ASK_OFF });
    expect(dispatch).not.toHaveBeenCalled();
    // every other command is still the engine's
    expect(sessionCommand({ type: "nextSection" }, dispatch)).toEqual({ ok: true });
    expect(dispatch).toHaveBeenCalledWith({ type: "nextSection" });
    expect(PHONE_ASK_OFF).toBe("okfilow:phone-off");
  });

  it("the window holding the session routes every command through that refusal, and the engine never runs a question", () => {
    const session = read("components/useSession.ts");
    const handler = session.slice(session.indexOf("client.onCommand((cmd, ack) => {"), session.indexOf("ack(r.ok ? { ok: true } : { ok: false, error: r.error });"));
    expect(handler).toContain("const r = sessionCommand(cmd, (c) => engine.dispatch(c));");
    expect(session).not.toContain("answerPhoneAsk");
    const engine = new Engine({ decide: async () => ({ decisions: [], latencyMs: 0, cost: 0, model: "m" }) });
    const before = JSON.stringify(engine.getState());
    expect(engine.dispatch({ type: "askOkFilow", text: "hi" })).toEqual({ ok: false, error: PHONE_ASK_OFF });
    expect(JSON.stringify(engine.getState())).toBe(before);
  });

  it("the panel asks only plain text its own shell hands it, never a question tagged as a phone's", () => {
    expect(askTextQuestion("  Explain this  ")).toBe("Explain this");
    for (const no of ["", "   ", null, undefined, 42, { text: "hi", source: "phone" }, { source: "phone" }, ["hi"]]) expect(askTextQuestion(no)).toBeNull();
  });

  it("the phone says each outcome in words, in all five languages", () => {
    expect(phoneAskLine({ ok: true }).key).toBe("mirror.ask.sent");
    expect(PHONE_ASK_ERRORS.map((e) => phoneAskLine({ ok: false, error: e }).key)).toEqual(["mirror.ask.off", "mirror.ask.busy", "mirror.ask.unavailable", "mirror.ask.empty"]);
    expect(phoneAskLine({ ok: false, error: "viewer role" })).toEqual({ key: "mirror.ask.failed", error: "viewer role" });
    expect(phoneAskLine({ ok: false })).toEqual({ key: "mirror.ask.failed", error: "" });
    const keys: I18nKey[] = ["mirror.ask.label", "mirror.ask.placeholder", "mirror.ask.send", "mirror.ask.sending", "mirror.ask.sent", "mirror.ask.off", "mirror.ask.busy", "mirror.ask.unavailable", "mirror.ask.empty", "mirror.ask.failed", "mirror.ask.where"];
    for (const key of keys) {
      const texts = LANGS.map((lang) => t(key, lang));
      expect(new Set(texts).size, key).toBe(5);
      for (const text of texts) {
        expect(text).not.toBe(key);
        expect(text).not.toContain("—");
      }
    }
    for (const lang of LANGS) expect(t("mirror.ask.failed", lang)).toContain("{error}");
  });

  it("the phone's box (kept for when it returns): a labelled field capped like the computer, a button that waits for a question", () => {
    const html = renderToStaticMarkup(createElement(LangProvider, { lang: "en", children: createElement(MirrorAsk, { send: async () => ({ ok: true }) }) }));
    expect(html).toContain('data-testid="mirror-ask"');
    expect(html).toContain(`maxLength="${PHONE_QUESTION_MAX}"`);
    expect(html).toMatch(/<button class="btn primary" type="submit" disabled="">Ask<\/button>/);
  });

  it("is not on the phone page while it is switched off", () => {
    const mirror = read("app/mirror/page.tsx");
    expect(mirror).not.toContain("MirrorAsk");
    expect(mirror).not.toContain("client.send(cmd)}");
  });
});
