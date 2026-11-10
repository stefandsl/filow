import { NextResponse } from "next/server";
import { requireEngine } from "@/lib/engineAuth";
import { consentDenied, photoRecipient } from "@/lib/buddy/outbound";

export const dynamic = "force-dynamic";

const MAX_BYTES = 1_500_000;

/**
 * OK Filow cards: a real photo for a subject ("Piston"), from Wikipedia's page summary thumbnail.
 * Only the subject's name leaves the PC, never the screen or the question; offline mode sends nothing,
 * and neither does a request without the user's yes for Wikipedia (x-filow-consent header): 403.
 * Returns { dataUrl } or { dataUrl: null } when there is no photo.
 */
export async function GET(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  if (process.env.FILOW_OFFLINE === "1") return NextResponse.json({ dataUrl: null, reason: "offline" });
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 80) ?? "";
  if (!q) return NextResponse.json({ dataUrl: null });
  const refused = consentDenied(req, "photo", photoRecipient());
  if (refused) return refused;
  try {
    const title = encodeURIComponent(q.replace(/\s+/g, "_"));
    const meta = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${title}?redirect=true`, {
      headers: { "User-Agent": "Filow/1.0 (desktop app; OK Filow cards)" },
      signal: AbortSignal.timeout(6000),
    });
    if (!meta.ok) return NextResponse.json({ dataUrl: null });
    const src = ((await meta.json()) as { thumbnail?: { source?: string } }).thumbnail?.source;
    if (!src || !/^https:\/\/(upload|thumb)\.wikimedia\.org\//.test(src)) return NextResponse.json({ dataUrl: null });
    const img = await fetch(src, { headers: { "User-Agent": "Filow/1.0 (desktop app; OK Filow cards)" }, signal: AbortSignal.timeout(8000) });
    const type = img.headers.get("content-type") ?? "";
    if (!img.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return NextResponse.json({ dataUrl: null });
    const buf = Buffer.from(await img.arrayBuffer());
    if (buf.length > MAX_BYTES) return NextResponse.json({ dataUrl: null });
    return NextResponse.json({ dataUrl: `data:${type};base64,${buf.toString("base64")}` });
  } catch {
    return NextResponse.json({ dataUrl: null });
  }
}
