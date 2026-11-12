import { NextResponse } from "next/server";
import { requireEngine } from "@/lib/engineAuth";
import { cleanText } from "@/lib/whiteboard/lesson";
import { LOOK_SCHEMA, lookPrompt, readLook } from "@/lib/whiteboard/edits";
import { installedModels, localJson, visionModel } from "@/lib/whiteboard/local";

export const dynamic = "force-dynamic";
/** A PNG of the board, at most 896 px a side: well under this. */
const MAX_BODY = 3_000_000;

/**
 * The whiteboard looks at its own drawing: the page sends a picture of the board and its labels,
 * a vision model on this PC names the labels that are cut, covered or unreadable. Only the local
 * Ollama is asked, and only when a vision model is installed (else: no problems, `model: null`).
 * The picture never leaves this PC.
 */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  let body: { png?: unknown; labels?: unknown };
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return NextResponse.json({ error: "request too large" }, { status: 413 });
    body = JSON.parse(raw) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const png = typeof body.png === "string" && /^[A-Za-z0-9+/=]+$/.test(body.png) ? body.png : "";
  // a PNG starts with these bytes ("\x89PNG" in base64)
  if (!png.startsWith("iVBORw0KGgo")) return NextResponse.json({ error: "not a PNG" }, { status: 400 });
  const labels = (Array.isArray(body.labels) ? body.labels : []).slice(0, 60).flatMap((l) => {
    const q = l as { id?: unknown; text?: unknown };
    const id = typeof q.id === "string" ? q.id.slice(0, 64) : "";
    const text = cleanText(q.text, 80);
    return id && text ? [{ id, text }] : [];
  });
  const model = visionModel(await installedModels());
  if (!model || !labels.length) return NextResponse.json({ model: null, problems: [] });
  const started = Date.now();
  try {
    const { system, user } = lookPrompt(labels);
    const raw = await localJson(model, system, user, LOOK_SCHEMA, { images: [png], timeoutMs: 8000, maxTokens: 200 });
    return NextResponse.json({ model, ms: Date.now() - started, problems: readLook(raw, labels) });
  } catch {
    return NextResponse.json({ model, ms: Date.now() - started, problems: [], failed: true });
  }
}
