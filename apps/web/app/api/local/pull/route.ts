import { requireEngine } from "@/lib/engineAuth";
import { OLLAMA_URL } from "@/lib/decide/clef";
import { LOCAL_MODELS } from "@/lib/localModels";

export const dynamic = "force-dynamic";

/** Streams Ollama's pull progress (NDJSON) straight back to the page. */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  const { name } = (await req.json()) as { name?: string };
  if (!name || !LOCAL_MODELS.some((m) => m.name === name && m.status === "available")) {
    return new Response(JSON.stringify({ error: "unknown model" }), { status: 400 });
  }
  const upstream = await fetch(`${OLLAMA_URL()}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: name, stream: true }),
  }).catch(() => null);
  if (!upstream || !upstream.ok || !upstream.body) {
    return new Response(JSON.stringify({ error: `Ollama not reachable at ${OLLAMA_URL()}` }), { status: 502 });
  }
  return new Response(upstream.body, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}

export async function DELETE(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  const { name } = (await req.json()) as { name?: string };
  if (!name) return new Response(JSON.stringify({ error: "name required" }), { status: 400 });
  const res = await fetch(`${OLLAMA_URL()}/api/delete`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: name }),
  }).catch(() => null);
  if (!res || !res.ok) return new Response(JSON.stringify({ error: "delete failed" }), { status: 502 });
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
}
