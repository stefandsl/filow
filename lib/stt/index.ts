import type { SttBackendId, SttStatus } from "@/lib/types";
import type { SttBackend, SttHandlers } from "./types";
import { BrowserStt } from "./browser";
import { ElevenLabsStt } from "./elevenlabs";
import { OpenAiStt } from "./openai";

export type { SttBackend, SttHandlers, TranscriptEvent } from "./types";

export const BACKEND_LABELS: Record<SttBackendId, string> = {
  elevenlabs: "ElevenLabs Scribe v2",
  openai: "OpenAI gpt-live-transcribe",
  browser: "Browser (Web Speech)",
};

export function createBackend(id: SttBackendId): SttBackend {
  switch (id) {
    case "elevenlabs":
      return new ElevenLabsStt();
    case "openai":
      return new OpenAiStt();
    case "browser":
      return new BrowserStt();
  }
}

/** Backends that can run right now, best first. */
export function availableBackends(status: SttStatus, webSpeech: boolean): SttBackendId[] {
  const out: SttBackendId[] = [];
  if (status.elevenlabs) out.push("elevenlabs");
  if (status.openai) out.push("openai");
  if (webSpeech) out.push("browser");
  return out;
}

export type AutoResult = {
  backend: SttBackend;
  /** Milliseconds from start() to the first transcript event. */
  firstWordMs: number;
};

/**
 * "Auto" mode: starts the best available backend; if it errors or produces no
 * transcript within `probeMs`, stops it and tries the next one. Measures time
 * to first transcript so the UI can show which backend was actually fastest.
 */
export async function startAuto(
  candidates: SttBackendId[],
  handlers: SttHandlers,
  onAttempt: (id: SttBackendId, note: string) => void,
  probeMs = 8000,
): Promise<AutoResult> {
  let lastError = "no transcription backend available";
  for (const id of candidates) {
    const backend = createBackend(id);
    const t0 = performance.now();
    onAttempt(id, "connecting");
    try {
      const firstWordMs = await new Promise<number>((resolve, reject) => {
        let settled = false;
        const timer = window.setTimeout(() => {
          if (!settled) {
            settled = true;
            reject(new Error(`no transcript within ${probeMs / 1000}s`));
          }
        }, probeMs);
        void backend
          .start({
            onReady: handlers.onReady,
            onError: (m) => {
              handlers.onError(m);
              if (!settled) {
                settled = true;
                window.clearTimeout(timer);
                reject(new Error(m));
              }
            },
            onTranscript: (e) => {
              if (!settled && (e.partial || e.committed)) {
                settled = true;
                window.clearTimeout(timer);
                resolve(performance.now() - t0);
              }
              handlers.onTranscript(e);
            },
          })
          .catch((err: Error) => {
            if (!settled) {
              settled = true;
              window.clearTimeout(timer);
              reject(err);
            }
          });
      });
      onAttempt(id, `live, first words in ${Math.round(firstWordMs)} ms`);
      return { backend, firstWordMs };
    } catch (err) {
      lastError = (err as Error).message;
      onAttempt(id, `skipped: ${lastError}`);
      backend.stop();
    }
  }
  throw new Error(lastError);
}
