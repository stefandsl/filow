// GIFs and short videos on the whiteboard (owner, 14/11: "the whiteboard must show GIFs"). Each is an
// Excalidraw `image` element, so any Excalidraw opens the board and shows a picture in its place:
// - a GIF is the image itself (the board is drawn as inline SVG, where a GIF moves);
// - a video is a poster image drawn by us (a dark frame, a play mark, its caption), and the video file
//   rides along in the same file's `files`, named by the element's customData.media.video; the board
//   page puts a muted, looping <video> over the poster (components/whiteboard/ExcalidrawBoard.tsx).
//
// Embedded, not linked: the .excalidraw file is the board's one document, and it must open the same
// offline, months later, after the source changed or went away; a link would also be a request to the web
// (and a yes) every time the board opens. Excalidraw itself embeds its images the same way. The price is
// size, so each file has a cap (MEDIA_FILE_CAP) and a board at most MAX_BOARD_MEDIA of them.
//
// Nothing here is HTML: the element is an image, the files are data URLs of the allowed types only,
// checked again whenever a file is read (lib/whiteboard/doc.ts). An agent places one with
// mediaElement() + applyOps({ op: "add", element, files }, { op: "add", element: label }); `step` is the
// lesson step it appears with.
import { el, FONT, INK, LINE_HEIGHT, safeId, type BinaryFile, type ExEl } from "./scene";

export type BoardMediaKind = "gif" | "video";
export type BoardMedia = { kind: BoardMediaKind; video?: string; caption: string; source: string };

/** Bytes of each embedded file (a data URL is a third larger). */
export const MEDIA_FILE_CAP: Record<BoardMediaKind, number> = { gif: 2_000_000, video: 4_000_000 };
export const MAX_BOARD_MEDIA = 6;
const dataCap = (kind: BoardMediaKind) => Math.ceil(MEDIA_FILE_CAP[kind] / 3) * 4 + 40;

const IMAGE_FILE = /^data:image\/(?:png|jpeg|webp|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
const GIF_FILE = /^data:image\/gif;base64,[A-Za-z0-9+/=]+$/;
const VIDEO_FILE = /^data:video\/(?:webm|mp4);base64,[A-Za-z0-9+/=]+$/;

/** A file a board may carry: an image (as before, up to 8 MB of data URL; a GIF within its cap) or a video within its cap. */
export function boardFileOk(dataURL: unknown): boolean {
  if (typeof dataURL !== "string") return false;
  if (VIDEO_FILE.test(dataURL)) return dataURL.length <= dataCap("video");
  if (GIF_FILE.test(dataURL)) return dataURL.length <= dataCap("gif");
  return dataURL.length < 8_000_000 && IMAGE_FILE.test(dataURL);
}
export const isVideoFile = (dataURL: string) => VIDEO_FILE.test(dataURL);

// eslint-disable-next-line no-control-regex
const clip = (s: unknown, n: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

/** An element's media note kept to what it may say, or undefined (then the element is a plain image). */
export function cleanBoardMedia(raw: unknown): BoardMedia | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  if (r.kind !== "gif" && r.kind !== "video") return undefined;
  const video = r.kind === "video" && typeof r.video === "string" ? safeId(r.video) : undefined;
  if (r.kind === "video" && !video) return undefined;
  return { kind: r.kind, ...(video ? { video } : {}), caption: clip(r.caption, 80), source: clip(r.source, 120) };
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** The picture a video shows where it cannot play (in Excalidraw, in a PNG export): our own SVG, no model text as markup. */
export function posterSvg(caption: string, w: number, h: number): string {
  const cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" rx="10" fill="#1f2328"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" opacity="0.9"/><path d="M ${cx - r * 0.35} ${cy - r * 0.5} L ${cx + r * 0.55} ${cy} L ${cx - r * 0.35} ${cy + r * 0.5} Z" fill="#1f2328"/><text x="${cx}" y="${h - 14}" font-family="Segoe UI, Arial, sans-serif" font-size="16" fill="#e9ecef" text-anchor="middle">${esc(clip(caption, 60))}</text></svg>`;
}

const b64 = (s: string) => (typeof btoa === "function" ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, "utf8").toString("base64"));
const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i += 97) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

/**
 * A GIF or a video as a board element and its files. `src` must be a data URL of that kind within its
 * cap (null otherwise). `at`: where it goes on the board (its width; the height keeps `ratio`, 4:3 by default).
 */
export function mediaElement(item: { kind: BoardMediaKind; src: string; caption: string; source: string }, at: { x: number; y: number; w: number; ratio?: number }, step = 0, key = "media"): { element: ExEl; label: ExEl | null; files: Record<string, BinaryFile> } | null {
  const ok = item.kind === "gif" ? GIF_FILE.test(item.src) && item.src.length <= dataCap("gif") : VIDEO_FILE.test(item.src) && item.src.length <= dataCap("video");
  if (!ok) return null;
  const w = Math.max(80, Math.min(1200, at.w));
  const h = Math.round(w / (at.ratio && at.ratio > 0.2 && at.ratio < 5 ? at.ratio : 4 / 3));
  const id = safeId(`m-${key}-${fnv(item.src)}`);
  const files: Record<string, BinaryFile> = {};
  let fileId = `${id}-f`;
  let media: BoardMedia = { kind: item.kind, caption: clip(item.caption, 80), source: clip(item.source, 120) };
  if (item.kind === "gif") files[fileId] = { id: fileId, mimeType: "image/gif", dataURL: item.src, created: 1 };
  else {
    const videoId = `${id}-v`;
    fileId = `${id}-p`;
    files[fileId] = { id: fileId, mimeType: "image/svg+xml", dataURL: `data:image/svg+xml;base64,${b64(posterSvg(media.caption, w, h))}`, created: 1 };
    files[videoId] = { id: videoId, mimeType: /^data:video\/mp4/.test(item.src) ? "video/mp4" : "video/webm", dataURL: item.src, created: 1 };
    media = { ...media, video: videoId };
  }
  const element = el(id, "image", { x: at.x, y: at.y, w, h }, { step, key, role: "block" }, { fileId, status: "saved", scale: [1, 1], crop: null, strokeColor: "transparent" });
  element.customData = { ...element.customData, media };
  // The caption and where it came from (author, licence) under the picture, as board text: it is saved
  // with the board and shows in any Excalidraw.
  const words = [media.caption, media.source].filter(Boolean).join(" · ").slice(0, 160);
  const label = words
    ? el(`${id}-src`, "text", { x: at.x, y: at.y + h + 8, w, h: 20 }, { step, key, role: "label" }, { text: words, originalText: words, fontSize: 14, fontFamily: FONT.liberation, textAlign: "left", verticalAlign: "top", strokeColor: INK.soft, lineHeight: LINE_HEIGHT, autoResize: true, roughness: 0 })
    : null;
  return { element, label, files };
}

/** The ids of the files an element needs: its image, and for a video the video itself. */
export function filesOf(e: ExEl): string[] {
  const m = cleanBoardMedia(e.customData?.media);
  return [e.fileId, m?.video].filter((x): x is string => typeof x === "string" && x.length > 0);
}
