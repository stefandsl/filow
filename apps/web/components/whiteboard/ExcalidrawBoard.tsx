"use client";
// The whiteboard drawn as Excalidraw draws it (the render path of the official excalidraw-mcp App,
// MIT, see THIRD_PARTY_NOTICES): the scene goes through Excalidraw's exportToSvg, and morphdom
// puts only what changed into the page, so what is already on the board stays put and only the new
// strokes draw on (stroke draw-on, fade-in). Here the new things of a step appear one by one at the
// time the voice reaches them (lib/whiteboard/pace.ts). Nothing the model wrote becomes markup:
// Excalidraw builds the SVG from validated elements (lib/whiteboard/scene.ts).
import morphdom from "morphdom";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { Box } from "@/lib/whiteboard/layout";
import type { Slot } from "@/lib/whiteboard/pace";
import { keyOf, stepOf, type ExEl, type Scene } from "@/lib/whiteboard/scene";
import { sceneSvg } from "@/lib/whiteboard/excalidraw";

export type DrawnInfo = { visible: ExEl[]; complete: boolean; svg: SVGSVGElement };
export type ExcalidrawBoardProps = {
  /** The board, measured (lib/whiteboard/excalidraw.ts prepareScene). */
  scene: Scene;
  /** The step whose things are new: they draw on, the rest is already there. */
  current: number;
  /** When each new thing of the current step is drawn (ms from the start of the step). */
  timing?: Map<string, Slot>;
  /** The step is over (paused, stepped by hand, the voice ended): everything of it is shown. */
  rest?: boolean;
  dark: boolean;
  /** Strokes draw on (false: the Lite tier, or the user asked for less motion). */
  animate: boolean;
  /** The part of the board to look at; null: the whole board. */
  camera?: Box | null;
  label: string;
  onPick?: (id: string, text: string) => void;
  pickLabel?: (text: string) => string;
  /** Called after each change is on the screen. */
  onDrawn?: (info: DrawnInfo) => void;
};

const frameOf = (els: ExEl[]): Box => {
  const f = els.find((e) => e.id === "wb-frame");
  return f ? { x: f.x, y: f.y, w: f.width, h: f.height } : { x: 0, y: 0, w: 1200, h: 720 };
};
const signature = (els: ExEl[]) => els.map((e) => `${e.id}:${e.version ?? 0}:${e.versionNonce ?? 0}:${e.x},${e.y},${e.width},${e.height}:${e.strokeColor}:${e.fontSize ?? ""}`).join("|");

export function ExcalidrawBoard({ scene, current, timing, rest, dark, animate, camera, label, onPick, pickLabel, onDrawn }: ExcalidrawBoardProps) {
  const host = useRef<HTMLDivElement>(null);
  const els = scene.elements;
  const board = frameOf(els);
  // the keys of the current step, in the order they are drawn
  const stepKeys = useMemo(() => [...new Set(els.filter((e) => stepOf(e) === current).map(keyOf))], [els, current]);
  const keysSig = stepKeys.join("|");
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set(stepKeys));
  const lens = useRef(new Map<string, number>());

  useEffect(() => {
    const keys = keysSig ? keysSig.split("|") : [];
    if (rest || !timing || !animate) {
      setRevealed(new Set(keys));
      return;
    }
    setRevealed(new Set(keys.filter((k) => !timing.has(k))));
    const timers = keys.filter((k) => timing.has(k)).map((k) => {
      const slot = timing.get(k)!;
      lens.current.set(k, slot.len);
      return setTimeout(() => setRevealed((prev) => (prev.has(k) ? prev : new Set(prev).add(k))), slot.at);
    });
    return () => timers.forEach(clearTimeout);
  }, [keysSig, current, timing, rest, animate]);

  const visible = useMemo(() => els.filter((e) => {
    const s = stepOf(e);
    return s < current || (s === current && revealed.has(keyOf(e)));
  }), [els, current, revealed]);
  const sig = signature(visible);
  const complete = visible.length === els.filter((e) => stepOf(e) <= current).length;

  // The camera moves smoothly to where it is asked to look (as excalidraw-mcp's camera does).
  const view = useRef<Box | null>(null);
  const target = camera ?? board;
  useEffect(() => {
    const svgOf = () => host.current?.querySelector("svg");
    if (!view.current || !animate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      view.current = { ...target };
      svgOf()?.setAttribute("viewBox", `${target.x} ${target.y} ${target.w} ${target.h}`);
      return;
    }
    let raf = 0;
    const tick = () => {
      const a = view.current!;
      const k = 0.14;
      a.x += (target.x - a.x) * k; a.y += (target.y - a.y) * k; a.w += (target.w - a.w) * k; a.h += (target.h - a.h) * k;
      svgOf()?.setAttribute("viewBox", `${a.x} ${a.y} ${a.w} ${a.h}`);
      if (Math.abs(target.x - a.x) + Math.abs(target.y - a.y) + Math.abs(target.w - a.w) + Math.abs(target.h - a.h) > 0.5) raf = requestAnimationFrame(tick);
      else view.current = { ...target };
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target.x, target.y, target.w, target.h, animate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render: exportToSvg, then morphdom so only the new nodes are added (and animate).
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef(0);
  const restRef = useRef(rest);
  restRef.current = rest;
  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;
  useEffect(() => {
    const ticket = ++latest.current;
    const newKeys = new Set(visible.filter((e) => stepOf(e) === current).map(keyOf));
    queue.current = queue.current.then(async () => {
      if (ticket !== latest.current || !host.current) return;
      let svg: SVGSVGElement;
      try {
        svg = await sceneSvg(visible, scene.files, { dark });
      } catch {
        return;
      }
      if (ticket !== latest.current || !host.current) return;
      const v = view.current ?? board;
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
      svg.setAttribute("class", "wb-board wb-ex-svg");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      const added: Element[] = [];
      const existing = host.current.querySelector("svg");
      if (existing) {
        morphdom(existing, svg, {
          onNodeAdded: (n) => { if (n.nodeType === 1) added.push(n as Element); return n; },
          // a node already drawn keeps its finished animation state
          onBeforeElUpdated: (from, to) => {
            if (from.classList?.contains("wb-in")) {
              to.setAttribute("class", from.getAttribute("class") ?? "");
              for (const a of ["style", "pathLength"]) { const v = from.getAttribute(a); if (v !== null) to.setAttribute(a, v); }
            }
            return true;
          },
        });
      } else {
        host.current.appendChild(svg);
        added.push(...Array.from(svg.querySelectorAll("g, path, text, image")));
      }
      // a board opened at rest (a saved board, going back a step) is simply there; new strokes draw on
      if (animate && (existing || !restRef.current)) {
        // the duration of the thing that was revealed last, so a stroke takes the time the voice gives it
        const len = Math.max(250, Math.min(2200, ...[...newKeys].map((k) => lens.current.get(k) ?? 600)));
        for (const n of added) {
          if (n.closest("defs, style, mask")) continue;
          // wb-stroke / wb-fade: the video recorder copies how far each of these has got (lib/whiteboard/video.ts)
          const stroke = n.tagName === "path" || n.tagName === "line" || n.tagName === "polyline";
          if (stroke) n.setAttribute("pathLength", "1");
          n.classList.add("wb-in", stroke ? "wb-stroke" : "wb-fade");
          (n as SVGElement).style.setProperty("--wb-len", `${len}ms`);
        }
      }
      onDrawnRef.current?.({ visible, complete, svg: host.current.querySelector("svg") as SVGSVGElement });
    });
  }, [sig, dark, animate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each box is also a button (keyboard and screen reader): "explain this part again".
  const nodes = visible.filter((e) => e.customData?.wb?.role === "node");
  const labelOf = (n: ExEl) => {
    const t = visible.find((e) => e.containerId === n.id);
    return (t?.originalText ?? t?.text ?? "").replace(/\s+/g, " ").trim();
  };
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const onKey = (id: string, text: string) => (ev: KeyboardEvent<HTMLButtonElement>) => {
    if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onPick?.(id, text); }
  };
  // what is on the board, counted by kind (the end-to-end test reads these)
  const count = (f: (e: ExEl) => boolean) => visible.filter(f).length;
  const words = visible.filter((e) => e.type === "text").map((e) => (e.originalText ?? e.text ?? "").replace(/\s+/g, " ").trim()).filter(Boolean);
  return (
    <div className={`wb-ex${animate ? " wb-ex-animate" : ""}${dark ? " wb-ex-dark" : ""}`} style={{ aspectRatio: `${target.w} / ${target.h}`, width: `min(100%, calc((100vh - 150px) * ${(target.w / target.h).toFixed(4)}))` } as CSSProperties} role="group" aria-label={label} data-step={current} data-elements={visible.length} data-complete={complete || undefined} data-nodes={count((e) => e.customData?.wb?.role === "node" && e.type !== "text")} data-edges={count((e) => e.customData?.wb?.role === "edge")} data-formulas={count((e) => typeof e.customData?.tex === "string")} data-plots={count((e) => /^b-.*-ax$/.test(e.id))} data-cards={count((e) => e.customData?.wb?.role === "block" && e.strokeStyle === "dashed")} data-sketches={count((e) => e.type === "image")}>
      <div ref={host} className="wb-ex-host" />
      {/* what the board says, for a screen reader (the drawing itself is hidden from it) */}
      <ul className="wb-sr">{words.map((w, i) => <li key={i}>{w}</li>)}</ul>
      {onPick && nodes.map((n) => {
        const text = labelOf(n);
        return (
          <button
            key={n.id}
            type="button"
            className="wb-hot"
            data-node={n.id}
            aria-label={pickLabel ? pickLabel(text) : text}
            style={{ left: pct(n.x - target.x, target.w), top: pct(n.y - target.y, target.h), width: pct(n.width, target.w), height: pct(n.height, target.h) }}
            onClick={() => onPick(n.id, text)}
            onKeyDown={onKey(n.id, text)}
          />
        );
      })}
    </div>
  );
}
