"use client";
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { flushSync } from "react-dom";
import { GRIP_ITEM, HIT_RECTS_CHANGED } from "./hit-rects";

/** Capture the pointer and pad only this grip's item through the existing rectangle report. */
export function useGripDrag() {
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);

  return (event: ReactPointerEvent<HTMLElement>, move: (event: PointerEvent) => void, finish: () => void) => {
    if (event.button !== 0 || cancel.current) return;
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    const id = event.pointerId;
    const item = target.closest(GRIP_ITEM);
    const report = (phase: "move" | "end" | "start") => window.dispatchEvent(new CustomEvent(HIT_RECTS_CHANGED, { detail: phase }));
    const step = (next: PointerEvent) => {
      if (next.pointerId !== id) return;
      if ((next.buttons & 1) === 0) { stop(true); return; }
      // The next frame must measure the new box even under concurrent rendering.
      flushSync(() => move(next));
      report("move");
    };
    const stop = (commit: boolean) => {
      if (!cancel.current) return;
      cancel.current = null;
      window.removeEventListener("pointermove", step);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", blur);
      target.removeEventListener("lostpointercapture", end);
      if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
      item?.removeAttribute("data-okf-grip-active");
      if (commit) flushSync(finish);
      report("end");
    };
    const end = (next: PointerEvent) => { if (next.pointerId === id) stop(true); };
    const blur = () => stop(true);
    cancel.current = () => stop(false);
    window.addEventListener("pointermove", step);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", blur);
    target.addEventListener("lostpointercapture", end);
    try { target.setPointerCapture(id); } catch { stop(false); return; }
    item?.setAttribute("data-okf-grip-active", "true");
    report("start");
  };
}
