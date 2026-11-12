// The answer bubble next to the pointer (docs/okfilow/BUBBLE.md): the whole answer is in it, it can
// be closed, and the overlay page and the panel are wired to the rules.
import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LANGS } from "@filow/core";
import { okfText } from "@/lib/buddy/text";
import { AnswerBubble, answerInBubble, bubbleClosable, markMore } from "./bubble";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const read = (rel: string) => fs.readFileSync(path.join(here, rel), "utf8").replace(/\r\n/g, "\n");
const css = read("../../app/okfilow/okfilow.css");
const overlay = read("../../app/okfilow/overlay/page.tsx");
const panel = read("../../app/okfilow/panel/page.tsx");
const t = okfText("en");
const noop = () => {};
/** The text of rendered markup, as a reader gets it. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
/** The css rule for one selector (the first, whole). */
const rule = (selector: string) => {
  const at = css.indexOf(`\n${selector} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at) + 1);
};

/** A long answer in each of the five languages: forty sentences, far beyond what seven lines hold. */
const LONG: Record<string, string> = {
  en: Array.from({ length: 40 }, (_, i) => `Sentence ${i + 1} explains one more step of keeping the files of a Windows PC tidy.`).join(" "),
  it: Array.from({ length: 40 }, (_, i) => `La frase ${i + 1} spiega un altro passo per tenere in ordine i file di un PC Windows.`).join(" "),
  ro: Array.from({ length: 40 }, (_, i) => `Propoziția ${i + 1} explică încă un pas pentru a ține în ordine fișierele unui PC cu Windows.`).join(" "),
  ru: Array.from({ length: 40 }, (_, i) => `Предложение ${i + 1} объясняет ещё один шаг, чтобы держать файлы на компьютере с Windows в порядке.`).join(" "),
  ja: Array.from({ length: 40 }, (_, i) => `${i + 1}番目の文は、Windowsパソコンのファイルを整理するための次の手順を説明します。`).join(""),
};

describe("the bubble shows the whole answer", () => {
  for (const lang of Object.keys(LONG)) {
    it(`a long answer is all there, to its last letter, with no ellipsis added: ${lang}`, () => {
      const text = LONG[lang];
      expect(text.length).toBeGreaterThan(1500);
      const html = renderToStaticMarkup(<AnswerBubble mode="speaking" text={text} stopped={false} shown t={okfText(lang)} onClose={noop} />);
      const box = html.slice(html.indexOf('data-testid="okf-bubble-text"'), html.indexOf("</div>", html.indexOf('data-testid="okf-bubble-text"')));
      expect(textOf(box.slice(box.indexOf(">") + 1))).toBe(text);
      expect(html.match(/data-s="/g)).toHaveLength(40);
      expect(html).not.toContain("…");
    });
  }
  it("the room scrolls and never clamps: no line clamp, no hidden overflow, at most half the screen high", () => {
    const text = rule(".okf-text");
    expect(text).not.toBe("");
    expect(css).not.toMatch(/line-clamp/);
    expect(text).not.toMatch(/text-overflow|overflow:\s*hidden|overflow-y:\s*hidden/);
    expect(text).toMatch(/overflow-y:\s*auto;/);
    expect(text).toMatch(/max-height:\s*50vh;/);
    expect(text).toMatch(/overflow-wrap:\s*anywhere;/); // a long word or path wraps instead of widening the bubble
    // a slim scrollbar without arrows, and a last line that fades out while more text lies below
    expect(css).toMatch(/\.okf-text::-webkit-scrollbar \{ width: 6px; \}/);
    expect(css).toMatch(/\.okf-text::-webkit-scrollbar-button \{ display: none;/);
    // scrollbar-color or scrollbar-width with a value switch the styled scrollbar off (the wide one with
    // arrows comes back), and globals.css sets scrollbar-color on every element: the text sets both back to auto
    expect(read("../../app/globals.css")).toMatch(/\* \{ scrollbar-color:/);
    expect(css).toContain(".okf-text { scrollbar-color: auto; scrollbar-width: auto; }");
    expect(css.replace(".okf-text { scrollbar-color: auto; scrollbar-width: auto; }", "")).not.toMatch(/scrollbar-width\s*:|scrollbar-color\s*:/);
    expect(css).toMatch(/\.okf-text\[data-more="1"\] \{[^}]*mask-image: linear-gradient\(to bottom, #000 calc\(100% - 26px\), transparent 100%\);/);
    // the bubble is a box of its own above the overlay, never wider than the screen
    expect(rule(".okf-bubble")).toMatch(/position:\s*fixed;/);
    expect(rule(".okf-bubble")).toMatch(/max-width:\s*min\(380px, calc\(100vw - 16px\)\);/);
  });
  it("says when more text lies below what is in view, and when the end is reached", () => {
    const box = { scrollHeight: 1842, scrollTop: 0, clientHeight: 384, dataset: {} as Record<string, string> };
    markMore(box as unknown as HTMLElement);
    expect(box.dataset.more).toBe("1");
    box.scrollTop = 1458;
    markMore(box as unknown as HTMLElement);
    expect(box.dataset.more).toBe("0");
    box.scrollTop = 1455; // within two pixels of the end: nothing more to read
    markMore(box as unknown as HTMLElement);
    expect(box.dataset.more).toBe("1");
    const short = { scrollHeight: 60, scrollTop: 0, clientHeight: 60, dataset: {} as Record<string, string> };
    markMore(short as unknown as HTMLElement);
    expect(short.dataset.more).toBe("0");
    markMore(null);
    expect(overlay).toContain("const mark = () => markMore(textBox.current);");
  });
  it("marks the sentence the voice is on, and only that one", () => {
    const html = renderToStaticMarkup(<AnswerBubble mode="speaking" text="One is first. Two is next. Three is last." stopped={false} shown spoken={1} t={t} onClose={noop} />);
    expect(html).toContain('<span data-s="0">One is first.</span> <span data-s="1" class="okf-said">Two is next.</span> <span data-s="2">Three is last.</span>');
    expect(html.match(/okf-said/g)).toHaveLength(1);
    expect(renderToStaticMarkup(<AnswerBubble mode="idle" text="One is first." stopped={false} shown t={t} onClose={noop} />)).not.toContain("okf-said");
  });
});

describe("the bubble's close button", () => {
  it("has a name in every language, and says Esc does the same", () => {
    const names = LANGS.map((lang) => okfText(lang)("closeAnswer"));
    expect(names).toEqual(["Close the answer", "Chiudi la risposta", "Закрыть ответ", "Închide răspunsul", "回答を閉じる"]);
    for (const lang of LANGS) {
      const html = renderToStaticMarkup(<AnswerBubble mode="idle" text="Done." stopped={false} shown t={okfText(lang)} onClose={noop} />);
      const name = okfText(lang)("closeAnswer");
      expect(html).toContain(`<button type="button" class="okf-bubble-close" data-testid="okf-bubble-close" aria-label="${name}" title="${name} (Esc)" tabindex="0">`);
    }
  });
  it("a click asks to close", () => {
    const onClose = vi.fn();
    const el = AnswerBubble({ mode: "idle", text: "Done.", stopped: false, shown: true, t, onClose });
    const kids = (el.props.children as unknown[]).flat().filter(Boolean) as Array<{ type: string; props: { onClick?: () => void } }>;
    const button = kids.find((k) => k.type === "button");
    expect(button).toBeTruthy();
    button!.props.onClick!();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it("is there for an answer, an error and a stopped answer; not while listening, and not while the text is still being written", () => {
    expect(bubbleClosable("speaking", "Text.", false)).toBe(true);
    expect(bubbleClosable("idle", "Text.", false)).toBe(true);
    expect(bubbleClosable("error", "It failed.", false)).toBe(true);
    expect(bubbleClosable("idle", "", true)).toBe(true);
    expect(bubbleClosable("thinking", "Half a", false)).toBe(false);
    expect(bubbleClosable("listening", "dictated words", false)).toBe(false);
    expect(bubbleClosable("idle", "", false)).toBe(false);
    expect(renderToStaticMarkup(<AnswerBubble mode="thinking" text="Half a" stopped={false} shown t={t} onClose={noop} />)).not.toContain("okf-bubble-close");
    expect(renderToStaticMarkup(<AnswerBubble mode="listening" text="" stopped={false} shown t={t} onClose={noop} />)).not.toContain("okf-bubble-close");
  });
  it("has a visible focus style, a hover style stronger than the app's own, and is out of the tab order while the bubble is hidden", () => {
    expect(css).toMatch(/\.okf-bubble-close:focus-visible \{ outline: 2px solid #ffffff; outline-offset: 2px; \}/);
    expect(css).toMatch(/:root \.okf-bubble-close:hover \{[^}]*background:/);
    expect(renderToStaticMarkup(<AnswerBubble mode="idle" text="Done." stopped={false} shown={false} t={t} onClose={noop} />)).toContain('tabindex="-1"');
  });
  it("the stopped mark is in the bubble, under the words", () => {
    const html = renderToStaticMarkup(<AnswerBubble mode="idle" text="Half an answer." stopped shown t={t} onClose={noop} />);
    expect(html).toMatch(/<div class="okf-bubble-body"><div class="okf-text"[^>]*>.*<\/div><span class="okf-bubble-stopped">Stopped<\/span><\/div>/);
    expect(renderToStaticMarkup(<AnswerBubble mode="idle" text="" stopped shown t={t} onClose={noop} />)).toContain('<span class="okf-bubble-stopped">Stopped</span>');
  });
});

describe("an answer's bubble and the waveform", () => {
  it("an answer, an error or a stopped mark makes it an answer's bubble (it holds still for the pointer); listening does not", () => {
    expect(answerInBubble("speaking", "Text.", false)).toBe(true);
    expect(answerInBubble("thinking", "Half a", false)).toBe(true);
    expect(answerInBubble("idle", "", true)).toBe(true);
    expect(answerInBubble("listening", "dictated words", false)).toBe(false);
    expect(answerInBubble("thinking", "", false)).toBe(false);
    expect(renderToStaticMarkup(<AnswerBubble mode="speaking" text="Text." stopped={false} shown t={t} onClose={noop} />)).toContain('class="okf-bubble okf-bubble--answer"');
    expect(renderToStaticMarkup(<AnswerBubble mode="listening" text="" stopped={false} shown level={0.5} t={t} onClose={noop} />)).toContain('<div class="okf-bubble" role="group"');
  });
  it("hidden, error and the spinner as before", () => {
    expect(renderToStaticMarkup(<AnswerBubble mode="error" text="It failed." stopped={false} shown={false} t={t} onClose={noop} />)).toContain('class="okf-bubble okf-hidden okf-bubble--error okf-bubble--answer"');
    expect(renderToStaticMarkup(<AnswerBubble mode="thinking" text="" stopped={false} shown t={t} onClose={noop} />)).toContain('<span class="okf-spin" aria-hidden="true"></span>');
    expect(renderToStaticMarkup(<AnswerBubble mode="listening" text="" stopped={false} shown level={1} t={t} onClose={noop} />)).toContain('<span class="okf-wave" aria-hidden="true">');
  });
});

describe("the overlay page and the bubble", () => {
  it("the bubble is outside the part hidden from screen readers, and is the shared component", () => {
    const hidden = overlay.indexOf("aria-hidden onPointerDown");
    const hiddenEnd = overlay.indexOf("\n    </div>\n", hidden);
    const at = overlay.indexOf("<AnswerBubble ");
    expect(hidden).toBeGreaterThan(0);
    expect(at).toBeGreaterThan(hiddenEnd);
    expect(overlay).not.toContain("okf-text");
  });
  it("is shown on the screen with the pointer until main sends it away, and comes back with new words, a question or a stopped answer", () => {
    expect(overlay).toContain('const bubbleShown = here && !closed && Boolean(text || stopped || mode === "listening" || mode === "thinking");');
    expect(overlay).toMatch(/b\.onBubbleClose\?\.\(\(\) => \{\s*setClosed\(true\);/);
    expect(overlay).toMatch(/b\.onText\(\(next\) => \{\s*setText\(next\);\s*if \(next\) reopen\(\);/);
    expect(overlay).toContain('if (s.mode === "listening" || s.mode === "thinking" || s.stopped === true) reopen();');
    // the stopped pill goes with it
    expect(overlay).toContain("const view = pillView({ mode, purpose, stopped: stopped && !closed, pill });");
  });
  it("the close button goes to main, which closes the bubble on every screen", () => {
    expect(overlay).toContain("onClose={() => okFilowBridge()?.closeBubble?.()}");
  });
  it("takes the mouse while the pointer is on the bubble or a control of the pill, and tells main which", () => {
    expect(overlay).toContain("const onBubble = useCallback((p: { x: number; y: number } | null) => holds.current.answer && holds.current.shown && overBubble(p, bubble.current?.getBoundingClientRect() ?? null), []);");
    expect(overlay).toContain("const over = overB || onControl(p);");
    expect(overlay).toContain("okFilowBridge()?.overlayHover?.(over, overB);");
    // again whenever what is shown changes under a pointer that stands still
    expect(overlay).toMatch(/tellHover\(cursor\.current, true\);\s*\}, \[mode, going, here, sees, lang, stopped, pill, keys, text, closed, tellHover\]\);/);
  });
  it("places it clear of the pill, holds it still near the pointer, and keeps a held one on screen", () => {
    expect(overlay).toContain("const pillRect = pillSpot.current?.getBoundingClientRect() ?? null;");
    expect(overlay).toContain("const hold = h.answer && h.placed && (!grew || h.over) && bubbleSticks(cursor.current, { left: h.at.x, top: h.at.y, right: h.at.x + size.width, bottom: h.at.y + size.height });");
    expect(overlay).toContain("const grew = Math.abs(size.width - h.size.width) >= 1 || Math.abs(size.height - h.size.height) >= 1;");
    // and looks again whether the pointer is on it when it moved or grew
    expect(overlay).toContain("if (moved || grew) tellHover(cursor.current);");
    expect(overlay).toContain("const at = hold ? bubbleOnScreen(h.at, size, view, pillRect) : bubblePlacement(h.answer && c ? { x: c.x + OFFSET.x, y: c.y + OFFSET.y } : next, size, view, 18, pillRect);");
  });
  it("keeps the sentence being spoken in view, unless the pointer is on the bubble", () => {
    expect(overlay).toContain("b.onSpoken?.((n) => setSpoken(Number.isInteger(n) ? n : -1))");
    expect(overlay).toContain("if (!box || !el || holds.current.over) return;");
    expect(overlay).toContain("const top = followScroll({ top: el.offsetTop, height: el.offsetHeight }, { scrollTop: box.scrollTop, clientHeight: box.clientHeight, scrollHeight: box.scrollHeight });");
    expect(overlay).toContain('if (s.mode === "listening" || s.mode === "thinking") setSpoken(-1);');
  });
});

describe("the panel and the bubble", () => {
  it("tells the overlays which sentence the voice is on, counted in the text the bubble shows", () => {
    expect(panel).toContain("onSentence: (index) => okFilowBridge()?.spoken?.(spokenBase.current + index),");
    expect(panel).toMatch(/const speak = useCallback\(\(text: string, id: number, lang\?: string, base = 0\) => \{\s*spokenBase\.current = base;/);
    // a Resume says only the rest: its sentences are counted from where they are in the whole text
    expect(panel).toContain("await speak(info.left, id, info.lang, Math.max(0, splitSentences(plan.shown).length - splitSentences(info.left).length));");
  });
  it("a new question, spoken or typed, and a dictation replace the old words at once", () => {
    const listen = panel.slice(panel.indexOf("const startListening = useCallback("), panel.indexOf("// Recognizer and microphone start together"));
    expect(listen).toMatch(/if \(why !== "dictate"\) \{[\s\S]*?b\.text\(""\);[\s\S]*?\}\s*setMode\("listening", \{ purpose: why \}\);/);
    expect(listen).toMatch(/if \(why === "dictate"\) \{\s*const keys = [^\n]*\n\s*b\.text\(flow\.current \? dictT\("dictatingHandsFree", \{ keys \}\) : dictT\("dictating"\)\);/);
    const ask = panel.slice(panel.indexOf("const ask = useCallback("), panel.indexOf("// With \"Look at my screen\" off no picture"));
    expect(ask).toMatch(/setMode\("thinking", \{ sees: seeing \}\);\s*b\.text\(resume\?\.shown \?\? ""\);/);
  });
});
