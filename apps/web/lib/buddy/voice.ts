// How OK Filow speaks an answer (docs/okfilow/VOICE.md). Three voices:
//   natural - the neural voice on this PC: apps/desktop/tts.js makes the audio piece by piece and
//             this module plays the pieces back to back, so speech starts after the first one;
//   system  - the voice built into this PC (speechSynthesis), the zero-download fallback;
//   cloud   - ElevenLabs through /api/buddy/tts, only when the user chose it.
// A natural voice that cannot speak falls back to the system voice and says why; a system voice that
// does not exist for the language stays silent and says why. Nothing here
// ever falls back to the cloud.
import type { OkFilowBridge, OkFilowStatus, OkFilowTtsReply, OkFilowTtsStatus } from "./bridge";
import { detectDominantLanguage, SPOKEN_LANGS, type SpokenLang } from "@filow/core";
import { voiceRoute } from "./outbound";
import { speechDeadline } from "./speech";
import { splitSentences } from "./turn";

export const VOICE_LANGS = SPOKEN_LANGS;
export type VoiceLang = SpokenLang;
export type VoiceChoice = OkFilowStatus["voice"];
/** Why the natural voice did not speak. */
export type VoiceFallback = "notInstalled" | "lowMemory" | "fewCores" | "slow" | "failed";

const isLang = (v: unknown): v is VoiceLang => (VOICE_LANGS as readonly string[]).includes(String(v));
const BCP47: Record<VoiceLang, string> = { en: "en-US", it: "it-IT", ru: "ru-RU", ro: "ro-RO", ja: "ja-JP" };

/**
 * The language of a text, for picking the voice (packages/core/src/spoken.ts). `fallback` (the app
 * language) decides when the text gives no hint.
 */
export function detectLang(text: string, fallback: string = "en"): VoiceLang {
  const back: VoiceLang = isLang(fallback) ? fallback : "en";
  return detectDominantLanguage(text, back) ?? back;
}

/** What the settings show for the natural voice (apps/web/app/okfilow/panel/voice-settings.tsx). */
export type VoicePanel =
  /** A desktop build older than the natural voice: show nothing. */
  | { show: "none" }
  /** This PC cannot carry the model: say why, offer no download. */
  | { show: "blocked"; reason: "lowMemory" | "fewCores" | "slow" }
  /** Not downloaded yet. `resume` when part of it is already on disk. */
  | { show: "get"; busy: "" | "downloading" | "extracting"; resume: boolean; pct: number; sizeMb: number; problem: "" | "offline" | "failed" }
  /** Downloaded. `light` when this PC uses the lighter setting. */
  | { show: "ready"; light: boolean; voices: number };

export function voicePanel(tts: OkFilowTtsStatus | null | undefined): VoicePanel {
  if (!tts) return { show: "none" };
  if (tts.installed) {
    // A PC that turned out too slow keeps the model on disk but no longer speaks with it.
    return tts.mode === "system" && tts.reason ? { show: "blocked", reason: tts.reason } : { show: "ready", light: tts.level === "light", voices: tts.voices };
  }
  if (tts.mode === "system" && tts.reason) return { show: "blocked", reason: tts.reason };
  const busy = tts.state === "downloading" || tts.state === "extracting" ? tts.state : "";
  const pct = Math.max(0, Math.min(100, Math.round(tts.pct || 0)));
  const problem = tts.state !== "error" ? "" : tts.error === "offline" ? "offline" : "failed";
  return { show: "get", busy, resume: !busy && pct > 0, pct, sizeMb: Math.round(tts.sizeBytes / 1e6), problem };
}

/** Plays the pieces of one answer back to back. */
export interface ChunkPlayer {
  /** Queues a piece; `pauseMs` of silence follows it before the next piece. */
  add(samples: Float32Array, sampleRate: number, pauseMs: number): void;
  /** Seconds of queued audio still to be heard. */
  remaining(): number;
  /** Seconds heard so far. */
  played(): number;
  /** Silences everything at once. */
  stop(): void;
  /**
   * Pause: the piece being heard plays to its end, the pieces not yet begun come off the schedule and
   * are kept in order, with the ones that arrive meanwhile. Nothing is cut.
   */
  pause?(): void;
  /** Carries on with the kept pieces, in order: nothing repeated, nothing skipped. */
  resume?(): void;
  /** The audio output's state, for the log ("running", "suspended"). */
  state(): string;
}

let sharedContext: AudioContext | null = null;

/** The real player: Web Audio, one shared output for the life of the panel. */
export function webAudioPlayer(): ChunkPlayer {
  const ctx = (sharedContext ??= new AudioContext({ latencyHint: "interactive" }));
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  type Piece = { samples: Float32Array; sampleRate: number; pauseMs: number };
  /** On the schedule: begun, or about to. */
  let scheduled: Array<Piece & { at: number; duration: number; source: AudioBufferSourceNode }> = [];
  /** Kept while paused (null when not paused). */
  let held: Piece[] | null = null;
  let next = 0;
  let first = -1;
  let end = 0;
  let stoppedAt = -1;
  /** Seconds of silence a pause added between two pieces: not counted as heard. */
  let idle = 0;
  const schedule = (p: Piece) => {
    const buffer = ctx.createBuffer(1, p.samples.length, p.sampleRate);
    buffer.getChannelData(0).set(p.samples);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    // A piece that arrives late starts at once; one that arrives early waits for its turn.
    const at = Math.max(ctx.currentTime + 0.03, next);
    source.start(at);
    scheduled.push({ ...p, at, duration: buffer.duration, source });
    if (first < 0) first = at;
    end = at + buffer.duration;
    next = end + Math.max(0, p.pauseMs) / 1000;
    return at;
  };
  return {
    add(samples, sampleRate, pauseMs) {
      if (stoppedAt >= 0 || !samples.length) return;
      if (held) held.push({ samples, sampleRate, pauseMs });
      else schedule({ samples, sampleRate, pauseMs });
    },
    remaining: () => (stoppedAt >= 0 ? 0 : Math.max(0, end - ctx.currentTime) + (held ?? []).reduce((sum, p) => sum + p.samples.length / p.sampleRate, 0)),
    played: () => (first < 0 ? 0 : Math.max(0, Math.min(stoppedAt >= 0 ? stoppedAt : ctx.currentTime, end) - first - idle)),
    stop() {
      if (stoppedAt >= 0) return;
      stoppedAt = ctx.currentTime;
      held = null;
      // A 5 ms fade instead of a hard cut, so the interruption does not click.
      gain.gain.setValueAtTime(gain.gain.value, stoppedAt);
      gain.gain.linearRampToValueAtTime(0, stoppedAt + 0.005);
      for (const s of scheduled) { try { s.source.stop(stoppedAt + 0.01); } catch { /* already ended */ } }
      setTimeout(() => gain.disconnect(), 100);
    },
    pause() {
      if (held || stoppedAt >= 0) return;
      const now = ctx.currentTime;
      const begun = scheduled.filter((p) => p.at <= now);
      held = scheduled.filter((p) => p.at > now).map((p) => {
        try { p.source.stop(); } catch { /* never started */ }
        p.source.disconnect();
        return { samples: p.samples, sampleRate: p.sampleRate, pauseMs: p.pauseMs };
      });
      scheduled = begun;
      const cur = begun[begun.length - 1];
      end = cur ? cur.at + cur.duration : 0;
      next = cur ? end + Math.max(0, cur.pauseMs) / 1000 : 0;
    },
    resume() {
      const list = held;
      if (!list) return;
      held = null;
      if (stoppedAt >= 0 || !list.length) return;
      const due = next;
      const at = schedule(list[0]);
      if (due > 0) idle += Math.max(0, at - due);
      for (const p of list.slice(1)) schedule(p);
    },
    state: () => ctx.state,
  };
}

/** The samples of a piece as they arrive over the desktop bridge (a typed array from another realm). */
export function toSamples(v: unknown): Float32Array {
  if (v instanceof Float32Array) return v;
  if (ArrayBuffer.isView(v)) {
    const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return new Float32Array(bytes.slice().buffer);
  }
  if (v instanceof ArrayBuffer) return new Float32Array(v.slice(0));
  if (Array.isArray(v)) return Float32Array.from(v as number[]);
  if (v && typeof v === "object") return Float32Array.from(Object.values(v as Record<string, number>));
  return new Float32Array(0);
}

export type SpeakerDeps = {
  bridge(): OkFilowBridge | null;
  status(): OkFilowStatus | null;
  /** False as soon as a newer question or answer took over the turn `id`. */
  isCurrent(id: number): boolean;
  /** The app language, used when the text itself does not say which language it is in. */
  uiLang(): string;
  /**
   * The cloud voice's audio for `text`, fetched behind the outbound notice and signal (the panel's
   * controller, lib/buddy/outboundClient.ts). A Blob: play it. "system": the user kept the voice on
   * this PC. null: the notice was closed without a choice, say nothing. Without it the cloud voice is
   * never used: this module sends nothing itself.
   */
  cloudAudio?(text: string): Promise<Blob | "system" | null>;
  /** The natural voice could not speak and the system voice took over (once per reason). */
  onFallback?(reason: VoiceFallback): void;
  /** This PC has no voice for the language of the text: nothing was read aloud (once per language). */
  onNoVoice?(lang: VoiceLang): void;
  /**
   * The voice is on sentence `index` of the text it was given (splitSentences): told once per
   * sentence, so the answer bubble can keep that sentence in view. Exact for this PC's voice; worked
   * out from what was played for the natural and the cloud voice.
   */
  onSentence?(index: number): void;
  player?(): ChunkPlayer;
};
export type SpeakOptions = {
  /** en, it, ru, ro or ja; when missing it is detected from the text. */
  lang?: string;
  /** Speak with this voice instead of the chosen one (the preview button). */
  voice?: VoiceChoice;
};

/** Letters and digits only, to measure how much of a text a voice has said whatever the spacing and marks. */
const bare = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
/** How many of `list`'s sentences fit, whole, in the first `chars` letters of the text. */
export function sentencesWithin(list: string[], chars: number): number {
  let n = 0;
  let sum = 0;
  for (const s of list) {
    sum += bare(s).length;
    // Two letters of slack: the text is tidied for speech before it is cut into pieces.
    if (sum > chars + 2) break;
    n++;
  }
  return n;
}

/** Extra time the natural voice gets before it is given up on: its model may still be loading. */
const LOAD_ALLOWANCE_MS = 8000;

export function createSpeaker(deps: SpeakerDeps) {
  /** Bumped by every speak() and stop(): the utterance that holds an older value is over. */
  let token = 0;
  /** Ends the utterance that is being heard right now, without waiting for a timer. */
  let cut: (() => void) | null = null;
  let utterance = 0;
  const told = new Set<VoiceFallback>();
  const mute = new Set<VoiceLang>();
  /** Paused: the voice finishes what cannot be cut cleanly (a sentence, a piece) and holds the rest. */
  let held = false;
  /** What pause and resume do to the voice that is speaking right now. */
  let hooks: { pause?(): void; resume?(): void } = {};
  /** Lets go of whoever waits for the pause to end. */
  let gate: Array<() => void> = [];
  /** Finishes the wait in progress now, without waiting for its next look. */
  let nudge: (() => void) | null = null;
  /** The sentences of the last answer spoken and how many were heard whole (left() is the rest). */
  let said: { list: string[]; done: number } = { list: [], done: 0 };
  /** How many sentences the voice speaking now has finished, when only it can tell (set by the voice). */
  let measure: (() => number) | null = null;
  /** The sentence last reported to onSentence (-1: none yet for this text). */
  let toldAt = -1;
  const tellAt = (index: number) => {
    if (index === toldAt || index < 0 || index >= said.list.length) return;
    toldAt = index;
    deps.onSentence?.(index);
  };
  const openGate = () => {
    const list = gate;
    gate = [];
    for (const fn of list) fn();
  };

  function stop() {
    // Where the voice got to is kept, so a Resume after a stop speaks only the rest.
    if (measure) said.done = Math.max(said.done, Math.min(said.list.length, measure()));
    measure = null;
    token++;
    held = false;
    hooks = {};
    const end = cut;
    cut = null;
    end?.();
    openGate();
  }

  /** Pause: no new sentence or piece starts until resume(). The one being heard is not cut (the cloud voice, one recording, fades out at once). */
  function pause() {
    if (held) return;
    held = true;
    hooks.pause?.();
  }
  function resume() {
    if (!held) return;
    held = false;
    hooks.resume?.();
    openGate();
  }
  /** Resolves when the pause is over: true to carry on, false when the answer was cut meanwhile. */
  function resumed(live: () => boolean) {
    return new Promise<boolean>((resolve) => {
      const done = () => { clearInterval(look); resolve(live() && !held); };
      const look = setInterval(() => { if (!live()) { gate = gate.filter((g) => g !== done); done(); } }, 150);
      gate.push(done);
    });
  }
  /** The part of the last answer the voice has not spoken ("" when it said all of it, or was never asked). */
  const left = () => said.list.slice(said.done).join(" ");

  /** Resolves when `settled()` says so, the deadline passes or the utterance is cut. */
  function wait(live: () => boolean, deadlineMs: number, everyMs: number, settled: () => boolean) {
    return new Promise<"done" | "cut" | "late">((resolve) => {
      let spent = 0;
      let over = false;
      const finish = (how: "done" | "cut" | "late") => {
        if (over) return;
        over = true;
        clearInterval(timer);
        if (cut === onCut) cut = null;
        if (nudge === look) nudge = null;
        resolve(how);
      };
      const onCut = () => finish("cut");
      const look = () => { if (!live()) finish("cut"); else if (settled()) finish("done"); };
      const timer = setInterval(() => {
        look();
        // The natural and the cloud voice: the sentence after the ones heard whole is the one being spoken.
        if (!over && measure && live()) tellAt(Math.min(said.list.length - 1, measure()));
        // The end of speech can go missing (device change, Bluetooth sleep): never stay on "speaking".
        // The clock stands still during a pause: a paused answer is not a lost one.
        if (!held && (spent += everyMs) >= deadlineMs) finish("late");
      }, everyMs);
      cut = onCut;
      nudge = look;
    });
  }

  /** Returns "" when the natural voice spoke (or was cut), else the reason it could not. */
  async function natural(text: string, lang: VoiceLang, live: () => boolean): Promise<VoiceFallback | ""> {
    const tts = deps.bridge()?.tts;
    if (!tts) return tell("failed");
    const s = deps.status();
    const id = ++utterance;
    const player = (deps.player ?? webAudioPlayer)();
    let pieces = 0;
    let last = false;
    /** Each piece's words and how long it takes to hear, to tell later how far the voice got. */
    const heard: Array<{ chars: number; seconds: number }> = [];
    const off = tts.onChunk((c) => {
      if (!c || c.id !== id || !live()) return;
      pieces++;
      if (c.last) last = true;
      const samples = toSamples(c.samples);
      const rate = Number(c.sampleRate) || 44100;
      const pauseMs = c.last ? 0 : Number(c.pause) || 0;
      if (!samples.length) return;
      player.add(samples, rate, pauseMs);
      heard.push({ chars: typeof c.text === "string" ? bare(c.text).length : 0, seconds: samples.length / rate + pauseMs / 1000 });
    });
    hooks = { pause: () => player.pause?.(), resume: () => player.resume?.() };
    // The sentences heard whole: the words of the pieces already played, measured against the answer's sentences.
    measure = () => {
      let seconds = player.played();
      let chars = 0;
      for (const h of heard) {
        if ((seconds -= h.seconds) < -0.05) break;
        chars += h.chars;
      }
      return sentencesWithin(said.list, chars);
    };
    let reply: OkFilowTtsReply | null = null;
    void tts.speak({ id, text, lang, voice: s?.naturalVoice, speed: s?.speed }).then(
      (r) => { reply = r; },
      (e) => { reply = { ok: false, reason: "failed", error: String(e instanceof Error ? e.message : e) }; },
    );
    const how = await wait(live, speechDeadline(text, s?.speed) + LOAD_ALLOWANCE_MS, 40, () => {
      const r = reply;
      if (!r) return false;
      // Every piece has arrived (or none will): done once the last of them has been heard.
      return (!r.ok || r.cancelled || last || !r.sent) && player.remaining() <= 0;
    });
    off();
    if (how === "done" && live()) {
      // Heard to the end; a voice that failed on the way said only what its pieces held.
      const ok = (reply as OkFilowTtsReply | null)?.ok === true;
      said.done = ok ? said.list.length : measure?.() ?? 0;
      measure = null;
      hooks = {};
    }
    if (how !== "done") {
      player.stop();
      void tts.cancel(id).catch(() => {});
    }
    tts.played({ id, seconds: Math.round(player.played() * 100) / 100, interrupted: how === "cut", state: player.state() });
    const r = reply as OkFilowTtsReply | null;
    if (how === "cut" || !r || r.ok) return "";
    tell(r.reason);
    // Part of the answer was already heard: do not start it again in another voice.
    return pieces ? "" : r.reason;
  }

  /** Says once per reason why the system voice is speaking instead of the natural one. */
  function tell(reason: VoiceFallback): VoiceFallback {
    if (!told.has(reason)) {
      told.add(reason);
      deps.onFallback?.(reason);
    }
    return reason;
  }

  async function cloud(text: string, lang: VoiceLang, live: () => boolean) {
    const got = deps.cloudAudio ? await deps.cloudAudio(text) : "system";
    if (got === null || !live()) return;
    if (got === "system") return system(text, lang, live);
    const url = URL.createObjectURL(got);
    const el = new Audio(url);
    let ended = false;
    el.onended = el.onerror = () => { ended = true; };
    el.playbackRate = deps.status()?.speed ?? 1;
    void el.play().catch(() => { ended = true; });
    // One recording: nobody knows where its sentences end, so a pause is taken at once, with a short
    // fade (about 40 ms) instead of a click, and resume carries on from the same position.
    let fade: ReturnType<typeof setInterval> | null = null;
    const unfade = () => { if (fade) clearInterval(fade); fade = null; el.volume = 1; };
    hooks = {
      pause: () => {
        let v = 1;
        fade = setInterval(() => {
          v -= 0.25;
          el.volume = Math.max(0, v);
          if (v <= 0) { unfade(); el.pause(); }
        }, 10);
      },
      resume: () => { unfade(); void el.play().catch(() => { ended = true; }); },
    };
    // How far it got: the share of the recording heard, measured against the answer's sentences.
    measure = () => (el.duration > 0 && Number.isFinite(el.duration) ? sentencesWithin(said.list, Math.floor((bare(said.list.join("")).length * el.currentTime) / el.duration)) : 0);
    if (held) hooks.pause?.();
    const how = await wait(live, speechDeadline(text, deps.status()?.speed), 100, () => ended);
    if (how === "done" && live()) { said.done = said.list.length; measure = null; }
    unfade();
    el.pause();
    URL.revokeObjectURL(url);
  }

  async function system(text: string, lang: VoiceLang, live: () => boolean) {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const voices = synth.getVoices();
    const pick = (want: string) => voices.find((v) => v.lang.toLowerCase().startsWith(want) && v.localService) ?? voices.find((v) => v.lang.toLowerCase().startsWith(want));
    // A voice of another language would read this text as noise (Russian or Japanese in an English
    // voice): when the list is known and has none for the language, stay silent and say why.
    if (voices.length && !pick(lang)) {
      if (!mute.has(lang)) {
        mute.add(lang);
        deps.onNoVoice?.(lang);
      }
      return;
    }
    // One sentence at a time, so a pause can fall between two sentences: the one being spoken is
    // finished, the next ones wait, and resume starts with the first sentence not spoken yet.
    const base = said.done;
    const list = said.list.slice(base);
    measure = null;
    hooks = {};
    for (let i = 0; i < list.length; i++) {
      if (held && !(await resumed(live))) break;
      if (!live()) break;
      const u = new SpeechSynthesisUtterance(list[i]);
      u.voice = pick(lang) ?? null;
      u.lang = BCP47[lang];
      u.rate = 1.05 * (deps.status()?.speed ?? 1);
      let ended = false;
      u.onend = u.onerror = () => { ended = true; nudge?.(); };
      tellAt(base + i);
      synth.speak(u);
      const how = await wait(live, speechDeadline(list[i], deps.status()?.speed), 150, () => ended || (!synth.speaking && !synth.pending));
      if (how !== "done") break;
      said.done = base + i + 1;
    }
    synth.cancel();
  }

  /**
   * Speaks `text` for the turn `id`, with the chosen voice. Whatever was being spoken stops first.
   * Resolves when the speech ended or was interrupted.
   */
  async function speak(text: string, id: number, opts: SpeakOptions = {}) {
    stop();
    const mine = token;
    const live = () => token === mine && deps.isCurrent(id);
    const s = deps.status();
    const voice = opts.voice ?? s?.voice ?? "system";
    said = { list: [], done: 0 };
    toldAt = -1;
    if (!text.trim() || voice === "off") return;
    said = { list: splitSentences(text), done: 0 };
    const lang = isLang(opts.lang) ? opts.lang : detectLang(text, deps.uiLang());
    // One rule decides local or cloud for the voice (lib/buddy/outbound.ts), shared with the notice.
    if (voiceRoute({ voice, offline: s?.offline }) === "cloud") return cloud(text, lang, live);
    if (voice === "natural") {
      const reason = await natural(text, lang, live);
      if (!reason || !live()) return;
    }
    return system(text, lang, live);
  }

  /** Loads the natural voice as soon as a question starts, so the answer does not wait for it. */
  function attach(): () => void {
    const b = deps.bridge();
    if (!b?.tts) return () => {};
    return b.onMode((m) => {
      if ((m.mode === "listening" || m.mode === "thinking") && deps.status()?.voice === "natural") void b.tts?.warm().catch(() => {});
    });
  }

  return { speak, stop, attach, pause, resume, paused: () => held, left };
}
