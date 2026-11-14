// AR-1 measurement worker. FIXED: part of the evaluator. Run only by evaluate.mjs through vitest.ar1.config.ts
// (vitest resolves the app's "@/" imports). It asks each item through the product path (askOllama, the same
// knownTarget rule as the ask route) and appends one raw JSON line per answer. Scoring happens in evaluate.mjs.
import { it } from "vitest";
import fs from "node:fs";
import sharp from "sharp";
import { isPhoneQuestionForModel } from "@filow/core";
import { askOllama } from "../../../apps/web/lib/buddy/providers";
import { screenHint } from "../../../apps/web/lib/buddy/ground";
import { parseBuddyAnswer } from "../../../apps/web/lib/buddy/prompt";
import { isSimpleLocatorQuestion } from "../../../apps/web/lib/buddy/local-target-prompt";

type Item = { id: number; screen: number; element: string; lang: string; text: string };

it("AR-1 asks the selected questions", async () => {
  const base = process.env.AR1_BASE!;
  const items: Item[] = JSON.parse(fs.readFileSync(process.env.AR1_ITEMS!, "utf8"));
  const out = process.env.AR1_OUT!;
  const screens = [{ index: 1, width: 1920, height: 1080 }];
  const images = new Map<number, string>();
  const image = async (n: number) => {
    if (!images.has(n)) images.set(n, (await sharp(`G:/FILOW/tmp/latency/screens/${String(n).padStart(3, "0")}.png`).resize({ width: 512 }).jpeg({ quality: 72 }).toBuffer()).toString("base64"));
    return images.get(n)!;
  };
  // The first item is asked once more at the start and discarded: it loads the model.
  for (const [k, item] of [items[0], ...items].entries()) {
    const stem = `G:/FILOW/tmp/latency/screens/${String(item.screen).padStart(3, "0")}`;
    const named = JSON.parse(fs.readFileSync(`${stem}.json`, "utf8")).elements.filter((e: { name: string }) => e.name === item.element);
    const req = {
      question: item.text + screenHint(named, 1), images: [`data:image/jpeg;base64,${await image(item.screen)}`], screens,
      language: item.lang, uiLanguage: item.lang, knownTarget: !isPhoneQuestionForModel(item.text) && isSimpleLocatorQuestion(item.text),
    };
    let output = ""; let firstTokenMs: number | null = null; let error: string | null = null;
    const started = performance.now();
    try {
      for await (const piece of askOllama(req, AbortSignal.timeout(180_000), { model: "lfm3-vl", pictures: true, at: { base, headers: {}, server: null } })) {
        if (piece && firstTokenMs === null) firstTokenMs = performance.now() - started;
        output += piece;
      }
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    if (k === 0) continue;
    // Only model-written text counts: the app's pointer-only words follow the [APP_WORDS:..] marker.
    const cut = output.indexOf("[APP_WORDS:");
    const parsed = parseBuddyAnswer(cut >= 0 ? output.slice(0, cut) : output, screens);
    const t = named[0];
    const strict = parsed.points.some(p => p.screen === 1 && p.x >= t.x1 && p.x <= t.x2 && p.y >= t.y1 && p.y <= t.y2);
    fs.appendFileSync(out, JSON.stringify({ ...item, knownTarget: req.knownTarget, target: t, firstTokenMs, totalMs: performance.now() - started,
      strict, words: parsed.text, appWords: cut >= 0, output, error }) + "\n");
  }
}, 30 * 60_000);
