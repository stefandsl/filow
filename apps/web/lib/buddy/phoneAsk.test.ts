import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Engine, LANGS, PHONE_QUESTION_MAX, t, type I18nKey } from "@filow/core";
import { LangProvider } from "@filow/ui";
import { MirrorAsk } from "@/components/MirrorAsk";
import { answerPhoneAsk, phoneAskLine, phoneQuestion, PHONE_ASK_ERRORS } from "./phoneAsk";

// "Ask OK Filow" on a paired phone: the phone sends the question over its paired session, the
// computer's main window hands it to OK Filow's panel, and the phone says in words what happened.
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const web = path.join(here, "..", "..");
const read = (p: string) => fs.readFileSync(path.join(web, p), "utf8").replace(/\r\n/g, "\n");

describe("a phone's question for OK Filow", () => {
  it("is text only, one line, capped, and nothing when empty", () => {
    expect(phoneQuestion("  What is\n on   the slide?  ")).toBe("What is on the slide?");
    expect(phoneQuestion("x".repeat(PHONE_QUESTION_MAX + 50))).toHaveLength(PHONE_QUESTION_MAX);
    expect(PHONE_QUESTION_MAX).toBe(300);
    for (const empty of ["", "   \n ", null, undefined, 42, { text: "hi" }]) expect(phoneQuestion(empty)).toBeNull();
  });

  it("on the computer, goes to OK Filow's panel and the phone hears back which way it went", async () => {
    const askFromPhone = vi.fn(async () => "asked" as const);
    expect(await answerPhoneAsk("  Why? ", { askFromPhone })).toEqual({ ok: true });
    expect(askFromPhone).toHaveBeenCalledWith("Why?");
    expect(await answerPhoneAsk("Why?", { askFromPhone: async () => "off" })).toEqual({ ok: false, error: "okfilow:off" });
    expect(await answerPhoneAsk("Why?", { askFromPhone: async () => "busy" })).toEqual({ ok: false, error: "okfilow:busy" });
    expect(await answerPhoneAsk("Why?", { askFromPhone: async () => "empty" })).toEqual({ ok: false, error: "okfilow:empty" });
    expect(await answerPhoneAsk("Why?", { askFromPhone: async () => "unavailable" })).toEqual({ ok: false, error: "okfilow:unavailable" });
    expect(await answerPhoneAsk("Why?", { askFromPhone: async () => { throw new Error("Denied"); } })).toEqual({ ok: false, error: "okfilow:unavailable" });
    expect(await answerPhoneAsk("Why?", { askFromPhone: (async () => true) as unknown as () => Promise<"asked"> })).toEqual({ ok: false, error: "okfilow:unavailable" });
    // a browser holding the session (no desktop app), or nothing to ask: nothing is handed on
    expect(await answerPhoneAsk("Why?", {})).toEqual({ ok: false, error: "okfilow:unavailable" });
    expect(await answerPhoneAsk("Why?", null)).toEqual({ ok: false, error: "okfilow:unavailable" });
    const never = vi.fn(async () => "asked" as const);
    expect(await answerPhoneAsk("   ", { askFromPhone: never })).toEqual({ ok: false, error: "okfilow:empty" });
    expect(never).not.toHaveBeenCalled();
  });

  it("the window holding the session answers it before the engine, which never runs it", () => {
    const session = read("components/useSession.ts");
    const handler = session.slice(session.indexOf("client.onCommand((cmd, ack) => {"), session.indexOf("const r = engine.dispatch(cmd);"));
    expect(handler).toContain('if (cmd.type === "askOkFilow") return void answerPhoneAsk(cmd.text).then(ack);');
    expect(session).toContain('import { answerPhoneAsk } from "@/lib/buddy/phoneAsk";');
    const engine = new Engine({ decide: async () => ({ decisions: [], latencyMs: 0, cost: 0, model: "m" }) });
    const before = JSON.stringify(engine.getState());
    expect(engine.dispatch({ type: "askOkFilow", text: "hi" })).toEqual({ ok: false, error: "okfilow:unavailable" });
    expect(JSON.stringify(engine.getState())).toBe(before);
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
        expect(text).not.toContain("\u2014");
      }
    }
    for (const lang of LANGS) expect(t("mirror.ask.failed", lang)).toContain("{error}");
  });

  it("the phone's box: a labelled field capped like the computer, a button that waits for a question, a spoken status line", () => {
    const html = renderToStaticMarkup(createElement(LangProvider, { lang: "en", children: createElement(MirrorAsk, { send: async () => ({ ok: true }) }) }));
    expect(html).toContain('data-testid="mirror-ask"');
    expect(html).toMatch(/<label class="label" id="([^"]+)-label" for="\1-q">Ask OK Filow<\/label>/);
    expect(html).toContain(`maxLength="${PHONE_QUESTION_MAX}"`);
    expect(html).toContain('placeholder="Type a question for the computer"');
    expect(html).toMatch(/<button class="btn primary" type="submit" disabled="">Ask<\/button>/);
    expect(html).toContain('role="status" aria-live="polite"');
    expect(html).toContain(t("mirror.ask.where", "en"));
  });

  it("is on the full phone view only, not in the desktop's own overlay windows or the compact view", () => {
    const mirror = read("app/mirror/page.tsx");
    expect(mirror.match(/<MirrorAsk /g)).toHaveLength(1);
    const stage = mirror.slice(mirror.indexOf("function MirrorStage("), mirror.indexOf("const pageArea"));
    expect(stage).toContain("<MirrorAsk send={ask} />");
    expect(mirror).toContain("ask={(cmd) => client.send(cmd)}");
  });
});
