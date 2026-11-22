// Run locally alongside the packaged trial. This fixture serves an ordinary HTML document.
// Count top-level arrivals at the HTTP receiver independently of the desktop's navigation record.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function cloudLabServer({ temperature = 20, dew = 12, arrival = () => {} } = {}) {
  if (![temperature, dew].every(n => Number.isInteger(n) && n >= -40 && n <= 50)) throw Error("Invalid lesson temperature");
  const page = readFileSync(new URL("./n04-cloud-lab.html", import.meta.url), "utf8")
    .replaceAll("{{temperature}}", String(temperature)).replaceAll("{{dew}}", String(dew));
  let count = 0;
  return createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/lesson/cloud-lab") {
      response.writeHead(404).end();
      return;
    }
    if (request.headers["sec-fetch-dest"] === "document") {
      const match = /^http:\/\/127\.0\.0\.1:48764\/filow-turn\/([a-f0-9-]{36})$/.exec(request.headers.referer || "");
      response.once("finish", () => arrival({ count: ++count, turn: match?.[1] ?? null, at: new Date().toISOString() }));
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'" });
    response.end(page);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [temperature = "20", dew = "12"] = process.argv.slice(2);
  const server = cloudLabServer({ temperature: Number(temperature), dew: Number(dew), arrival: row => console.log(JSON.stringify(row)) });
  server.listen(48764, "127.0.0.1", () => console.log("Cloud Lab ready"));
}
