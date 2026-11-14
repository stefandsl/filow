// Explicit opt-in, isolated real-model reliability measurement. No installed Filow or owner Ollama.
import { it, expect } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "node:net";
import sharp from "sharp";
import { askOllama, LOCAL_CONTEXT } from "../../apps/web/lib/buddy/providers";
import { parseBuddyAnswer } from "../../apps/web/lib/buddy/prompt";
import { screenHint } from "../../apps/web/lib/buddy/ground";
import { variantPrompt, variantQuestion } from "./hardening-prompt-variants";

it.skipIf(process.env.FILOW_HARDENING_MEASURE !== "1")("compares local prompt variants and revised answers", async () => {
  const root = "G:/FILOW/tmp/hardening";
  const base = "http://127.0.0.1:11435";
  const selected = process.env.FILOW_HARDENING_PHASE;
  const phases = ["baseline", "sentence-last", "examples-date-first", "user-last", "user-last-exact", "compact-exact", "after"];
  if (selected && !phases.includes(selected)) throw Error("Unknown measurement phase");
  const samples: Array<{phase: string; [key: string]: unknown}> = selected && fs.existsSync(`${root}/rework-samples.json`) ? JSON.parse(fs.readFileSync(`${root}/rework-samples.json`, "utf8")).filter((row: {phase:string})=>row.phase !== selected) : [];
  const port = createServer();
  await new Promise<void>((resolve, reject) => { port.once("error", reject); port.listen(11435, "127.0.0.1", resolve); });
  await new Promise<void>(resolve => port.close(() => resolve()));
  const log = fs.openSync(`${root}/ollama.log`, "a");
  const child = spawn(path.join(process.env.LOCALAPPDATA!, "Programs/Ollama/ollama.exe"), ["serve"], {
    windowsHide: true, stdio: ["ignore", log, log], env: { ...process.env,
      OLLAMA_HOST: "127.0.0.1:11435", OLLAMA_MODELS: "G:/FILOW/tmp/latency/ollama-std", OLLAMA_NOPRUNE: "1",
      USERPROFILE: root, APPDATA: root, LOCALAPPDATA: root, TEMP: root, TMP: root, CUDA_VISIBLE_DEVICES: "-1", HIP_VISIBLE_DEVICES: "-1", ROCR_VISIBLE_DEVICES: "-1", GGML_VK_VISIBLE_DEVICES: "-1", OLLAMA_LLM_LIBRARY: "cpu" },
  });
  const stop = () => { if (child.pid) { try { execFileSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, timeout: 10000, stdio: "ignore" }); } catch { /* already exited */ } } };
  const deadline = setTimeout(stop, 75 * 60_000);
  const nativeFetch = globalThis.fetch;
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { const r = await nativeFetch(`${base}/api/version`, { signal: AbortSignal.timeout(1000) }); if (r.ok) { ready = true; break; } } catch { /* starting */ }
      await new Promise(r => setTimeout(r, 500));
    }
    expect(ready).toBe(true);
    const screens = [{ index: 1, width: 1920, height: 1080 }];
    const questions = JSON.parse(fs.readFileSync("tools/eval/latency-questions.json", "utf8")).questions;
    for (const phase of phases.filter(phase => !selected || selected === phase)) {
      for (let i = -1; i < (phase === "after" ? 60 : 100); i++) {
        const n = (i >= 60 ? i - 60 : Math.max(0, i)) % 40 + 1;
        const stem = `G:/FILOW/tmp/latency/screens/${String(n).padStart(3, "0")}`;
        const image = (await sharp(`${stem}.png`).resize({ width: 512 }).jpeg({ quality: 72 }).toBuffer()).toString("base64");
        const q = questions[(i >= 60 ? i - 60 : Math.max(0, i)) % 5];
        const elements = JSON.parse(fs.readFileSync(`${stem}.json`, "utf8")).elements.filter((e: { name: string }) => e.name === q.element);
        const question = q.text + screenHint(elements, 1);
        const req = { question, images: [`data:image/jpeg;base64,${image}`], screens, language: "en", knownTarget: true };
        let raw = "";
        let firstTokenMs: number | null = null; const started = performance.now();
        const calls: unknown[] = [];
        globalThis.fetch = async (url, init) => {
          const response = await nativeFetch(url, init);
          if (String(url).endsWith("/api/chat")) {
            const copy = response.clone();
            calls.push(copy.text().then(text => ({ text })));
          }
          return response;
        };
        if (phase !== "after") {
          const response = await fetch(`${base}/api/chat`, { method: "POST", signal: AbortSignal.timeout(180000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({
            model: "lfm3-vl", stream: true, think: false, keep_alive: "30m", options: { ...LOCAL_CONTEXT, temperature: 0.3, num_predict: 1500 },
            messages: [{ role: "system", content: variantPrompt(phase, screens) },
              { role: "user", content: variantQuestion(phase, question), images: [image] }],
          }) });
          expect(response.ok).toBe(true);
          const reader = response.body!.getReader(); const decoder = new TextDecoder(); let pending = "";
          try { for (;;) { const { value, done } = await reader.read(); if (done) break; pending += decoder.decode(value, {stream:true}); let end: number; while ((end = pending.indexOf("\n")) >= 0) { const line = pending.slice(0,end); pending = pending.slice(end+1); if (!line.trim()) continue; const value = JSON.parse(line); if (value.message?.content && firstTokenMs === null) firstTokenMs = performance.now()-started; raw += value.message?.content ?? ""; } } } finally { reader.releaseLock(); }
        } else {
          for await (const piece of askOllama(req, AbortSignal.timeout(360000), { model: "lfm3-vl", pictures: true, at: { base, headers: {}, server: null } })) {
            if (piece && firstTokenMs === null) firstTokenMs = performance.now()-started;
            raw += piece;
          }
        }
        const parsed = parseBuddyAnswer(raw, screens);
        const target = elements[0];
        const strict = parsed.points.some(p => p.screen === 1 && p.x >= target.x1 && p.x <= target.x2 && p.y >= target.y1 && p.y <= target.y2);
        if (i >= 0) samples.push({ phase, i, cohort: i < 60 ? "warm" : "pointing", firstTokenMs, strict, question: q.text, screen: n, raw, words: parsed.text, marks: parsed.points.length + parsed.marks.length, calls: await Promise.all(calls) });
        fs.writeFileSync(`${root}/rework-samples.json`, JSON.stringify(samples, null, 2));
        console.log(`${phase} ${i + 1}/${phase === "after" ? 60 : 100}`);
      }
    }
  } finally { globalThis.fetch = nativeFetch; clearTimeout(deadline); stop(); fs.closeSync(log); }
}, 76 * 60_000);
