"use client";
// The main window in full screen (desktop app): on Windows the frame and the menu go with it, so a
// hover zone along the top edge shows a small bar to leave full screen, minimise or close the window.
// Escape also leaves full screen. The rules are in lib/fullScreenBar.ts; main checks every request
// (apps/desktop/window-controls.js). In a browser, and in the app's other windows, nothing renders.
import { useEffect, useRef, useState } from "react";
import { t, type Lang } from "@filow/core";
import { Icon } from "./icons";
import { useUiLang } from "./LangSwitch";
import { barShown, escapeLeavesFullScreen, HIDE_DELAY_MS, windowControlsBridge, type WindowControlsBridge } from "@/lib/fullScreenBar";

export function FullScreenBar() {
  const [lang] = useUiLang();
  const [fullScreen, setFullScreen] = useState(false);
  const [pointer, setPointer] = useState(false);
  const [focus, setFocus] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const bridge = windowControlsBridge();
    if (!bridge) return;
    let active = true;
    // main answers only the main window; the overlay and the points window are refused and show no bar
    bridge.isFullScreen().then((on) => { if (active) setFullScreen(on === true); }, () => {});
    const off = bridge.onFullScreen((on) => {
      setFullScreen(on === true);
      if (on !== true) { clearTimeout(hideTimer.current); setPointer(false); setFocus(false); }
    });
    return () => { active = false; off(); clearTimeout(hideTimer.current); };
  }, []);

  useEffect(() => {
    if (!fullScreen) return;
    // bubble phase on window: a dialog, a menu or a field that handles Escape itself comes first
    const onKey = (e: KeyboardEvent) => {
      if (!escapeLeavesFullScreen(e, true, document)) return;
      e.preventDefault();
      windowControlsBridge()?.exitFullScreen();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullScreen]);

  const bridge = windowControlsBridge();
  if (!fullScreen || !bridge) return null;
  return <FullScreenBarView lang={lang} shown={barShown({ fullScreen, pointer, focus })} bridge={bridge}
    onPointer={(on) => {
      clearTimeout(hideTimer.current);
      if (on) setPointer(true);
      else hideTimer.current = setTimeout(() => setPointer(false), HIDE_DELAY_MS);
    }}
    onFocus={setFocus} />;
}

/** The hover zone and the bar, as drawn in full screen. */
export function FullScreenBarView({ lang, shown, bridge, onPointer, onFocus }: {
  lang: Lang; shown: boolean; bridge: Pick<WindowControlsBridge, "exitFullScreen" | "minimize" | "close">;
  onPointer: (over: boolean) => void; onFocus: (inside: boolean) => void;
}) {
  const exitLabel = t("fullscreen.exit", lang), minimizeLabel = t("fullscreen.minimize", lang), closeLabel = t("fullscreen.close", lang);
  return (
    <div className="fsbar" data-shown={shown ? "true" : "false"} onPointerEnter={() => onPointer(true)} onPointerLeave={() => onPointer(false)}
      onFocus={() => onFocus(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onFocus(false); }}>
      <div className="fsbar-panel" role="toolbar" aria-label={t("fullscreen.bar", lang)}>
        <button type="button" className="btn fsbar-btn" data-action="exit" aria-label={exitLabel} title={`${exitLabel} (Esc)`} onClick={() => bridge.exitFullScreen()}>
          <Icon name="exitFullScreen" /><span>{exitLabel}</span>
        </button>
        <button type="button" className="btn fsbar-btn icon-only" data-action="minimize" aria-label={minimizeLabel} title={minimizeLabel} onClick={() => bridge.minimize()}>
          <Icon name="minimize" />
        </button>
        <button type="button" className="btn fsbar-btn icon-only" data-action="close" aria-label={closeLabel} title={closeLabel} onClick={() => bridge.close()}>
          <Icon name="close" />
        </button>
      </div>
    </div>
  );
}
