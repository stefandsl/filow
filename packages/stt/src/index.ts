import type { SttBackendId, SttStatus } from "@intelliprompter/core";
import type { SttBackend, SttHandlers } from "./types";
import { BrowserStt } from "./browser";
import { ElevenLabsStt } from "./elevenlabs";
import { OpenAiStt } from "./openai";

export type { SttBackend, SttHandlers, TranscriptEvent } from "./types";
export { browserSupported } from "./browser";

export const BACKEND_LABELS: Record<SttBackendId, string> = {
  elevenlabs: "ElevenLabs Scribe v2",
  openai: "OpenAI gpt-live-transcribe",
  browser: "Browser (Web Speech)",
};

export type BackendOptions = {
  /** Origin of the Next.js API that mints tokens, e.g. "https://prompter.example.com". Default: same origin. */
  baseUrl?: string;
  /** Extra headers for the token requests (the engine token when ACCESS_PASSWORD is set). */
  headers?: Record<string, string>;
};

export function createBackend(id: SttBackendId, opts: BackendOptions = {}): SttBackend {
  const base = opts.baseUrl ?? "";
  const headers = opts.headers ?? {};
  switch (id) {
    case "elevenlabs":
      return new ElevenLabsStt(base, headers);
    case "openai":
      return new OpenAiStt(base, headers);
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
 * transcript within `probeMs`, stops it and tries the next one. An explicit
 * backend choice must NOT go through here: it never falls back silently.
 */
export async function startAuto(
  candidates: SttBackendId[],
  handlers: SttHandlers,
  onAttempt: (id: SttBackendId, note: string) => void,
  opts: BackendOptions & { probeMs?: number } = {},
): Promise<AutoResult> {
  const probeMs = opts.probeMs ?? 8000;
  let lastError = "no transcription backend available";
  for (const id of candidates) {
    const backend = createBackend(id, opts);
    const t0 = performance.now();
    onAttempt(id, "connecting");
    try {
      const firstWordMs = await new Promise<number>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
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
                clearTimeout(timer);
                reject(new Error(m));
              }
            },
            onTranscript: (e) => {
              if (!settled && (e.partial || e.committed)) {
                settled = true;
                clearTimeout(timer);
                resolve(performance.now() - t0);
              }
              handlers.onTranscript(e);
            },
          })
          .catch((err: Error) => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
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
