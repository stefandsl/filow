// How OK Filow speaks an answer (docs/okfilow/VOICE.md). Three voices:
//   natural - the neural voice on this PC: apps/desktop/tts.js makes the audio piece by piece and
//             this module plays the pieces back to back, so speech starts after the first one;
//   system  - the voice built into this PC (speechSynthesis), the zero-download fallback;
//   cloud   - ElevenLabs through /api/buddy/tts, only when the user chose it.
// A natural voice that cannot speak falls back to the system voice and says why. Nothing here
// ever falls back to the cloud.
import type { OkFilowBridge, OkFilowStatus, OkFilowTtsReply, OkFilowTtsStatus } from "./bridge";
import { voiceRoute } from "./outbound";
import { speechDeadline } from "./speech";

export const VOICE_LANGS = ["en", "it", "ru", "ro", "ja"] as const;
export type VoiceLang = (typeof VOICE_LANGS)[number];
export type VoiceChoice = OkFilowStatus["voice"];
/** Why the natural voice did not speak. */
export type VoiceFallback = "notInstalled" | "lowMemory" | "fewCores" | "slow" | "failed";

const isLang = (v: unknown): v is VoiceLang => (VOICE_LANGS as readonly string[]).includes(String(v));
const BCP47: Record<VoiceLang, string> = { en: "en-US", it: "it-IT", ru: "ru-RU", ro: "ro-RO", ja: "ja-JP" };

// Words that settle the language of a short answer written in Latin letters. Words shared by two
// of the three languages (in, a, e, o, la, si, come, ma, se, le) are left out on purpose.
const words = (list: string) => new Set(list.split(" "));
const RO_WORDS = words("și este sunt pentru care această acest poți vrei din cu nu să mai apoi unde iar sau pe ce cum dacă în de apasă alege deschide bună mulțumesc sigur meniul fișier ești te");
const IT_WORDS = words("il lo gli un una che di è per non con sono del della nel alla questo questa anche puoi più qui poi dove ecco fai clic apri scegli sul sulla ciao grazie certo ed ha alle");
const EN_WORDS = words("the is are and of to you that this for with on can your at has then where click will it open choose sure hello what how do not be have from or if here there my i");

/**
 * The language of a text, for picking the voice. Japanese and Russian are told by their script;
 * English, Italian and Romanian by their letters and most common words. `fallback` (the app
 * language) decides when the text gives no hint.
 */
export function detectLang(text: string, fallback: string = "en"): VoiceLang {
  const back: VoiceLang = isLang(fallback) ? fallback : "en";
  const count = (re: RegExp) => (text.match(re) || []).length;
  const kana = count(/[぀-ヿ]/g);
  const han = count(/[一-鿿]/g);
  const cyr = count(/[Ѐ-ӿ]/g);
  const lat = count(/[a-zÀ-ɏ]/gi);
  if (kana + han + cyr + lat === 0) return back;
  if ((kana + han) * 2 > lat + cyr) return "ja";
  if (cyr > lat) return "ru";
  const lower = text.toLowerCase();
  const score = { en: 0, it: 0, ro: 0 };
  score.ro += 3 * (lower.match(/[ăşșţțâî]/g) || []).length;
  score.it += 2 * (lower.match(/[àèéìòù]/g) || []).length;
  for (const w of lower.match(/\p{L}+/gu) || []) {
    if (RO_WORDS.has(w)) score.ro += 2;
    if (IT_WORDS.has(w)) score.it += 2;
    if (EN_WORDS.has(w)) score.en += 2;
  }
  const best = Math.max(score.en, score.it, score.ro);
  const winners = (["en", "it", "ro"] as const).filter((l) => score[l] === best);
  if (best > 0 && winners.length === 1) return winners[0];
  // No hint, or a tie: the app language when it is one of the tied ones, else English.
  return winners.includes(back as "en") ? back : best > 0 ? winners[0] : "en";
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
  const sources: AudioBufferSourceNode[] = [];
  let next = 0;
  let first = -1;
  let end = 0;
  let stoppedAt = -1;
  return {
    add(samples, sampleRate, pauseMs) {
      if (stoppedAt >= 0 || !samples.length) return;
      const buffer = ctx.createBuffer(1, samples.length, sampleRate);
      buffer.getChannelData(0).set(samples);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      // A piece that arrives late starts at once; one that arrives early waits for its turn.
      const at = Math.max(ctx.currentTime + 0.03, next);
      source.start(at);
      sources.push(source);
      if (first < 0) first = at;
      end = at + buffer.duration;
      next = end + Math.max(0, pauseMs) / 1000;
    },
    remaining: () => (stoppedAt >= 0 ? 0 : Math.max(0, end - ctx.currentTime)),
    played: () => (first < 0 ? 0 : Math.max(0, Math.min(stoppedAt >= 0 ? stoppedAt : ctx.currentTime, end) - first)),
    stop() {
      if (stoppedAt >= 0) return;
      stoppedAt = ctx.currentTime;
      // A 5 ms fade instead of a hard cut, so the interruption does not click.
      gain.gain.setValueAtTime(gain.gain.value, stoppedAt);
      gain.gain.linearRampToValueAtTime(0, stoppedAt + 0.005);
      for (const s of sources) { try { s.stop(stoppedAt + 0.01); } catch { /* already ended */ } }
      setTimeout(() => gain.disconnect(), 100);
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
  player?(): ChunkPlayer;
};
export type SpeakOptions = {
  /** en, it, ru, ro or ja; when missing it is detected from the text. */
  lang?: string;
  /** Speak with this voice instead of the chosen one (the preview button). */
  voice?: VoiceChoice;
};

/** Extra time the natural voice gets before it is given up on: its model may still be loading. */
const LOAD_ALLOWANCE_MS = 8000;

export function createSpeaker(deps: SpeakerDeps) {
  /** Bumped by every speak() and stop(): the utterance that holds an older value is over. */
  let token = 0;
  /** Ends the utterance that is being heard right now, without waiting for a timer. */
  let cut: (() => void) | null = null;
  let utterance = 0;
  const told = new Set<VoiceFallback>();

  function stop() {
    token++;
    const end = cut;
    cut = null;
    end?.();
  }

  /** Resolves when `settled()` says so, the deadline passes or the utterance is cut. */
  function wait(live: () => boolean, deadlineMs: number, everyMs: number, settled: () => boolean) {
    return new Promise<"done" | "cut" | "late">((resolve) => {
      const finish = (how: "done" | "cut" | "late") => {
        clearInterval(timer);
        clearTimeout(stuck);
        if (cut === onCut) cut = null;
        resolve(how);
      };
      const onCut = () => finish("cut");
      const timer = setInterval(() => { if (!live()) finish("cut"); else if (settled()) finish("done"); }, everyMs);
      // The end of speech can go missing (device change, Bluetooth sleep): never stay on "speaking".
      const stuck = setTimeout(() => finish("late"), deadlineMs);
      cut = onCut;
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
    const off = tts.onChunk((c) => {
      if (!c || c.id !== id || !live()) return;
      pieces++;
      if (c.last) last = true;
      const samples = toSamples(c.samples);
      if (samples.length) player.add(samples, Number(c.sampleRate) || 44100, c.last ? 0 : Number(c.pause) || 0);
    });
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
    await wait(live, speechDeadline(text, deps.status()?.speed), 100, () => ended);
    el.pause();
    URL.revokeObjectURL(url);
  }

  async function system(text: string, lang: VoiceLang, live: () => boolean) {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    const pick = (want: string) => voices.find((v) => v.lang.toLowerCase().startsWith(want) && v.localService) ?? voices.find((v) => v.lang.toLowerCase().startsWith(want));
    // A voice for the language of the text when this PC has one, else the app language.
    const want: VoiceLang = !voices.length || pick(lang) ? lang : deps.uiLang() === "it" ? "it" : "en";
    u.voice = pick(want) ?? null;
    u.lang = BCP47[want];
    u.rate = 1.05 * (deps.status()?.speed ?? 1);
    let ended = false;
    u.onend = u.onerror = () => { ended = true; };
    synth.speak(u);
    await wait(live, speechDeadline(text, deps.status()?.speed), 150, () => ended || (!synth.speaking && !synth.pending));
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
    if (!text.trim() || voice === "off") return;
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

  return { speak, stop, attach };
}
