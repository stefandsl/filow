import type { SttBackend, SttHandlers } from "./types";
import { startMic, toBase64, type MicCapture } from "./mic";

const SAMPLE_RATE = 16000;
const MAX_RECONNECTS = 3;

/**
 * ElevenLabs Scribe v2 Realtime over WebSocket, authenticated with a server-minted single-use token.
 * The spoken language is sent as `language_code` (a big accuracy gain over detection for Italian);
 * an abnormal close (1006: network hiccup, VPN, idle) reconnects up to three times with a fresh
 * token instead of ending the take.
 */
export class ElevenLabsStt implements SttBackend {
  readonly id = "elevenlabs" as const;
  readonly label = "ElevenLabs Scribe v2";
  constructor(
    private readonly baseUrl: string = "",
    private readonly headers: Record<string, string> = {},
    private readonly language?: string,
  ) {}
  private ws: WebSocket | null = null;
  private mic: MicCapture | null = null;
  private running = false;
  private reconnects = 0;

  private async connect(h: SttHandlers): Promise<WebSocket> {
    const tokenRes = await fetch(`${this.baseUrl}/api/stt/elevenlabs-token`, { method: "POST", headers: this.headers });
    if (!tokenRes.ok) throw new Error((await tokenRes.json()).error ?? "token request failed");
    const { token } = (await tokenRes.json()) as { token: string };

    const url = new URL("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
    url.searchParams.set("model_id", "scribe_v2_realtime");
    url.searchParams.set("token", token);
    url.searchParams.set("audio_format", `pcm_${SAMPLE_RATE}`);
    url.searchParams.set("commit_strategy", "vad");
    url.searchParams.set("vad_silence_threshold_secs", "0.7");
    if (this.language && this.language !== "auto") url.searchParams.set("language_code", this.language);
    else url.searchParams.set("include_language_detection", "true");

    const ws = new WebSocket(url.toString());
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("ElevenLabs WebSocket failed to open"));
    });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { message_type: string; text?: string; message?: string; error?: string };
      switch (msg.message_type) {
        case "session_started":
          this.reconnects = 0;
          h.onReady?.();
          break;
        case "partial_transcript":
          h.onTranscript({ partial: msg.text ?? "" });
          break;
        case "committed_transcript":
          if (msg.text) h.onTranscript({ committed: msg.text + " ", partial: "" });
          break;
        case "committed_transcript_with_timestamps":
        case "committed_transcript_entities":
        case "edited_transcript":
          break; // variants of a commit already delivered
        case "warning":
          h.onLog?.(`ElevenLabs warning: ${msg.message ?? ""}`);
          break;
        default:
          // Every error type (auth_error, quota_exceeded_error, input_error, insufficient_audio_activity_error,
          // transcriber_error, ...) carries its text in `message`. Before, these were dropped and the take
          // looked live while nothing was transcribed.
          if (msg.message_type === "error" || msg.message_type.endsWith("_error") || msg.error)
            h.onError(`ElevenLabs ${msg.message_type}: ${msg.message ?? msg.error ?? ""}`);
          else h.onLog?.(`ElevenLabs ${msg.message_type}`);
      }
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return; // an older socket
      if (!this.running || ev.code === 1000 || ev.code === 1005) return;
      if (this.reconnects < MAX_RECONNECTS) {
        this.reconnects += 1;
        h.onTranscript({ partial: `(reconnecting ${this.reconnects}/${MAX_RECONNECTS}…)` });
        setTimeout(() => {
          if (!this.running) return;
          this.connect(h)
            .then((next) => {
              this.ws = next;
            })
            .catch((err) => h.onError(`ElevenLabs reconnect failed: ${(err as Error).message}`));
        }, 800 * this.reconnects);
      } else {
        h.onError(`ElevenLabs connection closed (${ev.code}) after ${MAX_RECONNECTS} reconnects; check the network or VPN`);
      }
    };
    return ws;
  }

  async start(h: SttHandlers) {
    this.running = true;
    this.reconnects = 0;
    this.ws = await this.connect(h);
    this.mic = await startMic(
      SAMPLE_RATE,
      (pcm) => {
        const ws = this.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(
          JSON.stringify({
            message_type: "input_audio_chunk",
            audio_base_64: toBase64(pcm),
            commit: false,
            sample_rate: SAMPLE_RATE,
          }),
        );
      },
      (detail) => h.onError(detail),
      h.onLog,
    );
  }

  stop() {
    this.running = false;
    this.mic?.stop();
    this.mic = null;
    this.ws?.close(1000);
    this.ws = null;
  }
}
