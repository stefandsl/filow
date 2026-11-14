// Explicit opt-in, isolated real-model reliability measurement. No installed Filow or owner Ollama.
import { it, expect } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:net";
import sharp from "sharp";
import { askOllama, LOCAL_CONTEXT } from "../../apps/web/lib/buddy/providers";
import { buddySystemPrompt, parseBuddyAnswer, withScreenNote } from "../../apps/web/lib/buddy/prompt";
import { screenHint } from "../../apps/web/lib/buddy/ground";
import { withLocalDate } from "../../apps/desktop/prompt-date";

it.skipIf(process.env.FILOW_HARDENING_MEASURE !== "1")("measures 60 warm questions before and after", async () => {
  const root = "G:/FILOW/tmp/hardening";
  const base = "http://127.0.0.1:11435";
  const port = createServer();
  await new Promise<void>((resolve, reject) => { port.once("error", reject); port.listen(11435, "127.0.0.1", resolve); });
  await new Promise<void>(resolve => port.close(() => resolve()));
  const log = fs.openSync(`${root}/ollama.log`, "a");
  const child = spawn(path.join(process.env.LOCALAPPDATA!, "Programs/Ollama/ollama.exe"), ["serve"], {
    windowsHide: true, stdio: ["ignore", log, log], env: { ...process.env,
      OLLAMA_HOST: "127.0.0.1:11435", OLLAMA_MODELS: "G:/FILOW/tmp/latency/ollama-std", OLLAMA_NOPRUNE: "1",
      TEMP: root, TMP: root, CUDA_VISIBLE_DEVICES: "-1", HIP_VISIBLE_DEVICES: "-1", ROCR_VISIBLE_DEVICES: "-1", GGML_VK_VISIBLE_DEVICES: "-1", OLLAMA_LLM_LIBRARY: "cpu" },
  });
  const stop = () => { if (child.pid) { try { execFileSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, timeout: 10000, stdio: "ignore" }); } catch { /* already exited */ } } };
  const deadline = setTimeout(stop, 24 * 60_000);
  const nativeFetch = globalThis.fetch;
  const samples: unknown[] = [];
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { const r = await nativeFetch(`${base}/api/version`, { signal: AbortSignal.timeout(1000) }); if (r.ok) { ready = true; break; } } catch { /* starting */ }
      await new Promise(r => setTimeout(r, 500));
    }
    expect(ready).toBe(true);
    const screens = [{ index: 1, width: 1920, height: 1080 }];
    const questions = JSON.parse(fs.readFileSync("tools/eval/latency-questions.json", "utf8")).questions;
    for (const phase of ["before", "after"]) {
      for (let i = -1; i < 60; i++) {
        const n = Math.max(0, i) % 40 + 1;
        const stem = `G:/FILOW/tmp/latency/screens/${String(n).padStart(3, "0")}`;
        const image = (await sharp(`${stem}.png`).resize({ width: 512 }).jpeg({ quality: 72 }).toBuffer()).toString("base64");
        const q = questions[Math.max(0, i) % 5];
        const elements = JSON.parse(fs.readFileSync(`${stem}.json`, "utf8")).elements.filter((e: { name: string }) => e.name === q.element);
        const question = q.text + screenHint(elements, 1);
        const req = { question, images: [`data:image/jpeg;base64,${image}`], screens, language: "en" };
        let raw = "";
        const calls: unknown[] = [];
        globalThis.fetch = async (url, init) => {
          const response = await nativeFetch(url, init);
          if (String(url).endsWith("/api/chat")) {
            const copy = response.clone();
            calls.push(copy.text().then(text => ({ text })));
          }
          return response;
        };
        if (phase === "before") {
          const response = await fetch(`${base}/api/chat`, { method: "POST", signal: AbortSignal.timeout(180000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({
            model: "lfm3-vl", stream: true, think: false, keep_alive: "30m", options: { ...LOCAL_CONTEXT, temperature: 0.3, num_predict: 1500 },
            messages: [{ role: "system", content: withLocalDate(buddySystemPrompt(screens, "en", { pictures: true }), new Date()) },
              { role: "user", content: withScreenNote(question, true), images: [image] }],
          }) });
          for (const line of (await response.text()).trim().split("\n")) { const value = JSON.parse(line); raw += value.message?.content ?? ""; }
        } else {
          for await (const piece of askOllama(req, AbortSignal.timeout(360000), { model: "lfm3-vl", pictures: true, at: { base, headers: {}, server: null } })) raw += piece;
        }
        const parsed = parseBuddyAnswer(raw, screens);
        if (i >= 0) samples.push({ phase, i, question: q.text, screen: n, raw, words: parsed.text, marks: parsed.points.length + parsed.marks.length, calls: await Promise.all(calls) });
        fs.writeFileSync(`${root}/warm-samples.json`, JSON.stringify(samples, null, 2));
        console.log(`${phase} ${i + 1}/60`);
      }
    }
  } finally { globalThis.fetch = nativeFetch; clearTimeout(deadline); stop(); fs.closeSync(log); }
}, 25 * 60_000);
