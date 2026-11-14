// Pictures, animations and short videos on the screen (owner, 14/11: "as HeyClicky does"), and the
// slide card. The model asks for them with tags; this file reads the tags, decides where each item may
// come from and who is asked first, checks what came back, and lays the items out. Pure: unit tested.
//
// Sources: a photo comes from Wikipedia, as the cards' photos do (/api/buddy/photo); an animated GIF or
// a video comes from Wikimedia Commons, which gives each file's author and licence
// (/api/buddy/media); and the user's own file or link, named in the question. Nothing else: a URL the
// model writes is never fetched. What the web sends back is shown as a picture, never read as words.
import type { Recipient } from "./outbound";
import { photoRecipient } from "./outbound";
import type { Rect } from "./marks";

export type MediaKind = "photo" | "gif" | "video";
/** What the model (or the user's question) asks for: a subject to look up, or the user's own file or link. */
export type MediaAsk = { kind: MediaKind; subject: string; own?: boolean };
/** What is shown: a data URL that passed checkMedia, its caption and where it came from (author, licence). */
export type MediaItem = { kind: MediaKind; src: string; caption: string; source: string };
export type BuddySlide = { title: string; points: string[]; media: MediaAsk[] };
/** Panel -> main -> overlay. x, y: the spot the answer is about (global DIP in the panel, overlay-local after main). */
export type MediaShow = { x: number; y: number; gallery: MediaItem[]; slide: { title: string; points: string[]; media: MediaItem[] } | null };

export const MAX_GALLERY = 6;
export const MAX_SLIDE_MEDIA = 3;
export const MIN_POINTS = 2;
export const MAX_POINTS = 5;
/** Bytes of the file itself (a data URL is a third larger). */
export const MAX_BYTES: Record<MediaKind, number> = { photo: 1_500_000, gif: 4_000_000, video: 8_000_000 };
/** A video longer than this is not shown (Commons says each file's length; a local file is checked as it loads). */
export const MAX_VIDEO_SECONDS = 60;

const DATA_RE: Record<MediaKind, RegExp> = {
  photo: /^data:image\/(?:jpeg|png|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/,
  gif: /^data:image\/gif;base64,[A-Za-z0-9+/=]+$/,
  video: /^data:video\/(?:webm|mp4);base64,[A-Za-z0-9+/=]+$/,
};
/** The longest data URL of each kind (base64 of MAX_BYTES and its prefix). */
export const maxDataUrl = (kind: MediaKind) => Math.ceil(MAX_BYTES[kind] / 3) * 4 + 40;

/** True when `src` is a data URL of that kind within its cap: the only thing an overlay ever shows. */
export function checkMedia(kind: MediaKind, src: unknown): src is string {
  return typeof src === "string" && src.length <= maxDataUrl(kind) && DATA_RE[kind].test(src);
}

// eslint-disable-next-line no-control-regex
const clip = (s: unknown, n: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

/** An item kept to what may be shown, or null. */
export function cleanItem(raw: unknown): MediaItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const kind = r.kind as MediaKind;
  if (!(kind in DATA_RE) || !checkMedia(kind, r.src)) return null;
  return { kind, src: r.src as string, caption: clip(r.caption, 80), source: clip(r.source, 120) };
}

/** A whole show kept to what may be shown (the overlay and main both check). Null when nothing is left. */
export function cleanShow(raw: unknown): MediaShow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const gallery = (Array.isArray(r.gallery) ? r.gallery : []).slice(0, MAX_GALLERY).map(cleanItem).filter((x): x is MediaItem => x !== null);
  const s = r.slide && typeof r.slide === "object" ? (r.slide as Record<string, unknown>) : null;
  const points = s && Array.isArray(s.points) ? s.points.map((p) => clip(p, 120)).filter(Boolean).slice(0, MAX_POINTS) : [];
  const slide = s && clip(s.title, 80) && points.length >= MIN_POINTS
    ? { title: clip(s.title, 80), points, media: (Array.isArray(s.media) ? s.media : []).slice(0, MAX_SLIDE_MEDIA).map(cleanItem).filter((x): x is MediaItem => x !== null) }
    : null;
  if (!gallery.length && !slide) return null;
  return { x: n(r.x), y: n(r.y), gallery, slide };
}

// ---- tags ----

const KIND_RE = /^(photo|picture|image|gif|animation|video|clip)$/i;
const kindOf = (w: string): MediaKind | null => {
  const k = w.trim().toLowerCase();
  if (!KIND_RE.test(k)) return null;
  return k === "gif" || k === "animation" ? "gif" : k === "video" || k === "clip" ? "video" : "photo";
};
/** "gif:Heart beating" -> { kind, subject }; the subject is a name to look up, never a link. */
function readAsk(s: string): MediaAsk | null {
  const m = /^\s*([a-z]+)\s*:\s*(.+?)\s*$/i.exec(s);
  const kind = m ? kindOf(m[1]) : null;
  const subject = m ? clip(m[2], 80).replace(/[[\]|]/g, "") : "";
  if (!kind || subject.length < 2 || /^[a-z]+:\/\//i.test(subject) || /^www\./i.test(subject)) return null;
  return { kind, subject };
}

const MEDIA_RE = /\[MEDIA:([^[\]]*)\]/gi;
const SLIDE_RE = /\[SLIDE:([^[\]|]*)\|([^[\]|]*)(?:\|([^[\]|]*))?\]/gi;

/** Takes the MEDIA and SLIDE tags out of an answer: at most six pictures, one slide. */
export function extractMedia(body: string): { body: string; media: MediaAsk[]; slide: BuddySlide | null } {
  const media: MediaAsk[] = [];
  let slide: BuddySlide | null = null;
  let out = body.replace(MEDIA_RE, (_m, inner: string) => {
    const a = readAsk(inner);
    if (a && media.length < MAX_GALLERY && !media.some((x) => x.kind === a.kind && x.subject.toLowerCase() === a.subject.toLowerCase())) media.push(a);
    return "";
  });
  out = out.replace(SLIDE_RE, (_m, title: string, points: string, list: string | undefined) => {
    const ps = points.split(";").map((p) => clip(p, 120)).filter(Boolean).slice(0, MAX_POINTS);
    const t = clip(title, 80);
    if (!slide && t && ps.length >= MIN_POINTS) {
      slide = { title: t, points: ps, media: (list ?? "").split(";").map(readAsk).filter((x): x is MediaAsk => x !== null).slice(0, MAX_SLIDE_MEDIA) };
    }
    return "";
  });
  return { body: out, media, slide };
}

/** How the model is taught the tags (the online prompt and the local one share this list). */
export const MEDIA_PROMPT = [
  "[MEDIA:kind:subject] shows a real picture from the web next to the answer: kind is photo, gif (a short animation) or video (a short silent clip); subject is a plain name to look up, like Heart or Solar eclipse, never a link. One tag per picture, 1 to 6 per answer, only when the user asks to see pictures, an animation or a video.",
  "[SLIDE:Title|first point; second point; third point|gif:subject; photo:subject] shows one slide over the screen: a title, 2 to 5 short points split by ;, then 0 to 3 pictures. Only when the user asks for a slide.",
].join("\n");

// ---- the user's own file or link ----

const OWN_EXT = /\.(gif|webm|mp4|png|jpe?g|webp)$/i;
const extKind = (p: string): MediaKind => (/\.gif$/i.test(p) ? "gif" : /\.(webm|mp4)$/i.test(p) ? "video" : "photo");
/**
 * Files and links to pictures, GIFs and videos the user wrote in the question (first line only: the
 * panel adds selected text and circled areas after it, which are not the user's own request).
 */
export function ownMedia(question: string): MediaAsk[] {
  const line = question.split("\n")[0] ?? "";
  const out: MediaAsk[] = [];
  const add = (s: string) => {
    const p = s.replace(/^["'<(]+|["'>),.;!?]+$/g, "");
    if (OWN_EXT.test(p) && out.length < MAX_GALLERY && !out.some((x) => x.subject === p)) out.push({ kind: extKind(p), subject: p, own: true });
  };
  for (const m of line.matchAll(/https?:\/\/[^\s"'<>]+/gi)) add(m[0]);
  for (const m of line.matchAll(/(?:"([A-Za-z]:\\[^"]+)"|([A-Za-z]:\\[^\s"]+))/g)) add(m[1] ?? m[2]);
  return out;
}

/** A link the user gave: where it goes, or null for a link this PC answers itself (loopback) or a bad one. */
export function ownHost(subject: string): string | null {
  try {
    const u = new URL(subject);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return isLoopback(u.hostname) ? null : u.hostname.toLowerCase();
  } catch {
    return null;
  }
}
export const isLoopback = (host: string) => /^(?:127(?:\.\d{1,3}){3}|localhost|\[::1\])$/i.test(host);

// ---- who is asked ----

/** Wikipedia and Wikimedia Commons are both run by the Wikimedia Foundation: one yes covers a batch with GIFs or videos in it. */
export const wikimediaRecipient = (): Recipient => ({ id: "wikimedia", names: ["Wikimedia"] });
/** A link the user gave goes to its own site, asked once per site. */
export const linkRecipient = (host: string): Recipient => ({ id: `link:${host}`, names: [host] });

/**
 * The one recipient a batch of lookups needs a yes for: photos only go to Wikipedia (the same yes as the
 * cards' photos), anything animated goes to Wikimedia (Wikipedia and Commons). Null: nothing to look up.
 */
export function batchRecipient(asks: MediaAsk[]): Recipient | null {
  const web = asks.filter((a) => !a.own);
  if (!web.length) return null;
  return web.every((a) => a.kind === "photo") ? photoRecipient() : wikimediaRecipient();
}

// ---- layout ----

type Size = { width: number; height: number };
export const TILE = { width: 260, media: 172, text: 64, gap: 12 } as const;

const overlapArea = (a: Rect, b: Rect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/**
 * Where a block of `size` goes: wholly on screen (an `edge` from it), covering as little of the `avoid`
 * boxes as possible (none when there is room), then as near the `anchor` as possible.
 */
export function placeBlock(size: Size, view: Size, avoid: Rect[], anchor: { x: number; y: number }, edge = 12, step = 16): { rect: Rect; overlap: number } {
  const w = Math.min(size.width, view.width - edge * 2);
  const h = Math.min(size.height, view.height - edge * 2);
  let best: { rect: Rect; overlap: number; cost: number } | null = null;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let x = edge; x <= view.width - edge - w; x += step) xs.push(x);
  for (let y = edge; y <= view.height - edge - h; y += step) ys.push(y);
  xs.push(Math.max(edge, view.width - edge - w));
  ys.push(Math.max(edge, view.height - edge - h));
  // right beside each box (the boxes come grown by the margin): the margin is then exact, not rounded to the step
  for (const a of avoid) {
    for (const x of [a.right, a.left - w]) if (x >= edge && x <= view.width - edge - w) xs.push(x);
    for (const y of [a.bottom, a.top - h]) if (y >= edge && y <= view.height - edge - h) ys.push(y);
  }
  for (const x of xs) {
    for (const y of ys) {
      const r: Rect = { left: x, top: y, right: x + w, bottom: y + h };
      let overlap = 0;
      for (const a of avoid) overlap += overlapArea(r, a);
      const cx = Math.max(r.left, Math.min(anchor.x, r.right));
      const cy = Math.max(r.top, Math.min(anchor.y, r.bottom));
      const cost = overlap * 1000 + Math.hypot(cx - anchor.x, cy - anchor.y);
      if (!best || cost < best.cost) best = { rect: r, overlap, cost };
    }
  }
  if (!best) return { rect: { left: edge, top: edge, right: edge + w, bottom: edge + h }, overlap: 0 };
  // Less than a step from a box (the toolbar, a mark): moved up to it, so the margin is exactly the one the
  // boxes were grown by, never the margin plus a few pixels of rounding.
  let r = best.rect;
  const cover = (x: Rect) => avoid.reduce((s, a) => s + overlapArea(x, a), 0);
  for (const a of avoid) {
    const across = r.left < a.right && r.right > a.left;
    const along = r.top < a.bottom && r.bottom > a.top;
    const moves = [across ? [0, -(r.top - a.bottom)] : null, across ? [0, a.top - r.bottom] : null, along ? [-(r.left - a.right), 0] : null, along ? [a.left - r.right, 0] : null];
    for (const m of moves) {
      if (!m || Math.abs(m[0] + m[1]) === 0 || Math.abs(m[0] + m[1]) >= step) continue;
      const moved = { left: r.left + m[0], top: r.top + m[1], right: r.right + m[0], bottom: r.bottom + m[1] };
      if (moved.left >= edge && moved.top >= edge && moved.right <= view.width - edge && moved.bottom <= view.height - edge && cover(moved) <= best.overlap) r = moved;
    }
  }
  return { rect: r, overlap: best.overlap };
}

/** Columns of a gallery: one row up to three, two by two for four, three across for five and six. */
export const galleryColumns = (n: number) => (n === 4 ? 2 : Math.min(3, Math.max(1, n)));

/**
 * The gallery's tiles: a grid (never two tiles on each other), placed off the `avoid` boxes (marks, their
 * labels, the pill, the bubble, the cards, the slide) and wholly on screen. When the full size does not fit
 * in free space it is tried smaller, down to 45%; `scale` says which size was used.
 */
export function galleryLayout(n: number, view: Size, avoid: Rect[], anchor: { x: number; y: number }): { tiles: Rect[]; scale: number; overlap: number } {
  if (n <= 0) return { tiles: [], scale: 1, overlap: 0 };
  // a gap from everything else too, never edge to edge
  avoid = avoid.map((r) => grow(r, TILE.gap));
  let pick: { tiles: Rect[]; scale: number; overlap: number } | null = null;
  for (const scale of SCALES) {
    const g = grid(n, scale, view);
    const { rect, overlap } = placeBlock(g, view, avoid, anchor);
    const tiles = g.tiles(rect.left, rect.top);
    if (!pick || overlap < pick.overlap) pick = { tiles, scale: g.scale, overlap };
    if (overlap === 0) break;
  }
  return pick!;
}

const SCALES = [1, 0.85, 0.7, 0.55, 0.45];

/**
 * The gallery's grid at one size: its whole size, and its tiles once its top-left corner is known. `fill`:
 * the tiles grow to fill this width exactly (to share the slide's edges).
 */
function grid(n: number, scale: number, view: Size, fill?: number) {
  const cols = galleryColumns(n);
  const rows = Math.ceil(n / cols);
  const tw = Math.round(TILE.width * scale);
  const th = Math.round(TILE.media * scale) + TILE.text;
  const gap = TILE.gap;
  // never wider or taller than the screen: the tiles shrink to fit it
  const fit = Math.min(1, (view.width - 24 - (cols - 1) * gap) / cols / tw, (view.height - 24 - (rows - 1) * gap) / rows / th);
  let w = Math.floor(tw * fit);
  let h = Math.floor(th * fit);
  if (fill && fill > cols * w + (cols - 1) * gap) {
    w = Math.floor((fill - (cols - 1) * gap) / cols);
    h = Math.round((TILE.media * w) / TILE.width) + TILE.text;
  }
  return {
    width: cols * w + (cols - 1) * gap,
    height: rows * h + (rows - 1) * gap,
    scale: scale * fit,
    tiles: (x: number, y: number): Rect[] => Array.from({ length: n }, (_, i) => {
      const left = x + (i % cols) * (w + gap);
      const top = y + Math.floor(i / cols) * (h + gap);
      return { left, top, right: left + w, bottom: top + h };
    }),
  };
}

const grow = (r: Rect, by: number): Rect => ({ left: r.left - by, top: r.top - by, right: r.right + by, bottom: r.bottom + by });

/**
 * A slide and a gallery together: one column on the layout grid, the pictures in a row (or a grid) on top,
 * the slide under them, both starting at the same left edge, one gap apart. When that column has no free
 * room, the slide is placed first and the gallery kept a gap away from it.
 */
export function showLayout(n: number, slide: Size | null, view: Size, avoid: Rect[], anchor: { x: number; y: number }): { slide: Rect | null; tiles: Rect[] } {
  if (!slide) return { slide: null, tiles: galleryLayout(n, view, avoid, anchor).tiles };
  const near = avoid.map((r) => grow(r, TILE.gap));
  if (n <= 0) return { slide: placeBlock(slide, view, near, anchor).rect, tiles: [] };
  for (const scale of SCALES) {
    // one width for both: the pictures fill the slide's width, or the slide takes the pictures' width
    const g = grid(n, scale, view, slide.width);
    const size = { width: g.width, height: g.height + TILE.gap + slide.height };
    if (size.width > view.width - 24 || size.height > view.height - 24) continue;
    const { rect, overlap } = placeBlock(size, view, near, anchor);
    if (overlap > 0) continue;
    const top = rect.top + g.height + TILE.gap;
    return { tiles: g.tiles(rect.left, rect.top), slide: { left: rect.left, top, right: rect.left + g.width, bottom: top + slide.height } };
  }
  const s = placeBlock(slide, view, near, anchor).rect;
  return { slide: s, tiles: galleryLayout(n, view, [...avoid, grow(s, TILE.gap)], anchor).tiles };
}
