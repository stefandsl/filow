import type { SttBackend, SttHandlers } from "./types";
import { startMic, toBase64, type MicCapture } from "./mic";

const SAMPLE_RATE = 24000;

/**
 * OpenAI Realtime transcription (gpt-live-transcribe) from the browser.
 * Auth goes through the WebSocket subprotocol because browsers cannot set headers.
 * We commit the buffer every ~4 s so completed transcripts keep flowing; deltas
 * arrive continuously in between.
 */
export class OpenAiStt implements SttBackend {
  readonly id = "openai" as const;
  readonly label = "OpenAI gpt-live-transcribe";
  constructor(private readonly baseUrl: string = "") {}
  private ws: WebSocket | null = null;
  private mic: MicCapture | null = null;
  private commitTimer: number | null = null;

  async start(h: SttHandlers) {
    const tokenRes = await fetch(`${this.baseUrl}/api/stt/openai-token`, { method: "POST" });
    if (!tokenRes.ok) throw new Error((await tokenRes.json()).error ?? "token request failed");
    const { value } = (await tokenRes.json()) as { value: string };

    const ws = new WebSocket("wss://api.openai.com/v1/realtime?intent=transcription", [
      "realtime",
      `openai-insecure-api-key.${value}`,
    ]);
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("OpenAI WebSocket failed to open"));
    });

    ws.send(
      JSON.stringify({
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: SAMPLE_RATE },
              transcription: { model: "gpt-live-transcribe", delay: "low" },
              turn_detection: null,
            },
          },
        },
      }),
    );

    let partial = "";
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as {
        type: string;
        delta?: string;
        transcript?: string;
        error?: { message?: string };
      };
      switch (msg.type) {
        case "session.updated":
          h.onReady?.();
          break;
        case "conversation.item.input_audio_transcription.delta":
          partial += msg.delta ?? "";
          h.onTranscript({ partial });
          break;
        case "conversation.item.input_audio_transcription.completed":
          partial = "";
          if (msg.transcript) h.onTranscript({ committed: msg.transcript + " ", partial: "" });
          break;
        case "error":
          h.onError(`OpenAI: ${msg.error?.message ?? "unknown error"}`);
          break;
      }
    };
    ws.onclose = (ev) => {
      if (ev.code !== 1000 && ev.code !== 1005) h.onError(`OpenAI connection closed (${ev.code})`);
    };

    let sentSinceCommit = 0;
    this.mic = await startMic(SAMPLE_RATE, (pcm) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: toBase64(pcm) }));
      sentSinceCommit += pcm.byteLength;
    });
    this.commitTimer = window.setInterval(() => {
      // Commit only if we actually sent audio (>= 100 ms) since the last commit.
      if (ws.readyState === WebSocket.OPEN && sentSinceCommit >= SAMPLE_RATE * 2 * 0.1) {
        ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        sentSinceCommit = 0;
      }
    }, 4000);
  }

  stop() {
    if (this.commitTimer !== null) window.clearInterval(this.commitTimer);
    this.commitTimer = null;
    this.mic?.stop();
    this.mic = null;
    this.ws?.close(1000);
    this.ws = null;
  }
}
