import type { Rect } from "@/lib/buddy/marks";

/** Main independently caps this padding. Only the item containing the active grip gets it. */
export const GRIP_MARGIN = 160;
export const HIT_RECTS_CHANGED = "okf-hit-rects-changed";
export type ItemHitRect = Rect & { hit?: Rect; bubble?: true };
export const GRIP_ITEM = ".okf-media-tile, .okf-slide, .okf-cards, .okf-bubble, .okf-model-tools, .okf-model-resize";

export function itemHitRects(elements: Iterable<Element>, bubble?: Element | null): ItemHitRect[] {
  return Array.from(elements, (el) => {
    const r = el.getBoundingClientRect();
    const item: ItemHitRect = { left: Math.floor(r.left), top: Math.floor(r.top), right: Math.ceil(r.right), bottom: Math.ceil(r.bottom) };
    if (el === bubble) item.bubble = true;
    if (el.getAttribute("data-okf-grip-active") === "true") {
      item.hit = { left: item.left - GRIP_MARGIN, top: item.top - GRIP_MARGIN, right: item.right + GRIP_MARGIN, bottom: item.bottom + GRIP_MARGIN };
    }
    return item;
  }).filter((r) => r.right > r.left && r.bottom > r.top);
}

/** One report after React's move update has committed. End/cancel reports synchronously. */
export function watchHitRectChanges(report: () => void): () => void {
  let frame: number | null = null;
  const changed = (event: Event) => {
    if ((event as CustomEvent).detail === "move") {
      if (frame === null) frame = requestAnimationFrame(() => { frame = null; report(); });
    } else {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      report();
    }
  };
  window.addEventListener(HIT_RECTS_CHANGED, changed);
  return () => {
    window.removeEventListener(HIT_RECTS_CHANGED, changed);
    if (frame !== null) cancelAnimationFrame(frame);
  };
}
