import { NextResponse } from "next/server";
import { requireEngine } from "@/lib/engineAuth";
import { decideClefLocal } from "@/lib/decide/clef";

export const dynamic = "force-dynamic";

/** Runs one real decision against the local Clef model and reports latency. */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  const { model } = (await req.json().catch(() => ({}))) as { model?: string };
  if (model) process.env.CLEF_MODEL = model;
  try {
    const out = await decideClefLocal({
      transcript: "so first of all, welcome everybody, great to see you all here today",
      bullets: [
        { id: "a", text: "welcome the audience" },
        { id: "b", text: "explain the pricing" },
      ],
      sectionTitle: "Intro",
      covered: [],
      upcoming: ["the demo"],
    });
    return NextResponse.json({ ok: true, latencyMs: out.latencyMs, model: out.model, decisions: out.decisions });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 502 });
  }
}
