// OK Filow, "Answers from: Local": time to the first word and to the whole answer for a short question
// about a screenshot, with the request askOllama (apps/web/lib/buddy/providers.ts) sends. A different
// image every run, as a new screenshot would be (the same image twice lets Ollama reuse its cached
// prompt and hides the picture-reading cost). Used for the P3 setup profiles (docs/gauntlet/BASELINE.md).
//   npx tsx scripts/bench/okfilow-local.mts <model> <gpu|cpu|cpu4|cpu8> <image|text> <dir of .jpg> [runs]
// "cpu" pins the model to the CPU (num_gpu 0) with Ollama's default threads; cpu4 / cpu8 also set the
// thread count. "text" sends no picture and puts the slide's text in the question. Talks only to the
// local Ollama at 127.0.0.1:11434. Images: scripts/bench/slide.ps1 makes 1024 x 576 test slides.
import fs from "node:fs";
import path from "node:path";
import { buddySystemPrompt } from "../../apps/web/lib/buddy/prompt";

// a copy of noThinkPrefill in apps/web/lib/buddy/providers.ts, which imports "@/" paths tsx cannot resolve
const noThinkPrefill = (m: string) => (m.startsWith("qwen3-vl") ? [{ role: "assistant", content: "<think>\n\n</think>\n\n" }] : []);

const [model, where = "gpu", mode = "image", dir = ".", runsArg = "3"] = process.argv.slice(2);
if (!model) {
  console.log("usage: npx tsx scripts/bench/okfilow-local.mts <model> <gpu|cpu|cpu4|cpu8> <image|text> <dir of .jpg> [runs]");
  process.exit(1);
}
const runs = Number(runsArg);
const images = fs.readdirSync(dir).filter((f) => f.endsWith(".jpg")).sort().map((f) => fs.readFileSync(path.join(dir, f)).toString("base64"));
if (mode === "image" && images.length < runs + 1) throw new Error(`need ${runs + 1} different images in ${dir}`);
const slideText = "Quarter results Q3. Support costs fell 30% this quarter. Churn dropped to 4%. Net promoter score: 62 (was 55). We hired 3 engineers. Chart: Support cost per ticket (EUR), Q1 42, Q2 38, Q3 31, Q4 29.";
const question = mode === "image" ? "What does the chart on my screen show? One sentence." : `What does the chart on my screen show? One sentence.\n(Text on my screen: "${slideText}")`;
const screens = [{ index: 1, width: 1024, height: 576, cursor: true }];
const WHERE: Record<string, object> = { gpu: {}, cpu: { num_gpu: 0 }, cpu4: { num_gpu: 0, num_thread: 4 }, cpu8: { num_gpu: 0, num_thread: 8 } };
const options = { temperature: 0.3, num_ctx: 8192, num_predict: 1500, ...WHERE[where] };

const rows: Array<{ ttft: number; total: number; tokens: number }> = [];
for (let i = 0; i < runs + 1; i++) {
  const t0 = performance.now();
  const res = await fetch("http://127.0.0.1:11434/api/chat", {
    method: "POST",
    body: JSON.stringify({
      model, stream: true, think: false, keep_alive: "10m", options,
      messages: [
        { role: "system", content: buddySystemPrompt(screens, "en") },
        { role: "user", content: question, ...(mode === "image" ? { images: [images[i]] } : {}) },
        ...noThinkPrefill(model),
      ],
    }),
  });
  if (!res.ok || !res.body) throw new Error(`${res.status} ${await res.text()}`);
  let ttft = 0;
  let text = "";
  let buf = "";
  let tokens = 0;
  const dec = new TextDecoder();
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const j = JSON.parse(line) as { message?: { content?: string }; done?: boolean; eval_count?: number; error?: string };
      if (j.error) throw new Error(j.error);
      if (!ttft && j.message?.content?.trim()) ttft = performance.now() - t0;
      text += j.message?.content ?? "";
      if (j.done) tokens = j.eval_count ?? 0;
    }
  }
  const total = performance.now() - t0;
  if (i === 0) console.log(`cold (model load included): first word ${Math.round(ttft)} ms, whole ${Math.round(total)} ms`);
  else rows.push({ ttft: Math.round(ttft), total: Math.round(total), tokens });
  if (i === runs) console.log("answer:", text.replace(/\s+/g, " ").slice(0, 300));
}
const med = (k: "ttft" | "total") => rows.map((r) => r[k]).sort((a, b) => a - b)[Math.floor(rows.length / 2)];
console.log(`${model} ${where} ${mode}: warm first word median ${med("ttft")} ms, whole answer median ${med("total")} ms, runs ${JSON.stringify(rows)}`);
