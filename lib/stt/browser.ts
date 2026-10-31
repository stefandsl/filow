import type { SttBackend, SttHandlers } from "./types";

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

function getCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as (new () => SpeechRecognitionLike) | null;
}

/** Electron ships Chromium without Google's speech key, so Web Speech never works there. */
export const browserSupported = () =>
  getCtor() !== null && !/Electron\//.test(navigator.userAgent);

/** Free, keyless. Chrome and Edge only. Restarts itself when the browser ends a session. */
export class BrowserStt implements SttBackend {
  readonly id = "browser" as const;
  readonly label = "Browser (Web Speech)";
  private rec: SpeechRecognitionLike | null = null;
  private running = false;

  async start(h: SttHandlers) {
    const Ctor = getCtor();
    if (!Ctor) throw new Error("Web Speech API is not available in this browser. Use Chrome or Edge.");
    this.running = true;
    let ready = false;

    const spin = () => {
      if (!this.running) return;
      const rec = new Ctor();
      this.rec = rec;
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || "en-US";
      rec.onresult = (ev) => {
        if (!ready) {
          ready = true;
          h.onReady?.();
        }
        let partial = "";
        let committed = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) committed += r[0].transcript + " ";
          else partial += r[0].transcript;
        }
        h.onTranscript({ committed: committed || undefined, partial });
      };
      rec.onerror = (ev) => {
        if (ev.error === "no-speech" || ev.error === "aborted") return;
        h.onError(`Web Speech: ${ev.error}`);
        if (ev.error === "not-allowed" || ev.error === "service-not-allowed") this.running = false;
      };
      rec.onend = () => {
        // Chrome stops after silence or ~60 s; keep it going.
        if (this.running) setTimeout(spin, 150);
      };
      rec.start();
    };
    spin();
    // The API has no "connected" event, so treat start as ready after a short grace.
    setTimeout(() => {
      if (!ready && this.running) {
        ready = true;
        h.onReady?.();
      }
    }, 800);
  }

  stop() {
    this.running = false;
    try {
      this.rec?.abort();
    } catch {
      /* ignore */
    }
    this.rec = null;
  }
}
