import { NextResponse } from "next/server";
import type { SttStatus } from "@intelliprompter/core";

/** Tells the client which keyed transcription backends are configured. Never returns the keys. */
export async function GET() {
  return NextResponse.json<SttStatus>({
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
  });
}
