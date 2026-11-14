// Server side of the pictures on the screen (lib/buddy/media.ts): an animated GIF or a short video from
// Wikimedia Commons, with its author and licence; or the user's own file or link. Each comes back as a
// data URL within its cap (checkMedia), or not at all. Only the subject's name goes to Commons; nothing
// is fetched from a link the model wrote. A file with no author or no licence is not used.
import { promises as fs } from "node:fs";
import { checkMedia, isLoopback, MAX_BYTES, MAX_VIDEO_SECONDS, type MediaItem, type MediaKind } from "./media";

const HEADERS = { "User-Agent": "Filow/1.0 (desktop app; OK Filow pictures)" };
const MIME: Record<MediaKind, RegExp> = { photo: /^image\/(?:jpeg|png|webp)$/, gif: /^image\/gif$/, video: /^video\/(?:webm|mp4)$/ };
const EXT_MIME: Record<string, string> = { gif: "image/gif", webm: "video/webm", mp4: "video/mp4", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

type Env = Record<string, string | undefined>;
/**
 * Where Commons is: the real one, or (development and QA runs only) a fake one on this PC, so tests make
 * no call to the web. A released build (NODE_ENV production) never takes the override.
 */
export function commonsBase(env: Env = process.env): string {
  const qa = env.FILOW_QA_COMMONS_URL;
  if (qa && env.NODE_ENV !== "production") {
    try { if (isLoopback(new URL(qa).hostname)) return qa.replace(/\/$/, ""); } catch { /* not a URL */ }
  }
  return "https://commons.wikimedia.org";
}
/** The files themselves are only taken from Wikimedia's upload host (or the fake Commons in a test run). */
export function uploadAllowed(url: string, base: string): boolean {
  if (/^https:\/\/upload\.wikimedia\.org\//.test(url)) return true;
  return base !== "https://commons.wikimedia.org" && url.startsWith(`${base}/`);
}

const stripHtml = (s: unknown) => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();

type CommonsPage = { title?: string; index?: number; imageinfo?: Array<{ url?: string; thumburl?: string; mime?: string; size?: number; duration?: number; extmetadata?: Record<string, { value?: unknown }> }> };

/** The search Commons is asked: files of that kind about the subject, with their author, licence and size. */
export function commonsQuery(base: string, kind: "gif" | "video", subject: string): string {
  const mime = kind === "gif" ? "image/gif" : "video/webm";
  const p = new URLSearchParams({
    action: "query", format: "json", generator: "search", gsrnamespace: "6", gsrlimit: "8",
    gsrsearch: `${subject} filemime:${mime}`, prop: "imageinfo", iiprop: "url|mime|size|extmetadata", iiurlwidth: "360",
    iiextmetadatafilter: "Artist|LicenseShortName|ObjectName",
  });
  return `${base}/w/api.php?${p.toString()}`;
}

/** The first file of the answer that can be shown: right type, small and short enough, with an author and a licence. */
export function pickCommons(json: unknown, kind: "gif" | "video", base: string): { url: string; caption: string; source: string } | null {
  const pages = Object.values(((json as { query?: { pages?: Record<string, CommonsPage> } })?.query?.pages) ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info || !MIME[kind].test(String(info.mime))) continue;
    if (kind === "video" && (typeof info.duration !== "number" || info.duration > MAX_VIDEO_SECONDS)) continue;
    const url = kind === "gif" && info.thumburl && /\.gif$/i.test(info.thumburl) ? info.thumburl : info.url;
    if (!url || !uploadAllowed(url, base)) continue;
    if (url === info.url && typeof info.size === "number" && info.size > MAX_BYTES[kind]) continue;
    const artist = stripHtml(info.extmetadata?.Artist?.value).slice(0, 60);
    const licence = stripHtml(info.extmetadata?.LicenseShortName?.value).slice(0, 40);
    if (!artist || !licence) continue;
    const caption = stripHtml(info.extmetadata?.ObjectName?.value) || String(p.title ?? "").replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, "");
    return { url, caption: caption.slice(0, 80), source: `Wikimedia Commons · ${artist} · ${licence}` };
  }
  return null;
}

/** Downloads one file as a data URL of that kind, within its cap; null for anything else. */
export async function download(url: string, kind: MediaKind, f: typeof fetch = fetch): Promise<string | null> {
  const res = await f(url, { headers: HEADERS, redirect: "error", signal: AbortSignal.timeout(15000) });
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!res.ok || !MIME[kind].test(type)) return null;
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES[kind]) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES[kind]) return null;
  const src = `data:${type};base64,${buf.toString("base64")}`;
  return checkMedia(kind, src) ? src : null;
}

/** A GIF or a video about the subject from Commons, or null. */
export async function fromCommons(kind: "gif" | "video", subject: string, f: typeof fetch = fetch, env: Env = process.env): Promise<MediaItem | null> {
  const base = commonsBase(env);
  const res = await f(commonsQuery(base, kind, subject), { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const pick = pickCommons(await res.json(), kind, base);
  if (!pick) return null;
  const src = await download(pick.url, kind, f);
  return src ? { kind, src, caption: pick.caption || subject, source: pick.source } : null;
}

const kindOfExt = (ext: string): MediaKind => (ext === "gif" ? "gif" : ext === "webm" || ext === "mp4" ? "video" : "photo");

/** The user's own file (a path on this PC) or link, as an item; null when it is not a picture, GIF or video within its cap. */
export async function fromOwn(subject: string, label: string, f: typeof fetch = fetch): Promise<MediaItem | null> {
  const ext = /\.([a-z0-9]+)$/i.exec(subject.split(/[?#]/)[0])?.[1]?.toLowerCase() ?? "";
  const mime = EXT_MIME[ext];
  if (!mime) return null;
  const kind = kindOfExt(ext);
  // the file's name is its caption, without the extension ("Mandelbrot set.png" -> "Mandelbrot set")
  const file = subject.split(/[\\/]/).pop()?.split(/[?#]/)[0] ?? subject;
  let name = file.replace(/\.[a-z0-9]+$/i, "") || file;
  try { name = decodeURIComponent(name); } catch { /* not encoded */ }
  if (/^[A-Za-z]:\\/.test(subject)) {
    const stat = await fs.stat(subject).catch(() => null);
    if (!stat || !stat.isFile() || stat.size > MAX_BYTES[kind]) return null;
    const src = `data:${mime};base64,${(await fs.readFile(subject)).toString("base64")}`;
    return checkMedia(kind, src) ? { kind, src, caption: name.slice(0, 80), source: label } : null;
  }
  let host: string;
  try { const u = new URL(subject); if (u.protocol !== "https:" && u.protocol !== "http:") return null; host = u.hostname; } catch { return null; }
  const src = await download(subject, kind, f);
  return src ? { kind, src, caption: name.slice(0, 80), source: isLoopback(host) ? label : host } : null;
}
