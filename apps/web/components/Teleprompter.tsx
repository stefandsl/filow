"use client";
import { Icon } from "./icons";
import { MicrophoneSelect } from "./MicrophoneSelect";
import type { MicWarning } from "@filow/stt";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  currentPoint,
  pointDisplayState,
  scriptIdentity,
  missedPoints,
  notesToMarkdown,
  parseScript,
  SCREEN_MODE_LABELS,
  resolveSetup,
  type DecisionProviderId,
  type ImportResponse,
  type Lang,
  type MachineInfo,
  type ResolvedSetup,
  type ScreenMode,
  type ScreenNote,
  type Script,
  type SttBackendId,
  type SttStatus,
  type StopReason,
} from "@filow/core";
import { Wordmark, LangProvider, OnScreenStrip, useLang, useT } from "@filow/ui";
import { availableBackends, BACKEND_LABELS, browserSupported, createBackend, selectedWhisperModel, sherpaBridge, sherpaUsable, whisperCached, type SttBackend, preopenMic, releasePreopenedMic } from "@filow/stt";
import { getCloudDecision, getSetupPreference, getStartMode, setDecisionProvider, setStartMode, speechLangFor, syncSpeechLang, type StartMode } from "@/lib/prefs";
import { loadGate } from "@/lib/gate/client";
import { useEngine, warmDecisionModel } from "./useEngine";
import { fetchPlan, type PlanResponse } from "@/lib/plan";
import { LOCAL_STT, takeModeOf } from "@/lib/router";
import { engineHeaders, ensureEngineToken, useSession } from "./useSession";
import { PairPanel } from "./PairPanel";
import { useScreenSense, type ScreenSource } from "./useScreenSense";
import { LangSwitch, ThemeSwitch, useUiLang, useUiTheme } from "./LangSwitch";
import { ResourcesPanel } from "./ResourcesPanel";
import { desktopBridge, type LessonView, type UpdateStatus } from "@/lib/sessionUrl";
import { publicLinkOn, useRemoteStatus } from "@/lib/useRemoteStatus";

import { SectionNav } from "./prompter/SectionNav";
import { sectionLabel } from "./prompter/sectionLabel";
import { PointsList } from "./prompter/PointsList";
import { NextSection } from "./prompter/NextSection";
import { Transcript } from "./prompter/Transcript";
import { ScreenSensePanel } from "./prompter/ScreenSensePanel";
import { ActionBar } from "./prompter/ActionBar";
import { StatusStrip } from "./prompter/StatusStrip";
import { OverflowMenu } from "./prompter/OverflowMenu";
import { Dialog } from "./prompter/Dialog";
import { ImportError } from "./prompter/ImportError";
import { LogPanel } from "./prompter/LogPanel";
import { useReanchor } from "./prompter/useReanchor";
import { ReanchorNotice } from "./prompter/ReanchorNotice";
import { DISPLAY_KEYS, DisplayPanel, displayAttributes, useCodesForWindows, useDisplayPrefs, useEyeline, usePointsWindow } from "./prompter/DisplayPanel";
import { openWhiteboard } from "@/lib/whiteboard/open";
import { lessonText, type LessonTextKey, waterCycle } from "@/lib/whiteboard/water-cycle";
import { anchorOf, canAskOkFilow, openOkFilow } from "@/lib/buddy/openAsk";
import { CancelledStart, StartAttempts, type StartAttempt } from "@/lib/startAttempt";
import { refocusIfLost } from "@/lib/focusHandoff";
import { decisionRecipient, localServer, sttRecipient, takeOutbound } from "@/lib/buddy/outbound";
import { usePageOutbound } from "./usePageOutbound";
import { useScriptTranslate } from "./useScriptTranslate";
import { PageOutboundNotice, PageOutboundSignal, useOkfText } from "./PageOutbound";
import { useRehearsal } from "./RehearsalPanel";
import { downloadMarkdown } from "./RehearsalExport";

type BackendChoice = "auto" | SttBackendId;

export default function Teleprompter() {
  const [lang, setLang] = useUiLang();
  const [theme, setTheme] = useUiTheme();
  return (
    <LangProvider lang={lang}>
      <TeleprompterInner onLang={setLang} theme={theme} onTheme={setTheme} />
    </LangProvider>
  );
}

function TeleprompterInner({ onLang, theme, onTheme }: { onLang: (l: Lang) => void; theme: "system" | "light" | "dark"; onTheme: (t: "system" | "light" | "dark") => void }) {
  const t = useT();
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const actionMenuRef = useRef<HTMLButtonElement>(null);
  const { engine, state } = useEngine();
  const [placeReady, setPlaceReady] = useState(false);
  const sessionInfo = useSession(engine, placeReady);
  // Re-anchoring (clicker keys, clicks, a section's name said aloud) and the Display panel: prompter/useReanchor.ts, prompter/DisplayPanel.tsx
  const reanchor = useReanchor(engine, state.sectionIdx);
  const { slideMoved } = reanchor;
  const [display, setDisplay] = useDisplayPrefs(DISPLAY_KEYS.prompter);
  const [displayOpen, setDisplayOpen] = useState(false);
  const pointsWindow = usePointsWindow();
  useCodesForWindows(sessionInfo.newCode);
  const readingRef = useRef<HTMLDivElement>(null);
  const [scriptText, setScriptText] = useState("");
  const [sttStatus, setSttStatus] = useState<SttStatus>({ elevenlabs: false, openai: false });
  // Resolved on the client only, so server and first client render agree.
  const [hasWebSpeech, setHasWebSpeech] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [choice, setChoice] = useState<BackendChoice>("auto");
  const [startDialog, setStartDialog] = useState(false);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [editing, setEditing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [lastNotes, setLastNotes] = useState<ScreenNote[]>([]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  // The Whiteboard button found OK Filow not running in the desktop app (lib/whiteboard/open.ts): said in words, never a dead button.
  const [boardDown, setBoardDown] = useState(false);
  const [lessonOpen, setLessonOpen] = useState(false);
  const [lessonResult, setLessonResult] = useState("");
  const closeLesson = useCallback(() => {
    setLessonOpen(false);
    engine.resumeControlEpoch(engine.getState().controlEpoch ?? 0);
  }, [engine]);
  const finishLesson = useCallback((explanation: string) => {
    closeLesson();
    setLessonResult(explanation);
  }, [closeLesson]);
  useEffect(() => {
    if (!lessonOpen && !lessonResult) return;
    return engine.subscribe((_snapshot, ops) => {
      if (ops.some(op => /^\/(?:script(?:\/|$)|sectionIdx$|here(?:\/|$)|points(?:\/|$)|controlEpoch$)/.test(op.path))) {
        setLessonOpen(false);
        setLessonResult("");
      }
    });
  }, [engine, lessonOpen, lessonResult]);
  // The OK Filow button (lib/buddy/openAsk.ts): drawn in the desktop app only, and says in words when OK Filow is not running.
  const [okfHere, setOkfHere] = useState(false);
  const [okfDown, setOkfDown] = useState(false);
  useEffect(() => setOkfHere(canAskOkFilow()), []);
  const [starting, setStarting] = useState(false);
  const [micWarning, setMicWarning] = useState<MicWarning | null>(null);
  const microphoneRef = useRef<HTMLSelectElement>(null);
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const stopButtonRef = useRef<HTMLButtonElement>(null);
  const [publicLink, setPublicLink] = useState(false);
  const [show, setShow] = useState<{ running: boolean; index: number; total: number } | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge?.onUpdateStatus) return;
    void bridge.updateStatus?.().then(setUpdate);
    return bridge.onUpdateStatus(setUpdate);
  }, []);
  useEffect(() => {
    const bridge = desktopBridge();
    if (!bridge?.onSlideshow) return;
    const apply = (st: { running: boolean; index: number; total: number; title: string }) => {
      setShow(st.running ? st : null);
      if (st.running && st.index >= 0) {
        engine.dispatch({ type: "slideChanged", index: st.index, total: st.total, title: st.title || undefined });
        slideMoved(st.index);
      }
    };
    void bridge.slideshowState?.().then(apply);
    return bridge.onSlideshow(apply);
  }, [engine, slideMoved]);
  const remoteLink = useRemoteStatus();
  useEffect(() => {
    setPublicLink(publicLinkOn(remoteLink));
  }, [remoteLink]);
  const startAttempts = useRef(new StartAttempts());
  const [pendingImport, setPendingImport] = useState<ImportResponse | null>(null);
  const backendRef = useRef<SttBackend | null>(null);
  // Going outside (docs/okfilow/OUTBOUND.md): the take asks before its first cloud send and shows
  // the signal for as long as the microphone streams to a cloud speech engine.
  const { out: outbound, state: outState } = usePageOutbound();
  const okt = useOkfText();
  const micSignal = useRef<(() => void) | null>(null);
  const endOutbound = useCallback(() => {
    micSignal.current?.();
    micSignal.current = null;
    outbound.setRoute("audio", null);
    outbound.setRoute("transcript", null);
  }, [outbound]);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Offline mode is owned by the desktop shell (menu toggle); the web deploy reads FILOW_OFFLINE.
  useEffect(() => {
    const bridge = (globalThis as { filow?: { offline?: boolean; onOffline?: (fn: (v: boolean) => void) => (() => void) | void } }).filow;
    if (bridge?.offline !== undefined) setOffline(bridge.offline);
    const off = bridge?.onOffline?.(setOffline);
    if (!bridge) void fetch("/api/local/status").then((r) => r.json()).then((s: { offline?: boolean }) => setOffline(Boolean(s.offline))).catch(() => undefined);
    return typeof off === "function" ? off : undefined;
  }, []);

  const { script, sectionIdx, points, stats, engine: eng } = state;
  const section = script.sections[sectionIdx];
  const nextSection = script.sections[sectionIdx + 1];
  const missed = missedPoints(state);
  const error = eng.error ?? null;
  const here = currentPoint(state);
  useEyeline(readingRef, here, display);

  // The desktop shell shows no "update ready" prompt while a take is live (SIGN-04).
  useEffect(() => {
    desktopBridge()?.setTakeLive?.(eng.recording);
    return () => desktopBridge()?.setTakeLive?.(false); // leaving the page ends the take
  }, [eng.recording]);

  // Start becomes Stop when a take begins, and back when it ends: the keyboard focus follows to the
  // button that took its place instead of falling to the top of the page (A11Y-02/03).
  const wasRecording = useRef(eng.recording);
  useEffect(() => {
    if (wasRecording.current === eng.recording) return;
    wasRecording.current = eng.recording;
    refocusIfLost(eng.recording ? stopButtonRef.current : startButtonRef.current, document);
  }, [eng.recording]);

  const pushLog = useCallback((line: string) => {
    setLog((l) => {
      const next = [...l.slice(-30), `${new Date().toLocaleTimeString()}  ${line}`];
      desktopBridge()?.takeLog?.(next.join("\n")); // kept by the desktop shell for "Report a problem"
      return next;
    });
  }, []);

  // ---- Screen Sense (ARCHITECTURE.md §6) --------------------------------
  const screen = useScreenSense(engine, state, pushLog);

  const importDocument = async (file: File) => {
    setImporting(true);
    setImportError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/import", { method: "POST", headers: engineHeaders(), body: form });
      const out = (await res.json()) as ImportResponse & { error?: string };
      if (!res.ok) throw new Error(out.error ?? `import failed (${res.status})`);
      setPendingImport(out);
      pushLog(`Imported ${file.name}: ${out.script.sections.length} sections from ${out.pages} ${out.kind === "pptx" ? "slides" : "pages"}`);
    } catch (err) {
      setImportError((err as Error).message);
      pushLog(`Import: ${(err as Error).message}`);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const exportNotes = () => {
    downloadMarkdown(notesToMarkdown(lastNotes, `Talk notes · ${new Date(lastNotes[0]?.at ?? Date.now()).toLocaleDateString()}`), "filow-notes");
  };

  // ---- script ----------------------------------------------------------
  const loadNumber = useRef(0);
  const writer = useRef<{ key: string; id: string; last: string } | null>(null);
  const checkpointError = useRef("");
  checkpointError.current = t("take.placeError");
  const persistPlace = useCallback(() => {
    const bridge = desktopBridge()?.takePlace;
    const owner = writer.current;
    if (!bridge || !owner) return;
    const place = engine.committedPlace();
    if (place && place.scriptKey !== owner.key) return;
    const payload = place && { sectionId: place.sectionId, here: place.here, points: place.points };
    const encoded = JSON.stringify(payload);
    if (owner.last === encoded) return;
    owner.last = encoded;
    const failed = () => {
      if (writer.current !== owner || owner.last !== encoded) return;
      owner.last = "";
      engine.setError(checkpointError.current);
    };
    void bridge.save(owner.id, engine.getState().version, payload).then(ok => { if (!ok) failed(); }, failed);
  }, [engine]);
  useEffect(() => engine.subscribe((_state, ops) => {
    if (ops.some(op => /^\/(points(?:\/|$)|sectionIdx$|controlEpoch$|here$)/.test(op.path))) persistPlace();
  }), [engine, persistPlace]);

  const installScript = useCallback(async (text: string, script: Script, number: number, recover: boolean) => {
    if (number !== loadNumber.current) return;
    const bridge = desktopBridge()?.takePlace;
    const key = bridge && scriptIdentity(script);
    let saved = null;
    writer.current = null;
    if (bridge) {
      try {
        const opened = await bridge.begin(key || "", recover);
        if (number !== loadNumber.current) return;
        if (key) writer.current = { key, id: opened.writer, last: "" };
        if (key && recover && opened.place) saved = { ...opened.place, scriptKey: key };
      } catch {
        if (number !== loadNumber.current) return;
        engine.setError(checkpointError.current);
      }
    }
    setScriptText(text);
    engine.loadScript({ script, place: saved });
    persistPlace();
    setPlaceReady(true);
  }, [engine, persistPlace]);
  const loadScript = useCallback(async () => {
    const number = ++loadNumber.current;
    const res = await fetch("/api/script");
    const { text, script } = (await res.json()) as { text: string; script: Script };
    await installScript(text, script, number, true);
  }, [installScript]);

  useEffect(function initializePresenter() {
    setHasWebSpeech(browserSupported());
    setMounted(true);
    void loadScript();
    void fetch("/api/stt/status")
      .then((r) => r.json())
      .then((s: SttStatus) => setSttStatus(s));
    return () => {
      loadNumber.current += 1;
      writer.current = null;
    };
  }, [loadScript]);

  const saveScript = async (text: string) => {
    const number = ++loadNumber.current;
    await ensureEngineToken();
    const res = await fetch("/api/script", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...engineHeaders() },
      body: JSON.stringify({ text }),
    });
    const { script } = (await res.json()) as { script: Script };
    await installScript(text, script, number, false);
    setEditing(false);
  };

  // Rehearsal report after Stop, talk timer and "Talk length" (RehearsalPanel.tsx).
  const rehearsal = useRehearsal({ engine, state, scriptText, saveScript, notes: lastNotes });

  // ---- transcription ---------------------------------------------------
  const stopTake = useCallback((reason: StopReason) => {
    startAttempts.current.cancel();
    setStarting(false);
    setMicWarning(null);
    backendRef.current?.stop();
    backendRef.current = null;
    endOutbound();
    releasePreopenedMic(); // the check's stream, if no backend took it (Web Speech, or a failed start)
    engine.stop(reason);
    // Live notes (§6.4) are offered for export until the next take starts.
    if (engine.getNotes().length) setLastNotes([...engine.getNotes()]);
  }, [engine, endOutbound]);

  /** Open the microphone once up front: a clear message beats five backends failing in a row. */
  const probeMic = async (attempt: StartAttempt): Promise<boolean> => {
    pushLog(t("mic.checking"));
    try {
      // The 0.9.6 probe opens and stops the stream before backend capture.
      const stream = await attempt.wait(preopenMic(pushLog));
      pushLog(`${t("mic.checking")} ${stream.getAudioTracks()[0]?.label || "ok"}`);
      return true;
    } catch (err) {
      if (err instanceof CancelledStart) throw err;
      const name = (err as DOMException).name;
      const msg = name === "NotFoundError" || name === "OverconstrainedError" ? t("mic.notFound") : name === "NotAllowedError" || name === "SecurityError" ? t("mic.denied") : `${t("mic.busy")} (${(err as Error).message})`;
      engine.setError(msg);
      pushLog(msg);
      return false;
    }
  };

  /** What each mode needs, read fresh every time the dialog opens. */
  const loadReadiness = async (): Promise<Readiness> => {
    const [stt, local, whisper, sherpa] = await Promise.all([
      fetch("/api/stt/status").then((r) => r.json()).catch(() => ({ elevenlabs: false, openai: false })) as Promise<SttStatus>,
      fetch("/api/local/status", { cache: "no-store" }).then((r) => r.json()).catch(() => null) as Promise<{ openrouterKey?: boolean; freellmReady?: boolean; ollama?: { ok: boolean }; models?: Array<{ name: string; installed: boolean }>; hardware?: MachineInfo } | null>,
      whisperCached(selectedWhisperModel()).catch(() => false),
      // The shell picks its model by the spoken language it holds; this also refreshes the page's copy.
      (async () => {
        const b = sherpaBridge();
        if (!b) return false;
        return sherpaUsable((await syncSpeechLang(b)).status!);
      })().catch(() => false),
    ]);
    return {
      openrouterKey: Boolean(local?.openrouterKey),
      freellmReady: Boolean(local?.freellmReady),
      cloudDecision: getCloudDecision(),
      sttKey: Boolean(stt.elevenlabs || stt.openai),
      whisper: whisper || sherpa,
      sherpa,
      clef: Boolean(local?.ollama?.ok && local?.models?.some((m) => m.name.startsWith("clef") && m.installed)),
      stt,
      // the setup profile the user chose (Settings), applied to this machine
      setup: local?.hardware ? resolveSetup(getSetupPreference(), local.hardware) : null,
    };
  };

  /** Start button: ask Cloud / Local unless a choice is remembered. */
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  /** The setup a local take started with, shown as a chip while it runs. */
  const [takeSetup, setTakeSetup] = useState<ResolvedSetup | null>(null);

  const requestStart = async () => {
    const attempt = startAttempts.current.begin();
    setStarting(true);
    try {
      const mode = getStartMode();
      const r = await attempt.wait(loadReadiness());
      setSttStatus(r.stt);
      setReadiness(r);
      let p: PlanResponse | null = null;
      if (mode === "auto") {
        // The router follows the setup for this computer (Settings); it measures nothing here, so a
        // start never spends a cloud call. Decisions stay local (matcher or Clef), never the cloud.
        setStarting(true);
        try {
          p = await attempt.wait(fetchPlan({ probe: false, apply: true }));
          setPlan(p);
        } catch (err) {
          if (err instanceof CancelledStart) throw err;
          pushLog(`auto: router failed (${(err as Error).message}); asking`);
        }
      }
      const step = startStep(mode, r, p && p.decision.provider && p.stt.backend ? takeModeOf(p) : null);
      if (step === "plan" && p?.decision.provider && p.stt.backend) {
        pushLog(`auto: ${p.stt.backend} · ${p.decision.provider}${p.decision.measuredMs ? ` ${p.decision.measuredMs} ms` : ""} · ${p.generate.provider}${p.generate.model ? ` ${p.generate.model}` : ""}`);
        await attempt.wait(startTake("local", r, attempt, { provider: p.decision.provider, backend: p.stt.backend }));
        return;
      }
      if (p?.stt.reason === "local-speech-missing") pushLog(t("start.noLocalSpeech"));
      if (mode === "auto") setStarting(false);
      if (step === "dialog" || step === "plan") {
        setStartDialog(true);
        return;
      }
      await attempt.wait(startTake(step, r, attempt));
    } catch (err) {
      if (!(err instanceof CancelledStart)) {
        engine.setError((err as Error).message);
        pushLog(`could not start: ${(err as Error).message}`);
      }
    } finally {
      if (attempt.isCurrent()) setStarting(false);
    }
  };

  const startTake = async (mode: "cloud" | "local", r: Readiness, attempt: StartAttempt, pick?: { provider: DecisionProviderId; backend: SttBackendId }) => {
    if (!attempt.isCurrent()) return;
    let pendingBackend: SttBackend | null = null;
    let releaseMic: (() => void) | null = null;
    try {
      engine.setError(undefined);
      setMicWarning(null);
      setLastNotes([]);
      setStarting(true);
      // The mode decides the provider and the transcription backend; no silent fallback to the other side.
      // Local: the setup for this computer picks the decision provider (packages/core/src/profile.ts).
      // Cloud: OpenRouter, or the user's FreeLLMAPI router when they chose it for takes (Settings > FreeLLMAPI).
      const provider: DecisionProviderId = pick?.provider ?? (mode === "local" ? localProvider(r) : cloudProvider(r));
      setDecisionProvider(provider);
      setTakeSetup(mode === "local" ? r.setup : null);
      if (mode === "local" && r.setup) pushLog(`${t("setup.inUse", { name: t(`setup.${r.setup.active}`) })} · ${provider}`);
      if (provider === "clef-local") void warmDecisionModel();
      if (provider === "matcher") {
        // the matcher's sentence model (120 MB, downloaded once, then cached) must be ready before the take
        let lastPct = -10;
        try {
          await attempt.wait(loadGate((p) => {
            // one number for the whole model (all its files), logged every 10%
            const pct = p.percent ?? -1;
            if (pct >= lastPct + 10) {
              lastPct = pct;
              pushLog(`${t("start.matcherLoading")} ${pct}%`);
            }
          }));
        } catch (err) {
          if (err instanceof CancelledStart) throw err;
          engine.setError(t("start.matcherFailed", { error: (err as Error).message }));
          pushLog(t("start.matcherFailed", { error: (err as Error).message }));
          setStarting(false);
          return;
        }
      }
      let backend: BackendChoice = pick?.backend ?? choice;
      if (backend === "auto") {
        if (mode === "local") backend = r.sherpa ? "sherpa" : "whisper";
        else backend = r.stt.elevenlabs ? "elevenlabs" : r.stt.openai ? "openai" : hasWebSpeech ? "browser" : "auto";
      }
      if (backend === "auto") {
        engine.setError(t("start.notReadyCloud"));
        setStarting(false);
        return;
      }
      if (mode === "local" && !LOCAL_STT.includes(backend)) {
        // a speech engine picked in the bar that sends the audio out cannot run a local take
        engine.setError(t("start.localNeedsLocalSpeech"));
        pushLog(t("start.localNeedsLocalSpeech"));
        setStarting(false);
        return;
      }
      // Before anything opens or leaves: who would hear the microphone and who would read the
      // words, named from the engines picked for this take. A no to either starts nothing.
      endOutbound();
      const known = await attempt.wait(outbound.recipients());
      if (!known && provider === "openrouter") {
        engine.setError(okt("noticeUnknown"));
        setStarting(false);
        return;
      }
      // decisions on the user's own server (Settings > Advanced) leave this PC: named "your server <name>"
      const decision = known?.decision ?? { openrouter: "", cloudflare: "" };
      const models = decision.local ? { ...decision, local: localServer(decision.local, okt("outServer")) } : decision;
      const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
      const consent = await attempt.wait(outbound.allowAll(takeOutbound({ backend, provider, models, userAgent })));
      if (!consent.ok) {
        pushLog(`take not started: ${consent.kind} to ${consent.recipient.names.join(", ")} ${consent.decision}`);
        setStarting(false);
        return;
      }
      const sttTo = sttRecipient(backend, userAgent);
      outbound.setRoute("audio", sttTo);
      outbound.setRoute("transcript", decisionRecipient(provider, models));
      pushLog(`${mode === "local" ? t("start.local") : t("start.cloud")} · ${BACKEND_LABELS[backend]}`);
      // Web Speech owns its input and always uses the system default.
      if (backend !== "browser" && !(await attempt.wait(probeMic(attempt)))) {
        setStarting(false);
        return;
      }
      const handlers = {
        onTranscript: (e: { committed?: string; partial?: string }) => {
          if (!attempt.isCurrent()) return;
          engine.feed(e, () => {
            reanchor.heard(e); // fresh speech names its section before its words are scored there
            rehearsal.transcript(e);
          });
        },
        onError: (m: string) => {
          if (!attempt.isCurrent()) return;
          pushLog(`error: ${m}`);
          if (backend === "sherpa") stopTake("interruption");
          engine.setError(backend === "sherpa" ? t("take.speechStopped") : m);
        },
        onReady: () => { if (attempt.isCurrent()) pushLog("transcription ready"); },
        onLog: (line: string) => { if (attempt.isCurrent()) pushLog(line); },
        onMicWarning: (warning: MicWarning | null) => {
          if (!attempt.isCurrent()) return;
          if (warning?.kind === "ended") stopTake("interruption");
          setMicWarning(warning);
        },
      };
      {
        // Explicit backend from the chosen mode: never fall back silently.
        // A cloud engine's token request carries the consent key; the server refuses it otherwise.
        const b = createBackend(backend, { headers: { ...engineHeaders(), ...outbound.header("audio", sttTo) }, language: speechLangFor(lang, backend !== "whisper") });
        pendingBackend = b;
        // The signal is on from before the first sound can leave until the take ends.
        if (sttTo) micSignal.current = releaseMic = outbound.hold("audio", sttTo);
        await attempt.wait(b.start(handlers));
        backendRef.current = b;
        engine.setBackend(b.id);
        pushLog(`${BACKEND_LABELS[backend]}: live`);
      }
      engine.start();
    } catch (err) {
      pendingBackend?.stop();
      // Only this attempt's own signal: a newer attempt may already be running.
      releaseMic?.();
      if (micSignal.current === releaseMic) micSignal.current = null;
      if (attempt.isCurrent()) {
        engine.setError((err as Error).message);
        pushLog(`could not start transcription: ${(err as Error).message}`);
        stopTake("interruption");
      }
    } finally {
      if (attempt.isCurrent()) setStarting(false);
    }
  };

  const cancelStart = (reason: StopReason) => {
    startAttempts.current.cancel();
    outbound.dismissAll(); // a notice still open for this start sends nothing
    stopTake(reason);
    setStarting(false);
  };
  const openLesson = useCallback(() => {
    setStartDialog(false);
    setLessonResult("");
    outbound.dismissAll();
    stopTake("interruption");
    setLessonOpen(true);
  }, [outbound, stopTake]);
  useEffect(() => desktopBridge()?.lesson?.onBoard(openLesson), [openLesson]);
  useEffect(() => engine.onTakeControl({
    start: () => { if (!lessonOpen && !engine.getState().engine.recording && !starting && !startDialog) void requestStart(); },
    stop: reason => { setLessonOpen(false); setStartDialog(false); cancelStart(reason); },
  }));

  useEffect(() => () => { startAttempts.current.cancel(); backendRef.current?.stop(); endOutbound(); }, [endOutbound]);

  // A yes withdrawn elsewhere (OK Filow settings) during a take stops it: the stored choices are
  // read again every two seconds while recording, and a running stream without a yes ends at once.
  useEffect(() => {
    if (!eng.recording) return;
    const timer = setInterval(() => void outbound.load(), 2000);
    return () => clearInterval(timer);
  }, [eng.recording, outbound]);
  useEffect(() => {
    if (!eng.recording) return;
    const lost = (["audio", "transcript"] as const).find((kind) => {
      const to = outbound.route(kind);
      return to && !Object.keys(outbound.header(kind, to)).length;
    });
    if (!lost) return;
    pushLog(`take stopped: the yes for ${lost} was withdrawn`);
    stopTake("interruption");
  }, [outState.consent, eng.recording, outbound, pushLog, stopTake]);

  // When the engine stops itself (cost cap), release the microphone too.
  useEffect(() => {
    if (!eng.recording && backendRef.current) {
      backendRef.current.stop();
      backendRef.current = null;
      endOutbound();
    }
  }, [eng.recording, endOutbound]);

  const tail = state.transcriptTail;
  const availability = availableBackends(sttStatus, { webSpeech: hasWebSpeech, whisper: mounted, sherpa: readiness?.sherpa ?? false, offline });
  const costLabel = stats.costUsd === null ? "n/a" : `$${stats.costUsd.toFixed(6)}`;
  const lang = useLang();

  return (
    <div className="app prompter" {...displayAttributes(display)} data-take={eng.recording ? "live" : undefined}>
      <header className="topbar">
        <div className="logo"><Wordmark height={28} /></div>
        {okfHere && !eng.recording && <a className="chip" href="/tour">{t("tour.practice")}</a>}
        <span className="subtitle">{t("app.tagline")}</span><span className="spacer" />
        <PairPanel prompter info={sessionInfo.info} status={sessionInfo.status} error={sessionInfo.error} onNewCode={() => void sessionInfo.newCode()} devices={sessionInfo.devices} onRevoke={sessionInfo.revokeDevice} onAllowAsk={sessionInfo.allowAsk} onApprove={sessionInfo.approveDevice} />
        <LangSwitch lang={lang} onChange={onLang} /><ThemeSwitch pref={theme} onChange={onTheme} />
        <a className="btn settings-link" href="/settings" aria-label={t("ctl.settings")} title={t("ctl.settingsTitle")}><Icon name="settings" /></a>
      </header>
      <SectionNav sections={script.sections} current={sectionIdx} onSelect={reanchor.toSection}
        toolActions={<>
          {okfHere && <button type="button" className="btn" aria-haspopup="dialog" onClick={openLesson}><Icon name="board" /><span className="action-label">{lessonText("lesson.prepared", lang)}</span></button>}
          {okfHere && <button type="button" className="btn okfilow-link" onClick={(e) => { setOkfDown(false); void openOkFilow(anchorOf(e.currentTarget)).then((went) => setOkfDown(went === "unavailable")); }} aria-label={t("ctl.okfilow")} title={t("ctl.okfilowTitle")}><Icon name="ask" /><span className="action-label">{t("ctl.okfilow")}</span></button>}
          <button type="button" className="btn display-link" onClick={() => setDisplayOpen(true)} aria-label={t("display.open")} title={t("display.openTitle")} aria-haspopup="dialog"><Icon name="sliders" /><span className="action-label">{t("display.open")}</span></button>
          <button type="button" className="btn whiteboard-link" onClick={() => { setBoardDown(false); void openWhiteboard().then((went) => setBoardDown(went === "unavailable")); }} aria-label={t("ctl.whiteboard")} title={t("ctl.whiteboardTitle")}><Icon name="board" /><span className="action-label">{t("ctl.whiteboard")}</span></button>
        </>}
        importAction={<button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={importing} aria-label={t("ctl.import")} title={t("ctl.importTitle")}><Icon name="up" /><span className="action-label">{importing ? t("ctl.importing") : t("ctl.import")}</span></button>}
        reloadAction={<button type="button" className="btn" onClick={loadScript} aria-label={t("ctl.reload")}><Icon name="reload" /><span className="action-label">{t("ctl.reload")}</span></button>} />
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.pptx,.docx,.txt,.md,.markdown"
          style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && void importDocument(e.target.files[0])}
        />

      <PageOutboundNotice />
      {lessonOpen && <PreparedWaterCycle onClose={closeLesson} onComplete={finishLesson} />}
      <div className="prompter-content" ref={readingRef}>
      <main className="prompter-main">
      <ReanchorNotice notice={reanchor.notice} onUndo={reanchor.undo} onDismiss={reanchor.dismiss} />
      {lessonResult && <aside role="status"><p>{lessonResult}</p><p>{lessonText("lesson.transfer", lang)}</p></aside>}
      <PageOutboundSignal className="okf-out-region--bar" />
      {update?.status === "downloaded" && !updateDismissed && !eng.recording && (
        <div className="update-banner">
          <span><Icon name="up" /> {t("update.ready", { version: update.version })}</span>
          <button className="btn primary" onClick={() => desktopBridge()?.installUpdate?.()}>
            {t("update.restart")}
          </button>
          <button className="btn" onClick={() => setUpdateDismissed(true)}>
            {t("update.later")}
          </button>
        </div>
      )}
      {error && <div className="chip err banner">{error}</div>}
      {eng.reloading && <div className="chip busy banner" role="status" title={t("app.reloadingTitle")}><Icon name="clock" /> {t("app.reloading")}</div>}
      {importError !== null && <ImportError error={importError} />}
      {boardDown && <div className="chip err banner" role="alert">{t("ctl.whiteboardDown")}</div>}
      {okfDown && <div className="chip err banner" role="alert">{t("ctl.okfilowDown")}</div>}


        <div className="section-heading">
          {section ? <><div className="section-count">{t("section.counter", {n: sectionIdx + 1, m: script.sections.length})}</div>
            <h1 className="section-title">{sectionLabel(section.title).title}</h1><span className="label">{sectionLabel(section.title).label && `${sectionLabel(section.title).label} - `}{t("section.points", {n: section.bullets.length})}</span></>
            : <><h1 className="section-title">{t("stage.noScript")}</h1><p>{t("stage.noScriptHint")}</p></>}
          <button type="button" className="btn edit-points" onClick={() => setEditing(true)}><Icon name="edit" /> {t("ctl.edit")}</button>
        </div>
        {rehearsal.timer}
        {section && <PointsList points={section.bullets.map(b => {
          const st = points[b.id] ?? {status: "waiting", confidence: 0};
          return {id:b.id, text:b.text, confidence:st.confidence, evidence:st.evidence, state:pointDisplayState(st)};
        })} onToggle={id => engine.dispatch(points[id]?.status === "started" ? {type:"reopen",id} : {type:"markStarted",id})}
          onHere={id => reanchor.toPoint(sectionIdx, id)} current={here} />}
        {state.screen && <OnScreenStrip screen={state.screen} unmentioned={state.unmentioned} analysing={state.screenStats?.analysing} onLookNow={screen.lookNow} onForget={screen.forget} />}
          {missed.length > 0 && (
            <div className="strip">
              <div className="label">{t("stage.missed", { n: missed.length })}</div>
              <div className="row scroll">
                {missed.map((b) => (
                  <span key={b.id} data-missed-id={b.id} className="missed-item" title={t("stage.reopen")} onClick={() => engine.dispatch({ type: "reopen", id: b.id })}
                    role="button" tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); engine.dispatch({ type: "reopen", id: b.id }); }
                    }}>
                    {t("stage.missedItem", { text: b.text })}
                  </span>
                ))}
              </div>
            </div>
          )}

        <Transcript text={tail} open={transcriptOpen} />
      {logOpen && (
        <LogPanel triggerRef={actionMenuRef} onClose={() => setLogOpen(false)}>
          {desktopBridge()?.reportProblem && (
            <button type="button" className="btn small" style={{ float: "right" }} onClick={() => desktopBridge()?.reportProblem?.()}>
              {t("log.report")}
            </button>
          )}
          {log.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </LogPanel>
      )}

        {nextSection && <NextSection title={nextSection.title} points={nextSection.bullets.map(b => b.text)} completed={nextSection.bullets.map(b => points[b.id]?.status === "started")} />}
      </main>
      </div>
      {/* Screen Sense: its own row under the reading area (never over the points), above the action bar. */}
      {screen.status !== "unsupported" && <ScreenSensePanel active={screen.status === "watching"}>
          {screen.status === "watching" ? (
            <button className="btn primary" onClick={screen.stopWatching}>
              {t("screen.stopWatching")}
            </button>
          ) : (
            <button
              className="btn"
              onClick={() => void screen.watchScreen()}
              disabled={offline || !screen.enabled}
              title={offline ? t("screen.watchOffline") : t("screen.watchTitle")}
            >
              {t("screen.watch")}
            </button>
          )}
          <select className="btn" value={screen.mode} onChange={(e) => screen.setMode(e.target.value as ScreenMode)} title={t(`mode.${screen.mode}`)} aria-label={t("screen.modeTitle")}>
            {(Object.keys(SCREEN_MODE_LABELS) as ScreenMode[]).map((m) => (
              <option key={m} value={m} title={t(`mode.${m}`)}>
                {t(`mode.${m}.short`)}
              </option>
            ))}
          </select>
          <OverflowMenu items={[
            ...(screen.desktop ? [{id:"region",label:t("screen.region"),onSelect:() => { if (!offline) void screen.captureRegion(); }}] : []),
            {id:"screenSettings",label:t("ctl.settings"),onSelect:() => { window.location.href = "/settings"; }},
            ...(state.screen ? [{id:"forget",label:t("screen.forget"),onSelect:screen.forget}] : []),
            ...(lastNotes.length > 0 ? [{id:"export",label:t("screen.exportNotes", {n:lastNotes.length}),onSelect:exportNotes}] : []),
          ]} />

          <button
            className="btn screen-scan"
            onClick={screen.lookNow}
            disabled={offline || (screen.status !== "watching" && !screen.desktop)}
            title={screen.desktop && screen.status !== "watching" ? t("screen.lookNowRegion") : t("screen.lookNowFrame")}
          >
            <Icon name="play" /> {t("screen.scan")}
          </button>
        {screen.status === "watching" && <span className="chip rec" title={t("screen.recTitle", {label:screen.label})}><Icon name="circle" /> {t("screen.rec")} {"\u00b7"} {state.screenStats?.analysing ? t("app.analysing") : screen.label}</span>}
      </ScreenSensePanel>}
      {displayOpen && <DisplayPanel prefs={display} onChange={setDisplay} onClose={() => setDisplayOpen(false)} pointsWindow={pointsWindow} anchor="sidebar" />}
      <ActionBar label={t("ctl.controls")} start={<>
        {eng.recording ? (
          <button ref={stopButtonRef} className="btn primary" onClick={() => stopTake("user")}>
            <Icon name="stop" /> {t("ctl.stop")}
          </button>
        ) : (
          <>
            <button ref={startButtonRef} className="btn primary" onClick={() => void requestStart()} disabled={starting || !section || availability.length === 0}>
              {starting ? t("ctl.starting") : <><Icon name="play" /> {t("ctl.start")}</>}
            </button>
            {starting && <button className="btn danger" onClick={() => cancelStart("interruption")}>{t("ctl.cancel")}</button>}
          </>
        )}
</>} mode={<><label className="backend-choice"><span>{t("ctl.mode")}</span>
        <select className="btn" value={choice} disabled={eng.recording} onChange={(e) => setChoice(e.target.value as BackendChoice)} title={choice === "auto" ? t("ctl.auto") : choice === "sherpa" ? t("ctl.backend.sherpa") : BACKEND_LABELS[choice]} aria-label={t("ctl.backend")}>
          <option value="auto" title={t("ctl.auto")}>{t("ctl.auto.short")}</option>
          {availability.map((id) => (
            <option key={id} value={id} title={id === "sherpa" ? t("ctl.backend.sherpa") : BACKEND_LABELS[id]}>
              {t(`ctl.backend.${id}.short`)}
            </option>
          ))}
        </select>
</label><MicrophoneSelect compact webSpeech={(eng.recording ? eng.backend : choice) === "browser"} selectRef={microphoneRef} /></>}
        warning={micWarning && <div className="mic-warning chip err" role="alert">
          <span>{t(micWarning.kind === "slow-context" ? "mic.slowContext" : "mic.noAudio", { label: micWarning.label || t("mic.systemDefault"), ms: micWarning.elapsedMs ?? 0 })}</span>
          <button type="button" className="btn" onClick={() => {
            const select = microphoneRef.current;
            select?.focus();
            try { select?.showPicker(); } catch { /* Keyboard focus works on older hosts. */ }
          }}>{t("mic.chooseAnother")}</button>
        </div>}
        prev={<button type="button" className="btn" onClick={() => reanchor.move("prev")} disabled={sectionIdx === 0} aria-keyshortcuts="PageUp ArrowLeft"><Icon name="left" /> {t("ctl.prev")}</button>}
        next={<button type="button" className="btn" onClick={() => reanchor.move("next")} disabled={!nextSection} aria-keyshortcuts="PageDown ArrowRight">{t("ctl.next")} <Icon name="right" /></button>}
        transcriptToggle={<button type="button" className="btn" aria-expanded={transcriptOpen} aria-controls="prompter-transcript-text" onClick={() => setTranscriptOpen(v => !v)}>{t("footer.transcript")}</button>}
        overflow={<OverflowMenu triggerRef={actionMenuRef} items={[
          {id:"reset",label:t("ctl.reset"),onSelect:() => engine.dispatch({type:"resetSection"})},
          {id:"log",label:t("ctl.logReport"),onSelect:() => { setLogOpen(true); }},
          ...rehearsal.menu,
          ...(desktopBridge()?.reportProblem ? [{id:"report",label:t("log.report"),onSelect:() => { desktopBridge()?.reportProblem?.(); }}] : []),
        ]} />} />
      <StatusStrip summary={t("status.thisComputer")} details={<><div className="status-metadata">
        {show && <span className="chip live"><Icon name="slides" /> {t("stage.slide", { n: show.index + 1, total: show.total })}</span>}
        {update?.status === "checking" && <span className="chip busy">{t("update.checking")}</span>}
        {update?.status === "downloading" && <span className="chip busy"><Icon name="down" /> {t("update.downloading", { version: update.version })}</span>}
        {update?.status === "downloaded" && <span className="chip live" title={t("update.ready", { version: update.version })}><Icon name="up" /> {update.version}</span>}
        {update?.status === "error" && <span className="chip err" title={update.error}>{t("update.error", { error: update.error.slice(0, 40) })}</span>}
        {publicLink && (
          <button className="chip live" title={t("pair.stopPublic")} onClick={() => desktopBridge()?.setRemoteShare?.(false)}>
            <Icon name="globe" /> {t("pair.publicChip")} <Icon name="close" />
          </button>
        )}
        {offline && <span className="chip err">{t("app.offline")}</span>}
        {eng.backend && <span className="chip live"><Icon name="circle" /> {BACKEND_LABELS[eng.backend]}</span>}
        {eng.slowMs && <span className="chip" title={t("app.slowTitle")}><Icon name="clock" /> {t("app.slow", { ms: eng.slowMs })}</span>}
        {takeSetup && eng.recording && (
          <a className="chip" href="/settings/local#setup" title={t("setup.label")}>
            <Icon name="sliders" /> {t("setup.inUse", { name: t(`setup.${takeSetup.active}`) })}
          </a>
        )}
        {plan && eng.recording && !takeSetup && (
          <span className="chip" title={t("plan.chipTitle")}>
            <Icon name="sliders" /> {t(`plan.stt.${plan.stt.backend ?? "none"}`)} · {t(`plan.decision.${plan.decision.provider ?? "none"}`)}
            {plan.decision.measuredMs ? ` ${plan.decision.measuredMs} ms` : ""}
          </span>
        )}
</div><ResourcesPanel compact embedded /></>} stats={<>
          {t("footer.stats", { calls: stats.calls, avg: stats.avgMs, cost: costLabel })}
          {stats.model ? ` · ${stats.model}` : ""}
          {state.screenStats?.frames
            ? ` · ${t("footer.screen", { n: state.screenStats.frames })}${state.screenStats.costUsd === null ? "" : ` $${state.screenStats.costUsd.toFixed(4)}`}`
            : ""}
</>} />
      {sessionInfo.pairRequests.length > 0 && (
        <div className="modal-bg">
          <div className="modal pairmodal">
            <div className="label">{t("pair.request")}</div>
            {sessionInfo.pairRequests.map((r) => (
              <div key={r.token} className="strip">
                <div className="label">{r.device || "phone"}</div>
                <div className="controls">
                  <button className="btn primary" onClick={() => sessionInfo.decidePair(r.token, "controller")}>
                    {t("pair.allowControl")}
                  </button>
                  <button className="btn" onClick={() => sessionInfo.decidePair(r.token, "viewer")}>
                    {t("pair.allowView")}
                  </button>
                  <button className="btn danger" onClick={() => sessionInfo.decidePair(r.token, "reject")}>
                    {t("pair.reject")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {startDialog && readiness && (
        <StartModeDialog
          readiness={readiness}
          returnFocusRef={startButtonRef}
          onCancel={() => { startAttempts.current.cancel(); setStartDialog(false); }}
          onPick={(mode, remember, auto) => {
            setStartDialog(false);
            setStartMode(modeAfterPick(getStartMode(), mode, remember, auto));
            void startTake(mode, readiness, startAttempts.current.begin());
          }}
        />
      )}
      {editing && <ScriptEditor initial={scriptText} onCancel={() => setEditing(false)} onSave={saveScript} />}
      {rehearsal.dialogs}
      {screen.sources && <SourceChooser sources={screen.sources} onPick={(s) => void screen.chooseSource(s)} />}
      {pendingImport && (
        <ScriptEditor
          initial={pendingImport.text}
          title={t("editor.imported", { n: pendingImport.script.sections.length })}
          warnings={pendingImport.warnings}
          onCancel={() => setPendingImport(null)}
          onSave={(txt) => {
            setPendingImport(null);
            void saveScript(txt);
          }}
        />
      )}
    </div>
  );
}

type Readiness = {
  openrouterKey: boolean; sttKey: boolean; whisper: boolean; sherpa: boolean; clef: boolean; stt: SttStatus; setup: ResolvedSetup | null;
  /** FreeLLMAPI has an address and a key; and whether the user chose it to track cloud takes (Settings > FreeLLMAPI). */
  freellmReady?: boolean; cloudDecision?: "openrouter" | "freellm";
};

/** Who decides in a cloud take: OpenRouter, or the user's FreeLLMAPI router when they chose it. Never one for the other. */
export function cloudProvider(r: Pick<Readiness, "cloudDecision">): "openrouter" | "freellm" {
  return r.cloudDecision === "freellm" ? "freellm" : "openrouter";
}

/** A cloud take can start: the chosen decider is set up, and a cloud speech key is there. */
export function cloudReady(r: Pick<Readiness, "cloudDecision" | "freellmReady" | "openrouterKey" | "sttKey">): boolean {
  return (cloudProvider(r) === "freellm" ? r.freellmReady === true : r.openrouterKey) && r.sttKey;
}

/**
 * Who decides in a local take: the setup's choice; Best quality falls back to the on-device matcher
 * while Clef Flash is not installed (still local, never the cloud). Without a setup (status
 * unreachable) the older rule: Clef.
 */
export function localProvider(r: Pick<Readiness, "clef" | "setup">): "matcher" | "clef-local" {
  if (!r.setup) return "clef-local";
  return r.setup.choices.decision.provider === "clef-local" && !r.clef ? "matcher" : r.setup.choices.decision.provider;
}

/** A local take can start: speech on this computer, and decisions (the matcher needs no install). */
export function localReady(r: Pick<Readiness, "whisper" | "clef" | "setup">): boolean {
  return r.whisper && (localProvider(r) === "matcher" || r.clef);
}

/**
 * What pressing Start does, from the remembered mode, what is ready, and (on Auto) the kind of take
 * the router planned. "plan": a local take with the plan's engines. Auto runs a take on this PC or
 * shows the dialog; it never starts an online take, whatever the plan says. "ask" always shows the
 * dialog; a remembered Cloud or Local starts when it is ready and shows the dialog when it is not.
 */
export function startStep(mode: StartMode, r: Parameters<typeof cloudReady>[0] & Parameters<typeof localReady>[0], planned: "local" | "cloud" | null): "plan" | "local" | "cloud" | "dialog" {
  if (mode === "auto") return planned === "local" ? "plan" : localReady(r) ? "local" : "dialog";
  if (mode === "cloud") return cloudReady(r) ? "cloud" : "dialog";
  if (mode === "local") return localReady(r) ? "local" : "dialog";
  return "dialog";
}

/**
 * The start mode kept after a pick in the dialog. "Remember my choice": the pick. Without it the
 * question comes back next time, except on Auto, which stays: a profile on Auto only saw the dialog
 * because this PC was not ready, and one unremembered pick must not turn every later take into a question.
 */
export function modeAfterPick(current: StartMode, picked: "cloud" | "local", remember: boolean, auto?: boolean): StartMode {
  if (remember) return auto ? "auto" : picked;
  return current === "auto" ? "auto" : "ask";
}

/** Cloud or Local for this take, with what each needs and whether it is there. */
/** "Auto": local when this computer's setup is ready (it always fits: the setup was chosen for it). Never the cloud by itself: Cloud is its own button. */
function autoPick(r: Readiness): "cloud" | "local" | null {
  return localReady(r) ? "local" : null;
}

export function StartModeDialog({ readiness, onPick, onCancel, returnFocusRef }: { readiness: Readiness; onPick: (mode: "cloud" | "local", remember: boolean, auto?: boolean) => void; onCancel: () => void; returnFocusRef?: RefObject<HTMLElement | null> }) {
  const t = useT();
  const [remember, setRemember] = useState(false);
  const cloudOk = cloudReady(readiness);
  const viaFree = cloudProvider(readiness) === "freellm";
  const localOk = localReady(readiness);
  const auto = autoPick(readiness);
  const setupName = readiness.setup ? t(`setup.${readiness.setup.active}`) : "";
  const autoWhy = auto === "local" && setupName ? t("start.autoSetup", { name: setupName }) : auto === "cloud" ? t("start.autoCloud") : "";
  const Line = ({ ok, label }: { ok: boolean; label: string }) => (
    <div className={`check ${ok ? "ok" : "missing"}`}>
      <Icon name={ok ? "check" : "close"} /> {label} <span className="hint">· {ok ? t("start.ready") : t("start.missing")}</span>
    </div>
  );
  return (
    <Dialog title={t("start.title")} onClose={onCancel} className="startmode" returnFocusRef={returnFocusRef}>
        {auto && (
          <div className="strip autopick">
            <div>
              <strong>{t("start.autoTitle")}</strong> {t("start.autoPick", { mode: auto === "local" ? t("start.local") : t("start.cloud") })} <span className="hint">{autoWhy}</span>
            </div>
            <button className="btn primary" onClick={() => onPick(auto, remember, true)}>
              {t("ctl.start")} · {t("start.autoBtn")}
            </button>
          </div>
        )}
        <div className="modes">
          <div className={`mode ${cloudOk ? "" : "notready"}`}>
            <h3>☁ {t("start.cloud")}</h3>
            <p className="hint">{t("start.cloudHint")}</p>
            {viaFree ? <Line ok={readiness.freellmReady === true} label={t("start.keyFreeLlm")} /> : <Line ok={readiness.openrouterKey} label={t("start.keyOpenRouter")} />}
            <Line ok={readiness.sttKey} label={t("start.keyStt")} />
            {viaFree && <p className="hint">{t("start.freeLlmHint")}</p>}
            {!cloudOk && <p className="hint">{t(viaFree ? "start.notReadyFreeLlm" : "start.notReadyCloud")}</p>}
            <button className="btn primary" disabled={!cloudOk} onClick={() => onPick("cloud", remember)}>
              {t("ctl.start")} · {t("start.cloud")}
            </button>
          </div>
          <div className={`mode ${localOk ? "" : "notready"}`}>
            <h3>💻 {t("start.local")}</h3>
            <p className="hint">{t("start.localHint")}</p>
            {readiness.setup && (
              <p className="hint setup-line">
                {t("setup.inUse", { name: setupName })} · <a href="/settings/local#setup">{t("setup.change")}</a>
              </p>
            )}
            <Line ok={readiness.whisper} label={t("start.whisper")} />
            {localProvider(readiness) === "matcher" ? <Line ok label={t("start.matcher")} /> : <Line ok={readiness.clef} label={t("start.clef")} />}
            {!localOk && <p className="hint">{t(readiness.whisper ? "start.notReadyLocal" : "start.noLocalSpeech")}</p>}
            <button className="btn primary" disabled={!localOk} onClick={() => onPick("local", remember)}>
              {t("ctl.start")} · {t("start.local")}
            </button>
          </div>
        </div>
        <div className="controls">
          <label className="btn choice">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> {t("start.remember")}
          </label>
          <a className="btn" href="/settings/local">
            {t("start.fix")}
          </a>
          <button className="btn" onClick={onCancel}>
            {t("common.cancel")}
          </button>
        </div>
    </Dialog>
  );
}

/** Desktop-only chooser: screens and windows minus this app (ARCHITECTURE.md §6.2). */
export function SourceChooser({ sources, onPick }: { sources: ScreenSource[]; onPick: (s: ScreenSource | null) => void }) {
  const t = useT();
  return (
    <Dialog title={t("screen.chooserTitle")} onClose={() => onPick(null)}>
        <div className="hint">{t("screen.chooserHint")}</div>
        {sources.length === 0 && <div className="hint">{t("screen.chooserEmpty")}</div>}
        <div className="sources">
          {sources.map((s) => (
            <button key={s.id} className="source" onClick={() => onPick(s)}>
              {s.thumbnail ? <img src={s.thumbnail} alt="" /> : <div style={{ aspectRatio: "16/9", background: "#000" }} />}
              <span className="kind">{t(`screen.kind.${s.kind}`)}</span>
              <span className="name" title={s.name}>
                {s.name}
              </span>
            </button>
          ))}
        </div>
        <div className="controls">
          <button className="btn" onClick={() => onPick(null)}>
            {t("common.cancel")}
          </button>
        </div>
    </Dialog>
  );
}

export function PreparedWaterCycle({ onClose, onComplete }: { onClose(): void; onComplete?(explanation: string): void }) {
  const bridge = desktopBridge()?.lesson;
  const lang = useLang();
  const t = (key: LessonTextKey, vars?: Record<string, string | number>) => lessonText(key, lang, vars);
  const [view, setView] = useState<LessonView>({ phase: "idle" });
  const [words, setWords] = useState("");
  useEffect(() => bridge?.onDraft((turn, draft) => {
    if (turn === view.turn && view.phase === "ready") setWords(draft);
  }), [bridge, view.phase, view.turn]);
  const generation = useRef(0);
  const nextRequest = useCallback(() => ++generation.current, []);
  const usingBrowser = useRef(false);
  useEffect(() => {
    window.speechSynthesis?.getVoices();
    const off = bridge?.onStop(() => {
      nextRequest();
      usingBrowser.current = false;
      setView({ phase: "idle" });
      setWords("");
    });
    return () => {
      off?.();
      nextRequest();
      if (usingBrowser.current) void bridge?.control("stop").catch(() => {});
    };
  }, [bridge, nextRequest]);
  useEffect(() => {
    if (!bridge || (view.phase !== "dispatched" && view.phase !== "guiding")) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const id = generation.current;
    const poll = async () => {
      const next = await bridge.control("observe", view.turn).catch((): LessonView => ({ phase: "held" }));
      if (disposed || generation.current !== id) return;
      setView(next);
      if (next.phase === view.phase) timer = setTimeout(() => void poll(), 350);
    };
    timer = setTimeout(() => void poll(), 100);
    return () => { disposed = true; clearTimeout(timer); };
  }, [bridge, view.turn, view.phase]);
  const narration = view.reading && (view.phase === "guiding" || view.phase === "explained")
    ? t(view.phase === "guiding" ? "lesson.guide" : "lesson.result", view.reading) : "";
  useEffect(() => {
    if (!narration) return;
    const id = generation.current;
    let live = true;
    const finished = () => {
      if (live && generation.current === id && view.phase === "explained") onComplete?.(narration);
    };
    const speech = window.speechSynthesis;
    const voice = speech?.getVoices().find(v => v.localService && v.lang.split(/[-_]/)[0] === lang);
    if (!voice) { finished(); return; }
    const utterance = new SpeechSynthesisUtterance(narration);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.onend = finished;
    utterance.onerror = finished;
    speech.speak(utterance);
    return () => { live = false; speech.cancel(); };
  }, [lang, narration, onComplete, view.phase]);
  const control = async (action: "prepare" | "talk" | "request" | "approve" | "reconcile" | "stop") => {
    if (!bridge) return;
    const id = nextRequest();
    usingBrowser.current = true;
    const result = bridge.control(action, view.turn, action === "approve" ? view.decision : action === "request" ? words : undefined);
    if (action === "prepare" || action === "approve" || action === "reconcile") setView({ phase: action === "prepare" ? "preparing" : "checking" });
    try {
      const next = await result;
      if (id === generation.current) setView(next);
    } catch { if (id === generation.current) setView({ phase: "held" }); }
  };
  const [photo, setPhoto] = useState<{ name: string; url: string } | null>(null);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  return <Dialog title={t("lesson.prepared")} onClose={onClose} heading>
    <label>{t("lesson.photo")} <input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => {
      const file = event.currentTarget.files?.[0];
      if (file && ["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
        setPhoto({ name: file.name, url: URL.createObjectURL(file) });
      }
    }} /></label>
    {photo && <figure><img src={photo.url} alt={photo.name} style={{ maxWidth: "100%", maxHeight: "32vh", objectFit: "contain" }} /><figcaption>{photo.name}</figcaption></figure>}
    <table aria-label={t("lesson.prepared")}><tbody>
      {waterCycle.map(([process, from, to]) => <tr key={process}>
        <th scope="row">{t(process)}</th>
        <td>{t(from)}</td>
        <td aria-hidden="true"><Icon name="right" /></td>
        <td>{t(to)}</td>
      </tr>)}
    </tbody></table>
    {bridge && <section aria-live="polite">
      {view.phase === "idle" && <button className="btn" onClick={() => void control("prepare")}>{t("lesson.browser")}</button>}
      {view.phase === "ready" && <form onSubmit={e => { e.preventDefault(); void control("request"); }}>
        <button type="button" className="btn" onClick={() => void control("talk")}>{t("ctl.okfilow")}</button>
        {view.micUnavailable && <p>{t("ctl.okfilowDown")}</p>}
        <label>{t("lesson.request")} <input value={words} placeholder={t("lesson.command")} onChange={e => setWords(e.target.value)} /></label>
        {view.unmatched && <p role="status">{t("lesson.tryCommand", { command: t("lesson.command") })}</p>}
        <button className="btn" disabled={!words.trim()}>{t("lesson.review")}</button>
      </form>}
      {view.phase === "approval" && view.decision && <>
        <p>{t("lesson.destination", { window: view.decision.window, turn: view.decision.turn })}<br /><code>{view.decision.url}</code></p>
        <button className="btn" onClick={() => void control("stop")}>{t("common.cancel")}</button>
        <button className="btn primary" onClick={() => void control("approve")}>{t("lesson.allow")}</button>
      </>}
      {["checking", "preparing", "dispatched"].includes(view.phase) && <p>{t("lesson.waiting")}</p>}
      {view.phase === "interrupted" && <button className="btn" onClick={() => void control("reconcile")}>{t("lesson.reconcile")}</button>}
      {narration && <p>{narration}</p>}
      {view.phase === "explained" && <p>{t("lesson.transfer")}</p>}
      {view.phase === "held" && <p role="status">{t("lesson.held")}</p>}
      {view.phase !== "idle" && <button className="btn" onClick={() => void control("stop")}>{t("lesson.stop")}</button>}
    </section>}
    <div className="controls"><button type="button" className="btn" onClick={onClose}>{t("lesson.return")}</button></div>
  </Dialog>;
}

export function ScriptEditor({
  initial,
  onSave,
  onCancel,
  title,
  warnings = [],
}: {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
  title?: string;
  warnings?: string[];
}) {
  const t = useT();
  const [text, setText] = useState(initial);
  const preview = parseScript(text);
  // Translate: on this PC by default, the cloud by choice (useScriptTranslate.tsx)
  const translation = useScriptTranslate(text, setText);
  return (
    <Dialog title={title ?? t("editor.title")} onClose={onCancel}>
        {warnings.map((w, i) => (
          <span key={i} className="chip err">
            {w}
          </span>
        ))}
        <div className="hint">{t("editor.hint", { sections: preview.sections.length, points: preview.sections.reduce((n, s) => n + s.bullets.length, 0) })}</div>
        {/* read-only while a translation runs: what is typed meanwhile would be replaced by the result */}
        <textarea value={text} onChange={(e) => setText(e.target.value)} readOnly={translation.busy} aria-busy={translation.busy} spellCheck={false} aria-label={title ?? t("editor.title")} />
        <div className="controls">
          <button className="btn primary" onClick={() => onSave(text)}>
            {t("common.save")}
          </button>
          <button className="btn" onClick={onCancel}>
            {t("common.cancel")}
          </button>
          {translation.row}
        </div>
        <PageOutboundSignal />
        {translation.below}
    </Dialog>
  );
}
