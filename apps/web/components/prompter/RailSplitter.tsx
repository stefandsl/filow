"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@filow/ui";
import { DEFAULT_RAIL_WIDTH, clampRailWidth, readRailWidth, writeRailWidth } from "@/lib/railWidth";

const STEP = 16;

function storage() {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Drag handle between the points column and the right rail. Sets `--rail-width` on its grid parent.
 * Mouse/touch drag, arrow keys (16 px), Home/End, double click resets. Hidden in the sidebar layout
 * and when the rail stacks under the points (CSS).
 */
export function RailSplitter() {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(DEFAULT_RAIL_WIDTH);

  const apply = (px: number, persist: boolean) => {
    const next = clampRailWidth(px, window.innerWidth);
    setWidth(next);
    ref.current?.parentElement?.style.setProperty("--rail-width", `${next}px`);
    if (persist) writeRailWidth(storage(), next);
  };

  useEffect(() => {
    apply(readRailWidth(storage(), window.innerWidth), false);
    // Re-clamp the viewer's preferred width (saved or default), not the value a narrow window already
    // shrank, so the rail grows back when the window gets wider again.
    const onResize = () => apply(readRailWidth(storage(), window.innerWidth), false);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const parent = ref.current?.parentElement;
    if (!parent) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const right = parent.getBoundingClientRect().right;
    const move = (ev: PointerEvent) => apply(right - ev.clientX, false);
    const up = (ev: PointerEvent) => {
      apply(right - ev.clientX, true);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing-rail");
    };
    document.body.classList.add("resizing-rail");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const map: Record<string, number> = { ArrowLeft: width + STEP, ArrowRight: width - STEP, Home: 720, End: 280 };
    if (!(e.key in map)) return;
    e.preventDefault();
    apply(map[e.key], true);
  };

  return (
    <div
      ref={ref}
      className="rail-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("rail.resize")}
      title={t("rail.resize")}
      aria-valuenow={width}
      aria-valuemin={280}
      aria-valuemax={720}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => apply(DEFAULT_RAIL_WIDTH, true)}
    />
  );
}
