import { NextResponse } from "next/server";
import { requireEngine } from "@/lib/engineAuth";
import { consentDenied, photoRecipient } from "@/lib/buddy/outbound";
import { parsePhotoLookup } from "@/lib/buddy/photo";

export const dynamic = "force-dynamic";

const MAX_BYTES = 1_500_000;
const HEADERS = { "User-Agent": "Filow/1.0 (desktop app; OK Filow cards)" };
const WIKIMEDIA = /^https:\/\/(upload|thumb)\.wikimedia\.org\//;

/** The thumbnail of the page with that title, or null. */
async function summaryThumb(wiki: string, name: string): Promise<string | null> {
  const title = encodeURIComponent(name.replace(/\s+/g, "_"));
  const meta = await fetch(`https://${wiki}.wikipedia.org/api/rest_v1/page/summary/${title}?redirect=true`, { headers: HEADERS, signal: AbortSignal.timeout(6000) });
  if (!meta.ok) return null;
  return ((await meta.json()) as { thumbnail?: { source?: string } }).thumbnail?.source ?? null;
}

/**
 * The thumbnail of the first page Wikipedia's own search finds for the words, or null. Used when no
 * page has exactly that title: a spoken subject is rarely a title ("сердца", "a red sports car").
 */
async function searchThumb(wiki: string, name: string): Promise<string | null> {
  const res = await fetch(`https://${wiki}.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(name)}&limit=3`, { headers: HEADERS, signal: AbortSignal.timeout(6000) });
  if (!res.ok) return null;
  const pages = ((await res.json()) as { pages?: Array<{ thumbnail?: { url?: string } | null }> }).pages ?? [];
  const url = pages.find((p) => p.thumbnail?.url)?.thumbnail?.url;
  if (!url) return null;
  // The search gives a small thumbnail ("//upload.wikimedia.org/.../60px-X.jpg"): ask for a size a card can show.
  return (url.startsWith("//") ? `https:${url}` : url).replace(/\/\d+px-/, "/330px-");
}

/**
 * OK Filow cards: a real photo for a subject ("Piston", or "it/cuore" for the Italian Wikipedia), from
 * Wikipedia: the thumbnail of the page with that title, else of the first page its search finds.
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
  const { wiki, name } = parsePhotoLookup(q);
  if (!name) return NextResponse.json({ dataUrl: null });
  try {
    const src = (await summaryThumb(wiki, name).catch(() => null)) ?? (await searchThumb(wiki, name));
    if (!src || !WIKIMEDIA.test(src)) return NextResponse.json({ dataUrl: null });
    const img = await fetch(src, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
    const type = img.headers.get("content-type") ?? "";
    if (!img.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return NextResponse.json({ dataUrl: null });
    const buf = Buffer.from(await img.arrayBuffer());
    if (buf.length > MAX_BYTES) return NextResponse.json({ dataUrl: null });
    return NextResponse.json({ dataUrl: `data:${type};base64,${buf.toString("base64")}` });
  } catch {
    return NextResponse.json({ dataUrl: null });
  }
}
