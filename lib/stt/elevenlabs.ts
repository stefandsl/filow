import type { SttBackend, SttHandlers } from "./types";
import { startMic, toBase64, type MicCapture } from "./mic";

const SAMPLE_RATE = 16000;

/** ElevenLabs Scribe v2 Realtime over WebSocket, authenticated with a server-minted single-use token. */
export class ElevenLabsStt implements SttBackend {
  readonly id = "elevenlabs" as const;
  readonly label = "ElevenLabs Scribe v2";
  private ws: WebSocket | null = null;
  private mic: MicCapture | null = null;

  async start(h: SttHandlers) {
    const tokenRes = await fetch("/api/stt/elevenlabs-token", { method: "POST" });
    if (!tokenRes.ok) throw new Error((await tokenRes.json()).error ?? "token request failed");
    const { token } = (await tokenRes.json()) as { token: string };

    const url = new URL("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
    url.searchParams.set("model_id", "scribe_v2_realtime");
    url.searchParams.set("token", token);
    url.searchParams.set("audio_format", `pcm_${SAMPLE_RATE}`);
    url.searchParams.set("commit_strategy", "vad");
    url.searchParams.set("vad_silence_threshold_secs", "0.7");

    const ws = new WebSocket(url.toString());
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("ElevenLabs WebSocket failed to open"));
    });

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data as string) as { message_type: string; text?: string; error?: string };
      switch (msg.message_type) {
        case "session_started":
          h.onReady?.();
          break;
        case "partial_transcript":
          h.onTranscript({ partial: msg.text ?? "" });
          break;
        case "committed_transcript":
          if (msg.text) h.onTranscript({ committed: msg.text + " ", partial: "" });
          break;
        default:
          if (msg.error) h.onError(`ElevenLabs ${msg.message_type}: ${msg.error}`);
      }
    };
    ws.onclose = (ev) => {
      if (ev.code !== 1000 && ev.code !== 1005) h.onError(`ElevenLabs connection closed (${ev.code})`);
    };

    this.mic = await startMic(SAMPLE_RATE, (pcm) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          message_type: "input_audio_chunk",
          audio_base_64: toBase64(pcm),
          commit: false,
          sample_rate: SAMPLE_RATE,
        }),
      );
    });
  }

  stop() {
    this.mic?.stop();
    this.mic = null;
    this.ws?.close(1000);
    this.ws = null;
  }
}
