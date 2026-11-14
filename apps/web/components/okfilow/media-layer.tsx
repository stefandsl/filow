"use client";
// Pictures, animations and short videos on the overlay, and the slide card (lib/buddy/media.ts). The
// gallery is a grid off the marks, the cards, the pill and the bubble, wholly on screen; the slide is one
// opaque card in the cards' style. A video is always muted and loops; GIFs and videos have play/pause,
// every item and the slide a close button. The overlay stays click-through outside them: it reports
// their rectangles and main lets the mouse in only there (apps/desktop/okfilow-hit.js). Stop takes all
// of it away at once (the overlay page passes null).
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { okFilowBridge } from "@/lib/buddy/bridge";
import { MAX_VIDEO_SECONDS, showLayout, type MediaItem, type MediaShow } from "@/lib/buddy/media";
import type { Rect } from "@/lib/buddy/marks";
import type { OkfKey } from "@/lib/buddy/text";

export const SLIDE_WIDTH = 560;

type T = (k: OkfKey) => string;

/** One picture, GIF or video with its play/pause (GIF and video) and close buttons. */
function MediaView({ item, t, onClose, onBad }: { item: MediaItem; t: T; onClose: () => void; onBad: () => void }) {
  const [paused, setPaused] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const still = useRef<HTMLCanvasElement>(null);
  const toggle = () => {
    const next = !paused;
    setPaused(next);
    if (item.kind === "video") {
      if (next) video.current?.pause();
      else void video.current?.play().catch(() => {});
    } else if (next && img.current && still.current) {
      // A GIF cannot be paused: the frame on screen now is kept as a still picture until Play.
      const c = still.current;
      c.width = img.current.naturalWidth || 1;
      c.height = img.current.naturalHeight || 1;
      c.getContext("2d")?.drawImage(img.current, 0, 0);
    }
  };
  // The picture alone in its box (no button on it), then one strip: caption and source, play/pause and close.
  return (
    <>
    <div className="okf-media-box" data-kind={item.kind} data-paused={paused || undefined}>
      {item.kind === "video" ? (
        <video
          ref={video}
          src={item.src}
          muted
          loop
          autoPlay
          playsInline
          disablePictureInPicture
          controls={false}
          onLoadedMetadata={(e) => { if (e.currentTarget.duration > MAX_VIDEO_SECONDS) onBad(); }}
          onError={onBad}
        />
      ) : (
        <>
          <img ref={img} src={item.src} alt={item.caption} onError={onBad} style={paused ? { visibility: "hidden" } : undefined} />
          {item.kind === "gif" && <canvas ref={still} aria-hidden style={paused ? undefined : { display: "none" }} />}
        </>
      )}
    </div>
    {/* The caption beside the buttons; the source (author, licence) on a row of its own, never broken inside a name. */}
    <figcaption>
      <span className="okf-media-caption" title={item.caption}>{item.caption}</span>
      {/* parts split at " · " (site, author, licence): a line breaks only between them, never inside a name or a licence */}
      <small className="okf-media-source" title={item.source}>{item.source.split(" · ").map((part, i) => <Fragment key={i}>{i > 0 && " · "}<span>{part}</span></Fragment>)}</small>
      <div className="okf-media-tools">
        {item.kind !== "photo" && (
          <button type="button" className="okf-media-btn" data-action="play" aria-label={paused ? t("mediaPlay") : t("pause")} title={paused ? t("mediaPlay") : t("pause")} onClick={toggle}>
            {paused ? <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg> : <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor" /></svg>}
          </button>
        )}
        <button type="button" className="okf-media-btn" data-action="close" aria-label={t("close")} title={t("close")} onClick={onClose}>
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
      </div>
    </figcaption>
    </>
  );
}

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect();
  return { left: Math.floor(r.left), top: Math.floor(r.top), right: Math.ceil(r.right), bottom: Math.ceil(r.bottom) };
};

type Props = { show: MediaShow | null; avoid: () => Rect[]; t: T; onPlaced?: (first: Rect, caption: string) => void };

/** Each new show is a new layer: nothing closed, nothing placed. Gone (null): nothing, and no rectangles take the mouse. */
export function MediaLayer(props: Props) {
  const seq = useRef(0);
  const last = useRef<MediaShow | null>(null);
  if (props.show !== last.current) {
    last.current = props.show;
    seq.current++;
  }
  return props.show ? <ShownMedia key={seq.current} {...props} show={props.show} /> : null;
}

function ShownMedia({ show, avoid, t, onPlaced }: Props & { show: MediaShow }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [slideGone, setSlideGone] = useState(false);
  const [slideAt, setSlideAt] = useState<Rect | null>(null);
  const [tiles, setTiles] = useState<Rect[]>([]);
  const slideEl = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);

  const gallery = show.gallery.map((item, i) => ({ item, key: `g${i}` })).filter((x) => !gone.has(x.key));
  const slide = show.slide && !slideGone ? show.slide : null;
  const slideMedia = (slide?.media ?? []).map((item, i) => ({ item, key: `s${i}` })).filter((x) => !gone.has(x.key));
  const sig = `${gallery.map((g) => g.key).join(",")}|${slide ? slideMedia.map((m) => m.key).join(",") : "-"}`;

  // Placed once the slide's real height is known (before it is painted).
  useLayoutEffect(() => {
    const view = { width: window.innerWidth, height: window.innerHeight };
    const anchor = { x: show.x, y: show.y };
    const size = slide && slideEl.current ? { width: Math.min(SLIDE_WIDTH, view.width - 24), height: slideEl.current.offsetHeight } : null;
    const placed = showLayout(gallery.length, size, view, avoid(), anchor);
    setSlideAt(placed.slide);
    setTiles(placed.tiles);
  }, [show, sig]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where the mouse may land (main lets it in only there).
  useEffect(() => {
    const b = okFilowBridge();
    const els = host.current ? Array.from(host.current.querySelectorAll(".okf-media-tile, .okf-slide:not(.okf-slide--measuring)")) : [];
    b?.overlayRects?.(els.map(rectOf));
  }, [tiles, slideAt, sig]);
  useEffect(() => () => okFilowBridge()?.overlayRects?.([]), []);
  // Once placed, the pointer goes to the first picture (or the slide), once per show.
  const told = useRef(false);
  useEffect(() => {
    const first = tiles[0] ?? slideAt;
    if (told.current || !first) return;
    told.current = true;
    onPlaced?.(first, gallery[0]?.item.caption ?? slide?.title ?? "");
  }, [tiles, slideAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const close =(key: string) => setGone((g) => new Set(g).add(key));
  return (
    <div ref={host} className="okf-media" data-testid="okf-media">
      {slide && (
        <section
          ref={slideEl}
          className={"okf-slide" + (slideAt ? "" : " okf-slide--measuring")}
          aria-label={t("slideLabel")}
          style={{ left: slideAt?.left ?? 0, top: slideAt?.top ?? 0, width: slideAt ? slideAt.right - slideAt.left : Math.min(SLIDE_WIDTH, typeof window === "undefined" ? SLIDE_WIDTH : window.innerWidth - 24) }}
        >
          <button type="button" className="okf-media-btn okf-slide-x" data-action="close" aria-label={t("close")} title={t("close")} onClick={() => setSlideGone(true)}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
          <h2>{slide.title}</h2>
          <ul>{slide.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
          {slideMedia.length > 0 && (
            <div className="okf-slide-media" data-count={slideMedia.length}>
              {slideMedia.map(({ item, key }) => (
                <figure key={key}>
                  <MediaView item={item} t={t} onClose={() => close(key)} onBad={() => close(key)} />
                </figure>
              ))}
            </div>
          )}
        </section>
      )}
      {gallery.map(({ item, key }, i) => {
        const r = tiles[i];
        if (!r) return null;
        return (
          <figure key={key} className="okf-media-tile" data-kind={item.kind} style={{ left: r.left, top: r.top, width: r.right - r.left, height: r.bottom - r.top }}>
            <MediaView item={item} t={t} onClose={() => close(key)} onBad={() => close(key)} />
          </figure>
        );
      })}
    </div>
  );
}
