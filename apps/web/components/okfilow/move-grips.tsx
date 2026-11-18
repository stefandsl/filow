"use client";
// The drag handle and the resize grip of an item OK Filow puts over the desktop (lib/buddy/layout-move.ts):
// a row of dots at the top that moves the item, lines in the bottom-right corner that resize it. Both take
// the mouse (the overlay reports the item's box, main lets clicks in only there), arrow keys move a focused
// handle's item and Shift+arrows resize it, and a double click on a handle puts every item back where OK
// Filow puts it ("reset layout"). A held grip reports a bounded hit margin around its item on each animation frame.
import { type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { dragBox, keyBox, resizeBox, type Area, type Box, type Limits } from "@/lib/buddy/layout-move";
import { useGripDrag } from "./use-grip-drag";

type Props = {
  box: Box;
  area: Area;
  lim: Limits;
  /** A new box while it moves (`done`: the drag or the key is over: remember it). */
  onBox: (b: Box, done: boolean) => void;
  onReset: () => void;
  moveLabel: string;
  sizeLabel: string;
  /** Draw only the handle, or only the grip (a gallery has its grip on its last picture only). */
  show?: "both" | "move" | "size";
  style?: CSSProperties;
};

export function MoveGrips({ box, area, lim, onBox, onReset, moveLabel, sizeLabel, show = "both", style }: Props) {
  const drag = useGripDrag();
  const down = (kind: "move" | "size") => (e: PointerEvent<HTMLElement>) => {
    const start = { x: e.clientX, y: e.clientY, box };
    let last = box;
    const move = (ev: globalThis.PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      last = kind === "move" ? dragBox(start.box, dx, dy, area, lim) : resizeBox(start.box, "se", dx, dy, area, lim);
      onBox(last, false);
    };
    drag(e, move, () => onBox(last, true));
  };
  const key = (kind: "move" | "size") => (e: KeyboardEvent<HTMLElement>) => {
    const next = keyBox(box, e.key, kind === "size" || e.shiftKey, area, lim);
    if (!next) return;
    e.preventDefault();
    onBox(next, true);
  };
  return (
    <>
      {show !== "size" && (
        <button type="button" className="okf-move" data-action="move" aria-label={moveLabel} title={moveLabel} style={style} onPointerDown={down("move")} onKeyDown={key("move")} onDoubleClick={onReset}>
          <svg viewBox="0 0 24 8" width="24" height="8" aria-hidden><g fill="currentColor"><circle cx="3" cy="2" r="1.4" /><circle cx="9" cy="2" r="1.4" /><circle cx="15" cy="2" r="1.4" /><circle cx="21" cy="2" r="1.4" /><circle cx="3" cy="6" r="1.4" /><circle cx="9" cy="6" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle cx="21" cy="6" r="1.4" /></g></svg>
        </button>
      )}
      {show !== "move" && (
        <button type="button" className="okf-resize" data-action="resize" aria-label={sizeLabel} title={sizeLabel} onPointerDown={down("size")} onKeyDown={key("size")} onDoubleClick={onReset}>
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden><path d="M11 3L3 11M11 7L7 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      )}
    </>
  );
}
