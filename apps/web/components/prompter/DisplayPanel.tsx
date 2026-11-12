import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import {
  DEFAULT_DISPLAY,
  DISPLAY_EYELINES,
  DISPLAY_SIZES,
  DISPLAY_WIDTHS,
  displayStyle,
  eyelineScrollTop,
  normalizeDisplay,
  type DisplayPrefs,
} from "@filow/core";
import { useT } from "@filow/ui";
import { Dialog } from "./Dialog";

/** Where each surface keeps its display choice (this device's browser storage). */
export const DISPLAY_KEYS = { prompter: "prefs:display", mirror: "prefs:display:mirror" } as const;

function storage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

/** The display choice of a surface, remembered on this device. Read after mount (server and first render agree). */
export function useDisplayPrefs(key: string): [DisplayPrefs, (next: DisplayPrefs) => void] {
  const [prefs, setPrefs] = useState<DisplayPrefs>(DEFAULT_DISPLAY);
  useEffect(() => {
    const read = () => {
      try { setPrefs(normalizeDisplay(JSON.parse(storage()?.getItem(key) ?? "{}"))); } catch { setPrefs(DEFAULT_DISPLAY); }
    };
    read();
    const onStorage = (e: StorageEvent) => { if (e.key === key) read(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);
  const save = useCallback((next: DisplayPrefs) => {
    const clean = normalizeDisplay(next);
    setPrefs(clean);
    try { storage()?.setItem(key, JSON.stringify(clean)); } catch { /* storage off: this session only */ }
  }, [key]);
  return [prefs, save];
}

/** Attributes that apply a display choice to the element holding the reading area. */
export function displayAttributes(p: DisplayPrefs) {
  return {
    "data-display-size": p.size,
    "data-display-mirror": p.mirror ? "on" : undefined,
    "data-display-contrast": p.contrast ? "high" : undefined,
    style: displayStyle(p) as CSSProperties,
  };
}

/** How long after a click the reading area stays put, so a double-click lands on the row it started on. */
const POINTER_CALM_MS = 700;

/**
 * Keeps the current point on the eyeline: when the current point or the display choice changes, the
 * reading area scrolls so the point's top sits at the chosen height. Waits while the pointer is busy
 * in the area (a click must not move the row under the second click of a double-click).
 */
export function useEyeline(area: RefObject<HTMLElement | null> | (() => HTMLElement | null), current: string | null, prefs: DisplayPrefs) {
  const lastPointer = useRef(0);
  const getArea = useCallback(() => (typeof area === "function" ? area() : area.current), [area]);
  useEffect(() => {
    const el = getArea();
    const target: EventTarget | null = el === document.scrollingElement ? document : el;
    if (!target) return;
    const mark = () => { lastPointer.current = Date.now(); };
    target.addEventListener("pointerdown", mark);
    return () => target.removeEventListener("pointerdown", mark);
  }, [getArea]);
  useEffect(() => {
    if (!current) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const apply = () => {
      const wait = POINTER_CALM_MS - (Date.now() - lastPointer.current);
      if (wait > 0) { timer = setTimeout(apply, wait); return; }
      let el = getArea();
      const row = document.querySelector<HTMLElement>(`[data-point-id="${CSS.escape(current)}"]`);
      if (!el || !row) return;
      // A short window lays the prompter out as one page that scrolls as a whole (globals.css, max-height: 500px).
      if (el !== document.scrollingElement && el.scrollHeight <= el.clientHeight + 1) el = document.scrollingElement as HTMLElement | null;
      if (!el) return;
      const page = el === document.scrollingElement;
      const areaTop = page ? 0 : el.getBoundingClientRect().top;
      const view = page ? window.innerHeight : el.clientHeight;
      const itemTop = row.getBoundingClientRect().top - areaTop + el.scrollTop;
      // On the first point the section's title stays in view: nothing above it needs to scroll away.
      const first = document.querySelector("[data-point-id]") === row;
      const top = first ? 0 : eyelineScrollTop(itemTop, view, prefs.eyeline, el.scrollHeight - view);
      if (Math.abs(top - el.scrollTop) < 4) return;
      const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollTo({ top, behavior: still ? "auto" : "smooth" });
    };
    timer = setTimeout(apply, 0);
    return () => clearTimeout(timer);
  }, [current, prefs.eyeline, prefs.size, prefs.width, getArea]);
}

type PointsWindowBridge = {
  status(): Promise<{ open: boolean }>;
  set(on: boolean): Promise<{ open: boolean }>;
  onChange?(fn: (s: { open: boolean }) => void): () => void;
};
function pointsWindowBridge(): PointsWindowBridge | undefined {
  return (globalThis as { filow?: { pointsWindow?: PointsWindowBridge } }).filow?.pointsWindow;
}

/**
 * The desktop shell asks for a fresh pairing code before a floating window (overlay, points window)
 * joins the session: codes are single use. `newCode` issues one and reports it to the shell.
 */
export function useCodesForWindows(newCode: () => Promise<void> | void) {
  const latest = useRef(newCode);
  latest.current = newCode;
  useEffect(() => {
    const bridge = (globalThis as { filow?: { onNeedCode?: (fn: () => void) => () => void } }).filow;
    return bridge?.onNeedCode?.(() => void latest.current());
  }, []);
}

/** The desktop's points window for calls: whether it is open, and a switch. Absent outside the desktop app. */
export function usePointsWindow(): { available: boolean; open: boolean; set(on: boolean): void } {
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const bridge = pointsWindowBridge();
    if (!bridge) return;
    setAvailable(true);
    void bridge.status().then((s) => setOpen(s.open)).catch(() => undefined);
    return bridge.onChange?.((s) => setOpen(s.open));
  }, []);
  const set = useCallback((on: boolean) => {
    const bridge = pointsWindowBridge();
    if (!bridge) return;
    void bridge.set(on).then((s) => setOpen(s.open)).catch(() => undefined);
  }, []);
  return { available, open, set };
}

function Choice<T extends string>({ name, legend, hint, options, value, onChange, label }: {
  name: string; legend: string; hint?: string; options: readonly T[]; value: T; onChange(v: T): void; label(v: T): string;
}) {
  return <fieldset className="display-choice">
    <legend>{legend}</legend>
    {hint && <p className="display-hint">{hint}</p>}
    <div className="display-options">
      {options.map((o) => <label key={o} className="display-option">
        <input type="radio" name={name} value={o} checked={value === o} onChange={() => onChange(o)} />
        <span>{label(o)}</span>
      </label>)}
    </div>
  </fieldset>;
}

/**
 * The "Display" panel: text size, line length, where the current point sits, mirror for teleprompter
 * glass, high contrast, and (desktop) the points window for calls. Every change shows at once and is
 * remembered on this device.
 */
export function DisplayPanel({ prefs, onChange, onClose, pointsWindow, anchor }: {
  prefs: DisplayPrefs;
  onChange(next: DisplayPrefs): void;
  onClose(): void;
  pointsWindow?: { available: boolean; open: boolean; set(on: boolean): void };
  /** "sidebar": opened from the main window's sidebar button, so it sits beside the sidebar, at its foot. Default: top right. */
  anchor?: "sidebar";
}) {
  const t = useT();
  const set = <K extends keyof DisplayPrefs>(k: K, v: DisplayPrefs[K]) => onChange({ ...prefs, [k]: v });
  return <Dialog title={t("display.title")} onClose={onClose} className={anchor === "sidebar" ? "display-panel display-panel-sidebar" : "display-panel"}>
    <p className="display-hint">{t("display.intro")}</p>
    <Choice name="display-size" legend={t("display.size")} options={DISPLAY_SIZES} value={prefs.size} onChange={(v) => set("size", v)} label={(v) => t(`display.size.${v}`)} />
    <Choice name="display-width" legend={t("display.width")} hint={t("display.widthHint")} options={DISPLAY_WIDTHS} value={prefs.width} onChange={(v) => set("width", v)} label={(v) => t(`display.width.${v}`)} />
    <Choice name="display-eyeline" legend={t("display.eyeline")} hint={t("display.eyelineHint")} options={DISPLAY_EYELINES} value={prefs.eyeline} onChange={(v) => set("eyeline", v)} label={(v) => t(`display.eyeline.${v}`)} />
    <fieldset className="display-choice">
      <legend>{t("display.more")}</legend>
      <label className="display-check"><input type="checkbox" checked={prefs.mirror} onChange={(e) => set("mirror", e.target.checked)} /><span>{t("display.mirror")}<small>{t("display.mirrorHint")}</small></span></label>
      <label className="display-check"><input type="checkbox" checked={prefs.contrast} onChange={(e) => set("contrast", e.target.checked)} /><span>{t("display.contrast")}<small>{t("display.contrastHint")}</small></span></label>
      {pointsWindow?.available && <label className="display-check"><input type="checkbox" checked={pointsWindow.open} onChange={(e) => pointsWindow.set(e.target.checked)} /><span>{t("display.pointsWindow")}<small>{t("display.pointsWindowHint")}</small></span></label>}
    </fieldset>
    <div className="display-actions">
      <button type="button" className="btn" onClick={() => onChange(DEFAULT_DISPLAY)}>{t("display.reset")}</button>
      <button type="button" className="btn primary" onClick={onClose}>{t("display.done")}</button>
    </div>
  </Dialog>;
}
