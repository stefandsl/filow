/**
 * Where the session server lives, as seen from the browser.
 * 1. Desktop app: window.filow.sessionUrl (LAN relay or hosted server).
 * 2. NEXT_PUBLIC_SESSION_URL set at build time: use it ("" = same origin, hosted mode behind Caddy).
 * 3. Otherwise: same host, port 4748 (dev).
 */
export type LessonDecision = { presenter: string; teacher: string; confirmation: string; turn: string; window: number; tab: string; action: "open"; url: string };
export type LessonView = {
  phase: "idle" | "preparing" | "ready" | "presenter" | "speaker" | "approval" | "checking" | "dispatched" | "guiding" | "explained" | "interrupted" | "held";
  turn?: string; decision?: LessonDecision; reading?: { temperature: number; dew: number }; micUnavailable?: boolean; confirmation?: string; expired?: boolean; unmatched?: boolean;
};

export type DailyTask = { id: string; rev: number; text: string; due: string; done: boolean; evidence: string; undo: boolean };
export type DailyView = {
  modelGranted?: boolean; modelReady?: boolean;
  session: string; version: number; day: string; today: string; offset: number; tasks: DailyTask[];
  review?: { token: string; type: "create" | "complete" | "reopen"; words: string; text?: string; due: string;
    targets: { id: string; rev: number; text: string }[]; which?: boolean } | null;
  status?: "modelNotReady" | "saved" | "stale" | "noMatch";
  ack?: { id: string; rev: number } | null;
};
export type DailySpeech = { session: string; capture: string; partial?: string; final?: string; error?: boolean;
  stopped?: boolean; status?: "modelNotReady" | "loadingModel" | "stale" | "noMatch" };
export type DailyBridge = {
  feed(session: string, capture: string, samples: Float32Array): void;
  onSpeech(fn: (message: DailySpeech) => void): () => void;
  control(action: string, payload?: Record<string, unknown>): Promise<DailyView>;
};
export type DesktopBridge = {
  daily?: DailyBridge;
  lesson?: {
    control(action: "prepare" | "confirmPresenter" | "talk" | "request" | "approve" | "reconcile" | "observe" | "state" | "stop", turn?: string, payload?: string | LessonDecision): Promise<LessonView>;
    onStop(fn: () => void): () => void;
    onDraft(fn: (turn: string, words: string) => void): () => void;
    onBoard(fn: () => void): () => void;
  };
  relayIdentity?: {
    remember(url: string, identity: { id: string; engineToken: string }): Promise<void>;
    resume(url: string): Promise<{ id: string; engineToken: string } | null>;
  };
  takePlace?: {
    begin(key: string, recover: boolean): Promise<{ writer: string; place: Omit<import("@filow/core").CommittedPlace, "scriptKey"> | null }>;
    save(writer: string, version: number, place: Omit<import("@filow/core").CommittedPlace, "scriptKey"> | null): Promise<boolean>;
  };
  desktop: true;
  account?: {
    status(): Promise<{ configured: boolean; service?: string; user: { email: string; name: string } | null; plan: "local" | "pro"; billing: boolean; checkout?: "open" | "unconfigured" | "billing_not_open"; paidUntil?: string | null }>;
    /** Whether this build has accounts (set at build time); no network call. */
    configured(): Promise<boolean>;
    begin(): Promise<{ userCode: string; expiresAt: number } | null>;
    poll(): Promise<{ state: "pending" | "signed-in" | "cancelled" | "expired" | "denied" }>;
    cancel(): Promise<void>;
    signOut(): Promise<unknown>;
    checkout(): Promise<void | { state: "billing_not_open" }>;
    portal(): Promise<void>;
  };
  tour?: {
    mark(rect: { x: number; y: number; width: number; height: number } | null): Promise<boolean>;
    /** Asks the real assistant the practice question in that language; the shell owns the sentence. */
    ask(lang: string): Promise<boolean>;
    done(): Promise<void>;
  };
  getPreferences?: import("@filow/core").UiBridge["getPreferences"];
  updatePreferences?: import("@filow/core").UiBridge["updatePreferences"];
  onPreferencesChanged?: import("@filow/core").UiBridge["onPreferencesChanged"];
  migrateUiPreferences?: (patch: import("@filow/core").UiPatch) => Promise<import("@filow/core").UiResult>;
  setLang?: (lang: import("@filow/core").UiLanguage) => void;
  setTheme?: (theme: import("@filow/core").UiTheme) => void;
  glass?: boolean;
  mode: "lan" | "hosted";
  sessionUrl: string;
  mirrorOrigin: string;
  /** The address on this network, whatever the public link does (shell 0.9.31+). */
  lanMirrorOrigin?: string;
  /** Relay URL for the phone when it differs from the engine's (public tunnel). */
  mirrorServerUrl?: string;
  remoteShare?: boolean;
  publicLinkUpdatesInPlace?: boolean;
  setRemoteShare?: (on: boolean) => void;
  /** The engine page tells the shell its session so local views (PowerPoint pane) can join it. */
  reportSession?: (info: { id: string; code: string }) => void;
  slideshowState?: () => Promise<SlideShowState>;
  onSlideshow?: (fn: (s: SlideShowState) => void) => () => void;
  closeOverlay?: () => void;
  /** Auto-update (installed app): state, manual check, install when downloaded. */
  updateStatus?: () => Promise<UpdateStatus>;
  takeLog?: (text: string) => void;
  reportProblem?: () => void;
  /** Opens the local About and privacy window (the policy ships in the app, readable offline). */
  openAbout?: (view?: "about" | "report") => void;
  /** Tells the shell a take is live, so an update that finishes downloading does not interrupt it. */
  setTakeLive?: (on: boolean) => void;
  onUpdateStatus?: (fn: (s: UpdateStatus) => void) => () => void;
  checkForUpdates?: () => void;
  installUpdate?: () => void;
  remoteStatus?: () => Promise<RemoteStatus>;
  onRemoteStatus?: (fn: (s: RemoteStatus) => void) => () => void;
  /** Streaming speech-to-text on this PC (desktop app); see packages/stt SherpaBridge. */
  stt?: import("@filow/stt").SherpaBridge;
  /** Phone on this network (desktop app): adapter and firewall diagnostics with one-click fixes. */
  net?: {
    status: () => Promise<NetStatus>;
    allowFirewall: () => Promise<"blocked" | "ok" | "missing" | "n/a">;
    useInterface: (address: string) => Promise<boolean>;
  };
  /** Local AI setup (desktop app): hardware scan, recommendation and the unattended Ollama install. */
  localAi?: {
    status: () => Promise<LocalAiStatus>;
    hardware: () => Promise<LocalAiHardware>;
    install: () => void;
    /** Start an installed Ollama that is not running; never downloads. Absent in an older shell. */
    start?: () => void;
    onStatus: (fn: (s: LocalAiStatus) => void) => () => void;
  };
  accessPassword: string;
  /** The per-launch key the app's own floating windows pair with (the overlay, the points window). */
  appPairKey?: string;
};

export type NetStatus = { ip: string; iface: string; virtual: boolean; canAllowFirewall?: boolean; firewall: "blocked" | "ok" | "missing" | "n/a"; interfaces: Array<{ name: string; address: string; virtual: boolean }> };

export type LocalAiStatus = { state: "idle" | "checking" | "downloading" | "installing" | "starting" | "ready" | "manual" | "error"; pct: number; error: string; version: string; command: string;
  /** On "error": what failed (localai.js installOllama). The page has a sentence for each in the user's language; "" = `error` is already one. */
  code?: string };
export type LocalAiHardware = {
  ramGb: number; gpu: string; gpuClass: "discrete" | "integrated" | "unknown"; freeGb: number; cpu: string; cores: number; platform: string; arch: string;
  recommended: { models: string[]; ollama: boolean; downloadGb: number };
};

export type UpdateStatus = { status: "disabled" | "idle" | "checking" | "downloading" | "downloaded" | "none" | "error"; version: string; error: string; current: string };

export type SlideShowState = { running: boolean; index: number; total: number; title: string };

export type RemoteStatus = {
  state: "off" | "downloading" | "connecting" | "on" | "error";
  /** the public address of the mirror page while the link is on */
  url: string;
  /** the public address of the session relay that goes with `url` */
  session?: string;
  error: string;
  wanted?: boolean;
};

export function desktopBridge(): DesktopBridge | null {
  return (globalThis as { filow?: DesktopBridge }).filow ?? null;
}

export function sessionServerUrl(): string {
  const bridge = desktopBridge();
  if (bridge) return bridge.sessionUrl;
  const configured = process.env.NEXT_PUBLIC_SESSION_URL;
  if (configured !== undefined && configured !== "auto") {
    return configured === "" ? window.location.origin : configured;
  }
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:4748`;
}

/** Origin a phone should open for /mirror. */
export function mirrorOrigin(): string {
  return desktopBridge()?.mirrorOrigin ?? window.location.origin;
}

/** Relay URL the phone should use; the engine's own URL unless the desktop app exposes a public one. */
export function mirrorServerUrl(): string {
  return desktopBridge()?.mirrorServerUrl || sessionServerUrl();
}
