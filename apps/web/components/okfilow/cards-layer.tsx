"use client";
// The answer's explanation cards on the overlay (HeyClicky-style): a column beside the spot they explain,
// in free space (lib/buddy/cards.ts), with a leader line from that spot to the card. A card is opaque
// from its first frame: only its size and position move as it arrives (no see-through fade over the
// page), and its picture is decoded before the card shows, so it never appears half drawn. A card with
// no picture has no picture area. Cards that go away fade like the marks' labels while their leader
// erases. A picture that arrives later (Wikipedia, after a yes) is decoded, then shown in its card,
// which keeps its place.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { OkFilowCard } from "@/lib/buddy/bridge";
import { CARD_EXIT_MS, CARD_WIDTH, cardLeader, leadersFor, placeCards, sameCards, type CardSpot, type Leader } from "@/lib/buddy/cards";
import type { Rect } from "@/lib/buddy/marks";

type Shown = { id: number; cards: OkFilowCard[]; photos: Array<string | null>; spot: CardSpot | null; leaders: Array<Leader | null>; leaving?: boolean };

/** How long a picture may take to decode before its card shows without it. */
const DECODE_MS = 1500;
/** The leader draws first; the cards land this long after it starts, one after another. */
export const CARD_DELAY_MS = 120;
export const CARD_STAGGER_MS = 90;

/** A picture, decoded and ready to paint: its source, or null when it cannot be shown (no picture area then). */
function decoded(src: string): Promise<string | null> {
  if (!src || typeof Image === "undefined") return Promise.resolve(null);
  const img = new Image();
  img.src = src;
  return Promise.race([img.decode().then(() => src, () => null), new Promise<null>((r) => setTimeout(() => r(null), DECODE_MS))]);
}

const origin: Record<CardSpot["side"], string> = { right: "0 30%", left: "100% 30%", below: "30% 0", above: "30% 100%" };

export function CardsLayer({ cards, avoid }: { cards: OkFilowCard[]; avoid: () => Rect[] }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [leaving, setLeaving] = useState<Shown | null>(null);
  const now = useRef<Shown | null>(null);
  now.current = shown;
  const seq = useRef(0);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const col = useRef<HTMLDivElement>(null);

  useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);

  useEffect(() => {
    /** Cards that were on screen go away with an exit (cards never placed were never seen). */
    const goAway = (s: Shown) => {
      if (!s.spot) return;
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      setLeaving({ ...s, leaving: true });
      leaveTimer.current = setTimeout(() => { leaveTimer.current = null; setLeaving(null); }, CARD_EXIT_MS + 60);
    };
    if (!cards.length) {
      if (now.current) { goAway(now.current); setShown(null); }
      return;
    }
    let live = true;
    void Promise.all(cards.map((c) => decoded(c.photo))).then((photos) => {
      if (!live) return;
      const cur = now.current;
      if (cur && sameCards(cur.cards, cards)) setShown({ ...cur, cards, photos });
      else {
        if (cur) goAway(cur);
        setShown({ id: ++seq.current, cards, photos, spot: null, leaders: [] });
      }
    });
    return () => { live = false; };
  }, [cards]);

  // Placed once the column's real height is known (before it is painted); a later picture keeps the place, kept on screen.
  useLayoutEffect(() => {
    const el = col.current;
    if (!shown || !el) return;
    const view = { width: window.innerWidth, height: window.innerHeight };
    const size = { width: CARD_WIDTH, height: el.offsetHeight };
    const subjects = shown.cards.map((c) => ({ x: c.x, y: c.y }));
    const spot = shown.spot
      ? { ...shown.spot, y: Math.max(12, Math.min(shown.spot.y, view.height - 12 - size.height)) }
      : placeCards(subjects[0], size, view, avoid(), subjects);
    const boxes = Array.from(el.children, (a) => {
      const art = a as HTMLElement;
      return { left: spot.x, top: spot.y + art.offsetTop, right: spot.x + CARD_WIDTH, bottom: spot.y + art.offsetTop + art.offsetHeight };
    });
    const own = leadersFor(subjects);
    const leaders = subjects.map((p, i) => (own[i] && boxes[i] ? cardLeader(p, boxes[i]) : null));
    const same = shown.spot && spot.x === shown.spot.x && spot.y === shown.spot.y && JSON.stringify(leaders) === JSON.stringify(shown.leaders);
    if (!same) setShown({ ...shown, spot, leaders });
  }, [shown, avoid]);

  const draw = (s: Shown) => {
    const cls = s.leaving ? " okf-cards--leaving" : "";
    return (
      <Fragment key={(s.leaving ? "out-" : "in-") + s.id}>
        {s.spot && (
          <svg className={"okf-draw okf-card-leaders" + cls} width="100%" height="100%">
            {s.leaders.map((l, i) => l && (
              <g key={i} className="okf-card-leader">
                <line className="okf-card-halo" x1={l.from.x} y1={l.from.y} x2={l.to.x} y2={l.to.y} pathLength={1} />
                <line className="okf-card-ink" x1={l.from.x} y1={l.from.y} x2={l.to.x} y2={l.to.y} pathLength={1} />
                <circle cx={l.from.x} cy={l.from.y} r={4} />
              </g>
            ))}
          </svg>
        )}
        <div
          ref={s.leaving ? undefined : col}
          className={"okf-cards" + (s.spot ? "" : " okf-cards--measuring") + cls}
          style={{ left: s.spot?.x ?? 0, top: s.spot?.y ?? 0, width: CARD_WIDTH }}
        >
          {s.cards.map((c, i) => (
            <article key={i} className="okf-card" style={{ "--okf-cd": `${CARD_DELAY_MS + i * CARD_STAGGER_MS}ms`, transformOrigin: origin[s.spot?.side ?? "right"] } as CSSProperties}>
              {s.photos[i] && <img src={s.photos[i]!} alt="" decoding="sync" />}
              <div>
                {c.title && <strong>{c.title}</strong>}
                {c.text && <p>{c.text}</p>}
              </div>
            </article>
          ))}
        </div>
      </Fragment>
    );
  };
  return (
    <>
      {leaving && draw(leaving)}
      {shown && draw(shown)}
    </>
  );
}
