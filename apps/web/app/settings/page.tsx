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
  /** the settings could not be read at all: said, with a way to try again, instead of an endless "Loading" */
  const [loadFailed, setLoadFailed] = useState(false);
  const ui = useSyncExternalStore(subscribeUiPreferences, getDesktopPreferences, () => null);
  const langPref = useSyncExternalStore(subscribeUiPreferences, getLanguagePref, () => "" as const);
  // What this page saw while it was open, for the way back (easy.ts EasyCaps): the natural voice
  // speaking, and the online service answers came from.
  const seen = useRef<{ naturalVoice: boolean; lastOnline?: "cloud" | "freellm" }>({ naturalVoice: false });
  // A read that started before a write must not land after it and show the old values.
  const epoch = useRef(0);

  /**
   * Everything the desktop app and this browser hold now. Read again after every write and every
   * few seconds (the OK Filow panel changes the same settings). A read that fails keeps what was
   * read before: one missed answer does not blank the page.
   */
  const readStores = useCallback(async () => {
    const mine = epoch.current;
    const ob = okFilowSettingsBridge(), db = dictationBridge();
    const [o, d] = await Promise.all([ob ? ob.status().catch(() => null) : null, db ? db.status().catch(() => null) : null]);
    if (mine !== epoch.current) return true;
    if (o) {
      if (o.voice === "natural") seen.current.naturalVoice = true;
      if (o.provider !== "local") seen.current.lastOnline = o.provider;
      setOkf(o);
    }
    if (d) setDict(d);
    setLocal(readLocal());
    setSpeech(getSpeechLang());
    // false: a desktop app is behind this page and did not answer
    return (!ob || Boolean(o)) && (!db || Boolean(d));
  }, []);
  const readStatus = useCallback(async () => {
    try {
      await ensureEngineToken();
      const res = await fetch(`/api/local/status?setup=${encodeURIComponent(getSetupPreference())}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setStatus((await res.json()) as Status);
      setLoadFailed(false);
      return true;
    } catch {
      return false;
    }
  }, []);
  const load = useCallback(async () => {
    setLoadFailed(false);
    const [answered, ok] = await Promise.all([readStores(), readStatus()]);
    // a desktop app that did not answer counts too: without it the page has nothing true to show
    if (!answered || !ok) setLoadFailed(true);
  }, [readStores, readStatus]);

  useEffect(() => {
    setBridges({ okFilow: Boolean(okFilowSettingsBridge()), dictation: Boolean(dictationBridge()), ui: Boolean(desktopBridge()?.updatePreferences) });
    void load();
    const timer = setInterval(() => void readStores(), 4000);
    return () => clearInterval(timer);
  }, [load, readStores]);

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
  const visible = useMemo(() => easyVisible(io), [io]);

  const ready = status && local && bridges && (!bridges.okFilow || okf) && (!bridges.dictation || dict);
  const model = useMemo(() => {
    if (!status || !local) return null;
    // What is installed is only known while Ollama answers; unknown means no download is offered
    // (never one for a model that may already be on this PC).
    const base: MachineInfo = status.hardware ?? { ramGb: status.machine.ramGb, cores: typeof navigator === "undefined" ? 4 : navigator.hardwareConcurrency || 4, gpu: { kind: "none", vramGb: null }, freeDiskGb: null };
    const machine: MachineInfo = { ...base, installed: status.ollama.reachable ? status.installed.map((i) => i.name) : undefined };
    const snapshot = easySnapshot({ okFilow: okf, dictation: dict, ui: { lang: langPref, runAtStartup: Boolean(ui?.startup.requested) }, local, speechLanguage: speech });
    const caps: EasyCaps = { online: { openrouter: status.openrouterKey, freellm: Boolean(status.freellmReady) }, ...seen.current };
    return { machine, snapshot, caps, view: easyView(snapshot, machine, caps, visible) };
  }, [status, local, okf, dict, langPref, ui, speech, visible]);

  const write = async (patch: EasyPatch) => {
    setBusy(true);
    setMessage("");
    epoch.current++;
    const ok = await writeEasyPatch(patch, io);
    epoch.current++;
    await readStores();
    // the setup decides which helper answers: the server's view follows it
    if (patch.local?.setup !== undefined) await readStatus();
    setBusy(false);
    setMessage(ok ? "saved" : "failed");
  };

  const onChange = <C extends EasyControl>(control: C, value: EasyValue[C]) => {
    if (!model || busy) return;
    const r = easyPatch(control, value, model.snapshot, model.machine, model.caps);
    // one refusal at a time: a message about an earlier click does not stay under another control
    setRefused(r.ok ? {} : { [control]: r.needs });
    if (r.ok) void write(r.patch);
  };
  const onReset = () => {
    if (!model || busy) return;
    setRefused({});
    // only the controls on this page: a setting behind a control that is not shown is not rewritten
    void write(easyReset(model.snapshot, model.machine, model.caps, visible).patch);
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
        {ready && model ? (
          <EasySettings
            view={model.view}
            visible={visible}
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
        ) : loadFailed ? (
          <div className="strip easy-failed" role="alert">
            <p className="easy-note">{t("easy.loadFailed")}</p>
            <div className="row">
              <button type="button" className="btn primary" onClick={() => void load()}>{t("easy.retry")}</button>
              <a className="btn" href="/settings/local">{t("easy.advanced")}</a>
            </div>
          </div>
        ) : (
          <div className="hint" role="status">{t("common.loading")}</div>
        )}
      </main>
    </div>
  );
}
