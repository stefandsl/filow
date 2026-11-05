import { requireEngine } from "@/lib/engineAuth";
import { NextResponse } from "next/server";

/** Mints a 15-minute single-use token so the browser can open the realtime WebSocket without the API key. */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  if (process.env.FILOW_OFFLINE === "1") return NextResponse.json({ unavailable: "disabled" });
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "ELEVENLABS_API_KEY not set" }, { status: 500 });

  const res = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
  });
  if (!res.ok) {
    return NextResponse.json({ error: `ElevenLabs ${res.status}: ${await res.text()}` }, { status: 502 });
  }
  const { token } = (await res.json()) as { token: string };
  return NextResponse.json({ token });
}
