// A stand-in for FreeLLMAPI (github.com/tashfeenahmed/freellmapi) in tests and packaged checks: an
// OpenAI-compatible server on 127.0.0.1 with one unified key, the router's replies and its error
// replies. No provider is ever called. It records every request (path, whether the key was right,
// whether a picture came along) so a check can count what reached the "router".
//
// CLI: node tools/autoloop/e2e/fake-freellm.mjs --port 3999 --key fake-unified-key [--mode ok]
//   prints "fake-freellm ready http://127.0.0.1:<port>/v1"; POST /__mode {"mode":"quota"} switches
//   the reply, GET /__log returns the recorded requests.
import http from "node:http";
import { pathToFileURL } from "node:url";

/** ok: answers. quota: 429 quota_exceeded. no_vision: 422 no_vision_model when a picture comes. bad_model: 400. broken: 500. */
export const FAKE_MODES = ["ok", "quota", "no_vision", "bad_model", "broken"];

/** The fake answer: OK Filow's format (a short spoken answer), also valid for the JSON callers. */
export const FAKE_ANSWER = "The fake router answered.";

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => { raw += c; if (raw.length > 20_000_000) req.destroy(); });
    req.on("end", () => resolve(raw));
    req.on("error", () => resolve(raw));
  });
}

/** The parsed body, or null when it is empty or not JSON. */
function parseJson(raw) {
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}

const hasImage = (body) => Array.isArray(body?.messages) && body.messages.some((m) => Array.isArray(m?.content) && m.content.some((p) => p?.type === "image_url"));

/** What the fake answers for a chat request, by its mode and the request's own content. */
function answerFor(body) {
  const system = Array.isArray(body?.messages) ? String(body.messages.find((m) => m.role === "system")?.content ?? "") : "";
  // JSON callers (decisions, slides) get JSON; translation gets the outline back; OK Filow gets text.
  if (/json/i.test(system) && /bullet|point/i.test(system) && /decid|scroll|mention/i.test(system)) return JSON.stringify({ decisions: [], unmentioned: [] });
  if (/translate/i.test(system)) return String(body.messages.find((m) => m.role === "user")?.content ?? "");
  if (/slide/i.test(system) && /json/i.test(system)) return JSON.stringify({ title: "Fake slide", points: ["A point from the fake router"] });
  return FAKE_ANSWER;
}

/**
 * Starts the fake on 127.0.0.1 (port 0 = any free port). `delayMs` holds each chat answer back.
 * @returns {Promise<{ url: string, port: number, log: Array<Record<string, unknown>>, setMode(m: string): void, close(): Promise<void> }>}
 */
export function startFakeFreeLlm({ port = 0, key = "fake-unified-key", mode = "ok", delayMs = 0 } = {}) {
  const state = { mode };
  const log = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const send = (status, json, extra = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...extra });
      res.end(JSON.stringify(json));
    };
    if (url.pathname === "/__mode" && req.method === "POST") {
      const wanted = parseJson(await readBody(req))?.mode;
      if (FAKE_MODES.includes(wanted)) state.mode = wanted;
      return send(200, { mode: state.mode });
    }
    if (url.pathname === "/__log") return send(200, log);
    const body = parseJson(await readBody(req));
    const keyOk = req.headers.authorization === `Bearer ${key}`;
    const entry = { at: Date.now(), method: req.method, path: url.pathname, keyOk, model: body?.model ?? null, stream: body?.stream === true, image: hasImage(body), mode: state.mode };
    log.push(entry);
    if (!keyOk) return send(401, { error: { message: "Invalid API key", type: "invalid_request_error", code: "invalid_api_key" } });
    if (url.pathname === "/v1/models" && req.method === "GET") {
      return send(200, { object: "list", data: [
        { id: "auto", object: "model" }, { id: "auto:fast", object: "model" }, { id: "auto:smart", object: "model" },
        { id: "gemini-2.5-flash", object: "model", execution_status: "ready" },
        { id: "llama-3.3-70b", object: "model", execution_status: state.mode === "quota" ? "exhausted" : "ready" },
        { id: "gpt-4.1", object: "model", execution_status: "needsKey" },
      ] });
    }
    if (url.pathname !== "/v1/chat/completions" || req.method !== "POST") return send(404, { error: { message: "Not found", code: "not_found" } });
    // a real router takes a moment (it may try several providers): long enough to see the signal
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    if (state.mode === "quota") return send(429, { error: { message: "All free-tier quotas are used up", type: "rate_limit_error", code: "quota_exceeded" } }, { "Retry-After": "3600" });
    if (state.mode === "no_vision" && entry.image) return send(422, { error: { message: "No vision-capable model is enabled", code: "no_vision_model" } });
    if (state.mode === "bad_model") return send(400, { error: { message: `Unknown profile or model: ${body?.model}`, code: "model_not_found" } });
    if (state.mode === "broken") return send(500, { error: { message: "upstream exploded", code: "internal_error" } });
    const content = answerFor(body);
    const routed = { "X-Routed-Via": "fakeprovider/fake-model-1" };
    if (body?.stream) {
      res.writeHead(200, { "Content-Type": "text/event-stream", ...routed });
      const pieces = content.match(/.{1,8}/gs) ?? [content];
      for (const p of pieces) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
      res.end("data: [DONE]\n\n");
      return;
    }
    return send(200, { id: "fake-1", object: "chat.completion", model: body?.model ?? "auto", choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }, routed);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const p = server.address().port;
      resolve({
        url: `http://127.0.0.1:${p}/v1`,
        port: p,
        log,
        setMode: (m) => { if (FAKE_MODES.includes(m)) state.mode = m; },
        close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }),
      });
    });
  });
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const arg = (name, def) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : def;
  };
  const fake = await startFakeFreeLlm({ port: Number(arg("port", "3999")), key: arg("key", "fake-unified-key"), mode: arg("mode", "ok") });
  console.log(`fake-freellm ready ${fake.url}`);
}
