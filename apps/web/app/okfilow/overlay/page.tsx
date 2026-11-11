"use client";
// OK Filow overlay: one transparent, click-through window per display. Draws the buddy dot next to
// the mouse, the waveform while listening, a spinner while thinking, the answer bubble, and flies
// the dot along a curve to the things the answer points at.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLang } from "@filow/ui";
import { okFilowBridge, type OkFilowCard, type OkFilowMode } from "@/lib/buddy/bridge";
import { bezierPoint, bubblePlacement } from "@/lib/buddy/motion";
import { joinNames, type OutboundSnapshot } from "@/lib/buddy/outbound";
import type { BuddyMark } from "@/lib/buddy/prompt";
import { okfText, type OkfKey } from "@/lib/buddy/text";
import { dictationText } from "@/lib/dictation/text";
import { OutboundIcon } from "../outbound-ui";
import "../okfilow.css";

const OFFSET = { x: 16, y: 20 };
const FLY_MS = 650;
const HOLD_MS = 5500;
const STROKE_GAP_MS = 900;

/** SVG path for one mark, drawn like a quick pen stroke (circles are slightly open ellipses). */
function markPath(m: BuddyMark): string {
  switch (m.kind) {
    case "circle": {
      const rx = m.r * 1.12;
      const ry = m.r * 0.92;
      const pts = Array.from({ length: 41 }, (_, i) => {
        const a = -2.2 + (i / 40) * Math.PI * 2.12;
        const wob = 1 + 0.035 * Math.sin(i * 1.7);
        return `${(m.x + Math.cos(a) * rx * wob).toFixed(1)},${(m.y + Math.sin(a) * ry * wob).toFixed(1)}`;
      });
      return "M" + pts.join(" L");
    }
    case "underline": {
      const mid = (m.x1 + m.x2) / 2;
      return `M${m.x1},${m.y + 2} Q${mid},${m.y - 3} ${m.x2},${m.y + 1}`;
    }
    case "box": {
      const p = 6;
      return `M${m.x1 - p},${m.y1 - p} L${m.x2 + p},${m.y1 - p + 2} L${m.x2 + p - 1},${m.y2 + p} L${m.x1 - p + 2},${m.y2 + p - 1} Z`;
    }
    case "arrow": {
      const ang = Math.atan2(m.y2 - m.y1, m.x2 - m.x1);
      const head = 16;
      const l = { x: m.x2 - head * Math.cos(ang - 0.45), y: m.y2 - head * Math.sin(ang - 0.45) };
      const r = { x: m.x2 - head * Math.cos(ang + 0.45), y: m.y2 - head * Math.sin(ang + 0.45) };
      const bend = { x: (m.x1 + m.x2) / 2 - (m.y2 - m.y1) * 0.12, y: (m.y1 + m.y2) / 2 + (m.x2 - m.x1) * 0.12 };
      return `M${m.x1},${m.y1} Q${bend.x},${bend.y} ${m.x2},${m.y2} M${l.x},${l.y} L${m.x2},${m.y2} L${r.x},${r.y}`;
    }
  }
}

/** Where a mark's label sits: just outside the shape, below-right. */
function labelAt(m: BuddyMark): { x: number; y: number } {
  switch (m.kind) {
    // Above the circle: the answer bubble usually sits below the buddy, so a label below would collide.
    case "circle": return { x: m.x + m.r * 0.6, y: Math.max(4, m.y - m.r - 30) };
    case "underline": return { x: m.x1, y: m.y + 10 };
    case "box": return { x: m.x1, y: Math.max(m.y1, m.y2) + 12 };
    case "arrow": return { x: m.x1, y: m.y1 + 10 };
  }
}

type Target = { x: number; y: number; label: string };

export default function OkFilowOverlay() {
  const dot = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<OkFilowMode>("idle");
  const [purpose, setPurpose] = useState("talk");
  const [text, setText] = useState("");
  const [level, setLevel] = useState(0);
  const [label, setLabel] = useState("");
  // Near the bottom or right edge the label goes above or to the left of the arrow, never off screen.
  const [flip, setFlip] = useState("");
  const [here, setHere] = useState(false);
  const [marks, setMarks] = useState<{ id: number; list: BuddyMark[] }>({ id: 0, list: [] });
  const [cards, setCards] = useState<OkFilowCard[]>([]);
  // Highlighter: while the talk chord is held the overlay takes the mouse; a drag marks the screen.
  const [ink, setInk] = useState<Array<Array<[number, number]>>>([]);
  const live = useRef<Array<[number, number]> | null>(null);
  // Going outside: on while anything carrying the user's content is in flight (main decides).
  const [out, setOut] = useState<OutboundSnapshot>({ active: false, kinds: [], names: [] });
  const lang = useLang();
  const t = useCallback((k: OkfKey) => okfText(lang)(k), [lang]);
  const going = out.active && out.names.length > 0;

  const pos = useRef({ x: -100, y: -100 });
  const cursor = useRef<{ x: number; y: number } | null>(null);
  const queue = useRef<Target[]>([]);
  const flight = useRef<{ from: { x: number; y: number }; to: Target; start: number; holdUntil: number } | null>(null);

  useEffect(() => {
    const b = okFilowBridge();
    if (!b) return;
    const applyColor = (c?: string) => { if (c && /^#[0-9a-f]{6}$/i.test(c)) document.documentElement.style.setProperty("--okf-ink", c); };
    void b.status().then((s) => applyColor(s.color)).catch(() => {});
    const offs = [
      b.onConfig((s) => applyColor(s.color)),
      b.onStrokes(() => setInk([])),
      b.onState((s) => {
        setMode(s.mode);
        setPurpose(s.purpose ?? "talk");
        if (s.mode !== "listening" && live.current) {
          const l = live.current;
          live.current = null;
          if (l.length > 1) b.stroke(l);
        }
        // The marks go away once the answer is on its way; the model already has them in the screenshot.
        if (s.mode === "speaking" || s.mode === "idle" || s.mode === "error") setInk([]);
      }),
      b.onText(setText),
      b.outbound?.onChange(setOut) ?? (() => {}),
      b.onLevel(setLevel),
      b.onCursor((p) => { cursor.current = p; }),
      b.onDraw((list) => {
        // Kept until main sends okfilow:clear (Escape, the panel's Clear, or the next question).
        setMarks((m) => ({ id: m.id + 1, list: Array.isArray(list) ? list : [] }));
      }),
      b.onCards((list) => setCards(Array.isArray(list) ? list.slice(0, 2) : [])),
      b.onClear(() => {
        setCards([]);
        setMarks((m) => (m.list.length ? { id: m.id + 1, list: [] } : m));
        queue.current = [];
        flight.current = null;
        setLabel("");
      }),
      b.onPoint((points) => {
        queue.current = [...points];
        flight.current = null;
        setLabel("");
      }),
    ];
    // Listeners are in place: ask for the state sent while this page was still loading.
    b.overlayReady();
    let raf = 0;
    const tick = (now: number) => {
      const f = flight.current;
      if (!f && queue.current.length) {
        const to = queue.current.shift()!;
        const from = pos.current.x < 0 ? { x: to.x - 120, y: to.y - 120 } : { ...pos.current };
        flight.current = { from, to, start: now, holdUntil: now + FLY_MS + HOLD_MS };
      }
      const g = flight.current;
      let next: { x: number; y: number } | null = null;
      if (g) {
        const k = Math.min(1, (now - g.start) / FLY_MS);
        next = bezierPoint(g.from, g.to, k);
        if (k >= 1) {
          setLabel((l) => (l === g.to.label ? l : g.to.label));
          const f = (g.to.y > window.innerHeight - 56 ? " okf-label--up" : "") + (g.to.x > window.innerWidth - 240 ? " okf-label--left" : "");
          setFlip((v) => (v === f ? v : f));
        }
        if (now > g.holdUntil || (queue.current.length && now > g.start + FLY_MS + 1800)) { flight.current = null; setLabel(""); }
      } else if (cursor.current) {
        const c = cursor.current;
        const want = { x: c.x + OFFSET.x, y: c.y + OFFSET.y };
        // Ease toward the pointer: snappy, but returning from a point glides back.
        const p = pos.current.x < 0 ? want : { x: pos.current.x + (want.x - pos.current.x) * 0.35, y: pos.current.y + (want.y - pos.current.y) * 0.35 };
        next = p;
      }
      const showing = Boolean(g || cursor.current);
      setHere((h) => (h === showing ? h : showing));
      if (next) {
        pos.current = next;
        if (dot.current) dot.current.style.transform = `translate(${next.x}px, ${next.y}px)`;
        if (bubble.current) {
          const r = bubble.current.getBoundingClientRect();
          const at = bubblePlacement(next, { width: r.width, height: r.height }, { width: window.innerWidth, height: window.innerHeight });
          bubble.current.style.transform = `translate(${at.x}px, ${at.y}px)`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); offs.forEach((o) => o()); };
  }, []);

  const bars = [0.55, 0.85, 1, 0.8, 0.5];
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    live.current = [[e.clientX, e.clientY]];
    setInk((k) => [...k, live.current!]);
  };
  const onMove = (e: React.PointerEvent) => {
    const l = live.current;
    if (!l) return;
    const last = l[l.length - 1];
    if (Math.hypot(e.clientX - last[0], e.clientY - last[1]) < 3) return;
    l.push([e.clientX, e.clientY]);
    setInk((k) => [...k.slice(0, -1), [...l]]);
  };
  const onUp = () => {
    const l = live.current;
    live.current = null;
    if (l && l.length > 1) okFilowBridge()?.stroke(l);
  };
  return (
    <>
    <div className={"okf-overlay" + (mode === "listening" && purpose === "talk" ? " okf-overlay--catch" : "")} aria-hidden onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {cards.length > 0 && (() => {
        // A column beside the spot the first card explains; the cards stack by their real heights,
        // and the column is kept on screen (it scrolls inside itself only if it is taller).
        const w = 260;
        const est = cards.reduce((sum, c) => sum + (c.photo ? 270 : 130) + 12, 0);
        const left = Math.min(Math.max(8, cards[0].x + 24), window.innerWidth - w - 8);
        const top = Math.min(Math.max(8, cards[0].y - 40), Math.max(8, window.innerHeight - est - 8));
        return (
          <div className="okf-cards" style={{ left, top, width: w, maxHeight: window.innerHeight - top - 8 }}>
            {cards.map((c, i) => (
              <article key={i} className="okf-card" style={{ animationDelay: `${300 + i * 400}ms` }}>
                {c.photo && <img src={c.photo} alt="" />}
                <div>
                  {c.title && <strong>{c.title}</strong>}
                  {c.text}
                </div>
              </article>
            ))}
          </div>
        );
      })()}
      {ink.length > 0 && (
        <svg className="okf-draw okf-ink" width="100%" height="100%">
          {ink.map((l, i) => <polyline key={i} points={l.map((p) => p.join(",")).join(" ")} />)}
        </svg>
      )}
      {marks.list.length > 0 && (
        <svg key={marks.id} className="okf-draw" width="100%" height="100%">
          {marks.list.map((m, i) => (
            <g key={i} className="okf-mark" style={{ animationDelay: `${i * STROKE_GAP_MS}ms` }}>
              <path d={markPath(m)} pathLength={1} style={{ animationDelay: `${i * STROKE_GAP_MS}ms` }} />
              {m.label && (
                <foreignObject x={labelAt(m).x} y={labelAt(m).y} width="240" height="40">
                  <span className="okf-mark-label" style={{ animationDelay: `${i * STROKE_GAP_MS + 450}ms` }}>{m.label}</span>
                </foreignObject>
              )}
            </g>
          ))}
        </svg>
      )}
      {/* Going outside wins over the other pills, and shows on every display: it must not be missed. */}
      {going ? (
        <div className="okf-notch okf-notch--out">
          <OutboundIcon />
          <strong>{t("outLabel")}</strong>
          <span>{t("outSending").replace("{names}", joinNames(out.names, t("outAnd")))}</span>
        </div>
      ) : here && (mode === "listening" || mode === "thinking") && (
        <div className="okf-notch">
          <span className={"okf-notch-dot okf-notch-dot--" + mode} />
          {t(mode === "thinking" ? "notchLooking" : purpose === "dictate" ? "notchDictating" : purpose === "handsfree" ? "notchHandsFree" : "notchListening")}
        </div>
      )}
      <div ref={dot} className={`okf-buddy okf-buddy--${mode}${going ? " okf-buddy--out" : ""}${here ? "" : " okf-hidden"}`}>
        {going && <span className="okf-out-rings"><i /><i /><i /></span>}
        <svg className="okf-arrow" viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l17 8-7.5 2.2L10.4 20z" /></svg>
        {label && <span className={"okf-label" + flip}>{label}</span>}
      </div>
      <div ref={bubble} className={`okf-bubble${here && (text || mode === "listening" || mode === "thinking") ? "" : " okf-hidden"}${mode === "error" ? " okf-bubble--error" : ""}`}>
        {mode === "listening" && (
          <span className="okf-wave">{bars.map((b, i) => <i key={i} style={{ height: `${4 + Math.round(level * b * 18)}px` }} />)}</span>
        )}
        {mode === "thinking" && <span className="okf-spin" />}
        {text && <span className="okf-text">{text}</span>}
      </div>
    </div>
    {/* Dictation's start and end for screen readers (outside the hidden overlay), from the display with the mouse only. */}
    <div className="okf-sr" role="status" aria-live="polite">
      {here && purpose === "dictate" && mode === "listening" ? dictationText(lang, "startedLive") : ""}
    </div>
    </>
  );
}
