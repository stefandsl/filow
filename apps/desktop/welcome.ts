import { mountIcons } from "../web/components/icons";
import { t, LANG_LABELS, acceptUiSnapshot, themeFollowing, resolveUiLanguage, type I18nKey, type UiBridge, type UiPatch, type UiSnapshot, type UiResult } from "../../packages/core/src/index";
import { applyUiPreferences } from "../web/lib/applyUiPreferences";
import { welcomeSteps, micErrorKind, levelFromRms, micTick, startMic, micActionsShown, micFocusMove, micDeviceChange, offersDownload, offerGb, escapeAction, type MicState, type StepId } from "./welcome-flow";
import "./welcome.css";

/** The speech-setup offer from the main process (apps/desktop/welcome-setup.js setupOffer). */
type SetupOffer = { ask: boolean; ready: boolean; downloadGb: number; needsOllama: boolean; models: string[]; device: "pc" | "mac"; ramGb: number; online: boolean; profile: string | null; unknown?: boolean; cleanup?: { id: string; bytes: number; gb: number } | null };
type WelcomeBridge = UiBridge & {
  complete: (practice?: boolean) => Promise<UiResult>;
  context: () => Promise<{ firstRun: boolean; askSetup: boolean }>;
  setupOffer: () => Promise<SetupOffer>;
  chooseSetup: (accept: boolean, cleanup: boolean) => Promise<{ ok: boolean }>;
  openMicSettings: () => void;
};
declare global { interface Window { filowWelcome: WelcomeBridge } }

const bridge = window.filowWelcome;
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel)!;
const form = $<HTMLFormElement>("#flow");
const back = $<HTMLButtonElement>("#back");
const secondary = $<HTMLButtonElement>("#secondary");
const start = $<HTMLButtonElement>("#start");
const error = $("#error");
const STEP_TITLES: Record<StepId, I18nKey> = { language: "welcome.stepLanguage", intro: "tour.step", mic: "welcome.stepMic", setup: "welcome.stepSetup", preferences: "welcome.preferences" };

let state: UiSnapshot | null = null;
let errorKey: I18nKey | null = null;
let steps: StepId[] = ["language"];
let index = 0;
let offer: SetupOffer | null = null;
// The setup step's "S1-mini by Superwhisper" line: ticked unless the user unticks it.
let cleanupTicked = true;
/** The offer as the step counts it: without the cleanup model's share when its line is unticked. */
const counted = (o: SetupOffer) => ({ ...o, downloadGb: offerGb(o, cleanupTicked) });
let busy = false;
const tr = (key: I18nKey, vars?: Record<string, string | number>) => t(key, state?.resolvedLang ?? "en", vars);

// ---- preferences rows (startup, theme, accent): one instance, in the step that shows them ----
let prefs: { startup: HTMLInputElement; follow: HTMLInputElement; theme: HTMLSelectElement; accent: HTMLInputElement; root: HTMLElement } | null = null;
function mountPrefs(host: HTMLElement) {
  const frag = $<HTMLTemplateElement>("#prefs-template").content.cloneNode(true) as DocumentFragment;
  host.append(frag);
  mountIcons(host);
  prefs = { startup: $("#startup", host), follow: $("#follow-theme", host), theme: $("#theme", host), accent: $("#accent", host), root: host };
  prefs.theme.addEventListener("change", () => void update({ theme: prefs!.theme.value as UiSnapshot["theme"] }));
  prefs.follow.addEventListener("change", () => { if (state) void update({ theme: themeFollowing(prefs!.follow.checked, state.resolvedTheme) }); });
  prefs.accent.addEventListener("change", () => void update({ followSystemAccent: prefs!.accent.checked }));
  prefs.startup.addEventListener("change", () => void update({ runAtStartup: prefs!.startup.checked }));
}

// ---- rendering ----
function render(next?: UiSnapshot) {
  if (next) state = acceptUiSnapshot(state, next);
  if (!state) return;
  applyUiPreferences(state);
  document.documentElement.lang = state.resolvedLang;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach(el => { el.textContent = tr(el.dataset.i18n as I18nKey); });
  document.querySelectorAll<HTMLElement>("[data-i18n-label]").forEach(el => el.setAttribute("aria-label", tr(el.dataset.i18nLabel as I18nKey)));
  const systemLang = resolveUiLanguage("", navigator.language);
  $("#lang-auto").textContent = tr("welcome.languageAuto", { name: LANG_LABELS[systemLang] });
  document.querySelectorAll<HTMLInputElement>('input[name="lang"]').forEach(r => { r.checked = r.value === state!.lang; });
  const select = $<HTMLSelectElement>("#language-select");
  select.value = state.lang;
  if (prefs) {
    prefs.theme.value = state.resolvedTheme;
    prefs.follow.checked = state.theme === "system"; prefs.accent.checked = state.followSystemAccent;
    prefs.startup.checked = state.startup.enabled || state.startup.status === "requires-approval";
    $('[data-row="startup"]', prefs.root).hidden = !state.startup.supported;
    $('[data-row="accent"]', prefs.root).hidden = !state.accentSupported;
    $("[data-explicit-theme]", prefs.root).hidden = prefs.follow.checked;
    // Platform is presentation-only; support/registration is determined by the main process.
    $('[data-label="startup"]', prefs.root).textContent = tr(navigator.platform.startsWith("Mac") ? "ui.startupMac" : "ui.startupWindows");
    $('[data-status="startup"]', prefs.root).textContent = state.startup.status === "blocked" ? tr("ui.startupBlocked") : state.startup.status === "requires-approval" ? tr("ui.startupApproval") : "";
    $('[data-status="accent"]', prefs.root).textContent = state.followSystemAccent && !state.accentColor ? tr("ui.accentUnavailable") : "";
  }
  renderStep();
  renderMic();
  renderSetup();
  error.textContent = errorKey ? tr(errorKey) : "";
}

function renderStep() {
  const id = steps[index];
  document.querySelectorAll<HTMLElement>("[data-step]").forEach(s => { s.hidden = s.dataset.step !== id; });
  const guided = id !== "preferences";
  const progress = $("#progress");
  progress.hidden = !guided || steps.length < 2;
  progress.textContent = tr("welcome.stepOf", { n: index + 1, m: steps.length });
  const list = $("#stepper-list");
  list.replaceChildren(...(guided ? steps : []).map((s, i) => {
    const li = document.createElement("li");
    li.className = i < index ? "done" : i === index ? "current" : "";
    if (i === index) li.setAttribute("aria-current", "step");
    const dot = document.createElement("span"); dot.className = "dot"; dot.setAttribute("aria-hidden", "true");
    if (i < index) dot.dataset.icon = "check"; else dot.textContent = String(i + 1);
    const label = document.createElement("span"); label.textContent = tr(STEP_TITLES[s]);
    li.append(dot, label);
    return li;
  }));
  mountIcons(list);
  $("#stepper").hidden = !guided;
  back.hidden = !guided || index === 0;
  const last = index === steps.length - 1;
  let primary: I18nKey = "welcome.continue";
  let second: I18nKey | null = null;
  if (id === "preferences") primary = "welcome.done";
  else if (id === "setup" && offer && offersDownload(counted(offer))) { primary = offer.ready ? "welcome.setupAcceptRest" : "welcome.setupAccept"; second = "welcome.setupLater"; }
  else if (last) primary = "welcome.finish";
  $("#primary-label").textContent = tr(primary);
  secondary.hidden = !second;
  if (second) secondary.textContent = tr(second);
  start.disabled = busy || (id === "setup" && !offer);
}

// ---- microphone check ----
let mic: MicState = startMic();
let micLabel = "";
let micStop: (() => void) | null = null;
function setMic(next: MicState) { mic = next; renderMic(); }
function renderMic() {
  if (!state) return;
  const card = $("#mic-card");
  card.dataset.state = mic.status;
  const text: Record<MicState["status"], I18nKey> = { listening: "welcome.micListening", heard: "welcome.micHeard", silent: "welcome.micSilent", none: "welcome.micNone", blocked: "welcome.micBlocked", busy: "welcome.micBusy" };
  $("#mic-text").textContent = tr(text[mic.status]);
  const icon = $("#mic-icon");
  const iconName = mic.status === "heard" ? "check" : mic.status === "listening" ? "circle" : mic.status === "silent" ? "clock" : "close";
  if (icon.dataset.icon !== iconName) { icon.dataset.icon = iconName; mountIcons(card); }
  const failed = mic.status === "none" || mic.status === "blocked" || mic.status === "busy";
  const actions = $("#mic-actions");
  const status = $("#mic-status");
  const shown = micActionsShown(mic.status);
  const active = document.activeElement;
  const move = micFocusMove(shown, active && actions.contains(active) ? "actions" : active === status ? "status" : "other");
  actions.hidden = !shown;
  if (move === "status") status.focus();
  // Windows and macOS have a microphone privacy page to open; Linux has none.
  const hasSettings = /^(Win|Mac)/.test(navigator.platform);
  $("#mic-settings").hidden = !hasSettings || !(mic.status === "blocked" || mic.status === "busy");
  $("#mic-device").textContent = micLabel && !failed ? tr("welcome.micDevice", { name: micLabel }) : "";
  $("#mic-meter").hidden = failed;
  if (move === "retry") $("#mic-retry").focus();
}
let ariaAt = 0;
function setLevel(level: number) {
  $("#mic-bar").style.transform = `scaleX(${level.toFixed(3)})`;
  // The bar moves every frame; assistive tech gets the value 4 times a second.
  const now = performance.now();
  if (level === 0 || now - ariaAt > 250) { ariaAt = now; $("#mic-meter").setAttribute("aria-valuenow", String(Math.round(level * 100))); }
}
// Each check has a generation: one that resolves after the user moved on (or retried) stops its own stream.
let micGen = 0;
function stopMic() { micGen++; micStop?.(); micStop = null; setLevel(0); }
async function startMicCheck() {
  stopMic();
  const gen = micGen;
  setMic(startMic());
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
  } catch (err) {
    if (gen === micGen) setMic({ ...startMic(), status: micErrorKind((err as Error)?.name ?? "") });
    return;
  }
  if (gen !== micGen || steps[index] !== "mic") { stream.getTracks().forEach(tk => tk.stop()); return; }
  const track = stream.getAudioTracks()[0];
  micLabel = track?.label ?? "";
  // Unplugged mid-check: the track ends. Say so instead of a flat bar under "Filow can hear you."
  // If another microphone is still plugged in, the device check below starts over with it.
  track?.addEventListener("ended", () => {
    if (gen !== micGen) return;
    stopMic();
    setMic({ ...startMic(), status: "none" });
    checkDevices();
  });
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const frame = new Float32Array(analyser.fftSize);
  let last = performance.now(), raf = 0, shown = 0;
  const tick = (now: number) => {
    analyser.getFloatTimeDomainData(frame);
    let sum = 0;
    for (const v of frame) sum += v * v;
    const level = levelFromRms(Math.sqrt(sum / frame.length));
    shown = Math.max(level, shown * 0.85); // fast attack, slow release: readable, not jittery
    setLevel(shown);
    const next = micTick(mic, level, Math.min(200, now - last));
    last = now;
    if (next.status !== mic.status) setMic(next); else mic = next;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  micStop = () => { cancelAnimationFrame(raf); stream.getTracks().forEach(tk => tk.stop()); void ctx.close(); };
  renderMic();
}

// ---- speech setup ----
function renderSetup() {
  if (!state) return;
  const device = offer?.device === "mac" ? "Mac" : "PC";
  $("#h-setup").textContent = tr("welcome.setupTitle", { device });
  if (!offer) return;
  $("#setup-name").textContent = offer.profile ? tr("welcome.setupProfile", { name: offer.profile }) : tr("welcome.setupLocal");
  $("#setup-facts").textContent = offer.ramGb > 0 ? tr("welcome.setupMemory", { gb: offer.ramGb }) : "";
  const download = offersDownload(counted(offer));
  const ollama = offer.needsOllama ? ` ${tr("welcome.setupOllama")}` : "";
  const gb = offerGb(offer, cleanupTicked).toLocaleString(state.resolvedLang);
  // Ready for a first take: said on its own (green); the optional rest, if any, follows in plain text.
  const ready = offer.ready && !offer.unknown;
  const size = offer.unknown ? tr("welcome.setupUnknown")
    : offer.ready ? (download ? `${tr("welcome.setupRest", { gb })}${ollama}` : "")
    : !offer.online ? tr("welcome.setupOffline")
    : `${tr("welcome.setupDownload", { gb })}${ollama}`;
  $("#setup-ready").hidden = !ready;
  $("#setup-size").textContent = size;
  $("#setup-size").hidden = !size;
  // S1-mini by Superwhisper has its own ticked line with its real size; it stays while there is a way to download.
  const cleanup = offersDownload(offer) ? offer.cleanup ?? null : null;
  const listed = offer.models.filter(n => n !== cleanup?.id);
  $("#setup-details").hidden = !download || listed.length === 0;
  $("#setup-cleanup-row").hidden = !cleanup;
  if (cleanup) $("#setup-cleanup-label").textContent = tr("welcome.setupCleanup", { size: `${Math.round(cleanup.bytes / 1024 / 1024)} MB` });
  $("#setup-list").replaceChildren(...listed.map(n => { const li = document.createElement("li"); li.textContent = tr(`catalog.${n}` as I18nKey); return li; }));
  // Nothing to download, offline or unknown: the size line already says so.
  $("#setup-note").hidden = !download;
}

// ---- navigation ----
function go(to: number) {
  $<HTMLVideoElement>("#intro-video").pause();
  if (steps[index] === "mic" && steps[to] !== "mic") stopMic();
  index = Math.max(0, Math.min(steps.length - 1, to));
  errorKey = null;
  render();
  const id = steps[index];
  if (id === "mic") void startMicCheck();
  if (id === "setup" && !offer) void loadOffer();
  // Screen readers hear the new step's title (its section names the step count via #progress); Enter
  // continues from there (see the form keydown handler). No ring: the title is not a control.
  $(`#h-${id}`).focus();
}
async function loadOffer() {
  try { offer = await bridge.setupOffer(); } catch { offer = { ask: true, ready: false, downloadGb: 0, needsOllama: false, models: [], device: "pc", ramGb: 0, online: true, profile: null, unknown: true }; }
  render();
}
async function finish(acceptSetup: boolean) {
  if (busy) return;
  busy = true; render();
  try {
    // A failed answer must not keep the user in the welcome: main() then asks with its own dialog.
    if (steps.includes("setup")) await bridge.chooseSetup(acceptSetup, cleanupTicked).catch(() => undefined);
    stopMic();
    const result = await bridge.complete(steps.includes("intro") && $<HTMLInputElement>("#live-practice").checked);
    if (!result.ok) { errorKey = result.code; render(result.state); }
  } catch { errorKey = "ui.saveError"; }
  finally { busy = false; render(); }
}
function primaryAction() {
  if (busy) return;
  if (index < steps.length - 1) { go(index + 1); return; }
  // "Download" only when the step offered one: "Finish" on an offline or could-not-check card downloads nothing.
  void finish(steps[index] === "setup" && !!offer && offersDownload(counted(offer)));
}
form.addEventListener("submit", event => { event.preventDefault(); primaryAction(); });
// Enter continues from a step's title or the language choices. Never on a held key (auto-repeat would
// run through every step), never past a disabled primary, and never to accept the download: on the
// setup step only the focused button itself does that.
form.addEventListener("keydown", event => {
  if (event.key !== "Enter" || event.defaultPrevented || event.isComposing) return;
  const el = event.target as HTMLElement;
  if (el.closest("button, select, summary, a, textarea, video")) return;
  if (el instanceof HTMLInputElement && el.type === "checkbox") return;
  event.preventDefault();
  if (event.repeat || start.disabled || steps[index] === "setup") return;
  primaryAction();
});
document.addEventListener("keydown", event => {
  const el = event.target as HTMLElement | null;
  const action = escapeAction({ key: event.key, repeat: event.repeat, isComposing: event.isComposing, defaultPrevented: event.defaultPrevented, inSelect: !!el?.closest?.("select") }, !secondary.hidden && !secondary.disabled && !busy);
  if (action !== "secondary") return;
  event.preventDefault();
  secondary.click();
});
back.addEventListener("click", () => go(index - 1));
secondary.addEventListener("click", () => void finish(false));
// Closing the window mid-flow completes the welcome (ui-preferences.js): stop the microphone first.
window.addEventListener("beforeunload", () => stopMic());
$("#mic-retry").addEventListener("click", () => void startMicCheck());
navigator.mediaDevices?.addEventListener("devicechange", () => checkDevices());
function checkDevices() {
  if (steps[index] !== "mic") return;
  const gen = micGen;
  void navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]).then(devices => {
    if (gen !== micGen || steps[index] !== "mic") return;
    const action = micDeviceChange(mic.status, devices.some(d => d.kind === "audioinput"));
    if (action === "none") { stopMic(); setMic({ ...startMic(), status: "none" }); }
    else if (action === "restart") void startMicCheck();
  });
}
$("#mic-settings").addEventListener("click", () => bridge.openMicSettings());
$<HTMLInputElement>("#setup-cleanup").addEventListener("change", event => { cleanupTicked = (event.target as HTMLInputElement).checked; render(); });

async function update(patch: UiPatch) {
  try { const result = await bridge.updatePreferences(patch); errorKey = result.ok ? null : result.code; render(result.state); }
  catch { errorKey = "ui.saveError"; render(); }
}
document.querySelectorAll<HTMLInputElement>('input[name="lang"]').forEach(r => r.addEventListener("change", () => { if (r.checked) void update({ lang: r.value as UiSnapshot["lang"] }); }));
$<HTMLSelectElement>("#language-select").addEventListener("change", event => void update({ lang: (event.target as HTMLSelectElement).value as UiSnapshot["lang"] }));

mountIcons(document);
const unsubscribe = bridge.onPreferencesChanged(next => render(next));
window.addEventListener("unload", () => { unsubscribe(); stopMic(); }, { once: true });
void Promise.all([bridge.getPreferences(), bridge.context().catch(() => ({ firstRun: true, askSetup: false }))]).then(([prefsState, ctx]) => {
  steps = welcomeSteps(ctx);
  mountPrefs(document.querySelector<HTMLElement>(steps[0] === "preferences" ? '[data-step="preferences"] [data-prefs]' : "#more .rows")!);
  render(prefsState);
  window.dispatchEvent(new Event("filow:hydrated")); // shows the window
  go(0);
  // Fetched now so it is ready before the user reaches the step, but only after "shown": the main process
  // scans the hardware for it, which takes seconds on a slow PC (it also holds the request until shown).
  if (ctx.askSetup && ctx.firstRun) void loadOffer();
});
