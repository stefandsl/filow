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
import { boundsOf, keyOf, stepOf, type ExEl, type Scene } from "@/lib/whiteboard/scene";
import { sceneSvg } from "@/lib/whiteboard/excalidraw";
import { cleanBoardMedia, isVideoFile } from "@/lib/whiteboard/media";
import {
  EMPTY_CUE_FRAME,
  createCueSession,
  cueAccentColor,
  cueSignalStyle,
  extractStepCues,
  renderedTextBox,
  scheduleStepCues,
  type CueFrame,
  type CueMode,
  type Pt,
  type ReceiverBox,
  type Rect,
} from "@/lib/whiteboard/motion";

export type DrawnInfo = { visible: ExEl[]; complete: boolean; svg: SVGSVGElement };
export type ExcalidrawBoardProps = {
  /** The board, measured (lib/whiteboard/excalidraw.ts prepareScene). */
  scene: Scene;
  /** The step whose things are new: they draw on, the rest is already there. */
  current: number;
  /** Increments on every step display or replay so presentation cues restart cleanly. */
  turn?: number;
  /** Expected duration of the current step in ms, used to fit edge cues inside the step slot. */
  stepMs?: number;
  /** True while the current step is actively playing or replaying (false on Pause, Done, Edit, file open). */
  cueActive?: boolean;
  /** Optional reduced-motion override for deterministic tests; defaults to prefers-reduced-motion. */
  reducedMotion?: boolean;
  /** Optional clock override for deterministic tests; defaults to performance.now. */
  now?: () => number;
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
  /** The play/pause button of a video on the board, in the page's language. */
  videoLabels?: { play: string; pause: string };
};

/** A video on the board: muted and looping, over its poster, with one play/pause button. */
function BoardVideo({ src, label, playLabel, pauseLabel, style }: { src: string; label: string; playLabel: string; pauseLabel: string; style: CSSProperties }) {
  const v = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const toggle = () => {
    const next = !paused;
    setPaused(next);
    if (next) v.current?.pause();
    else void v.current?.play().catch(() => {});
  };
  return (
    <div className="wb-video" style={style}>
      <video ref={v} src={src} muted loop autoPlay playsInline disablePictureInPicture aria-label={label} />
      <button type="button" className="wb-video-btn" aria-label={paused ? playLabel : pauseLabel} title={paused ? playLabel : pauseLabel} onClick={toggle}>
        {paused ? <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><path d="M4 2.5v11l9-5.5z" fill="currentColor" /></svg> : <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden><path d="M4 2.5h3v11H4zM9 2.5h3v11H9z" fill="currentColor" /></svg>}
      </button>
    </div>
  );
}

const frameOf = (els: ExEl[]): Box => {
  const f = els.find((e) => e.id === "wb-frame");
  return f ? { x: f.x, y: f.y, w: f.width, h: f.height } : { x: 0, y: 0, w: 1200, h: 720 };
};
const signature = (els: ExEl[]) => els.map((e) => `${e.id}:${e.version ?? 0}:${e.versionNonce ?? 0}:${e.x},${e.y},${e.width},${e.height}:${e.strokeColor}:${e.fontSize ?? ""}`).join("|");
const ptsAttr = (pts: Pt[]) => pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
const chevronPath = (x: number, y: number, angle: number, size: number, tipOffset = 2) => {
  const spread = 2.52;
  const tipX = x + Math.cos(angle) * tipOffset;
  const tipY = y + Math.sin(angle) * tipOffset;
  const x1 = tipX + Math.cos(angle + spread) * size;
  const y1 = tipY + Math.sin(angle + spread) * size;
  const x2 = tipX + Math.cos(angle - spread) * size;
  const y2 = tipY + Math.sin(angle - spread) * size;
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} L ${tipX.toFixed(1)} ${tipY.toFixed(1)} L ${x2.toFixed(1)} ${y2.toFixed(1)}`;
};
function ReceiverOutline({
  receiver,
  color,
  strokeWidth,
  strokeOpacity,
  fillOpacity,
  dash,
  pad = 6,
}: {
  receiver: ReceiverBox;
  color: string;
  strokeWidth: number;
  strokeOpacity: number;
  fillOpacity?: number;
  dash?: string;
  pad?: number;
}) {
  const fill = fillOpacity ? color : "none";
  if (receiver.shape === "ellipse") {
    return (
      <ellipse
        cx={receiver.x + receiver.w / 2}
        cy={receiver.y + receiver.h / 2}
        rx={receiver.w / 2 + pad}
        ry={receiver.h / 2 + pad}
        fill={fill}
        fillOpacity={fillOpacity ?? 0}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeOpacity={strokeOpacity}
        strokeDasharray={dash}
      />
    );
  }
  if (receiver.shape === "diamond") {
    const cx = receiver.x + receiver.w / 2;
    const cy = receiver.y + receiver.h / 2;
    const pts = [
      `${cx},${receiver.y - pad}`,
      `${receiver.x + receiver.w + pad},${cy}`,
      `${cx},${receiver.y + receiver.h + pad}`,
      `${receiver.x - pad},${cy}`,
    ].join(" ");
    return (
      <polygon
        points={pts}
        fill={fill}
        fillOpacity={fillOpacity ?? 0}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeOpacity={strokeOpacity}
        strokeDasharray={dash}
        strokeLinejoin="round"
      />
    );
  }
  return (
    <rect
      x={receiver.x - pad}
      y={receiver.y - pad}
      width={receiver.w + pad * 2}
      height={receiver.h + pad * 2}
      rx={receiver.roundness ? 14 : 4}
      ry={receiver.roundness ? 14 : 4}
      fill={fill}
      fillOpacity={fillOpacity ?? 0}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeOpacity={strokeOpacity}
      strokeDasharray={dash}
    />
  );
}

export function ExcalidrawBoard({
  scene,
  current,
  turn = 0,
  stepMs = 0,
  cueActive,
  reducedMotion,
  now,
  timing,
  rest,
  dark,
  animate,
  camera,
  label,
  onPick,
  pickLabel,
  onDrawn,
  videoLabels,
}: ExcalidrawBoardProps) {
  const host = useRef<HTMLDivElement>(null);
  const cueSvgRef = useRef<SVGSVGElement>(null);
  const els = scene.elements;
  const board = frameOf(els);
  const [hostWidth, setHostWidth] = useState(0);
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const measure = () => setHostWidth(node.getBoundingClientRect().width);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  const [prefersReduced, setPrefersReduced] = useState(false);
  useEffect(() => {
    if (reducedMotion !== undefined || typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReduced(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, [reducedMotion]);
  const isReduced = reducedMotion ?? prefersReduced;
  // the keys of the current step, in the order they are drawn
  const stepKeys = useMemo(() => [...new Set(els.filter((e) => stepOf(e) === current).map(keyOf))], [els, current]);
  const keysSig = stepKeys.join("|");
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set(stepKeys));
  const lens = useRef(new Map<string, number>());
  const prevStep = useRef<number>(-1);

  useEffect(() => {
    const keys = keysSig ? keysSig.split("|") : [];
    const sameStep = prevStep.current === current;
    prevStep.current = current;
    if (rest || !timing || !animate || isReduced) {
      setRevealed(new Set(keys));
      return;
    }
    // Replaying a step whose items are already on the board keeps the prepared drawing intact.
    if (sameStep) {
      setRevealed((prev) => (keys.every((k) => prev.has(k)) ? prev : new Set(keys)));
      return;
    }
    setRevealed(new Set(keys.filter((k) => !timing.has(k))));
    const timers = keys.filter((k) => timing.has(k)).map((k) => {
      const slot = timing.get(k)!;
      lens.current.set(k, slot.len);
      return setTimeout(() => setRevealed((prev) => (prev.has(k) ? prev : new Set(prev).add(k))), slot.at);
    });
    return () => timers.forEach(clearTimeout);
  }, [keysSig, current, turn, timing, rest, animate, isReduced]);

  const visible = useMemo(() => els.filter((e) => {
    const s = stepOf(e);
    return s < current || (s === current && revealed.has(keyOf(e)));
  }), [els, current, revealed]);
  const sig = signature(visible);
  const complete = visible.length === els.filter((e) => stepOf(e) <= current).length;

  // Presentation-only directed edge cues (lib/whiteboard/motion.ts): never stored in the scene or exports.
  const stepCues = useMemo(() => extractStepCues(scene, current), [scene, current]);
  const cueActiveFlag = cueActive ?? !rest;
  const cueMode: CueMode = !cueActiveFlag || !stepCues.length ? "off" : !animate || isReduced ? "static" : "motion";
  const scheduledCues = useMemo(
    () => (cueMode === "motion" ? scheduleStepCues(stepCues, timing, stepMs) : []),
    [cueMode, stepCues, timing, stepMs],
  );
  const [cueFrame, setCueFrame] = useState<CueFrame>(EMPTY_CUE_FRAME);
  const nowRef = useRef(now);
  nowRef.current = now;
  useEffect(() => {
    if (cueMode === "off") {
      setCueFrame(EMPTY_CUE_FRAME);
      return;
    }
    const session = createCueSession({
      mode: cueMode,
      cues: stepCues,
      scheduled: scheduledCues,
      now: () => (nowRef.current ? nowRef.current() : performance.now()),
      scheduleFrame: (cb) => requestAnimationFrame(cb),
      cancelFrame: (id) => cancelAnimationFrame(id),
      onFrame: setCueFrame,
    });
    return () => session.cancel();
  }, [cueMode, stepCues, scheduledCues, current, turn]);

  // The camera moves smoothly to where it is asked to look (as excalidraw-mcp's camera does).
  const view = useRef<Box | null>(null);
  const target = camera ?? board;
  // Excalidraw draws the export from the top-left of what it draws, not from the board's 0,0: the view box
  // is moved back by that corner, so the board (and what sits over it: boxes to click, GIFs, videos) lines
  // up for a board with no frame at 0,0 too (a .excalidraw file opened from disk).
  const origin = useRef({ x: 0, y: 0 });
  const viewBox = (a: Box) => `${a.x - origin.current.x} ${a.y - origin.current.y} ${a.w} ${a.h}`;
  const sceneViewBox = (a: Box) => `${a.x} ${a.y} ${a.w} ${a.h}`;
  useEffect(() => {
    const svgOf = () => host.current?.querySelector("svg");
    if (!view.current || !animate || isReduced) {
      view.current = { ...target };
      svgOf()?.setAttribute("viewBox", viewBox(target));
      cueSvgRef.current?.setAttribute("viewBox", sceneViewBox(target));
      return;
    }
    let raf = 0;
    const tick = () => {
      const a = view.current!;
      const k = 0.14;
      a.x += (target.x - a.x) * k; a.y += (target.y - a.y) * k; a.w += (target.w - a.w) * k; a.h += (target.h - a.h) * k;
      svgOf()?.setAttribute("viewBox", viewBox(a));
      cueSvgRef.current?.setAttribute("viewBox", sceneViewBox(a));
      if (Math.abs(target.x - a.x) + Math.abs(target.y - a.y) + Math.abs(target.w - a.w) + Math.abs(target.h - a.h) > 0.5) raf = requestAnimationFrame(tick);
      else view.current = { ...target };
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target.x, target.y, target.w, target.h, animate, isReduced]); // eslint-disable-line react-hooks/exhaustive-deps

  // Render: exportToSvg, then morphdom so only the new nodes are added (and animate).
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef(0);
  const restRef = useRef(rest);
  restRef.current = rest;
  // Pausing or settling strips transient draw-on classes so strokes/labels finish immediately
  // and later replays never restart CSS fade animations on already-drawn elements.
  useEffect(() => {
    if (!rest || !host.current) return;
    host.current.querySelectorAll(".wb-in").forEach((node) => {
      node.classList.remove("wb-in", "wb-stroke", "wb-fade");
      node.removeAttribute("pathLength");
    });
  }, [rest]);
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
      const drawn = boundsOf(visible);
      origin.current = drawn ? { x: drawn.x, y: drawn.y } : { x: 0, y: 0 };
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      svg.setAttribute("viewBox", viewBox(v));
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
  const activeEdgeId = cueFrame.signals[0]?.edgeId ?? cueFrame.arrivals[0]?.edgeId ?? cueFrame.staticEmphasis[0]?.edgeId;
  const showCueLayer = cueFrame.signals.length > 0 || cueFrame.arrivals.length > 0 || cueFrame.staticEmphasis.length > 0;
  const activeView = view.current ?? target;
  const cssPerScene = hostWidth > 0 && activeView.w > 0 ? hostWidth / activeView.w : 0.65;
  const toScene = (cssPx: number) => cssPx / Math.max(0.25, cssPerScene);
  const externalTextMasks = useMemo(() => {
    const receiverIds = new Set<string>();
    for (const a of cueFrame.arrivals) receiverIds.add(a.receiver.id);
    for (const st of cueFrame.staticEmphasis) if (st.receiver) receiverIds.add(st.receiver.id);
    if (!receiverIds.size) return [] as Rect[];
    const byId = new Map(visible.map((e) => [e.id, e]));
    return visible
      .filter((e) => !e.isDeleted && e.type === "text" && (!e.containerId || !receiverIds.has(e.containerId)))
      .map((e) => renderedTextBox(e, byId))
      .filter((b): b is Rect => b !== null);
  }, [visible, cueFrame.arrivals, cueFrame.staticEmphasis]);
  const outlineMaskId = `wb-cue-mask-${current}`;
  return (
    <div
      className={`wb-ex${animate ? " wb-ex-animate" : ""}${dark ? " wb-ex-dark" : ""}${rest ? " wb-settled" : ""}`}
      style={{ aspectRatio: `${target.w} / ${target.h}`, width: `min(100%, calc((100vh - 150px) * ${(target.w / target.h).toFixed(4)}))` } as CSSProperties}
      role="group"
      aria-label={label}
      data-step={current}
      data-elements={visible.length}
      data-complete={complete || undefined}
      data-nodes={count((e) => e.customData?.wb?.role === "node" && e.type !== "text")}
      data-edges={count((e) => e.customData?.wb?.role === "edge")}
      data-formulas={count((e) => typeof e.customData?.tex === "string")}
      data-plots={count((e) => /^b-.*-ax$/.test(e.id))}
      data-cards={count((e) => e.customData?.wb?.role === "block" && e.strokeStyle === "dashed")}
      data-sketches={count((e) => e.type === "image" && !e.customData?.media)}
      data-media={count((e) => e.type === "image" && Boolean(cleanBoardMedia(e.customData?.media)))}
      data-cue-mode={cueMode}
      data-cue-phase={cueFrame.phase}
      data-cue-edge={activeEdgeId || undefined}
      data-cue-signals={cueFrame.signals.length}
      data-cue-arrivals={cueFrame.arrivals.length}
      data-cue-static={cueFrame.staticEmphasis.length}
    >
      <div ref={host} className="wb-ex-host" />
      {showCueLayer && (
        <svg
          ref={cueSvgRef}
          className="wb-cue-layer"
          data-wb-cue="layer"
          viewBox={sceneViewBox(activeView)}
          aria-hidden="true"
          focusable="false"
        >
          {externalTextMasks.length > 0 && (
            <defs>
              <mask
                id={outlineMaskId}
                maskUnits="userSpaceOnUse"
                x={activeView.x - 40}
                y={activeView.y - 40}
                width={activeView.w + 80}
                height={activeView.h + 80}
              >
                <rect x={activeView.x - 40} y={activeView.y - 40} width={activeView.w + 80} height={activeView.h + 80} fill="#ffffff" />
                {externalTextMasks.map((tb, i) => (
                  <rect key={i} x={tb.x - 2} y={tb.y - 2} width={tb.w + 4} height={tb.h + 4} fill="#000000" />
                ))}
              </mask>
            </defs>
          )}
          {cueFrame.signals.map((s) => {
            const st = cueSignalStyle(s.color, dark);
            const dotR = toScene(s.overLabel ? st.overLabelDotRadiusPx : st.dotRadiusPx);
            const haloR = toScene(s.overLabel ? st.overLabelHaloRadiusPx : st.haloRadiusPx);
            const haloOp = s.overLabel ? st.overLabelHaloOpacity : st.haloOpacity;
            const ringW = toScene(2);
            const chevSize = toScene(s.overLabel ? 4.2 : 4.8);
            const chevW = toScene(2);
            return (
              <g key={`sig-${s.edgeId}`} data-wb-cue="signal" data-edge={s.edgeId} data-from={s.fromId} data-to={s.toId}>
                {s.trail.length >= 2 && (
                  <polyline
                    points={ptsAttr(s.trail)}
                    fill="none"
                    stroke={st.fill}
                    strokeWidth={toScene(s.overLabel ? 3 : 4.5)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeOpacity={dark ? (s.overLabel ? 0.35 : 0.55) : s.overLabel ? 0.28 : 0.45}
                  />
                )}
                <circle data-wb-cue-halo="1" cx={s.x} cy={s.y} r={haloR} fill={st.fill} fillOpacity={haloOp} />
                <circle data-wb-cue-dot="1" cx={s.x} cy={s.y} r={dotR} fill={st.fill} stroke={st.ringStroke} strokeWidth={ringW} />
                <path
                  d={chevronPath(s.x, s.y, s.angle, chevSize, toScene(1.6))}
                  fill="none"
                  stroke={st.chevronStroke}
                  strokeWidth={chevW}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            );
          })}
          {cueFrame.arrivals.map((a) => {
            const accent = cueAccentColor(a.color, dark);
            const op = Math.max(0, Math.min(1, a.intensity));
            const maskUrl = externalTextMasks.length > 0 ? `url(#${outlineMaskId})` : undefined;
            return (
              <g key={`arr-${a.edgeId}`} data-wb-cue="arrival" data-edge={a.edgeId} data-to={a.receiver.id}>
                <g mask={maskUrl}>
                  <ReceiverOutline receiver={a.receiver} color={accent} strokeWidth={toScene(5)} strokeOpacity={op * (dark ? 0.32 : 0.24)} pad={a.outlinePad} />
                  <ReceiverOutline receiver={a.receiver} color={accent} strokeWidth={toScene(2.8)} strokeOpacity={op * 0.95} fillOpacity={op * (dark ? 0.12 : 0.06)} pad={a.outlinePad} />
                </g>
                <path
                  d={chevronPath(a.tip.x, a.tip.y, a.tip.angle, toScene(8.5), toScene(1.8))}
                  fill="none"
                  stroke={accent}
                  strokeWidth={toScene(2.6)}
                  strokeOpacity={op * 0.9}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            );
          })}
          {cueFrame.staticEmphasis.map((st) => {
            const accent = cueAccentColor(st.color, dark);
            const maskUrl = externalTextMasks.length > 0 ? `url(#${outlineMaskId})` : undefined;
            return (
              <g key={`st-${st.edgeId}`} data-wb-cue="static" data-edge={st.edgeId} data-from={st.fromId} data-to={st.toId}>
                {st.tail.length >= 2 && (
                  <polyline
                    points={ptsAttr(st.tail)}
                    fill="none"
                    stroke={accent}
                    strokeWidth={toScene(3.2)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeOpacity={dark ? 0.65 : 0.48}
                  />
                )}
                <path
                  d={chevronPath(st.tip.x, st.tip.y, st.tip.angle, toScene(8.5), toScene(1.8))}
                  fill="none"
                  stroke={accent}
                  strokeWidth={toScene(2.8)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeOpacity={0.95}
                />
                {st.receiver && (
                  <g mask={maskUrl}>
                    <ReceiverOutline
                      receiver={st.receiver}
                      color={accent}
                      strokeWidth={toScene(2.6)}
                      strokeOpacity={0.92}
                      fillOpacity={dark ? 0.12 : 0.06}
                      dash={`${toScene(7).toFixed(1)} ${toScene(4.5).toFixed(1)}`}
                      pad={st.outlinePad}
                    />
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {/* what the board says, for a screen reader (the drawing itself is hidden from it) */}
      <ul className="wb-sr">{words.map((w, i) => <li key={i}>{w}</li>)}</ul>
      {/* A GIF or a video on the board is shown over its element as it is (lib/whiteboard/media.ts): the dark
          board is Excalidraw's light one inverted, which would invert a picture's colours too. A video is muted,
          looping, with play/pause. */}
      {visible.map((e) => {
        const m = e.type === "image" ? cleanBoardMedia(e.customData?.media) : undefined;
        if (!m) return null;
        const box = { left: pct(e.x - target.x, target.w), top: pct(e.y - target.y, target.h), width: pct(e.width, target.w), height: pct(e.height, target.h) };
        if (m.kind === "gif") {
          const f = e.fileId ? scene.files[e.fileId] : undefined;
          return f && /^data:image\/gif;base64,/.test(f.dataURL) ? <img key={e.id} className="wb-gif" src={f.dataURL} alt={m.caption} style={box} /> : null;
        }
        const f = m.video ? scene.files[m.video] : undefined;
        if (!f || !isVideoFile(f.dataURL)) return null;
        return <BoardVideo key={e.id} src={f.dataURL} label={m.caption} playLabel={videoLabels?.play ?? "Play"} pauseLabel={videoLabels?.pause ?? "Pause"} style={box} />;
      })}
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
