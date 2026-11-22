const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const LESSON_URL = "http://127.0.0.1:48764/lesson/cloud-lab";

async function serveCloudLab(turn, signal) {
  signal.throwIfAborted();
  const instance = randomUUID();
  const page = fs.readFileSync(path.join(__dirname, "cloud-lab.html"), "utf8").replace("{{instance}}", instance);
  const url = new URL(LESSON_URL);
  const server = http.createServer((req, res) => {
    if (req.method !== "GET" || req.url !== url.pathname || req.headers.host !== url.host
        || req.headers.referer !== url.origin + "/filow-turn/" + turn) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "X-Filow-Instance": instance, "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'" }).end(page);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host:url.hostname, port:Number(url.port), exclusive:true }, resolve);
  });
  const close = () => { server.close(); server.closeAllConnections(); };
  if (signal.aborted) { close(); signal.throwIfAborted(); }
  signal.addEventListener("abort", close, { once:true });
  return { instance, close };
}
module.exports = { serveCloudLab, LESSON_URL };
