import { afterEach, expect, it, vi } from "vitest";
import { createBackend } from "./index";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("Web Speech listens in the spoken language passed for the take, not the browser UI language", async () => {
  vi.useFakeTimers();
  const recs: { lang: string }[] = [];
  vi.stubGlobal("window", { SpeechRecognition: function () { const r = { lang: "", start() {}, stop() {}, abort() {} }; recs.push(r); return r; } });
  vi.stubGlobal("navigator", { language: "en-US", userAgent: "Mozilla/5.0 Chrome/120" });
  const backend = createBackend("browser", { language: "it" });
  await backend.start({ onTranscript: vi.fn(), onError: vi.fn() });
  backend.stop();
  expect(recs).toHaveLength(1);
  expect(recs[0].lang).toMatch(/^it/i);
});
