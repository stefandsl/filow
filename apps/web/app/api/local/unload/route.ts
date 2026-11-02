import { requireEngine } from "@/lib/engineAuth";
import { OLLAMA_URL } from "@/lib/decide/clef";

export const dynamic = "force-dynamic";

/** Frees a loaded Ollama model from VRAM/RAM: a generate call with keep_alive 0 (the model file stays on disk). */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  const { name } = (await req.json()) as { name?: string };
  if (!name) return new Response(JSON.stringify({ error: "name required" }), { status: 400 });
  const res = await fetch(`${OLLAMA_URL()}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: name, keep_alive: 0 }),
  }).catch(() => null);
  if (!res || !res.ok) return new Response(JSON.stringify({ error: (await res?.text().catch(() => "")) || "unload failed" }), { status: 502 });
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
}
