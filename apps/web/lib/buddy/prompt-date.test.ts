import { afterEach, expect, it, vi } from "vitest";
import { withLocalDate } from "../../../desktop/prompt-date";
import { createRequire } from "node:module";
const { jobPrompt } = createRequire(import.meta.url)("../../../desktop/okfilow-agents.js");
import { buddySystemPrompt } from "./prompt";
import { askBuddy, buddyCloudRecipient } from "./providers";
import { consentKey, freellmRecipient } from "./outbound";
import { localJson } from "../whiteboard/local";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each([
  [new Date(2026, 10, 14, 12), "2026-11-14 (Saturday)"],
  [new Date(2024, 1, 29, 12), "2024-02-29 (Thursday)"],
  [new Date(2026, 11, 31, 23, 59, 59, 999), "2026-12-31 (Thursday)"],
  [new Date(2027, 0, 1, 0), "2027-01-01 (Friday)"],
])("uses the local calendar at %s", (date, expected) => {
  expect(withLocalDate("Unchanged prefix", date)).toBe(`Unchanged prefix\nToday's local date: ${expected}.`);
});

it("uses local fields even when UTC is a different date", () => {
  const date = new Date("2026-11-14T23:30:00Z");
  vi.spyOn(date, "getFullYear").mockReturnValue(2026);
  vi.spyOn(date, "getMonth").mockReturnValue(10);
  vi.spyOn(date, "getDate").mockReturnValue(15);
  vi.spyOn(date, "getDay").mockReturnValue(0);
  expect(withLocalDate("", date)).toBe("\nToday's local date: 2026-11-15 (Sunday).");
});

it.each(["en", "it", "ru", "ro", "ja", "auto"])("preserves %s language rules and static prefix", (language) => {
  for (const pictures of [false, true]) {
    const base = buddySystemPrompt([], language, { pictures, quoted: true });
    expect(withLocalDate(base, new Date(2026, 10, 14))).toBe(base + "\nToday's local date: 2026-11-14 (Saturday).");
  }
});

it("puts the agent date after instructions and before variable task context", () => {
  const prompt = jobPrompt("Write a note", "A blank page", new Date(2026, 10, 14));
  expect(prompt).toContain("Today's local date: 2026-11-14 (Saturday).\nWhat was on");
  expect(prompt).toContain("Task: Write a note");
});

it.each(["local", "cloud", "freellm"] as const)("dates both normal and whiteboard-shaped %s calls with no network", async (provider) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 14, 23, 59, 59));
  vi.stubEnv("FILOW_OFFLINE", "0");
  vi.stubEnv("OPENROUTER_API_KEY", "unit-test");
  vi.stubEnv("FREELLMAPI_API_KEY", "unit-test");
  vi.stubEnv("FREELLMAPI_BASE_URL", "http://127.0.0.1:4965");
  const systems: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const body = JSON.parse(init.body);
    systems.push(body.messages[0].content);
    return new Response(provider === "local" ? '{"message":{"content":"ok"},"done":true}\n' : 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
  }));
  const consent = provider === "cloud" ? consentKey("ask", buddyCloudRecipient()) : provider === "freellm" ? consentKey("ask", freellmRecipient()) : undefined;
  for (const system of [undefined, "Write a lesson in Italian."]) {
    for await (const chunk of askBuddy(provider, { question: "Today?", images: [], screens: [], language: "it", consent }, undefined, { model: "qa", pictures: false }, system ? { system } : undefined)) expect(chunk).toBe("ok");
    vi.setSystemTime(new Date(2026, 10, 15));
  }
  expect(systems[0]).toContain("Answer in Italian.");
  expect(systems[0]).toMatch(/2026-11-14 \(Saturday\)\.$/);
  expect(systems[1]).toBe("Write a lesson in Italian.\nToday's local date: 2026-11-15 (Sunday).");
});

it("dates local board look/edit instructions", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 14));
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    expect(JSON.parse(init.body).messages[0].content).toBe("Inspect the board.\nToday's local date: 2026-11-14 (Saturday).");
    return Response.json({ message: { content: "{}" } });
  }));
  await localJson("qa", "Inspect the board.", "q", {}, { timeoutMs: 1000 });
});
// Version rejection is covered with real HTTP fakes in ollama-runtime.test.ts.
vi.mock("@/../desktop/ollama-runtime", async (original) => ({ ...await original<object>(), checkRuntime: async () => ({ state: "ready" }) }));
