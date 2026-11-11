// The voice drives the clock. A step is one spoken sentence plus the drawing made while it is
// said: the drawing of a step is spread over the time its sentence takes, so the pen never runs
// ahead of the words. (The idea is that of haiderfarooq3/khan-explainer, MIT: "a beat is one spoken
// clause plus the drawing that happens while it is said; the renderer fits the drawing to the
// beat". No code of that project is used here: its scenes are drawing functions with coordinates
// written by a model and rendered offline; Filow lays the board out itself and plays live.)
//
// A live voice cannot be measured before it speaks, so the time a sentence will take is estimated
// from what this voice has taken so far (PaceMeter), the drawing is fitted to a little less than
// that, and when the voice ends the board is completed at once.
import type { BoardLayout } from "./layout";

/** Letters a second, before any sentence has been heard: a calm reading voice. Kana and kanji carry more sound each. */
const START_RATE = { latin: 14, cjk: 6.5 };
const CJK = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;
/** The drawing takes this part of the time the sentence is expected to take: it ends before the voice does. */
export const DRAW_SHARE = 0.88;
export const PACE_LIMITS = { minMs: 1_200, maxMs: 20_000 };

/** What a sentence weighs for the clock: its letters, with the pauses of its punctuation. */
export function spokenUnits(text: string): number {
  const letters = Array.from(text.replace(/\s+/g, " ").trim());
  const pauses = letters.filter((ch) => ",.;:!?、。".includes(ch)).length;
  return letters.length + pauses * 4;
}

/**
 * How long this voice takes to say a sentence, learned from the sentences it has said: every
 * measured sentence moves the rate towards what was heard, so the second step already fits the
 * voice in use (a slow natural voice, a fast system voice, a speed the user set).
 */
export class PaceMeter {
  private rate: number | null = null;
  private heard = 0;
  /** The time `text` is expected to take, in ms. */
  estimate(text: string): number {
    const rate = this.rate ?? (CJK.test(text) ? START_RATE.cjk : START_RATE.latin);
    const ms = (spokenUnits(text) / rate) * 1000 + 250;
    return Math.round(Math.min(PACE_LIMITS.maxMs, Math.max(PACE_LIMITS.minMs, ms)));
  }
  /** A sentence was heard from start to end and took `ms`. A cut or a failed voice (far too short) teaches nothing. */
  learn(text: string, ms: number): void {
    const units = spokenUnits(text);
    if (units < 8 || ms < 600) return;
    const seen = (units / Math.max(1, ms - 250)) * 1000;
    if (!Number.isFinite(seen) || seen < 2 || seen > 60) return;
    // the first sentence heard counts in full, later ones for a third
    this.rate = this.rate === null ? seen : this.rate + (seen - this.rate) / 3;
    this.heard++;
  }
  get measured(): boolean {
    return this.heard > 0;
  }
}

export type Slot = { at: number; len: number };

/** How much pen work a thing is, relative to the others of its step. */
const WEIGHT = { node: 3, edge: 2.4, mark: 1.2, formula: 2.4, note: 2, card: 2, plot: 4, cells: 3, sketch: 3 } as const;

/**
 * When each new thing of a step is drawn, in ms from the start of the step: one after the other in
 * the order a teacher draws them (boxes, then the arrows between them, then what is written
 * beside), each for a share of `drawMs` that follows its weight. Keys: `n:<id>` for a box,
 * the edge key, the mark key, the block key. Nothing starts before 0 and nothing ends after `drawMs`.
 */
export function stepSchedule(layout: BoardLayout, step: number, drawMs: number): Map<string, Slot> {
  const things: Array<{ key: string; weight: number }> = [];
  for (const nd of layout.nodes) if (nd.step === step) things.push({ key: `n:${nd.id}`, weight: WEIGHT.node });
  for (const e of layout.edges) if (e.step === step) things.push({ key: e.key, weight: WEIGHT.edge });
  for (const m of layout.marks) if (m.step === step) things.push({ key: m.key, weight: WEIGHT.mark });
  for (const b of layout.blocks) if (b.step === step) things.push({ key: b.key, weight: WEIGHT[b.kind] });
  const slots = new Map<string, Slot>();
  const total = things.reduce((sum, t) => sum + t.weight, 0);
  if (!total || !(drawMs > 0)) return slots;
  // a thing is never drawn slower than a hand would: a step with one box does not take six seconds over it
  const unit = Math.min(drawMs / total, 520);
  let at = 0;
  for (const t of things) {
    const len = Math.round(unit * t.weight);
    slots.set(t.key, { at: Math.round(at), len });
    at += unit * t.weight;
  }
  return slots;
}

/** The time the drawing of a step gets when its sentence is expected to take `sayMs`. */
export const drawMsFor = (sayMs: number) => Math.round(sayMs * DRAW_SHARE);
