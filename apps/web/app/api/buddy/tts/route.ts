import { NextResponse } from "next/server";
import { requireEngine } from "@/lib/engineAuth";

export const dynamic = "force-dynamic";

/** OK Filow cloud voice: text in, ElevenLabs MP3 out. Only used when the user picked the cloud voice. */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  if (process.env.FILOW_OFFLINE === "1") return NextResponse.json({ error: "offline" }, { status: 409 });
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "No ElevenLabs key: add ELEVENLABS_API_KEY, or use the voice of this PC." }, { status: 409 });
  let text = "";
  try {
    text = String(((await req.json()) as { text?: unknown }).text ?? "").trim().slice(0, 1500);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!text) return NextResponse.json({ error: "text is empty" }, { status: 400 });
  const voice = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_TTS_MODEL || "eleven_flash_v2_5" }),
  });
  if (!res.ok || !res.body) return NextResponse.json({ error: `ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}` }, { status: 502 });
  return new Response(res.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}
