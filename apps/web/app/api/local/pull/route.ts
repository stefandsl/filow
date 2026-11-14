import { requireEngine } from "@/lib/engineAuth";
import { OLLAMA_URL } from "@/lib/decide/clef";
import { LOCAL_MODELS } from "@/lib/localModels";
import { canonical, localOwnership, modelInventory } from "@/lib/localOwnership";

export const dynamic = "force-dynamic";
const active = new Set<string>();

/** A model of Filow's catalogue, by its name or by an installed tag of it ("clef-flash:latest"). */
const deletable = (name: string) => LOCAL_MODELS.some((m) => m.runtime === "ollama" && (m.name === name || (!m.name.includes(":") && name.startsWith(`${m.name}:`))));

/** Streams Ollama's pull progress (NDJSON) straight back to the page. */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  const { name } = (await req.json()) as { name?: string };
  if (!name || !LOCAL_MODELS.some((m) => m.name === name && m.status === "available")) {
    return new Response(JSON.stringify({ error: "unknown model" }), { status: 400 });
  }
  const base = OLLAMA_URL();
  const key = base + ":" + canonical(name);
  if (active.has(key)) return Response.json({ error: "model_busy" }, { status: 409 });
  active.add(key);
  const record = localOwnership();
  try { record.beginModel(base, name, await modelInventory(base, req.signal)); }
  catch { active.delete(key); return Response.json({ error: "ownership_unverified" }, { status: 503 }); }
  const upstream = await fetch(`${OLLAMA_URL()}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: name, stream: true }),
    // The page's Cancel button aborts its request; passing the signal on makes Ollama stop too.
    signal: req.signal,
  }).catch(() => null);
  if (!upstream) { active.delete(key); return new Response(JSON.stringify({ error: `Ollama not reachable at ${OLLAMA_URL()}` }), { status: 502 }); }
  if (!upstream.ok || !upstream.body) {
    active.delete(key);
    // Ollama answers 4xx/5xx with {"error": "..."} (unknown model, registry down): pass it on as is.
    const text = await upstream.text().catch(() => "");
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* plain text */
    }
    return new Response(JSON.stringify({ error: message || `Ollama answered ${upstream.status}` }), { status: 502 });
  }
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder(); let pending = ""; let success = false;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          if (pending.trim()) { try { success ||= JSON.parse(pending).status === "success"; } catch { /* incomplete */ } }
          if (success && !req.signal.aborted) {
            const found = (await modelInventory(base, req.signal)).find(m => canonical(m.name) === canonical(name));
            if (found) record.completeModel(base, name, found.digest);
          }
          active.delete(key); controller.close(); return;
        }
        pending += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
          try { success ||= JSON.parse(line).status === "success"; } catch { /* progress */ }
        }
        controller.enqueue(value);
      } catch (error) { active.delete(key); await reader.cancel().catch(() => {}); controller.error(error); }
    },
    async cancel() { active.delete(key); await reader.cancel(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}

export async function DELETE(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  const { name } = (await req.json()) as { name?: string };
  // Catalogue membership is necessary but never evidence of ownership.
  if (!name || !deletable(name)) return new Response(JSON.stringify({ error: "unknown model" }), { status: 400 });
  const base = OLLAMA_URL(); const record = localOwnership();
  const key = base + ":" + canonical(name);
  if (active.has(key)) return Response.json({ error: "model_busy" }, { status: 409 });
  active.add(key);
  try {
  try {
    const found = (await modelInventory(base, req.signal)).find(m => canonical(m.name) === canonical(name));
    if (!found || !record.ownsModel(base, name, found.digest)) return Response.json({ error: "model_not_owned" }, { status: 403 });
  } catch { return Response.json({ error: "ownership_unverified" }, { status: 503 }); }
  const res = await fetch(`${OLLAMA_URL()}/api/delete`, {
    method: "DELETE",
    signal: AbortSignal.any([req.signal, AbortSignal.timeout(10000)]),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: name }),
  }).catch(() => null);
  if (!res || !res.ok) return new Response(JSON.stringify({ error: "delete failed" }), { status: 502 });
  record.forgetModel(base, name);
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } finally { active.delete(key); }
}
