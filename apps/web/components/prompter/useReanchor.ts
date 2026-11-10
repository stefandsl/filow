import { useCallback, useEffect, useRef, useState } from "react";
import { clickerMove, moveCommand, spokenSection, type ClickerMove, type Command, type CommandResult, type SessionState, type TranscriptEvent } from "@filow/core";

/**
 * Whether a key event belongs to a control that uses the arrow and page keys itself (a text field, a
 * list, a menu, a slider) or to an open dialog. Then a clicker key is that control's, not a move.
 */
export function keyBelongsToControl(target: EventTarget | null, doc: Document | null = typeof document === "undefined" ? null : document): boolean {
  if (doc?.querySelector("dialog[open]")) return true;
  const el = target as (Element & { isContentEditable?: boolean }) | null;
  if (!el || typeof el.closest !== "function") return false;
  if (el.isContentEditable) return true;
  return Boolean(el.closest('input, textarea, select, [contenteditable="true"], [role="menu"], [role="menubar"], [role="listbox"], [role="radiogroup"], [role="slider"], [role="tablist"], [role="spinbutton"], [role="grid"], [role="tree"]'));
}

/**
 * Presentation clickers and the keyboard: PageDown / Right go to the next section, PageUp / Left to
 * the previous one, wherever the focus is in the window, except in a control that uses those keys.
 * B and "." are never taken (clickerMove), so a slide show behind keeps its black and white screen.
 */
export function useClickerKeys(onMove: (move: ClickerMove) => void, enabled = true) {
  const latest = useRef(onMove);
  latest.current = onMove;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const move = clickerMove(e);
      if (!move || keyBelongsToControl(e.target)) return;
      e.preventDefault();
      latest.current(move);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

export type MoveNotice = { title: string; from: number };

type Dispatcher = { dispatch(cmd: Command): CommandResult; getState(): SessionState };

/**
 * Every way the presenter says where they are, for the prompter: clicker keys, a click on a section
 * or a point, a section's name said aloud (a short local match on the titles, nothing leaves the PC),
 * and slide moves in PowerPoint. A move made by voice leaves a notice with a way back, in case the
 * name came up in passing.
 */
export function useReanchor(engine: Dispatcher) {
  const [notice, setNotice] = useState<MoveNotice | null>(null);
  const move = useCallback((m: ClickerMove) => {
    const cmd = moveCommand(engine.getState(), m);
    if (cmd) engine.dispatch(cmd);
  }, [engine]);
  useClickerKeys(move);
  const toSection = useCallback((idx: number) => { engine.dispatch({ type: "anchor", idx }); }, [engine]);
  const toPoint = useCallback((idx: number, pointId: string) => { engine.dispatch({ type: "anchor", idx, pointId }); }, [engine]);
  const heard = useCallback((e: TranscriptEvent) => {
    if (!e.committed) return;
    const s = engine.getState();
    const idx = spokenSection(e.committed, s.script.sections.map((x) => x.title), s.sectionIdx);
    if (idx === null) return;
    if (engine.dispatch({ type: "anchor", idx }).ok) setNotice({ title: s.script.sections[idx].title, from: s.sectionIdx });
  }, [engine]);
  // PowerPoint moved to another slide: the slide's section takes back the points an earlier move
  // past it had marked missed. Only on a real change: the slide show reports the same slide often.
  const lastSlide = useRef<number | null>(null);
  const slideMoved = useCallback((index: number) => {
    if (lastSlide.current === index) return;
    lastSlide.current = index;
    const s = engine.getState();
    if (s.script.source === "slides" && index >= 0 && index < s.script.sections.length) engine.dispatch({ type: "anchor", idx: index, keepRecent: true });
  }, [engine]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 12000);
    return () => clearTimeout(t);
  }, [notice]);
  const undo = useCallback(() => {
    if (notice) engine.dispatch({ type: "anchor", idx: notice.from });
    setNotice(null);
  }, [engine, notice]);
  const dismiss = useCallback(() => setNotice(null), []);
  return { move, toSection, toPoint, heard, slideMoved, notice, undo, dismiss };
}
