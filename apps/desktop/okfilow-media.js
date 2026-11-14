// Pictures, animations, videos and the slide on the overlay (apps/web/lib/buddy/media.ts says the same
// rules for the page): main passes on only data URLs of the allowed types within their caps, short
// strings and at most six pictures plus a slide with three, to the overlay of the display the answer is
// about, in its own coordinates. Nothing here fetches anything.

const MAX_GALLERY = 6;
const MAX_SLIDE_MEDIA = 3;
const MAX_POINTS = 5;
const BYTES = { photo: 1_500_000, gif: 4_000_000, video: 8_000_000 };
const DATA = {
  photo: /^data:image\/(?:jpeg|png|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/,
  gif: /^data:image\/gif;base64,[A-Za-z0-9+/=]+$/,
  video: /^data:video\/(?:webm|mp4);base64,[A-Za-z0-9+/=]+$/,
};
const maxDataUrl = (kind) => Math.ceil(BYTES[kind] / 3) * 4 + 40;

// eslint-disable-next-line no-control-regex
const clip = (s, n) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

function cleanItem(raw) {
  if (!raw || typeof raw !== "object" || !Object.prototype.hasOwnProperty.call(DATA, raw.kind)) return null;
  const src = raw.src;
  if (typeof src !== "string" || src.length > maxDataUrl(raw.kind) || !DATA[raw.kind].test(src)) return null;
  return { kind: raw.kind, src, caption: clip(raw.caption, 80), source: clip(raw.source, 120) };
}

/** The show as main passes it on, or null when nothing in it may be shown. */
function cleanShow(raw) {
  if (!raw || typeof raw !== "object") return null;
  const items = (list, n) => (Array.isArray(list) ? list.slice(0, n).map(cleanItem).filter(Boolean) : []);
  const gallery = items(raw.gallery, MAX_GALLERY);
  const s = raw.slide && typeof raw.slide === "object" ? raw.slide : null;
  const points = s && Array.isArray(s.points) ? s.points.map((p) => clip(p, 120)).filter(Boolean).slice(0, MAX_POINTS) : [];
  const slide = s && clip(s.title, 80) && points.length >= 2 ? { title: clip(s.title, 80), points, media: items(s.media, MAX_SLIDE_MEDIA) } : null;
  if (!gallery.length && !slide) return null;
  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return { x: n(raw.x), y: n(raw.y), gallery, slide };
}

/** The show for one overlay (its bounds, global DIP): in its coordinates when the spot is on it, else null. */
function showFor(show, b) {
  if (!show || !b) return null;
  const on = show.x >= b.x && show.y >= b.y && show.x < b.x + b.width && show.y < b.y + b.height;
  return on ? { ...show, x: show.x - b.x, y: show.y - b.y } : null;
}

module.exports = { MAX_GALLERY, BYTES, maxDataUrl, cleanItem, cleanShow, showFor };
