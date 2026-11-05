"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@filow/ui";
import { DEFAULT_NEXT_HEIGHT, MIN_NEXT_HEIGHT, clampNextHeight, maxNextHeight, readNextHeight, writeNextHeight } from "@/lib/nextHeight";

function storage() {
  try { return window.localStorage; } catch { return undefined; }
}

/** The card's bottom edge resizes only the next-section preview, never the points. */
export function NextSectionResize({ controls }: { controls: string }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const preferred = useRef(DEFAULT_NEXT_HEIGHT);
  const drag = useRef<{ id: number; y: number; height: number } | null>(null);
  const [size, setSize] = useState({ height: DEFAULT_NEXT_HEIGHT, max: DEFAULT_NEXT_HEIGHT });
  const [dragging, setDragging] = useState(false);

  const apply = useCallback((px: number, persist = false) => {
    const card = ref.current?.parentElement;
    const content = card?.closest(".prompter-content");
    if (!card || !content) return;
    const height = clampNextHeight(px, content.clientHeight);
    setSize({ height, max: maxNextHeight(content.clientHeight) });
    card.style.height = `${height}px`;
    if (persist) {
      preferred.current = px;
      writeNextHeight(storage(), px);
    }
  }, []);

  useEffect(() => {
    // Re-read the saved preference, not the height a smaller window already clamped.
    // Keep the in-memory preference if browser storage becomes unavailable.
    const resize = () => {
      preferred.current = readNextHeight(storage(), Number.MAX_SAFE_INTEGER, preferred.current);
      apply(preferred.current);
    };
    resize();
    window.addEventListener("resize", resize);
    const content = ref.current?.closest(".prompter-content");
    const observer = new ResizeObserver(resize);
    if (content) observer.observe(content);
    return () => { window.removeEventListener("resize", resize); observer.disconnect(); };
  }, [apply]);

  const cancelDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    apply(preferred.current);
  };

  return <div ref={ref} className={`next-section-resize${dragging ? " resizing" : ""}`}
    role="separator" aria-orientation="horizontal" aria-controls={controls}
    aria-label={t("next.resize")} title={t("next.resize")}
    aria-valuenow={size.height} aria-valuemin={MIN_NEXT_HEIGHT} aria-valuemax={size.max} tabIndex={0}
    onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { id: event.pointerId, y: event.clientY, height: size.height };
      setDragging(true);
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (start?.id === event.pointerId) apply(start.height + event.clientY - start.y);
    }}
    onPointerUp={event => {
      const start = drag.current;
      if (start?.id !== event.pointerId) return;
      const content = ref.current?.closest(".prompter-content");
      apply(clampNextHeight(start.height + event.clientY - start.y, content?.clientHeight ?? 0), true);
      drag.current = null;
      setDragging(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}
    onKeyDown={event => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      event.preventDefault();
      apply(Math.min(size.max, Math.max(MIN_NEXT_HEIGHT, size.height + (event.key === "ArrowDown" ? 16 : -16))), true);
    }}
    onDoubleClick={() => apply(DEFAULT_NEXT_HEIGHT, true)} />;
}
