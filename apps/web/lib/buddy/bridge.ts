// Types for window.okFilow (apps/desktop/okfilow-preload.js).
import type { ConsentChanges, ConsentMap, OutboundKind, OutboundSnapshot, Recipient } from "./outbound";
import type { BuddyMark } from "./prompt";
import type { BuddyModel } from "./visuals";

/** A card in global DIP coordinates, with its photo already fetched (data URL or ""). */
export type OkFilowCard = { x: number; y: number; title: string; text: string; photo: string };
export type OkFilowMode = "idle" | "listening" | "thinking" | "speaking" | "error";

/** apps/desktop/dictation.js status(): settings, the key choices, and what this PC can do. */
export type DictationStatus = {
  enabled: boolean;
  chord: string;
  mode: "hold" | "toggle";
  language: "auto" | "en" | "it" | "ru" | "ro" | "ja";
  insert: "paste" | "copy";
  removeFillers: boolean;
  /** English dictations written out by S1-mini by Superwhisper on this PC (apps/desktop/dictation-cleanup.js). */
  cleanup: boolean;
  cleanupStyle: "casual" | "semi-casual" | "semi-formal" | "formal";
  cleanupLists: boolean;
  /** The model is on this computer and the runtime is in this build. */
  cleanupReady?: boolean;
  cleanupState?: { runtime: boolean; model: boolean; downloading: boolean; pct: number; bytes: number; error: string } | null;
  /** Italian, Russian, Romanian, Japanese: marks and capitals where the recognizer left none (apps/desktop/dictation-punctuate.js). Missing on older builds. */
  punctuate?: boolean;
  punctuateState?: { runtime: boolean; model: boolean; downloading: boolean; pct: number; bytes: number; error: string } | null;
  sound: boolean;
  platform: string;
  chords: Array<{ value: string; label: string }>;
  chordLabel: string;
  talk: string;
  talkLabel: string;
  check: { ok: boolean; conflict: "same" | "overlap" | "invalid" | null; warnings: Array<"altgr" | "layout"> };
  /** False while the keyboard hook is not registered, so the dictation keys do nothing (missing on older builds). */
  hookReady?: boolean;
  canPaste: boolean;
  copyReason: "" | "setting" | "nohook" | "wayland" | "accessibility";
  modelReady: boolean | null;
  /** A screen reader is running: the start and stop tones play whatever the sound setting says. */
  screenReader?: boolean;
};
/** What happened to a dictation (apps/desktop/dictation.js insert()). */
export type DictationResult = { ok: boolean; action: "paste" | "typed" | "copy" | "direct" | "refused" | "none"; reason: string; chars: number };

export type OkFilowStatus = {
  enabled: boolean;
  hotkey: string;
  /** Answers from: this PC, OpenRouter, or the user's FreeLLMAPI router (lib/freellm.ts). */
  provider: "local" | "cloud" | "freellm";
  /** "natural" = the neural voice that runs on this PC (apps/desktop/tts.js). */
  voice: "natural" | "system" | "cloud" | "off";
  /** Which of the natural voices speaks: 0-4 female, 5-9 male. */
  naturalVoice?: number;
  showAlways: boolean;
  dictation: boolean;
  color: string;
  speed: number;
  typedVoice: boolean;
  allowScreenshots?: boolean;
  answerDir?: string;
  answerLog?: boolean;
  agentCli?: string;
  onboarded?: boolean;
  /** What the user allowed or refused to send outside, per kind and recipient. */
  consent?: ConsentMap;
  /** "Look at my screen": the user's choice, or "auto" while the setup for this computer decides (lib/buddy/sees.ts). Missing on older builds. */
  seeScreen?: "auto" | "on" | "off";
  handsFree: boolean;
  dictateChord: string;
  /** Dictation's own settings and checks (apps/desktop/dictation.js). */
  dictationStatus?: DictationStatus;
  hotkeys: string[];
  offline: boolean;
  hook: "hold" | "toggle";
  hookError: string;
  /** macOS: the permission hold-to-talk still needs (apps/desktop/mac-permissions.js); absent or "" elsewhere. */
  hookPermission?: "accessibility" | "inputMonitoring" | "";
  mode: OkFilowMode;
};

export type OkFilowCapture = {
  images: string[];
  screens: Array<{ index: number; width: number; height: number; cursor?: boolean }>;
  displays: Array<{ index: number; id: number; bounds: { x: number; y: number; width: number; height: number } }>;
  /** Highlighter strokes the user drew while asking, on the 0-1000 grid of each screen. */
  marked: Array<{ screen: number; points: Array<[number, number]> }>;
  /** Text the user had selected in the focused app when they started talking ("" when none). */
  selected?: string;
};

type Off = () => void;

/** The natural voice on this PC: is its model here, and can this PC carry it. */
export type OkFilowTtsStatus = {
  installed: boolean;
  state: "idle" | "downloading" | "extracting" | "ready" | "error";
  /** Download progress 0-100 (what is already on disk when a download was interrupted). */
  pct: number;
  error: string;
  sizeBytes: number;
  voices: number;
  /** "system" when this PC cannot carry the model; `reason` says why. */
  mode: "natural" | "system";
  level: "standard" | "light" | "";
  reason: "" | "lowMemory" | "fewCores" | "slow";
};
export type OkFilowTtsChunk = { id: number; seq: number; last: boolean; samples: Float32Array; sampleRate: number; pause: number };
export type OkFilowTtsReply =
  | { ok: true; cancelled: boolean; chunks: number; sent: number; level: string }
  | { ok: false; reason: "notInstalled" | "lowMemory" | "fewCores" | "slow" | "failed"; error?: string };

/** A background "agent, ..." job (apps/desktop/okfilow-agents.js). */
export type OkFilowJob = {
  id: string;
  title: string;
  task: string;
  cli: "codex" | "claude";
  dir: string;
  status: "running" | "done" | "failed" | "stopped";
  startedAt: string;
  finishedAt?: string;
  summary: string;
  artifacts: string[];
};
/** The agent was not started: the user has not said yes to the maker of the CLI that would run it. */
export type OkFilowAgentConsent = { needsConsent: { kind: "agent"; recipient: Recipient; cli: string } };
/** A settings change. Consent goes as `consentChanges` (merged by main), never as a whole map. */
export type OkFilowPatch = Partial<Omit<OkFilowStatus, "consent">> & { consentChanges?: ConsentChanges };
export type OkFilowBridge = {
  accessPassword: string;
  sessionUrl: string;
  status(): Promise<OkFilowStatus>;
  configure(patch: OkFilowPatch): Promise<OkFilowStatus>;
  /** `images: false` ("Look at my screen" is off): no picture of the screen is taken; `images` comes back empty. */
  capture(opts?: { images?: boolean }): Promise<OkFilowCapture>;
  setMode(mode: OkFilowMode, extra?: Record<string, unknown>): Promise<void>;
  level(v: number): void;
  text(t: string): void;
  point(points: Array<{ x: number; y: number; label: string }>): void;
  /** Marks already in global DIP coordinates; each overlay draws the ones on its display. */
  draw(marks: BuddyMark[]): void;
  /** Overlay -> main: one finished highlighter stroke, in overlay-local coordinates. */
  stroke(points: Array<[number, number]>): void;
  /** Panel -> overlays: explanation cards (global DIP). */
  cards(list: OkFilowCard[]): void;
  /** Panel -> main: open the 3D model window with this model. */
  showModel(model: BuddyModel): void;
  /** Model window -> main: loaded, send me the model. */
  modelReady(): void;
  /** Overlay -> main: my listeners are registered, send me the current state. */
  overlayReady(): void;
  closeModel(): void;
  /** Model window -> panel (through main): ask OK Filow about a clicked part. */
  askAbout(text: string): void;
  /** Whiteboard tutor (docs/whiteboard/SPEC.md). Absent in a desktop build older than the whiteboard. */
  showWhiteboard?(topic: string): void;
  whiteboardReady?(): void;
  closeWhiteboard?(): void;
  onWhiteboard?(fn: (topic: string) => void): Off;
  /** Puts dictated text where the focus is (typed, pasted or only copied; see DictationResult). */
  /** `phrase`: one phrase of a hands-free dictation (it follows the phrases typed before it). */
  typeText(text: string, language?: string, phrase?: boolean): Promise<DictationResult>;
  handsFreeOff(): void;
  agents: {
    /** Starts a job when the text is an "agent, ..." request; resolves null otherwise, or needsConsent when the user must agree first. */
    start(text: string, context?: string): Promise<OkFilowJob | OkFilowAgentConsent | null>;
    list(): Promise<OkFilowJob[]>;
    stop(id: string): Promise<OkFilowJob[]>;
    remove(id: string): Promise<OkFilowJob[]>;
    open(path: string): Promise<string>;
    onChange(fn: (jobs: OkFilowJob[]) => void): Off;
    onDone(fn: (job: OkFilowJob) => void): Off;
  };
  /** "Going outside": report each send carrying the user's content; main shows it on the pointer and the panel. */
  outbound?: {
    begin(id: string, kind: OutboundKind, names: string[]): void;
    end(id: string, opts?: { cancel?: boolean }): void;
    onChange(fn: (s: OutboundSnapshot) => void): Off;
    /** Panel -> main: my listener is registered, send me what is going out right now. */
    ready(): void;
  };
  /** A first-send notice is open (main shows the panel and keeps it) or closed. */
  notice?: { open(): void; close(): void };
  hidePanel(): void;
  clearVisuals(): void;
  answerLog(entry: { question: string; raw: string; visuals: unknown; images: string[]; svg?: string }): Promise<string>;
  pickAnswerDir(): Promise<OkFilowStatus>;
  openAnswers(): Promise<boolean>;
  deleteAnswers(): Promise<number>;
  /** Stop the answer in progress (the Stop button, Escape). Main tells the panel through onStop. Absent in a desktop build older than Stop. */
  stopAnswer?(source?: "button" | "panel"): void;
  onStop?(fn: (p: { source?: string } | undefined) => void): Off;
  /** Overlay -> main: the pointer is on (or off) the Stop button, so this overlay takes the mouse meanwhile. */
  overlayHover?(on: boolean): void;
  press(): void;
  release(): void;
  /** `handsFree`: a dictation with the keys up, typed phrase by phrase until the keys are pressed once more. */
  onPress(fn: (p: { purpose: "talk" | "dictate"; handsFree?: boolean; upgrade?: boolean } | undefined) => void): Off;
  onRelease(fn: (p: { purpose: "talk" | "dictate" | null } | undefined) => void): Off;
  onCancel(fn: (p: { purpose: "talk" | "dictate" | null } | undefined) => void): Off;
  onConfig(fn: (s: OkFilowStatus) => void): Off;
  onMode(fn: (s: { mode: OkFilowMode; error?: string }) => void): Off;
  /** `sees`: this question took the screen with it; `stopped`: the user stopped the answer. */
  onState(fn: (s: { mode: OkFilowMode; error?: string; purpose?: string; sees?: boolean; stopped?: boolean }) => void): Off;
  onCursor(fn: (p: { x: number; y: number } | null) => void): Off;
  onLevel(fn: (v: number) => void): Off;
  onText(fn: (t: string) => void): Off;
  onPoint(fn: (points: Array<{ x: number; y: number; label: string }>) => void): Off;
  onDraw(fn: (marks: BuddyMark[]) => void): Off;
  /** The screen changed under the drawing (click, key, app switch): wipe it. */
  onClear(fn: () => void): Off;
  onCards(fn: (list: OkFilowCard[]) => void): Off;
  onModel(fn: (model: BuddyModel) => void): Off;
  onAskText(fn: (text: string) => void): Off;
  /** Main -> overlays: wipe the user's highlighter strokes (cancelled ask). */
  onStrokes(fn: (s: unknown[]) => void): Off;
  onHandsFree(fn: (on: boolean) => void): Off;
  onQuickAsk(fn: () => void): Off;
  /** First run: where the tray icon is (global DIP), or null. */
  onWelcome(fn: (tray: { x: number; y: number } | null) => void): Off;
  stt: {
    status(): Promise<{ ready: boolean }>;
    start(language: string): Promise<unknown>;
    feed(samples: Float32Array): void;
    stop(): Promise<unknown>;
    onResult(fn: (r: { partial: string; committed: string; error?: string }) => void): Off;
  };
  /** Absent in a desktop build older than the natural voice. */
  tts?: {
    status(): Promise<OkFilowTtsStatus>;
    /** The click is the consent: fetches the voice model (resumes a partial download). */
    download(): Promise<OkFilowTtsStatus>;
    remove(): Promise<OkFilowTtsStatus>;
    /** Loads the model ahead of the answer. */
    warm(): Promise<boolean>;
    speak(req: { id: number; text: string; lang: string; voice?: number; speed?: number }): Promise<OkFilowTtsReply>;
    cancel(id?: number): Promise<void>;
    played(info: { id: number; seconds: number; interrupted: boolean; state: string }): void;
    onChunk(fn: (c: OkFilowTtsChunk) => void): Off;
    onStatus(fn: (s: OkFilowTtsStatus) => void): Off;
  };
};

export function okFilowBridge(): OkFilowBridge | null {
  if (typeof window === "undefined") return null;
  return ((window as unknown as { okFilow?: OkFilowBridge }).okFilow) ?? null;
}

/**
 * The slice of the same IPC surface the main window gets (window.filow.okFilow, apps/desktop/preload.js):
 * Filow Settings shows OK Filow's main switches; the full list stays in the panel.
 */
export type OkFilowSettingsBridge = Pick<OkFilowBridge, "status" | "configure"> & { openPanel(): void };

export function okFilowSettingsBridge(): OkFilowSettingsBridge | null {
  return (globalThis as { filow?: { okFilow?: OkFilowSettingsBridge } }).filow?.okFilow ?? null;
}
/** Joins the committed sherpa text and the live partial into the question. */
export function joinTranscript(committed: string[], partial: string): string {
  return [...committed, partial].map((s) => s.trim()).filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim();
}
