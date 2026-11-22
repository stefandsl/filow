import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";

const load = createRequire(import.meta.url);
const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");
let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

it("sweeps at startup before onboarding and again each day without opening the list", () => {
  vi.useFakeTimers();
  dir = mkdtempSync(join(tmpdir(), "daily-expiry-"));
  const day = 86400000;
  const journal = join(dir, "daily.json");
  writeFileSync(journal, JSON.stringify({ version: 1, seen: [], tasks: [30, 29].map(age => ({
    text: String(age), done: false, changed: Date.now() - age * day,
  })) }));
  const rows = () => JSON.parse(readFileSync(journal, "utf8")).tasks.map((row: { text: string }) => row.text);
  const lifecycle = load("./day-by-day-store").startDailyRetention(dir);
  try {
    expect(rows()).toEqual(["29"]);
    vi.advanceTimersByTime(day);
    expect(rows()).toEqual([]);
    expect(main).toMatch(/loadSettings\(\);[^}]+startDailyRetention\(userData[^}]+/);
    expect(main.indexOf("startDailyRetention(userData")).toBeLessThan(main.indexOf("await showWelcome()"));
  } finally { lifecycle.stop(); }
});

it("never sends a QA tag or version probe to the default Ollama port", async () => {
  const ai = load("./localai");
  const urls: string[] = [];
  const tags = async (url: string) => {
    urls.push(url);
    return { ok: true, json: async () => ({ models: [] }) };
  };
  for (const endpoint of [undefined, "http://localhost:11434", "http://127.0.0.1:11434", "http://example.org:51234"]) {
    vi.stubEnv("OLLAMA_URL", endpoint);
    expect(await ai.fetchOllamaTags(tags)).toBeNull();
    expect(urls).toEqual([]);
    expect(ai.ollamaProbeUrl()).toBeNull();
  }
  vi.stubEnv("OLLAMA_URL", "http://127.0.0.1:51234");
  await ai.fetchOllamaTags(tags);
  expect(urls).toEqual(["http://127.0.0.1:51234/api/tags"]);
  expect(main).toContain("fetchJson: () => localAi.fetchOllamaTags()");
});
