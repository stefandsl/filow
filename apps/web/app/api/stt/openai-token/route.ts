import { requireEngine } from "@/lib/engineAuth";
import { consentDenied, sttRecipient } from "@/lib/buddy/outbound";
import { NextResponse } from "next/server";

/**
 * Mints an ephemeral client secret for a browser-side realtime transcription session.
 * The secret is what lets the microphone stream out, so it needs the user's yes for OpenAI
 * (x-filow-consent header): 403 without it, and nothing is requested.
 */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  if (process.env.FILOW_OFFLINE === "1") return NextResponse.json({ unavailable: "disabled" });
  const refused = consentDenied(req, "audio", sttRecipient("openai")!);
  if (refused) return refused;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });

  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: { model: "gpt-live-transcribe", delay: "low" },
            turn_detection: null,
          },
        },
      },
    }),
  });
  if (!res.ok) {
    return NextResponse.json({ error: `OpenAI ${res.status}: ${await res.text()}` }, { status: 502 });
  }
  const json = (await res.json()) as { value?: string; client_secret?: { value: string } };
  const value = json.value ?? json.client_secret?.value;
  if (!value) return NextResponse.json({ error: "No client secret in response" }, { status: 502 });
  return NextResponse.json({ value });
}
