"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { createDownloadProgress, GATE_MODEL, LANG_LABELS, LANGS, SCREEN_MODE_LABELS, type DecisionProviderId, type I18nKey, type Lang, type MachineInfo, type ScreenMode, type SetupModel, type SetupPreference } from "@filow/core";
import { preloadWhisper, removeCachedModel, selectedWhisperModel, setSelectedWhisperModel, sherpaBridge, whisperCached, type SherpaStatus } from "@filow/stt";
import { SherpaLanguageNote } from "@/components/SherpaLanguageNote";
import { Wordmark, LangProvider, useT } from "@filow/ui";
import { engineHeaders, ensureEngineToken } from "@/components/useSession";
import { LangSwitch, ThemeSwitch, useUiLang, useUiTheme } from "@/components/LangSwitch";
import { getDecisionProvider, getGateMode, getScreenMode, getSetupPreference, getSpeechLang, getStartMode, SPEECH_LANGS, setDecisionProvider, setGateMode, setScreenMode, setSetupPreference, chooseSpeechLang, syncSpeechLang, setStartMode, type GateMode, type SpeechLang, type StartMode } from "@/lib/prefs";
import { loadGate, stopGate, unloadGate } from "@/lib/gate/client";
import { DeviceModelList, InUseChip, modelsBridge, StopButton } from "@/components/ModelControls";
import { browserUses, deleteQuestion, ollamaUses, sizeText, type UseContext } from "@/lib/modelUse";
import { readTranslateWhere } from "@/lib/translateWhere";
import { screenBridge } from "@/lib/screen/watcher";
import { desktopBridge, type LocalAiHardware, type LocalAiStatus } from "@/lib/sessionUrl";
import { localAiBusy, localAiEnsureStep, localAiNeedsReport, localAiText } from "@/lib/localAiStatus";
import { placementText, ResourcesPanel, useResources } from "@/components/ResourcesPanel";
import { fetchPlan, type PlanResponse } from "@/lib/plan";
import { MicrophoneSelect } from "@/components/MicrophoneSelect";
import { OkFilowSettings } from "@/components/OkFilowSettings";
import { DictationSettings, dictationBridge } from "@/components/DictationSettings";
import { SetupPicker } from "./SetupPicker";
import { FreeLlmSettings } from "./FreeLlmSettings";
import { WhiteboardModelSetting } from "@/components/whiteboard/ModelPicker";
import { AboutPrivacyLink } from "@/components/AboutPrivacyLink";
import { DownloadLabel } from "@/components/DownloadLabel";

type Status = {
  pii: { mode: "off" | "on" | "strict"; serverUrl: string; serverReachable: boolean };
  ollama: { url: string; reachable: boolean; version: string | null; minimum: string; ok: boolean };
  machine: { ramGb: number; platform: string; arch: string };
  offline: boolean;
  defaultProvider: string;
  openrouterKey: boolean;
  /** FreeLLMAPI has an address and a key (not whether the router is running) */
  freellmReady?: boolean;
  cloudflareKey: boolean;
  recommendation: string | null;
  /** the hardware the setup profiles are chosen from (P3) */
  hardware?: MachineInfo;
  gpu?: { name: string };
  installed: Array<{ name: string; sizeGb: number }>;
  /** The Ollama model each feature would call now, from the feature's own picker (lib/modelUse.ts). */
  picks?: { decision: string; translate: string | null; okfilow: string[] };
  models: Array<{
    name: string; kind: string; runtime: "ollama" | "browser" | "sherpa"; label: string; description: string; downloadGb: number; loadedGb: number; ramGb: number; vramGb?: number;
    status: "available" | "planned"; fit: "fits" | "tight" | "too big"; installed: boolean; installedSizeGb: number | null; ollamaOk: boolean;
  }>;
};

/** Electron accelerator → the keys a person reads: CommandOrControl+Shift+Space → Ctrl, Shift, Space (⌘ on a Mac). */
function prettyHotkey(acc: string): string[] {
  const mac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
  const names: Record<string, string> = {
    commandorcontrol: mac ? "⌘" : "Ctrl",
    cmdorctrl: mac ? "⌘" : "Ctrl",
    command: "⌘",
    cmd: "⌘",
    control: "Ctrl",
    ctrl: "Ctrl",
    alt: mac ? "⌥" : "Alt",
    option: "⌥",
    shift: mac ? "⇧" : "Shift",
    super: mac ? "⌘" : "Win",
    meta: mac ? "⌘" : "Win",
    printscreen: "Print Screen",
    space: "Space",
    plus: "+",
  };
  return acc
    .split("+")
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => names[k.toLowerCase()] ?? (k.length === 1 ? k.toUpperCase() : k));
}

export default function LocalModelsPage() {
  const [lang, setLang] = useUiLang();
  const [theme, setTheme] = useUiTheme();
  return (
    <LangProvider lang={lang}>
      <SettingsInner lang={lang} onLang={setLang} theme={theme} onTheme={setTheme} />
    </LangProvider>
  );
}

function SettingsInner({ lang, onLang, theme, onTheme }: { lang: Lang; onLang: (l: Lang) => void; theme: "system" | "light" | "dark"; onTheme: (t: "system" | "light" | "dark") => void }) {
  const t = useT();
  const [status, setStatus] = useState<Status | null>(null);
  const [provider, setProvider] = useState<DecisionProviderId | "">("");
  const [progress, setProgress] = useState<Record<string, ReactNode>>({});
  /** One AbortController per running pull, so a pull started by mistake can be stopped. */
  const pulls = useRef<Record<string, AbortController>>({});
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [whisperModel, setWhisperModel] = useState("");
  const [cached, setCached] = useState<Record<string, boolean>>({});
  const [screenMode, setScreenModeState] = useState<ScreenMode>("balanced");
  const [startMode, setStartModeState] = useState<StartMode>("ask");
  const [speechLang, setSpeechLangState] = useState<SpeechLang>("auto");
  const [gateMode, setGateModeState] = useState<GateMode>("off");
  const [gateStatus, setGateStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [gatePct, setGatePct] = useState<number | null>(null);
  const [hotkey, setHotkey] = useState<{ hotkey: string; enabled: boolean } | null>(null);
  const [hotkeyDraft, setHotkeyDraft] = useState("");
  const [hotkeyMsg, setHotkeyMsg] = useState("");
  const [ai, setAi] = useState<LocalAiStatus | null>(null);
  const [hw, setHw] = useState<LocalAiHardware | null>(null);
  const [autoList, setAutoList] = useState<string[]>([]);
  const res = useResources();
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [setupPref, setSetupPref] = useState<SetupPreference>("auto");
  const [setupBusy, setSetupBusy] = useState(false);
  const loadPlan = async (probe: boolean) => {
    setPlanBusy(true);
    try {
      setPlan(await fetchPlan({ probe }));
    } catch {
      /* shown as missing */
    } finally {
      setPlanBusy(false);
    }
  };
  const [sherpa, setSherpa] = useState<SherpaStatus | null>(null);
  // The plan says which engine follows a talk and which model ticks the points, so "in use" depends on
  // it: it is read at the start and again whenever a model arrives or goes (downloaded, deleted).
  const onDisk = `${sherpa?.model === "ready"}|${sherpa?.active ?? ""}|${Object.keys(cached).filter((k) => cached[k]).join(",")}|${(status?.installed ?? []).map((i) => i.name).join(",")}`;
  useEffect(() => {
    void loadPlan(false);
  }, [onDisk]);
  useEffect(() => {
    const b = sherpaBridge();
    if (!b) return;
    // The shell holds the spoken language (and picks its model by it): read it from there.
    void syncSpeechLang(b).then(({ lang: spoken, status }) => { setSpeechLangState(spoken); if (status) setSherpa(status); });
    return b.onStatus((s) => setSherpa(s));
  }, []);
  // S1-mini by Superwhisper for the setup picker: present or not, and a running download, as the desktop app says.
  const [cleanupModel, setCleanupModel] = useState<{ runtime: boolean; model: boolean; downloading: boolean; pct: number } | null>(null);
  const readCleanupModel = useCallback(() => {
    void dictationBridge()?.status().then((v) => setCleanupModel(v?.cleanupState ?? null)).catch(() => {});
  }, []);
  useEffect(() => {
    readCleanupModel();
    const timer = setInterval(readCleanupModel, 2000);
    return () => clearInterval(timer);
  }, [readCleanupModel]);

  const refresh = useCallback(async () => {
    await ensureEngineToken();
    const res = await fetch(`/api/local/status?setup=${encodeURIComponent(getSetupPreference())}`, { cache: "no-store" });
    const s = (await res.json()) as Status;
    setStatus(s);
    const c: Record<string, boolean> = {};
    for (const m of s.models) if (m.runtime === "browser") c[m.name] = await whisperCached(m.name);
    setCached(c);
    setGateCached(await whisperCached(GATE_MODEL));
  }, []);

  // What "in use" is worked out from (lib/modelUse.ts): the plan, the user's switches, OK Filow's own status.
  const [okf, setOkf] = useState<UseContext["okFilow"]>(null);
  const [translateWhere, setTranslateWhere] = useState<UseContext["translateWhere"]>("local");
  const [gateCached, setGateCached] = useState(false);
  useEffect(() => {
    const b = (globalThis as { filow?: { okFilow?: { status(): Promise<{ enabled?: boolean; provider?: string; offline?: boolean } | null> } } }).filow?.okFilow;
    const read = () => {
      setTranslateWhere(readTranslateWhere(typeof localStorage === "undefined" ? null : localStorage));
      void b?.status().then((s) => setOkf(s ? { enabled: s.enabled !== false, provider: s.provider ?? "", offline: Boolean(s.offline) } : null)).catch(() => {});
    };
    read();
    const timer = setInterval(read, 4000);
    return () => clearInterval(timer);
  }, []);
  const useCtx: UseContext = { plan, startMode, decisionPref: provider, okFilow: okf, translateWhere, gateMode, whisperModel, picks: status?.picks ?? null };

  useEffect(() => {
    setProvider(getDecisionProvider() ?? "");
    setWhisperModel(selectedWhisperModel());
    setScreenModeState(getScreenMode());
    setStartModeState(getStartMode());
    setSpeechLangState(getSpeechLang());
    setGateModeState(getGateMode());
    setSetupPref(getSetupPreference());
    void screenBridge()
      ?.getSettings()
      .then((h) => {
        setHotkey(h);
        setHotkeyDraft(h.hotkey);
      });
    void refresh();
    const la = desktopBridge()?.localAi;
    if (!la) return;
    void la.status().then(setAi);
    void la.hardware().then(setHw);
    const off = la.onStatus((s) => {
      setAi(s);
      if (s.state === "ready") void refresh();
    });
    return off;
  }, [refresh]);

  const aiText = (s: LocalAiStatus) => localAiText(s, t);

  /** Ask the desktop shell to install Ollama and resolve once it answers (or give up after 30 minutes). */
  const ensureOllama = async (): Promise<boolean> => {
    const la = desktopBridge()?.localAi;
    if (!la) return false;
    let asked = false;
    let fresh = false;
    const until = Date.now() + 30 * 60_000;
    while (Date.now() < until) {
      const step = localAiEnsureStep(await la.status(), asked, fresh);
      if (step === "ready") return true;
      if (step === "failed") return false;
      if (step === "wait") fresh = true;
      if (step === "ask") {
        asked = true;
        la.install();
      }
      await new Promise((r) => setTimeout(r, step === "ask" ? 300 : 2000));
    }
    return false;
  };

  const saveHotkey = async (next: { hotkey?: string; enabled?: boolean }) => {
    const bridge = screenBridge();
    if (!bridge) return;
    const r = await bridge.setSettings(next);
    setHotkey({ hotkey: r.hotkey, enabled: r.enabled });
    setHotkeyDraft(r.hotkey);
    setHotkeyMsg(r.ok ? t("settings.saved") : r.error ?? t("settings.hotkeyFailed"));
  };

  const download = async (name: string) => {
    setError(null);
    setProgress((p) => ({ ...p, [name]: t("settings.starting") }));
    const ctl = new AbortController();
    pulls.current[name] = ctl;
    // A model that was here before this click ("Re-check") stays when the check is stopped.
    const hadIt = Boolean(cached[name]);
    clearTimeout(lateRemovals.current[name]);
    try {
      // One number for the whole model: its files download in parallel (issue #4).
      const total = createDownloadProgress();
      const device = await preloadWhisper(name, (p) => {
        const percent = total.update(p);
        setProgress((pr) => ({ ...pr, [name]: <DownloadLabel label={t("progress.speechModel")} percent={percent} /> }));
      }, ctl.signal);
      setTestResult((r) => ({ ...r, [name]: t("settings.readyOn", { device }) }));
      setCached((c) => ({ ...c, [name]: true }));
    } catch (err) {
      // Stopped by the user: not an error, and the files that were already complete go too.
      if (err instanceof DOMException && err.name === "AbortError") {
        if (!hadIt) {
          await removeStopped(name);
          setCached((c) => ({ ...c, [name]: false }));
        }
      } else setError(`Whisper: ${(err as Error).message}`);
    } finally {
      delete pulls.current[name];
      setProgress((p) => ({ ...p, [name]: "" }));
    }
  };

  /**
   * After a Stop: the files that were already complete go. A file whose write to the browser cache was
   * under way when the worker ended can still land a moment later (seen once, stopping at 0%), so the
   * cache is cleared a second time shortly after.
   */
  const lateRemovals = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const removeStopped = async (name: string) => {
    await removeCachedModel(name);
    clearTimeout(lateRemovals.current[name]);
    // dropped when the same model is downloaded again meanwhile (download() and the pre-filter button clear it)
    lateRemovals.current[name] = setTimeout(() => void removeCachedModel(name), 2500);
  };
  /** The user pressed Stop on the Ollama installer: the setup that asked for it ends quietly, not with "Ollama is not running". */
  const ollamaStopped = useRef(false);

  /** One question (name, size, what it is in use for) before a model that lives in the app's own page is deleted. */
  const removeCached = async (name: string, kind: "whisper" | "gate", sizeGb: number) => {
    const uses = browserUses({ name, kind }, useCtx);
    if (!confirm(deleteQuestion({ name: kind === "gate" ? t("gate.label") : label(name), size: sizeText(sizeGb * 1024 ** 3, t), uses, effect: "browser" }, t))) return;
    if (kind === "gate") {
      unloadGate();
      setGateStatus("idle");
      setGatePct(null);
    }
    await removeCachedModel(name);
    if (kind === "gate") setGateCached(false);
    else setCached((c) => ({ ...c, [name]: false }));
  };

  const pull = async (name: string) => {
    setError(null);
    setProgress((p) => ({ ...p, [name]: t("settings.starting") }));
    const ctl = new AbortController();
    pulls.current[name] = ctl;
    try {
      const res = await fetch("/api/local/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...engineHeaders() },
        body: JSON.stringify({ name }),
        signal: ctl.signal,
      });
      if (!res.ok || !res.body) {
        const { error } = (await res.json().catch(() => ({ error: `pull failed (${res.status})` }))) as { error?: string };
        setError(error ?? "pull failed");
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      // Ollama reports each layer (digest) on its own: one number for the whole model (issue #4).
      const total = createDownloadProgress();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const j = JSON.parse(line) as { status?: string; digest?: string; total?: number; completed?: number; error?: string };
            if (j.error) setError(j.error);
            const percent = total.update({ status: j.status, file: j.digest, loaded: j.completed, total: j.total });
            const checking = /^(verifying|writing|success)/.test(j.status ?? "");
            const label = checking ? t("progress.verifying") : percent === null ? t("settings.starting") : <DownloadLabel label={t("progress.ollamaModel")} percent={percent} />;
            setProgress((p) => ({ ...p, [name]: label }));
          } catch {
            /* partial line */
          }
        }
      }
    } catch (err) {
      // Cancelled by the user: closing the request makes Ollama stop the download; partial blobs
      // are resumed by a later pull or cleaned up by Ollama.
      if (!(err instanceof DOMException && err.name === "AbortError")) setError(String(err));
    } finally {
      delete pulls.current[name];
      setProgress((p) => ({ ...p, [name]: "" }));
      void refresh();
    }
  };

  const cancelPull = (name: string) => {
    pulls.current[name]?.abort();
  };

  const remove = async (name: string, sizeGb: number) => {
    // One question that names the model and its size and, when a feature uses it, says so and what happens next.
    if (!confirm(deleteQuestion({ name: label(name), size: sizeText(sizeGb * 1024 ** 3, t), uses: ollamaUses(name, useCtx), effect: "ollama" }, t))) return;
    const res = await fetch("/api/local/pull", { method: "DELETE", headers: { "Content-Type": "application/json", ...engineHeaders() }, body: JSON.stringify({ name }) }).catch(() => null);
    if (!res || !res.ok) setError(t("settings.deleteFailed", { name: label(name), error: res ? `HTTP ${res.status}` : "" }));
    void refresh();
  };

  const unload = async (name: string) => {
    await fetch("/api/local/unload", { method: "POST", headers: { "Content-Type": "application/json", ...engineHeaders() }, body: JSON.stringify({ name }) });
    void refresh();
  };

  const test = async (name: string) => {
    setTestResult((r) => ({ ...r, [name]: t("settings.running") }));
    const res = await fetch("/api/local/test", { method: "POST", headers: { "Content-Type": "application/json", ...engineHeaders() }, body: JSON.stringify({ model: name }) });
    const j = (await res.json()) as { ok: boolean; latencyMs?: number; error?: string; decisions?: Array<{ id: string; confidence: number }> };
    setTestResult((r) => ({
      ...r,
      [name]: j.ok
        ? `${j.latencyMs} ms · welcome ${Math.round((j.decisions?.[0]?.confidence ?? 0) * 100)}% · pricing ${Math.round((j.decisions?.[1]?.confidence ?? 0) * 100)}%`
        : t("settings.failed", { error: j.error ?? "" }),
    }));
  };

  // ?auto=whisper-base,whisper-small,clef-flash : written by the Windows installer's "models" page.
  const [autoDone, setAutoDone] = useState(false);
  useEffect(() => {
    if (!status || autoDone) return;
    const auto = new URLSearchParams(window.location.search).get("auto");
    if (!auto) return;
    setAutoDone(true);
    // one start per click: the list leaves the address, so a reload or Back after Stop does not start the downloads again
    const here = new URL(window.location.href);
    here.searchParams.delete("auto");
    window.history.replaceState(window.history.state, "", here);
    const wanted = auto.split(",").map((x) => x.trim()).filter(Boolean);
    setAutoList(wanted);
    (async () => {
      for (const w of wanted) {
        if (w === "nemotron-streaming") {
          const b = sherpaBridge();
          if (b && (await b.status()).model === "missing") b.download();
          continue;
        }
        if (w === "whisper-base" || w === "whisper-small") {
          const name = `onnx-community/${w}`;
          if (!(await whisperCached(name))) await download(name);
          if (!selectedWhisperModel() || w === "whisper-small") {
            setSelectedWhisperModel(name);
            setWhisperModel(name);
          }
        }
      }
      const ollamaWanted = wanted.filter((w) => status.models.some((m) => m.name === w && m.runtime === "ollama" && m.status === "available"));
      if (ollamaWanted.length) {
        let reachable = status.ollama.reachable;
        if (!reachable) reachable = await ensureOllama();
        if (reachable) {
          const fresh = (await fetch("/api/local/status", { cache: "no-store" }).then((r) => r.json())) as Status;
          for (const w of ollamaWanted) {
            const m = fresh.models.find((x) => x.name === w);
            if (m && m.ollamaOk && !m.installed) await pull(w);
          }
        }
      }
      setAutoList([]);
      await refresh();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  /** The setup choice is remembered at once; the router's view follows it. */
  const chooseSetup = (p: SetupPreference) => {
    setSetupPref(p);
    setSetupPreference(p);
    void loadPlan(false);
  };

  /** One-time downloads the setup still needs, one after the other, with the progress shown per model below. */
  const getSetupModels = async (models: SetupModel[]) => {
    setSetupBusy(true);
    try {
      for (const m of models) {
        if (m.runtime === "llama") {
          // the same call the button in the Dictation section makes: the app downloads, resumes and checks the hash
          await dictationBridge()?.downloadCleanup?.().catch(() => undefined);
          readCleanupModel();
          continue;
        }
        if (m.runtime === "sherpa") {
          const b = sherpaBridge();
          if (b && (await b.status()).model !== "ready") b.download();
          continue;
        }
        if (m.runtime !== "ollama") continue;
        ollamaStopped.current = false;
        if (!status?.ollama.reachable && !(await ensureOllama())) {
          // stopped by the user while the installer downloaded: a choice, not an error
          if (!ollamaStopped.current) setError(t("settings.ollamaNotRunning"));
          return;
        }
        await pull(m.name);
      }
    } finally {
      setSetupBusy(false);
      void refresh();
    }
  };

  // Links to /settings/local#setup (start dialog, take chip): the section renders after the status loads.
  useEffect(() => {
    // also #models (a download started from the Easy page: the list where it runs and can be stopped) and #freellm (where a key is added)
    const section = window.location.hash.slice(1);
    if (status && /^[a-z]+$/.test(section)) document.getElementById(section)?.scrollIntoView({ block: "start" });
  }, [status]);

  const choose = (id: DecisionProviderId | "") => {
    setProvider(id);
    setDecisionProvider(id);
  };

  /** Model names and descriptions live only in the dictionary (modelLabel.<name>, model.<name>). */
  const describe = (m: { name: string }) => t(`model.${m.name}` as I18nKey);
  const label = (name: string | null) => {
    if (!name) return "";
    const key = `modelLabel.${name}` as I18nKey;
    const text = t(key);
    return text === key ? name : text;
  };

  const providerLabel = (id: string) => (id === "openrouter" || id === "clef-local" || id === "clef-cloudflare" || id === "matcher" || id === "freellm" ? t(`provider.${id}`) : id);

  return (
    <div className="app settings">
      <header className="topbar">
        <div className="logo">
          <Wordmark height={28} />
        </div>
        <span className="subtitle">{t("easy.advanced")}</span>
        <span className="spacer" />
        {status?.offline && <span className="chip err">{t("app.offline")}</span>}
        <ThemeSwitch pref={theme} onChange={onTheme} />
        <LangSwitch lang={lang} onChange={onLang} />
        {/* Settings opens on the Easy page; this page is the detail behind it */}
        <Link className="btn" href="/settings" data-testid="back-to-easy">
          {t("easy.back")}
        </Link>
        <Link className="btn" href="/">
          {t("common.back")}
        </Link>
      </header>

      <section className="strip">
        <div className="label">{t("common.language")}</div>
        <div className="row">
          {LANGS.map((l) => (
            <label key={l} className={`btn choice ${lang === l ? "primary" : ""}`}>
              <input type="radio" name="lang" checked={lang === l} onChange={() => onLang(l)} /> {LANG_LABELS[l]}
            </label>
          ))}
        </div>
        <div className="hint">{t("settings.languageHint")}</div>
      </section>

      {!status ? (
        <div className="hint">{t("common.loading")}</div>
      ) : (
        <>
          {status.hardware && (
            <SetupPicker
              hardware={status.hardware}
              gpuName={status.gpu?.name ?? ""}
              preference={setupPref}
              onChange={chooseSetup}
              installed={{ ollama: status.installed.map((i) => i.name), sherpa: sherpa?.model === "ready" }}
              onGet={(m) => void getSetupModels(m)}
              busy={setupBusy}
              cleanup={cleanupModel}
              onStopCleanup={modelsBridge() ? () => void modelsBridge()?.cancel("cleanup").then(readCleanupModel) : undefined}
            />
          )}

          <ResourcesPanel />

          <section className="strip">
            <div className="label">{t("plan.label")}</div>
            <div className="hint">{t("plan.hint")}</div>
            {plan && (
              <div className="planrows">
                <div><strong>{t("plan.task.stt")}</strong> {t(`plan.stt.${plan.stt.backend ?? "none"}`)} <span className="hint">· {t(`plan.reason.${plan.stt.reason}` as I18nKey)}</span></div>
                <div><strong>{t("plan.task.decision")}</strong> {t(`plan.decision.${plan.decision.provider ?? "none"}`)}{plan.decision.measuredMs ? ` · ${plan.decision.measuredMs} ms` : ""} <span className="hint">· {t(`plan.reason.${plan.decision.reason}` as I18nKey)}</span></div>
                <div><strong>{t("plan.task.generate")}</strong> {plan.generate.provider === "ollama" ? label(plan.generate.model) : t(`plan.decision.${plan.generate.provider === "openrouter" ? "openrouter" : "none"}`)} <span className="hint">· {t(`plan.reason.${plan.generate.reason}` as I18nKey)}</span></div>
                <div><strong>{t("plan.task.vision")}</strong> {t(`plan.decision.${plan.vision.provider === "openrouter" ? "openrouter" : "none"}`)}</div>
                {plan.expectedTickMs !== null && <div className="hint">{t("plan.expected", { s: (plan.expectedTickMs / 1000).toFixed(1) })}</div>}
              </div>
            )}
            <div className="row">
              <button className="btn primary" disabled={planBusy} onClick={() => void loadPlan(true)}>
                {planBusy ? t("settings.running") : t("plan.measure")}
              </button>
              <span className="hint">{t("plan.measureHint")}</span>
            </div>
          </section>

          <section className="strip">
            <div className="label">{t("speech.label")}</div>
            <div className="row">
              {SPEECH_LANGS.map((l) => (
                <label key={l} className={`btn choice ${speechLang === l ? "primary" : ""}`}>
                  <input
                    type="radio"
                    name="speechLang"
                    checked={speechLang === l}
                    onChange={() => {
                      setSpeechLangState(l);
                      void chooseSpeechLang(l, sherpaBridge()).then((s) => { if (s) setSherpa(s); });
                    }}
                  />{" "}
                  {t(`speech.${l}`)}
                </label>
              ))}
            </div>
            <div className="hint">{t("speech.hint")}</div>
            <MicrophoneSelect webSpeech />
          </section>

          <section className="strip">
            <div className="label">{t("start.modeLabel")}</div>
            <div className="row">
              {(["ask", "auto", "cloud", "local"] as StartMode[]).map((m) => (
                <label key={m} className={`btn choice ${startMode === m ? "primary" : ""}`}>
                  <input
                    type="radio"
                    name="startMode"
                    checked={startMode === m}
                    onChange={() => {
                      setStartModeState(m);
                      setStartMode(m);
                    }}
                  />{" "}
                  {m === "ask" ? t("start.modeAsk") : m === "auto" ? t("start.modeAuto") : m === "cloud" ? t("start.modeCloud") : t("start.modeLocal")}
                </label>
              ))}
            </div>
          </section>

          <details className="strip more-options">
            <summary className="label">{t("settings.moreOptions")}</summary>
            <section className="strip">
              <div className="label">{t("gate.label")}</div>
              <div className="row">
                {(["off", "on"] as GateMode[]).map((m) => (
                  <label key={m} className={`btn choice ${gateMode === m ? "primary" : ""}`}>
                    <input
                      type="radio"
                      name="gateMode"
                      checked={gateMode === m}
                      onChange={() => {
                        setGateModeState(m);
                        setGateMode(m);
                      }}
                    />{" "}
                    {t(`gate.${m}`)}
                  </label>
                ))}
                <button
                  className="btn"
                  disabled={gateStatus === "loading" || gateStatus === "ready"}
                  onClick={() => {
                    setGateStatus("loading");
                    // a model that was here before this click (loaded again after a restart) stays when the load is stopped
                    const hadIt = gateCached;
                    clearTimeout(lateRemovals.current[GATE_MODEL]);
                    loadGate((p) => setGatePct(p.percent)).then(
                      () => { setGateStatus("ready"); setGateCached(true); },
                      (err) => {
                        // Stopped by the user: back to "Download", and the files that were already complete go too.
                        const stopped = err instanceof DOMException && err.name === "AbortError";
                        setGateStatus(stopped ? "idle" : "error");
                        setGatePct(null);
                        if (stopped && !hadIt) void removeStopped(GATE_MODEL).then(() => setGateCached(false));
                      },
                    );
                  }}
                >
                  {gateStatus === "ready" ? t("gate.ready") : gateStatus === "loading" ? <DownloadLabel label={t("progress.gateModel")} percent={gatePct} /> : t("gate.download")}
                </button>
                {gateStatus === "loading" && <StopButton name={t("gate.label")} onStop={() => stopGate()} />}
                {gateStatus !== "loading" && gateCached && (
                  <>
                    <span className="chip live">{t("settings.installed")}</span>
                    <InUseChip uses={browserUses({ name: GATE_MODEL, kind: "gate" }, useCtx)} />
                    <button type="button" className="btn danger" aria-label={t("settings.deleteLabel", { name: t("gate.label") })} onClick={() => void removeCached(GATE_MODEL, "gate", 0.12)}>
                      {t("settings.delete")}
                    </button>
                  </>
                )}
              </div>
              <div className="hint">{t("gate.hint")}</div>
            </section>
            <section className="strip">
              <div className="label">{t("settings.provider")}</div>
              <div className="hint">{t("settings.providerHint")}</div>
              <div className="row">
                {(["matcher", "clef-local", "openrouter", "clef-cloudflare"] as DecisionProviderId[]).map((id) => {
                  const disabled =
                    (id === "openrouter" && (!status.openrouterKey || status.offline)) ||
                    (id === "clef-cloudflare" && (!status.cloudflareKey || status.offline));
                  return (
                    <label key={id} className={`btn choice ${provider === id ? "primary" : ""}`} title={disabled ? t("settings.notConfigured") : ""}>
                      <input type="radio" name="provider" checked={provider === id} disabled={disabled} onChange={() => choose(id)} /> {t(`provider.${id}`)}
                    </label>
                  );
                })}
                <label className={`btn choice ${provider === "" ? "primary" : ""}`}>
                  <input type="radio" name="provider" checked={provider === ""} onChange={() => choose("")} />{" "}
                  {t("settings.serverDefault", { name: providerLabel(status.defaultProvider) })}
                </label>
              </div>
            </section>
          </details>

          <FreeLlmSettings onChange={() => void refresh()} />
          <WhiteboardModelSetting />

          <section className="strip">
            <div className="label">Ollama</div>
            <div className="row">
              <span className={`chip ${status.ollama.ok ? "live" : "err"}`}>
                {status.ollama.reachable ? `${status.ollama.version}${status.ollama.ok ? "" : ` ${t("settings.ollamaNeed", { v: status.ollama.minimum })}`}` : t("settings.ollamaNotRunning")}
              </span>
              <span className="hint">{status.ollama.url}</span>
              <span className="hint">
                {t("settings.machine", { ram: status.machine.ramGb, platform: status.machine.platform, arch: status.machine.arch })}{" "}
                {status.recommendation ? t("settings.recommended", { name: status.recommendation }) : t("settings.tooLittleRam")}
              </span>
            </div>
            {hw && (
              <div className="hint">
                {t("settings.hardware", { gpu: hw.gpu || "-", free: hw.freeGb })}
                {hw.recommended.models.length > 0 && <> · {t("settings.recommendedList", { list: hw.recommended.models.map((n) => t(`catalog.${n}` as I18nKey)).join(", "), gb: hw.recommended.downloadGb })}</>}
              </div>
            )}
            {autoList.length > 0 && <div className="hint">{t("settings.autoSetup", { list: autoList.join(", ") })}</div>}
            {!status.ollama.ok && desktopBridge()?.localAi && (
              <div className="row">
                <button
                  className="btn primary"
                  disabled={localAiBusy(ai)}
                  onClick={() => desktopBridge()?.localAi?.install()}
                >
                  {ai?.state === "error" ? t("settings.ai.retry") : t("settings.aiInstallBtn")}
                </button>
                {/* this row is only there while Ollama is not usable: an old "ready" would contradict the chip above */}
                {localAiBusy(ai) && ai && <span className="chip busy">{aiText(ai)}</span>}
                {/* the installer's download can be stopped; an install that is running is left to finish */}
                {ai?.state === "downloading" && modelsBridge() && <StopButton name="Ollama" onStop={() => { ollamaStopped.current = true; void modelsBridge()?.cancel("ollama-installer"); }} />}
                {/* after a failure the line below says what to do; "downloads the installer" would be wrong for an Ollama that is installed */}
                {ai?.state !== "error" && <span className="hint">{t("settings.aiHint")}</span>}
              </div>
            )}
            {!status.ollama.ok && ai?.state === "error" && (
              <div className="row" role="alert" data-testid="ollama-failure" style={{ alignItems: "center", gap: 12, margin: "8px 0" }}>
                {/* full-size text: this is the line the user has to read and act on, not a status chip */}
                <span style={{ color: "var(--warn)", flex: "1 1 420px" }}>{aiText(ai)}</span>
                {localAiNeedsReport(ai) && desktopBridge()?.reportProblem && (
                  <button type="button" className="btn small" onClick={() => desktopBridge()?.reportProblem?.()}>
                    {t("log.report")}
                  </button>
                )}
              </div>
            )}
            {ai?.state === "manual" && (
              <div className="hint">
                {t("settings.ai.manual")} <code>{ai.command}</code>
              </div>
            )}
            {!status.ollama.ok && (
              <div className="hint">
                {t("settings.installOllama", { v: status.ollama.minimum })}{" "}
                <a href="https://ollama.com/download" target="_blank" rel="noreferrer">
                  ollama.com/download
                </a>
              </div>
            )}
          </section>

          <DeviceModelList ctx={useCtx} onChange={() => { readCleanupModel(); void sherpaBridge()?.status().then(setSherpa); }} />

          <section className="strip" id="models">
            <div className="label">{t("settings.models")}</div>
            <div className="hint">{t("settings.ramNote")}</div>
            {status.models.map((m) => (
              <div key={m.name} className="model">
                <div>
                  <strong>{label(m.name)}</strong> <span className="chip">{t(`plan.task.${m.kind}` as I18nKey)}</span>{" "}
                  <span className={`chip ${m.fit === "fits" ? "live" : m.fit === "tight" ? "" : "err"}`}>{t(`fit.${m.fit}`)}</span>{" "}
                  {m.runtime !== "sherpa" && (m.installed || cached[m.name]) && <span className="chip live">{t("settings.installed")}</span>}{" "}
                  {m.runtime === "ollama" && m.installed && <InUseChip uses={ollamaUses(m.name, useCtx)} />}
                  {m.runtime === "browser" && cached[m.name] && <InUseChip uses={browserUses({ name: m.name, kind: "whisper" }, useCtx)} />}
                  {res?.loaded.some((l) => l.name === m.name || l.name.startsWith(`${m.name}:`)) &&
                    (() => {
                      const l = res.loaded.find((x) => x.name === m.name || x.name.startsWith(`${m.name}:`))!;
                      return <span className={`chip ${l.where === "gpu" ? "live" : l.where === "cpu" ? "err" : ""}`}>{placementText(t, l)}</span>;
                    })()}
                  {m.runtime === "browser" && whisperModel === m.name && <span className="chip">{t("settings.selectedWhisper")}</span>}
                  {m.status === "planned" && <span className="chip">{t("settings.planned")}</span>}
                  <div className="hint">{describe(m)}</div>
                  <div className="hint memline">
                    <span>{t("mem.download", { dl: m.installedSizeGb ?? m.downloadGb })}</span>
                    {m.runtime === "ollama" ? (
                      <>
                        <span>{m.vramGb ? t("mem.gpu", { vram: m.loadedGb, min: m.vramGb }) : t("mem.gpuNone")}</span>
                        <span>{t("mem.cpu", { ram: m.loadedGb, min: m.ramGb })}</span>
                      </>
                    ) : (
                      <span>{t("mem.browser", { ram: m.loadedGb, min: m.ramGb })}</span>
                    )}
                    {(() => {
                      const l = res?.loaded.find((x) => x.name === m.name || x.name.startsWith(`${m.name}:`));
                      return l ? <span className="chip live">{t("mem.now", { total: l.sizeGb, vram: l.vramGb, pct: l.gpuPct })}</span> : null;
                    })()}
                  </div>
                  {/* Under the description, not beside the button: the button and its Stop keep their line whatever the note says. */}
                  {m.runtime === "sherpa" && sherpaBridge() && <SherpaLanguageNote s={sherpa} />}
                </div>
                <div className="row">
                  {m.status === "available" && m.runtime === "browser" && (
                    <>
                      <button className="btn primary" disabled={Boolean(progress[m.name])} onClick={() => void download(m.name)}>
                        {progress[m.name] ? progress[m.name] : cached[m.name] ? t("settings.recheck") : t("settings.download")}
                      </button>
                      {progress[m.name] && <StopButton name={label(m.name)} onStop={() => cancelPull(m.name)} />}
                      {!progress[m.name] && cached[m.name] && (
                        <button type="button" className="btn danger" aria-label={t("settings.deleteLabel", { name: label(m.name) })} onClick={() => void removeCached(m.name, "whisper", m.downloadGb)}>
                          {t("settings.delete")}
                        </button>
                      )}
                      {whisperModel !== m.name && (
                        <button
                          className="btn"
                          onClick={() => {
                            setSelectedWhisperModel(m.name);
                            setWhisperModel(m.name);
                          }}
                        >
                          {t("settings.useWhisper")}
                        </button>
                      )}
                    </>
                  )}
                  {m.runtime === "sherpa" &&
                    (sherpaBridge() ? (
                      <>
                        {/* Each speech model on disk has its own row above ("Models on this computer"): size, in use, Delete. */}
                        {sherpa?.model === "ready" ? (
                          <span className="chip live">{t("settings.installed")}</span>
                        ) : (
                          <button className="btn primary" disabled={sherpa?.model === "downloading" || sherpa?.model === "extracting"} onClick={() => sherpaBridge()?.download(speechLang)}>
                            {sherpa?.model === "downloading" ? <DownloadLabel label={t("progress.speechModel")} percent={sherpa.pct ?? null} /> : sherpa?.model === "extracting" ? t("settings.starting") : sherpa?.partial ? t("settings.resumeDownload", { pct: sherpa.partial }) : t("settings.download")}
                          </button>
                        )}
                        {(sherpa?.model === "downloading" || sherpa?.model === "extracting") && modelsBridge() && (
                          <StopButton name={sherpa.wantedLabel ?? label(m.name)} onStop={() => void modelsBridge()?.cancel("speech")} />
                        )}
                        {/* a desktop build before the models list: its one Delete (every speech model at once) stays */}
                        {!modelsBridge() && (sherpa?.model === "ready" || sherpa?.active) && (
                          <button className="btn" onClick={() => void sherpaBridge()?.remove()}>
                            {t("settings.delete")}
                          </button>
                        )}
                        {sherpa?.model === "error" && <span className="chip err">{sherpa.error}</span>}
                      </>
                    ) : (
                      <span className="hint">{t("settings.sherpaDesktopOnly")}</span>
                    ))}
                  {m.status === "available" && m.runtime === "ollama" && !m.installed && (
                    <>
                      <button className="btn primary" disabled={!m.ollamaOk || Boolean(progress[m.name])} onClick={() => void pull(m.name)}>
                        {progress[m.name] ? progress[m.name] : t("settings.download")}
                      </button>
                      {progress[m.name] && <StopButton name={label(m.name)} hint={t("settings.stopHintOllama")} onStop={() => cancelPull(m.name)} />}
                    </>
                  )}
                  {m.installed && m.kind === "decision" && (
                    <button className="btn" onClick={() => void test(m.name)}>
                      {t("settings.test")}
                    </button>
                  )}
                  {m.runtime === "ollama" && res?.loaded.some((l) => l.name === m.name || l.name.startsWith(`${m.name}:`)) && (
                    <button className="btn" onClick={() => void unload(res.loaded.find((l) => l.name === m.name || l.name.startsWith(`${m.name}:`))!.name)}>
                      {t("settings.unload")}
                    </button>
                  )}
                  {m.installed && m.runtime === "ollama" && (
                    <button className="btn danger" aria-label={t("settings.deleteLabel", { name: label(m.name) })} onClick={() => void remove(m.name, m.installedSizeGb ?? m.downloadGb)}>
                      {t("settings.delete")}
                    </button>
                  )}
                  {testResult[m.name] && <span className="hint">{testResult[m.name]}</span>}
                </div>
              </div>
            ))}
          </section>

          <section className="strip">
            <div className="label">Screen Sense</div>
            <div className="hint">{t("settings.screenHint")}</div>
            <div className="row">
              {(Object.keys(SCREEN_MODE_LABELS) as ScreenMode[]).map((m) => (
                <label key={m} className={`btn choice ${screenMode === m ? "primary" : ""}`}>
                  <input
                    type="radio"
                    name="screenMode"
                    checked={screenMode === m}
                    onChange={() => {
                      setScreenModeState(m);
                      setScreenMode(m);
                    }}
                  />{" "}
                  {t(`mode.${m}`)}
                </label>
              ))}
            </div>
            <div className="hint">{t("settings.screenModes")}</div>
            {hotkey ? (
              <div className="row">
                <label className={`btn choice ${hotkey.enabled ? "primary" : ""}`}>
                  <input type="checkbox" checked={hotkey.enabled} onChange={(e) => void saveHotkey({ enabled: e.target.checked })} /> {t("settings.hotkeyEnabled")}
                </label>
                <span className="keys" title={t("settings.hotkeyTitle")}>
                  {prettyHotkey(hotkeyDraft || "CommandOrControl+Shift+Space").map((k, i) => (
                    <kbd key={i}>{k}</kbd>
                  ))}
                </span>
                <input className="btn hotkey" value={hotkeyDraft} onChange={(e) => setHotkeyDraft(e.target.value)} placeholder="CommandOrControl+Shift+Space" title={t("settings.hotkeyTitle")} spellCheck={false} />
                <button className="btn" onClick={() => void saveHotkey({ hotkey: hotkeyDraft })}>
                  {t("settings.saveHotkey")}
                </button>
                {hotkeyMsg && <span className="hint">{hotkeyMsg}</span>}
                <span className="hint">{t("settings.hotkeyHint")}</span>
              </div>
            ) : (
              <div className="hint">{t("settings.browserScreen")}</div>
            )}
          </section>

          <OkFilowSettings lang={lang} />
          <DictationSettings lang={lang} />

          <section className="strip">
            <div className="label">{t("settings.privacy")}</div>
            <div className="row">
              <span className={`chip ${status.pii.mode === "off" ? "err" : "live"}`}>{t("settings.piiGuard", { mode: status.pii.mode })}</span>
              <span className={`chip ${status.pii.serverReachable ? "live" : ""}`}>{status.pii.serverReachable ? t("settings.rizzoRunning") : t("settings.rizzoNotRunning")}</span>
              <span className="hint">{status.pii.serverUrl}</span>
            </div>
            <div className="hint">{t("settings.piiHint")}</div>
            {!status.pii.serverReachable && (
              <div className="hint">
                {t("settings.rizzoStart")} <code>git clone https://github.com/Rizzo-AI-Academy/rizzo-pii && cd rizzo-pii && docker build -t rizzo-pii . && docker run -p 127.0.0.1:5005:5005 rizzo-pii</code>
              </div>
            )}
            <div className="hint">{t("settings.offlineHint")}</div>
            <AboutPrivacyLink />
          </section>
          {error && <span className="chip err">{error}</span>}
        </>
      )}
    </div>
  );
}
