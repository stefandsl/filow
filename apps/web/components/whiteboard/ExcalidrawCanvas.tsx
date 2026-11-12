"use client";
// The board in the full Excalidraw editor: the user moves, rewrites, recolours or draws by hand on
// what Filow drew. Nothing here is uploaded: no share link, no library browser, no collaboration;
// the fonts come from this app. "Back to the lesson" hands the elements back, and the page keeps
// what changed by element id (lib/whiteboard/doc.ts diffEdits).
import "@excalidraw/excalidraw/index.css";
import { useEffect, useRef, useState } from "react";
import { loadExcalidraw } from "@/lib/whiteboard/excalidraw";
import type { BinaryFile, ExEl, Scene } from "@/lib/whiteboard/scene";

type ExcalidrawModule = typeof import("@excalidraw/excalidraw");
const LANG_CODES: Record<string, string> = { en: "en", it: "it-IT", ru: "ru-RU", ro: "ro-RO", ja: "ja-JP" };

export type ExcalidrawCanvasProps = {
  scene: Scene;
  dark: boolean;
  lang: string;
  label: string;
  /** The name of Excalidraw's menu button, which has none of its own. */
  menuLabel: string;
  doneLabel: string;
  onDone: (elements: ExEl[], files: Record<string, BinaryFile>) => void;
};

export function ExcalidrawCanvas({ scene, dark, lang, label, menuLabel, doneLabel, onDone }: ExcalidrawCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const [mod, setMod] = useState<ExcalidrawModule | null>(null);
  const latest = useRef<{ elements: ExEl[]; files: Record<string, BinaryFile> }>({ elements: scene.elements, files: scene.files });
  useEffect(() => {
    let live = true;
    void loadExcalidraw().then((m) => { if (live) setMod(m); });
    return () => { live = false; };
  }, []);
  // Excalidraw's menu button carries only an icon: it gets a name a screen reader can say
  useEffect(() => {
    if (!mod || !host.current) return;
    const name = () => host.current?.querySelectorAll(".main-menu-trigger").forEach((b) => { if (!b.getAttribute("aria-label")) b.setAttribute("aria-label", menuLabel); });
    name();
    const watch = new MutationObserver(name);
    watch.observe(host.current, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, [mod, menuLabel]);
  const Editor = mod?.Excalidraw;
  return (
    <div ref={host} className="wb-canvas" role="region" aria-label={label} data-canvas={mod ? "ready" : "loading"}>
      <div className="wb-canvas-editor">
      {Editor && (
        <Editor
          initialData={{ elements: scene.elements as never, files: scene.files as never, appState: { viewBackgroundColor: "#ffffff", theme: dark ? "dark" : "light" }, scrollToContent: true }}
          theme={dark ? "dark" : "light"}
          langCode={LANG_CODES[lang] ?? "en"}
          name={label}
          excalidrawAPI={(api) => { setTimeout(() => api.scrollToContent(undefined, { fitToContent: true, animate: false }), 60); }}
          onChange={(elements, _state, files) => { latest.current = { elements: elements as unknown as ExEl[], files: files as unknown as Record<string, BinaryFile> }; }}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, toggleTheme: null } }}
        />
      )}
      </div>
      <button type="button" className="wb-btn primary wb-canvas-done" data-action="edit-done" onClick={() => onDone(latest.current.elements, latest.current.files)}>{doneLabel}</button>
    </div>
  );
}
