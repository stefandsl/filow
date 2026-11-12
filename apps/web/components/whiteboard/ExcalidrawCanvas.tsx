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
  doneLabel: string;
  onDone: (elements: ExEl[], files: Record<string, BinaryFile>) => void;
};

export function ExcalidrawCanvas({ scene, dark, lang, label, doneLabel, onDone }: ExcalidrawCanvasProps) {
  const [mod, setMod] = useState<ExcalidrawModule | null>(null);
  const latest = useRef<{ elements: ExEl[]; files: Record<string, BinaryFile> }>({ elements: scene.elements, files: scene.files });
  useEffect(() => {
    let live = true;
    void loadExcalidraw().then((m) => { if (live) setMod(m); });
    return () => { live = false; };
  }, []);
  const Editor = mod?.Excalidraw;
  return (
    <div className="wb-canvas" role="region" aria-label={label} data-canvas={mod ? "ready" : "loading"}>
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
