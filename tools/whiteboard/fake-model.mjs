#!/usr/bin/env node
// A fake model server for whiteboard tests: answers as Ollama (/api/tags, /api/chat, /api/generate)
// and as OpenRouter (/v1/chat/completions) with fixed lessons, so end-to-end checks never make a
// paid or cloud call and always see the same board. It records what it was sent (GET /__seen), so
// a test can prove what did and did not leave for the "cloud".
//
// Usage: node tools/whiteboard/fake-model.mjs [port]      (default 4812)
// Point Filow at it: OLLAMA_URL=http://127.0.0.1:4812  OPENROUTER_BASE_URL=http://127.0.0.1:4812/v1
// Lessons by topic: a question that contains "broken" gets a step of invalid JSON (a text card);
// as OpenRouter, a question that names Krebs comes back as a lesson about "[PERSON_NAME]" (an account that redacts names);
// anything else gets the full lesson (boxes, arrows, a formula, a plot, a note, a mark).
import http from "node:http";

const STEPS = [
  { say: "A leaf takes in sunlight, water and carbon dioxide.", items: [{ kind: "node", id: "sun", text: "Sunlight" }, { kind: "node", id: "water", text: "Water" }, { kind: "node", id: "co2", text: "Carbon dioxide" }, { kind: "node", id: "leaf", text: "Leaf" }, { kind: "edge", from: "sun", to: "leaf", text: "energy" }, { kind: "edge", from: "water", to: "leaf" }] },
  { say: "Inside the leaf, chlorophyll uses the light to build sugar.", items: [{ kind: "edge", from: "co2", to: "leaf" }, { kind: "node", id: "sugar", text: "Glucose" }, { kind: "edge", from: "leaf", to: "sugar", text: "makes" }, { kind: "formula", tex: "6CO_2 + 6H_2O \\rightarrow C_6H_{12}O_6 + 6O_2" }] },
  { say: "Oxygen is released, and more light means more sugar up to a limit.", items: [{ kind: "node", id: "o2", text: "Oxygen" }, { kind: "edge", from: "leaf", to: "o2", text: "released" }, { kind: "plot", expr: "x / (1 + x)", xmin: 0, xmax: 8 }, { kind: "note", text: "The curve flattens: light is no longer the limit." }] },
  { say: "So the leaf is where light becomes food.", items: [{ kind: "mark", target: "leaf", style: "circle" }, { kind: "mark", target: "sugar", style: "underline" }] },
];
// The local path asks for a drawing plan, a fact check of its relations, then a pick per step.
const PLAN = {
  things: [{ id: "sun", text: "Sunlight" }, { id: "water", text: "Water" }, { id: "co2", text: "Carbon dioxide" }, { id: "leaf", text: "Leaf" }, { id: "sugar", text: "Glucose" }, { id: "o2", text: "Oxygen" }],
  relations: [{ from: "sun", verb: "energy", to: "leaf" }, { from: "water", verb: "enters", to: "leaf" }, { from: "co2", verb: "enters", to: "leaf" }, { from: "leaf", verb: "makes", to: "sugar" }, { from: "leaf", verb: "releases", to: "o2" }],
};
const MORE_PLAN = { things: [{ id: "chl", text: "Chlorophyll" }], relations: [{ from: "chl", verb: "sits in", to: "leaf" }] };
const PICKS = [
  { things: ["sun", "water", "co2"], relations: ["1", "2"], formula: "", plot: "", note: "" },
  { things: ["sugar"], relations: ["4"], formula: "6CO_2 + 6H_2O \\rightarrow C_6H_{12}O_6 + 6O_2", plot: "", note: "" },
  { things: ["o2"], relations: ["5"], formula: "", plot: "x / (1 + x)", note: "The curve flattens: light is no longer the limit." },
  { things: ["leaf"], relations: [], formula: "", plot: "", note: "" },
];
const outlineFor = (broken) => ({ title: broken ? "Broken lesson" : "Photosynthesis", scene: "flow", kind: "process", steps: STEPS.map((s) => ({ say: s.say })) });
const CLOUD = {
  topic: "Ohm's law: the current through a resistance is the voltage across it divided by the resistance.",
  title: "Ohm's law",
  scene: "flow",
  steps: [
    { say: "Voltage pushes a current through a resistance.", items: [{ kind: "node", id: "v", text: "Voltage" }, { kind: "node", id: "i", text: "Current" }, { kind: "node", id: "r", text: "Resistance" }, { kind: "edge", from: "v", to: "i", text: "pushes" }, { kind: "edge", from: "r", to: "i", text: "limits" }] },
    { say: "One formula ties the three together.", items: [{ kind: "formula", tex: "V = I R" }, { kind: "plot", expr: "2x", xmin: 0, xmax: 5 }, { kind: "sketch", title: "Resistor", shapes: [{ type: "line", x1: 40, y1: 150, x2: 120, y2: 150, stroke: "#333333", width: 4 }, { type: "rect", x: 120, y: 120, w: 160, h: 60, fill: "#e7c98a", stroke: "#333333", width: 4 }, { type: "line", x1: 280, y1: 150, x2: 360, y2: 150, stroke: "#333333", width: 4 }] }] },
    { say: "Double the voltage and the current doubles.", items: [{ kind: "mark", target: "i", style: "highlight" }, { kind: "note", text: "The resistance stays the same." }, { kind: "cells", values: ["V = 12 V", "I = 2 A", "R = 6 ohm"], pointer: 0 }] },
  ],
};

/** Starts the server; resolves with what a test needs to read and stop it. */
export function startFakeModel(port = 4812) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* not JSON */ }
      const url = req.url || "";
      if (url === "/__seen") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(seen));
      }
      const lastUser = (body.messages ?? []).filter((m) => m.role === "user").pop()?.content;
      seen.push({ url, at: Date.now(), hasImage: /"image_url"|"images":\s*\["/.test(raw), user: (typeof lastUser === "string" ? lastUser : JSON.stringify(lastUser ?? "")).slice(0, 400) });
      if (url.startsWith("/api/tags")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ models: [{ name: "fake-local" }] }));
      }
      if (url.startsWith("/api/generate")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ done: true }));
      }
      if (url.startsWith("/api/chat")) {
        const user = String((body.messages ?? []).filter((m) => m.role === "user").pop()?.content ?? "");
        const system = String((body.messages ?? [])[0]?.content ?? "");
        let answer;
        if (system.includes("planning a short whiteboard lesson")) answer = JSON.stringify(outlineFor(/broken/i.test(user)));
        else if (system.includes("strict examiner")) answer = JSON.stringify({ sentences: (user.match(/^\d+\. /gm) ?? []).map((_, i) => ({ n: i + 1, true: true })), answers: true });
        else if (system.includes("prepare the drawing")) answer = JSON.stringify(user.includes("Already on the board") ? MORE_PLAN : PLAN);
        else if (system.includes("A fact checker went through")) answer = JSON.stringify({ relations: [] });
        else if (system.includes("check facts")) answer = JSON.stringify({ answers: (user.match(/^\d+\. /gm) ?? []).map((_, i) => ({ n: i + 1, true: true })) });
        else {
          const n = STEPS.findIndex((s) => user.includes(`Sentence of this step: "${s.say}"`)) + 1 || 1;
          const broken = user.includes("Lesson: Broken lesson") && n === 2;
          answer = broken ? "Sure! Here is the drawing you asked for: {things: oops" : JSON.stringify(PICKS[n - 1]);
        }
        res.writeHead(200, { "Content-Type": "application/x-ndjson" });
        const half = Math.ceil(answer.length / 2);
        res.write(JSON.stringify({ message: { content: answer.slice(0, half) } }) + "\n");
        // a little time between the pieces, as a real model has
        return setTimeout(() => res.end(JSON.stringify({ message: { content: answer.slice(half) }, done: true }) + "\n"), 150);
      }
      if (url.endsWith("/chat/completions")) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const messages = body.messages ?? [];
        const text = (m) => (typeof m?.content === "string" ? m.content : (m?.content ?? []).map((p) => p.text ?? "").join(""));
        // the examiner call of the online path: every sentence true, every arrow right as drawn
        const asked = text(messages[messages.length - 1]);
        const reviewing = text(messages[0]).includes("strict examiner of a whiteboard lesson");
        const count = (from, to) => (asked.slice(asked.indexOf(from), to ? asked.indexOf(to) : undefined).match(/^\d+\. /gm) ?? []).length;
        // the arrow call: one sentence a line, each judged true
        const judging = text(messages[0]).includes("one line at a time");
        const answer = reviewing
          ? { topic: true, answers: true, issues: "", must: "current", sentences: Array.from({ length: count("Sentences:", "Boxes:") }, (_, i) => ({ n: i + 1, true: true })) }
          : judging
            ? { arrows: (asked.match(/^\d+\. /gm) ?? []).map((_, i) => ({ n: i + 1, verdict: "true" })) }
            : text(messages[0]).includes("leaves some things unnamed")
              ? // the legend: the letters of the formula and the axes of the plot, named
                { symbols: [{ symbol: "V", means: "voltage" }, { symbol: "I", means: "current" }, { symbol: "R", means: "resistance" }], axes: [{ plot: 1, x: "Current (A)", y: "Voltage (V)" }] }
            : /K r e b s/.test(asked)
              ? // the same account, asked again with the name spelled out: the filter lets it through and the model can answer
                { ...CLOUD, topic: "The K r e b s cycle is a loop of reactions in the cell.", title: "The K r e b s cycle" }
            : /Krebs|H ?o ?d ?g ?k ?i ?n/.test(asked)
              ? // a provider that hides names before the model sees them: the model answers about a placeholder
                { ...CLOUD, topic: "The [PERSON_NAME] cycle is a cycle.", title: "The [PERSON_NAME] cycle" }
              : CLOUD;
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(answer) } }] })}\n\n`);
        return setTimeout(() => res.end("data: [DONE]\n\n"), 600);
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "the fake model does not serve this path" }));
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ port, seen, stop: () => new Promise((r) => server.close(() => r())) }));
  });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const fake = await startFakeModel(Number(process.argv[2] || 4812));
  console.log(`fake model on http://127.0.0.1:${fake.port}`);
}
