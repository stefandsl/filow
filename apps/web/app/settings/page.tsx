"use client";

// Settings: the Easy page. Eight plain controls, preselected for this computer; Advanced settings
// (/settings/local) holds the details. Nothing is stored here: the page reads the settings that
// exist, shows what they mean (packages/core/src/easy.ts) and writes back only what the user changes.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { easyPatch, easyReset, easyView, langFromLocale, type EasyCaps, type EasyControl, type EasyNeeds, type EasyPatch, type EasyValue, type I18nKey, type Lang, type MachineInfo } from "@filow/core";
import { LangProvider, useT, Wordmark } from "@filow/ui";
import { EasySettings } from "@/components/easy/EasySettings";
import { ThemeSwitch, useUiLang, useUiTheme } from "@/components/LangSwitch";
import { dictationBridge } from "@/components/DictationSettings";
import { ensureEngineToken } from "@/components/useSession";
import { okFilowSettingsBridge, type DictationStatus, type OkFilowStatus } from "@/lib/buddy/bridge";
import { downloadHref, easySnapshot, easyVisible, writeEasyPatch, type EasyIo, type EasySources } from "@/lib/easy/io";
import { sizeText } from "@/lib/modelUse";
import { getDesktopPreferences, getLanguagePref, getSetupPreference, getSpeechLang, getStartMode, receiveUiPreferences, setLang, setSetupPreference, setStartMode, subscribeUiPreferences } from "@/lib/prefs";
import { desktopBridge } from "@/lib/sessionUrl";
import { readTranslateWhere, saveTranslateWhere } from "@/lib/translateWhere";

/** The part of /api/local/status this page reads. */
type Status = {
  ollama: { reachable: boolean };
  machine: { ramGb: number; platform: string };
  openrouterKey: boolean;
  freellmReady?: boolean;
  hardware?: MachineInfo;
  installed: Array<{ name: string }>;
};

const store = () => (typeof localStorage === "undefined" ? null : localStorage);
const readLocal = (): EasySources["local"] => ({ setup: getSetupPreference(), startMode: getStartMode(), translateWhere: readTranslateWhere(store()) });

export default function SettingsPage() {
  const [lang] = useUiLang();
  const [theme, setTheme] = useUiTheme();
  return (
    <LangProvider lang={lang}>
      <Inner theme={theme} onTheme={setTheme} />
    </LangProvider>
  );
}

function Inner({ theme, onTheme }: { theme: "system" | "light" | "dark"; onTheme: (t: "system" | "light" | "dark") => void }) {
  const t = useT();
  const [status, setStatus] = useState<Status | null>(null);
  const [okf, setOkf] = useState<OkFilowStatus | null>(null);
  const [dict, setDict] = useState<DictationStatus | null>(null);
  const [local, setLocal] = useState<EasySources["local"] | null>(null);
  const [speech, setSpeech] = useState<EasySources["speechLanguage"]>("auto");
  const [bridges, setBridges] = useState<{ okFilow: boolean; dictation: boolean; ui: boolean } | null>(null);
  const [refused, setRefused] = useState<Partial<Record<EasyControl, EasyNeeds>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<"" | "saved" | "failed">("");
  const ui = useSyncExternalStore(subscribeUiPreferences, getDesktopPreferences, () => null);
  const langPref = useSyncExternalStore(subscribeUiPreferences, getLanguagePref, () => "" as const);
  // The natural voice was heard speaking here: "Answer out loud" puts that one back (easy.ts EasyCaps).
  const natural = useRef(false);

  /** Everything the desktop app and this browser hold now. Read again after every write and every few seconds (the OK Filow panel changes the same settings). */
  const readStores = useCallback(async () => {
    const o = await okFilowSettingsBridge()?.status().catch(() => null) ?? null;
    const d = await dictationBridge()?.status().catch(() => null) ?? null;
    if (o?.voice === "natural") natural.current = true;
    setOkf(o);
    setDict(d);
    setLocal(readLocal());
    setSpeech(getSpeechLang());
  }, []);
  const readStatus = useCallback(async () => {
    await ensureEngineToken();
    const res = await fetch(`/api/local/status?setup=${encodeURIComponent(getSetupPreference())}`, { cache: "no-store" });
    if (res.ok) setStatus((await res.json()) as Status);
  }, []);

  useEffect(() => {
    setBridges({ okFilow: Boolean(okFilowSettingsBridge()), dictation: Boolean(dictationBridge()), ui: Boolean(desktopBridge()?.updatePreferences) });
    void readStores();
    void readStatus().catch(() => undefined);
    const timer = setInterval(() => void readStores(), 4000);
    return () => clearInterval(timer);
  }, [readStores, readStatus]);

  const startupSupported = Boolean(bridges?.ui && ui?.startup.supported);
  const io = useMemo<EasyIo>(() => {
    const o = okFilowSettingsBridge(), d = dictationBridge(), desk = desktopBridge();
    return {
      okFilow: bridges?.okFilow && o ? (patch) => o.configure(patch as Parameters<typeof o.configure>[0]) : undefined,
      dictation: bridges?.dictation && d ? (patch) => d.configure(patch) : undefined,
      startup: startupSupported && desk?.updatePreferences ? async (on) => {
        const r = await desk.updatePreferences!({ runAtStartup: on });
        receiveUiPreferences(r.state);
        return r.ok;
      } : undefined,
      lang: setLang,
      setup: setSetupPreference,
      startMode: setStartMode,
      translateWhere: (w) => saveTranslateWhere(store(), w),
    };
  }, [bridges, startupSupported]);

  const ready = status && local && bridges && (!bridges.okFilow || okf) && (!bridges.dictation || dict);
  const model = useMemo(() => {
    if (!status || !local) return null;
    // What is installed is known when Ollama answers, or when the desktop app can install it for a download.
    const knowsInstalled = status.ollama.reachable || Boolean(desktopBridge()?.localAi);
    const base: MachineInfo = status.hardware ?? { ramGb: status.machine.ramGb, cores: typeof navigator === "undefined" ? 4 : navigator.hardwareConcurrency || 4, gpu: { kind: "none", vramGb: null }, freeDiskGb: null };
    const machine: MachineInfo = { ...base, installed: knowsInstalled ? status.installed.map((i) => i.name) : undefined };
    const snapshot = easySnapshot({ okFilow: okf, dictation: dict, ui: { lang: langPref, runAtStartup: Boolean(ui?.startup.requested) }, local, speechLanguage: speech });
    const caps: EasyCaps = { online: { openrouter: status.openrouterKey, freellm: Boolean(status.freellmReady) }, naturalVoice: natural.current };
    return { machine, snapshot, caps, view: easyView(snapshot, machine, caps) };
  }, [status, local, okf, dict, langPref, ui, speech]);

  const write = async (patch: EasyPatch) => {
    setBusy(true);
    setMessage("");
    const ok = await writeEasyPatch(patch, io);
    await readStores();
    // the setup decides which helper answers: the server's view follows it
    if (patch.local?.setup !== undefined) await readStatus().catch(() => undefined);
    setBusy(false);
    setMessage(ok ? "saved" : "failed");
  };

  const onChange = <C extends EasyControl>(control: C, value: EasyValue[C]) => {
    if (!model || busy) return;
    const r = easyPatch(control, value, model.snapshot, model.machine, model.caps);
    setRefused((now) => ({ ...now, [control]: r.ok ? undefined : r.needs }));
    if (r.ok) void write(r.patch);
  };
  const onReset = () => {
    if (!model || busy) return;
    setRefused({});
    void write(easyReset(model.snapshot, model.machine, model.caps).patch);
  };

  // "Automatic" names the language it stands for: the desktop app says which one while Automatic is chosen
  const systemLang: Lang = ui && langPref === "" ? ui.resolvedLang : typeof navigator === "undefined" ? "en" : langFromLocale(navigator.language);
  const modelName = (name: string) => {
    const key = `modelLabel.${name}` as I18nKey;
    const text = t(key);
    // the dictionary names a model with what it is used for in brackets: the detail line keeps the name only
    return text === key ? name : text.replace(/\s*\(.*\)\s*$/, "");
  };
  const startup = ui?.startup.status === "blocked" || ui?.startup.status === "requires-approval" ? ui.startup.status : null;

  return (
    <div className="app settings">
      <header className="topbar">
        <div className="logo">
          <Wordmark height={28} />
        </div>
        <span className="spacer" />
        <ThemeSwitch pref={theme} onChange={onTheme} />
        <Link className="btn" href="/">
          {t("common.back")}
        </Link>
      </header>
      <main className="easy-main">
        {!ready || !model ? (
          <div className="hint" role="status">{t("common.loading")}</div>
        ) : (
          <EasySettings
            view={model.view}
            visible={easyVisible(io)}
            keys={dict?.chordLabel ?? "Ctrl + Win"}
            mac={status.machine.platform === "darwin"}
            systemLang={systemLang}
            startup={startup}
            refused={refused}
            busy={busy}
            message={message}
            onChange={onChange}
            onReset={onReset}
            advancedHref="/settings/local"
            keyHref="/settings/local#freellm"
            downloadHref={(d) => downloadHref(d.models.map((m) => m.name))}
            size={(gb) => sizeText(gb * 1024 ** 3, t)}
            modelName={modelName}
          />
        )}
      </main>
    </div>
  );
}
