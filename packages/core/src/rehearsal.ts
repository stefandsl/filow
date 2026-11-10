// The rehearsal report (research item 1): what a take sounded like, made on this computer from what
// the prompter already has (committed transcript with the time it arrived, partial-text activity,
// the points' states and the sections shown). Nothing here leaves the PC. Pure: the caller passes
// the time.
//
// Honest limits, also shown in the report's help text:
// - Times are when the speech engine reported words, not audio timestamps: a pause is a stretch with
//   no new words for LONG_PAUSE_MS. Engines that report only finished phrases (no partial text) get
//   each phrase's start estimated from its length at an average pace.
// - Many speech models leave out "um" and "uh"; the filler count only sees what was transcribed.
import { t, type I18nKey, type Lang } from "./i18n";
import { fold, tokenize } from "./text";
import { sectionTimes, talkBudget, TalkClockTracker } from "./rehearsal-timer";
import type { TranscriptEvent } from "./engine";
import type { PointStatus, Script, SessionState, TalkClock } from "./types";

export type SpeechLanguage = "en" | "it" | "ru" | "ro" | "ja";
export const SPEECH_LANGUAGES: SpeechLanguage[] = ["en", "it", "ru", "ro", "ja"];

/** A silence at least this long counts as a long pause. */
export const LONG_PAUSE_MS = 3000;

/**
 * Filler words, one small list per language, matched on whole tokens of the folded text (text.ts:
 * lower case, Latin accents off, so "păi" is "pai" and "cioè" is "cioe").
 * - `sound`: a hesitation sound of any length ("ummm", "ăăă", "эээ", "えーー").
 * - `words`: a word or a fixed phrase.
 * - `alone`: also an everyday word ("あの人" is "that person", "вот" is "here is"), so it counts only
 *   right before a comma, a full stop or the end of a phrase (not a question mark).
 * Kept short on purpose: a word that is often meant (English "like", "so", "actually", Italian
 * "allora", "tipo") is left out, so the count errs low rather than blaming real words.
 */
type Filler = { label: string; sound?: RegExp; words?: string[]; alone?: boolean };
export const FILLERS: Record<SpeechLanguage, Filler[]> = {
  en: [
    { label: "um", sound: /^u+m+$/ },
    { label: "uh", sound: /^u+h+$/ },
    { label: "er", sound: /^e+r+m*$/ },
    { label: "hmm", sound: /^h*m{2,}$/ },
    { label: "you know", words: ["you", "know"], alone: true },
    { label: "I mean", words: ["i", "mean"], alone: true },
    { label: "basically", words: ["basically"] },
    { label: "literally", words: ["literally"] },
  ],
  it: [
    { label: "ehm", sound: /^e+h*m+$|^e+h+$/ },
    { label: "uhm", sound: /^u+h*m+$/ },
    { label: "mmm", sound: /^m{2,}$/ },
    { label: "cioè", words: ["cioe"] },
    { label: "diciamo", words: ["diciamo"], alone: true },
    { label: "praticamente", words: ["praticamente"] },
    { label: "insomma", words: ["insomma"] },
    { label: "come dire", words: ["come", "dire"] },
  ],
  ru: [
    { label: "э", sound: /^э+м*$/ },
    { label: "мм", sound: /^м{2,}$/ },
    { label: "ну", words: ["ну"] },
    { label: "как бы", words: ["как", "бы"] },
    { label: "это самое", words: ["это", "самое"], alone: true },
    { label: "короче", words: ["короче"] },
    { label: "типа", words: ["типа"], alone: true },
    { label: "вот", words: ["вот"], alone: true },
    { label: "значит", words: ["значит"], alone: true },
  ],
  ro: [
    { label: "ă", sound: /^a{2,}$/ },
    { label: "î", sound: /^i{3,}$/ }, // "îi" (him, her) folds to "ii"
    { label: "eee", sound: /^e{2,}$/ },
    { label: "mmm", sound: /^h*m{2,}$/ },
    { label: "păi", words: ["pai"] },
    { label: "adică", words: ["adica"] },
    { label: "practic", words: ["practic"], alone: true },
    { label: "cum să zic", words: ["cum", "sa", "zic"] },
    { label: "deci", words: ["deci"], alone: true },
  ],
  ja: [
    { label: "えーと", sound: /^え[ーぇ〜]*(?:っ?と)$/ },
    { label: "えっと", words: ["えっ", "と"] },
    { label: "えー", sound: /^え[ーぇ〜]+$/ },
    { label: "あのー", sound: /^あの[ーう〜]+$/ },
    { label: "あのう", words: ["あの", "う"] }, // the word cutter splits "あのう" in two
    { label: "うーん", sound: /^う[ー〜]+ん$/ },
    { label: "まあ", sound: /^ま[あー]+$/ },
    { label: "なんか", words: ["なんか"], alone: true },
    { label: "あの", words: ["あの"], alone: true },
  ],
};

/**
 * Comfortable pace, a rough guide per language: words per minute, characters per minute for
 * Japanese (whose words are not separated). Typical presentation speeds from public speaking
 * coaching; Russian words are longer, Japanese counts kana and kanji.
 */
export const PACE_RANGE: Record<SpeechLanguage, [number, number]> = {
  en: [120, 170],
  it: [120, 180],
  ro: [110, 170],
  ru: [100, 150],
  ja: [250, 380],
};

const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu;
const CYRILLIC = /\p{Script=Cyrillic}/gu;
const LETTER = /[\p{L}\p{N}]/gu;
const IS_JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
// A question mark is not a pause here: "Do you know?" and "Что это значит?" are meant.
const PAUSE_PUNCT = /^\s*(?:[,.;:!…、。，．！]|$)/u;

const MARKERS: Record<"en" | "it" | "ro", Set<string>> = {
  en: new Set("the and is are of to that this we you it was with for".split(" ")),
  it: new Set("il lo la di che e non per un una sono questo come gli del della".split(" ")),
  ro: new Set("si este sunt de in care pe nu cu o un mai ca la acest pentru".split(" ")),
};

/** The language a transcript is in, from its letters and its commonest words. */
export function detectSpeechLanguage(text: string): SpeechLanguage {
  const letters = (text.match(LETTER) ?? []).length || 1;
  if ((text.match(JAPANESE) ?? []).length / letters > 0.3) return "ja";
  if ((text.match(CYRILLIC) ?? []).length / letters > 0.5) return "ru";
  const tokens = tokenize(text).map((tok) => tok.norm);
  const score = (l: "en" | "it" | "ro") => tokens.filter((w) => MARKERS[l].has(w)).length;
  const best = (["en", "it", "ro"] as const).map((l) => [l, score(l)] as const).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : "en";
}

/** Filler counts in one stretch of text, by label. */
export function countFillers(text: string, lang: SpeechLanguage): Map<string, number> {
  const tokens = tokenize(text);
  const counts = new Map<string, number>();
  const list = [...FILLERS[lang]].sort((a, b) => (b.words?.length ?? 1) - (a.words?.length ?? 1));
  for (let i = 0; i < tokens.length; ) {
    const hit = list.find((f) => {
      const n = f.words?.length ?? 1;
      if (i + n > tokens.length) return false;
      const ok = f.sound ? f.sound.test(tokens[i].norm) : f.words!.every((w, k) => tokens[i + k].norm === fold(w));
      return ok && (!f.alone || PAUSE_PUNCT.test(text.slice(tokens[i + n - 1].end)));
    });
    if (hit) {
      counts.set(hit.label, (counts.get(hit.label) ?? 0) + 1);
      i += hit.words?.length ?? 1;
    } else i++;
  }
  return counts;
}

/** Words (characters for Japanese) in a stretch of speech; filler sounds count too, they take time. */
export function speechUnits(text: string, lang: SpeechLanguage): number {
  if (lang === "ja") return (text.match(LETTER) ?? []).length;
  return tokenize(text).filter((tok) => /[\p{L}\p{N}]/u.test(tok.norm)).length;
}

// ---- recording a take ---------------------------------------------------------------------

export type TakeSegment = { text: string; /** when the words began (estimated without partial text) */ startAt: number; /** when the phrase was committed */ at: number };
export type PointEvent = { id: string; from: PointStatus; to: PointStatus; at: number; sectionIdx: number; manual: boolean };

/** Everything a report is made from. Times are epoch ms on this computer. */
export type TakeLog = {
  clock: TalkClock;
  segments: TakeSegment[];
  /** moments the speech engine reported words in progress (partial text) */
  activity: number[];
  /** point state changes during the take */
  pointEvents: PointEvent[];
  /** each point's state when the take started, and when it stopped */
  pointsAtStart: Record<string, PointStatus>;
  pointsAtEnd: Record<string, PointStatus>;
  manualAtEnd: string[];
};

const statusOf = (state: Pick<SessionState, "points">) => Object.fromEntries(Object.entries(state.points).map(([id, p]) => [id, p.status]));

/**
 * Records one take for the report: call `observe` with every engine state and `transcript` with
 * every speech event. A new take (recording turns on) starts a new log.
 */
export class TakeRecorder {
  private clock = new TalkClockTracker();
  private segments: TakeSegment[] = [];
  private activity: number[] = [];
  private pointEvents: PointEvent[] = [];
  private pointsAtStart: Record<string, PointStatus> = {};
  private last: Record<string, PointStatus> = {};
  private recording = false;
  private partialSince = false;
  private finished: TakeLog | null = null;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Call right before the engine loads a script: during a take the log starts again with it. */
  scriptLoading(): void {
    this.clock.scriptLoading();
  }

  observe(state: Pick<SessionState, "sectionIdx" | "points" | "engine">): void {
    const now = this.now();
    const wasRecording = this.recording;
    const startedBefore = this.clock.snapshot(now).startedAt;
    this.clock.observe(state, now);
    this.recording = state.engine.recording;
    // A new take, or another script loaded during this one (the clock starts again with it).
    if (this.recording && (!wasRecording || this.clock.snapshot(now).startedAt !== startedBefore)) {
      this.segments = [];
      this.activity = [];
      this.pointEvents = [];
      this.partialSince = false;
      this.finished = null;
      this.pointsAtStart = statusOf(state);
      this.last = { ...this.pointsAtStart };
      return;
    }
    if (!wasRecording) return;
    for (const [id, p] of Object.entries(state.points)) {
      const from = this.last[id] ?? "waiting";
      if (p.status !== from) this.pointEvents.push({ id, from, to: p.status, at: now, sectionIdx: state.sectionIdx, manual: p.evidence?.source === "manual" });
    }
    this.last = statusOf(state);
    if (!this.recording) {
      this.finished = {
        clock: this.clock.snapshot(now),
        segments: this.segments,
        activity: this.activity,
        pointEvents: this.pointEvents,
        pointsAtStart: this.pointsAtStart,
        pointsAtEnd: this.last,
        manualAtEnd: Object.entries(state.points).filter(([, p]) => p.status === "started" && p.evidence?.source === "manual").map(([id]) => id),
      };
    }
  }

  transcript(e: TranscriptEvent): void {
    if (!this.recording) return;
    const now = this.now();
    const committed = e.committed?.trim();
    if (committed) {
      const prev = this.segments[this.segments.length - 1]?.at ?? this.clock.snapshot(now).startedAt ?? now;
      // Without partial text the phrase arrives whole when it ends: estimate when it began.
      const startAt = this.partialSince ? now : Math.max(prev, now - estimateMs(committed));
      this.segments.push({ text: committed, startAt, at: now });
      this.partialSince = false;
    } else if (e.partial && /\p{L}/u.test(e.partial) && !/^\s*\(/.test(e.partial)) {
      // "(reconnecting…)", "(transcription lagging…)" and "…" are status, not speech
      this.activity.push(now);
      this.partialSince = true;
    }
  }

  /** The last finished take, or null while one runs or before the first. */
  result(): TakeLog | null {
    return this.finished;
  }

  /** The talk clock of the current or last take. */
  talkClock(): TalkClock {
    return this.clock.snapshot(this.now());
  }
}

function estimateMs(text: string): number {
  const lang: SpeechLanguage = IS_JAPANESE.test(text) ? "ja" : "en";
  const [lo, hi] = PACE_RANGE[lang];
  return (speechUnits(text, lang) / ((lo + hi) / 2)) * 60_000;
}

// ---- the report ---------------------------------------------------------------------------

/** "earlier": already ticked when this take started (from an earlier take, nothing was reset). */
export type PointOutcome = "covered" | "late" | "missed" | "notReached" | "earlier";
export const POINT_OUTCOMES: PointOutcome[] = ["covered", "late", "earlier", "missed", "notReached"];

export type RehearsalReport = {
  lang: SpeechLanguage;
  startedAt: number;
  durationMs: number;
  /** from the first to the last words, without the long pauses */
  speakingMs: number;
  /** words, or characters for Japanese */
  units: number;
  pace: { unit: "wpm" | "cpm"; value: number | null; band: "slow" | "ok" | "fast" | null; range: [number, number] };
  fillers: { total: number; perMinute: number; top: Array<{ label: string; count: number }> };
  pauses: { count: number; longestMs: number; list: Array<{ atMs: number; ms: number; sectionIdx: number }> };
  talkTargetMs: number | null;
  sections: Array<{ idx: number; title: string; spentMs: number; targetMs: number | null; visited: boolean; outcomes: Record<PointOutcome, number> }>;
  points: Array<{ id: string; text: string; sectionIdx: number; outcome: PointOutcome; manual: boolean }>;
  suggestions: Array<{ key: I18nKey; vars: Record<string, string | number> }>;
};

/** A pace needs this much speech to mean anything. */
const MIN_SPEECH_FOR_PACE = 20_000;

export function buildRehearsalReport(log: TakeLog, script: Pick<Script, "sections" | "minutes">, opts: { lang?: SpeechLanguage | "auto" } = {}): RehearsalReport {
  const startedAt = log.clock.startedAt ?? log.segments[0]?.startAt ?? 0;
  const endedAt = log.clock.endedAt ?? log.segments[log.segments.length - 1]?.at ?? startedAt;
  const durationMs = Math.max(0, endedAt - startedAt);
  const text = log.segments.map((s) => s.text).join(" ");
  const lang = opts.lang && opts.lang !== "auto" ? opts.lang : detectSpeechLanguage(text);

  // Speech activity as intervals; a long pause is a gap between them.
  const spans = [...log.segments.map((s) => [s.startAt, s.at] as const), ...log.activity.map((a) => [a, a] as const)].sort((a, b) => a[0] - b[0]);
  const sectionAt = (time: number) => {
    let idx = log.clock.entries[0]?.idx ?? 0;
    for (const e of log.clock.entries) if (e.at <= time) idx = e.idx;
    return idx;
  };
  const pauses: RehearsalReport["pauses"]["list"] = [];
  let reach = spans[0]?.[1] ?? 0;
  for (const [from, to] of spans.slice(1)) {
    if (from - reach >= LONG_PAUSE_MS) pauses.push({ atMs: reach - startedAt, ms: from - reach, sectionIdx: sectionAt(reach) });
    reach = Math.max(reach, to);
  }
  const pauseMs = pauses.reduce((a, p) => a + p.ms, 0);
  const speakingMs = spans.length ? Math.max(0, reach - spans[0][0] - pauseMs) : 0;

  const units = speechUnits(text, lang);
  const range = PACE_RANGE[lang];
  const value = speakingMs >= MIN_SPEECH_FOR_PACE ? Math.round(units / (speakingMs / 60_000)) : null;
  const band = value === null ? null : value < range[0] ? "slow" : value > range[1] ? "fast" : "ok";

  const fillerCounts = new Map<string, number>();
  for (const s of log.segments) for (const [label, n] of countFillers(s.text, lang)) fillerCounts.set(label, (fillerCounts.get(label) ?? 0) + n);
  const fillerTotal = [...fillerCounts.values()].reduce((a, b) => a + b, 0);
  const top = [...fillerCounts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 3);
  const minutes = Math.max(speakingMs, 1) / 60_000;

  // Points: covered in time, covered after their section was left, skipped, or not reached.
  const visited = new Set(log.clock.entries.map((e) => e.idx));
  const finalIdx = log.clock.entries[log.clock.entries.length - 1]?.idx ?? -1;
  const manual = new Set(log.manualAtEnd);
  const points: RehearsalReport["points"] = script.sections.flatMap((sec, sectionIdx) =>
    sec.bullets.map((b) => {
      const end = log.pointsAtEnd[b.id] ?? "waiting";
      const events = log.pointEvents.filter((e) => e.id === b.id);
      let outcome: PointOutcome;
      if (end === "started") {
        const tick = events.filter((e) => e.to === "started").pop();
        // Ticked before this take began and never touched in it: nothing this take said earned it.
        if (!tick) outcome = "earlier";
        else outcome = tick.sectionIdx > sectionIdx || events.some((e) => e.to === "missed") || log.pointsAtStart[b.id] === "missed" ? "late" : "covered";
      } else {
        // Skipped: marked missed during this take (the presenter moved past it), or left open in a
        // section shown and left. Still open in the section showing at Stop, or in a section this
        // take never showed (even if an earlier take marked it missed): the take ended first.
        const missedNow = events.some((e) => e.to === "missed");
        outcome = missedNow || (visited.has(sectionIdx) && sectionIdx !== finalIdx) ? "missed" : "notReached";
      }
      return { id: b.id, text: b.text, sectionIdx, outcome, manual: manual.has(b.id) };
    }),
  );

  const budget = talkBudget(script);
  const spent = sectionTimes(log.clock, script.sections.length, endedAt);
  const sections = script.sections.map((sec, idx) => {
    const outcomes: Record<PointOutcome, number> = { covered: 0, late: 0, earlier: 0, missed: 0, notReached: 0 };
    for (const p of points) if (p.sectionIdx === idx) outcomes[p.outcome]++;
    return { idx, title: sec.title, spentMs: spent[idx] ?? 0, targetMs: budget.sections[idx] ?? null, visited: visited.has(idx), outcomes };
  });

  const report: RehearsalReport = {
    lang,
    startedAt,
    durationMs,
    speakingMs,
    units,
    pace: { unit: lang === "ja" ? "cpm" : "wpm", value, band, range },
    fillers: { total: fillerTotal, perMinute: Math.round((fillerTotal / minutes) * 10) / 10, top },
    pauses: { count: pauses.length, longestMs: Math.max(0, ...pauses.map((p) => p.ms)), list: pauses },
    talkTargetMs: budget.talkMs,
    sections,
    points,
    suggestions: [],
  };
  report.suggestions = suggest(report);
  return report;
}

const mins = (ms: number) => Math.max(1, Math.round(ms / 60_000));

/** One or two plain next steps, the most useful first. */
function suggest(r: RehearsalReport): RehearsalReport["suggestions"] {
  if (r.units === 0) return [{ key: "report.tip.noSpeech", vars: {} }];
  const out: Array<{ score: number; key: I18nKey; vars: Record<string, string | number> }> = [];
  const missed = r.points.filter((p) => p.outcome === "missed");
  if (missed.length) out.push({ score: 100, key: missed.length === 1 ? "report.tip.missedOne" : "report.tip.missed", vars: { n: missed.length, point: missed[0].text } });
  const long = r.sections
    .filter((s) => s.targetMs !== null && s.spentMs - s.targetMs >= Math.max(30_000, s.targetMs * 0.2))
    .sort((a, b) => b.spentMs - (b.targetMs ?? 0) - (a.spentMs - (a.targetMs ?? 0)))[0];
  if (r.talkTargetMs !== null && r.durationMs - r.talkTargetMs >= 60_000) out.push({ score: 90, key: "report.tip.talkLong", vars: { over: mins(r.durationMs - r.talkTargetMs), target: mins(r.talkTargetMs) } });
  else if (long) out.push({ score: 80, key: "report.tip.sectionLong", vars: { section: long.title, over: mins(long.spentMs - (long.targetMs ?? 0)) } });
  if (r.pace.band === "fast") out.push({ score: 70, key: r.pace.unit === "cpm" ? "report.tip.fastJa" : "report.tip.fast", vars: { value: r.pace.value ?? 0, hi: r.pace.range[1] } });
  if (r.pace.band === "slow") out.push({ score: 50, key: r.pace.unit === "cpm" ? "report.tip.slowJa" : "report.tip.slow", vars: { value: r.pace.value ?? 0, lo: r.pace.range[0] } });
  if (r.fillers.total >= 5 && r.fillers.perMinute >= 3) out.push({ score: 60, key: "report.tip.fillers", vars: { word: r.fillers.top[0]?.label ?? "", n: r.fillers.top[0]?.count ?? 0 } });
  if (r.pauses.count >= 4) out.push({ score: 40, key: "report.tip.pauses", vars: { n: r.pauses.count } });
  if (!out.length) return [{ key: "report.tip.good", vars: {} }];
  return out.sort((a, b) => b.score - a.score).slice(0, 2).map(({ key, vars }) => ({ key, vars }));
}

// ---- Markdown -----------------------------------------------------------------------------

const clockText = (ms: number) => {
  const s = Math.round(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** The report as Markdown, in the interface language; `notes` (live screen notes) is appended as is. */
export function rehearsalMarkdown(r: RehearsalReport, lang: Lang, notes?: string): string {
  const when = new Date(r.startedAt).toLocaleString(lang);
  const pace = r.pace.value === null ? t("report.paceShort", lang) : t(r.pace.unit === "cpm" ? "report.cpm" : "report.wpm", lang, { n: r.pace.value });
  const out = [
    `# ${t("report.title", lang)}`,
    "",
    t("report.madeHere", lang, { when }),
    "",
    `## ${t("report.nextSteps", lang)}`,
    "",
    ...r.suggestions.map((s) => `- ${t(s.key, lang, s.vars)}`),
    "",
    `## ${t("report.overview", lang)}`,
    "",
    `- ${t("report.length", lang)}: ${clockText(r.durationMs)}${r.talkTargetMs !== null ? ` (${t("report.target", lang)} ${clockText(r.talkTargetMs)})` : ""}`,
    `- ${t("report.pace", lang)}: ${pace}${r.pace.band ? ` (${t(`report.band.${r.pace.band}` as I18nKey, lang)}, ${t("report.paceRange", lang, { lo: r.pace.range[0], hi: r.pace.range[1] })})` : ""}`,
    `- ${t("report.fillers", lang)}: ${r.fillers.total}${r.fillers.top.length ? ` (${r.fillers.top.map((f) => `"${f.label}" ${f.count}`).join(", ")})` : ""}`,
    `- ${t("report.pauses", lang)}: ${r.pauses.count}${r.pauses.count ? ` (${t("report.longest", lang)} ${Math.round(r.pauses.longestMs / 1000)} s)` : ""}`,
    "",
    `## ${t("report.sections", lang)}`,
    "",
    `| ${t("report.section", lang)} | ${t("report.time", lang)} | ${t("report.targetCol", lang)} | ${t("report.pointsCol", lang)} |`,
    "|---|---|---|---|",
    ...r.sections.map((s) => {
      const pts = POINT_OUTCOMES.filter((k) => s.outcomes[k]).map((k) => `${s.outcomes[k]} ${t(`report.outcome.${k}` as I18nKey, lang)}`).join(", ") || "-";
      return `| ${s.title.replace(/\|/g, "\\|")} | ${s.visited ? clockText(s.spentMs) : "-"} | ${s.targetMs !== null ? clockText(s.targetMs) : "-"} | ${pts} |`;
    }),
    "",
  ];
  for (const k of ["missed", "late", "notReached"] as const) {
    const list = r.points.filter((p) => p.outcome === k);
    if (list.length) out.push(`## ${t(`report.list.${k}` as I18nKey, lang)}`, "", ...list.map((p) => `- ${p.text}`), "");
  }
  out.push(`_${t("report.limits", lang)}_`, "");
  if (notes) out.push(notes.replace(/^#/gm, "##"), "");
  return out.join("\n");
}
