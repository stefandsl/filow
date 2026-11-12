"use client";
// Settings > Advanced: "Which model does each task". One row per task with "Automatic (Filow picks:
// ...)" and every model that can do it, on this PC or on the user's own computers (Ollama over the
// network). A server model is chosen only after the page said what goes there; a choice that cannot
// be used now says so under its row, and the task runs on Automatic meanwhile.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { LANG_LABELS, type I18nKey, type Lang } from "@filow/core";
import { useT } from "@filow/ui";
import { engineHeaders } from "./useSession";
import { modelsBridge } from "./ModelControls";
import type { DeviceModels } from "@/lib/modelUse";
import { DESKTOP_HEADER } from "@/lib/modelRoles/view";
import { TASKS, type OllamaTaskId, type SpeechTaskId, type TaskId } from "@/lib/modelRoles/tasks";
import { missingPin, ollamaGroups, optionValue, parseOption, selectedValue, speechGroup, type RoleGroup, type RolesData, type RolesServer } from "@/lib/modelRoles/view";

type T = ReturnType<typeof useT>;
type Ask = { task: OllamaTaskId; source: string; model: string; server: RolesServer };

const SINGLE_KIND: Record<"cleanup" | "punctuation" | "voice", string> = { cleanup: "cleanup", punctuation: "punctuation", voice: "voice" };

/** This launch's token from the desktop window's bridge: only that window may change where tasks run. */
async function desktopHeader(): Promise<Record<string, string>> {
  const bridge = (globalThis as { filow?: { desktopToken?: () => Promise<string> } }).filow;
  try {
    const token = bridge?.desktopToken ? await bridge.desktopToken() : "";
    return token ? { [DESKTOP_HEADER]: token } : {};
  } catch {
    return {};
  }
}

async function put(body: unknown): Promise<{ ok: boolean; code?: string }> {
  try {
    const res = await fetch("/api/local/roles", { method: "PUT", headers: { "Content-Type": "application/json", ...engineHeaders(), ...(await desktopHeader()) }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; code?: string };
    return res.ok ? { ok: true } : { ok: false, code: json.code ?? "failed" };
  } catch {
    return { ok: false, code: "failed" };
  }
}

const errText = (t: T, code: string | undefined) => {
  const key = `roles.err.${code}` as I18nKey;
  const text = t(key);
  return text === key ? t("roles.err.failed") : text;
};

export function ModelRoles({ setup }: { setup: string }) {
  const t = useT();
  const [data, setData] = useState<RolesData | null>(null);
  const [device, setDevice] = useState<DeviceModels | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [said, setSaid] = useState<{ text: string; failed: boolean }>({ text: "", failed: false });
  const [busy, setBusy] = useState(false);

  const read = useCallback(async (fresh = false) => {
    try {
      const res = await fetch(`/api/local/roles?setup=${encodeURIComponent(setup)}${fresh ? "&fresh=1" : ""}`, { headers: engineHeaders(), cache: "no-store" });
      if (res.ok) setData((await res.json()) as RolesData);
    } catch {
      /* the last answer stays on screen */
    }
    void modelsBridge()?.status().then(setDevice).catch(() => {});
  }, [setup]);

  useEffect(() => {
    void read();
    const timer = setInterval(() => void read(), 10_000);
    const now = () => void read();
    window.addEventListener("focus", now);
    return () => { clearInterval(timer); window.removeEventListener("focus", now); };
  }, [read]);

  const done = async (r: { ok: boolean; code?: string }, ok: string) => {
    setSaid(r.ok ? { text: ok, failed: false } : { text: t("roles.saveFailed", { reason: errText(t, r.code) }), failed: true });
    // the save itself listed the server afresh: the cached lists are enough here, and a server that
    // does not answer does not hold the page for its timeout
    await read();
  };

  const choose = async (task: TaskId, value: string) => {
    setSaid({ text: "", failed: false });
    if (!value) {
      setBusy(true);
      await done(await put({ action: "pin", task, pin: null }), t("roles.savedAuto", { task: t(`roles.task.${task}` as I18nKey) }));
      setBusy(false);
      return;
    }
    const picked = parseOption(value);
    if (!picked) return;
    const server = data?.servers.find((s) => s.id === picked.source);
    // a model on another computer: first say what goes there, and wait for the yes
    if (server) return setAsk({ task: task as OllamaTaskId, source: picked.source, model: picked.model, server });
    setBusy(true);
    await done(await put({ action: "pin", task, pin: { source: "local", model: picked.model } }), t("roles.saved", { task: t(`roles.task.${task}` as I18nKey), model: picked.model }));
    setBusy(false);
  };

  const agree = async () => {
    if (!ask) return;
    setBusy(true);
    const r = await put({ action: "pin", task: ask.task, pin: { source: ask.source, model: ask.model, agreed: true } });
    setAsk(null);
    await done(r, t("roles.savedServer", { task: t(`roles.task.${ask.task}` as I18nKey), model: ask.model, name: ask.server.name }));
    setBusy(false);
  };

  if (!data) return null;
  return (
    <section className="strip roles" id="model-roles" data-testid="model-roles" aria-labelledby="roles-title">
      <h2 className="label" id="roles-title">{t("roles.title")}</h2>
      <p className="hint">{t("roles.hint")}</p>
      <div className="roles-list">
        {TASKS.map((def) => (
          <TaskRow key={def.id} task={def.id} engine={def.engine} data={data} device={device} busy={busy} ask={ask?.task === def.id ? ask : null} onChoose={choose} onAgree={agree} onCancel={() => setAsk(null)} t={t} />
        ))}
      </div>
      <Servers data={data} t={t} onChanged={(r, ok) => done(r, ok)} />
      <p className={`hint device-notice${said.failed ? " failed" : ""}`} role="status" data-testid="roles-notice">{said.text}</p>
    </section>
  );
}

function TaskRow(p: { task: TaskId; engine: "ollama" | "speech" | "single"; data: RolesData; device: DeviceModels | null; busy: boolean; ask: Ask | null; onChoose: (task: TaskId, value: string) => void; onAgree: () => void; onCancel: () => void; t: T }) {
  const { task, t } = p;
  const id = useId();
  const name = t(`roles.task.${task}` as I18nKey);
  if (p.engine === "single") {
    const model = p.device?.models.find((m) => m.kind === SINGLE_KIND[task as keyof typeof SINGLE_KIND] && m.installed);
    return (
      <div className="roles-row" data-task={task}>
        <span className="roles-name">{name}</span>
        <span className="hint roles-only">{!modelsBridge() ? t("roles.desktopOnly") : model ? t("roles.onlyOne", { name: model.name }) : t("roles.notInstalled")}</span>
      </div>
    );
  }
  let groups: RoleGroup[];
  let autoName: string | null;
  let pin = p.data.pins[task] ?? null;
  let notes: string[] = [];
  let now: string;
  let spoken = "";
  let autoLabel: string | null = null;
  if (p.engine === "speech") {
    const role = p.device?.speechRoles?.[task as SpeechTaskId];
    if (!role || !p.device) {
      return (
        <div className="roles-row" data-task={task}>
          <span className="roles-name">{name}</span>
          <span className="hint roles-only">{t("roles.desktopOnly")}</span>
        </div>
      );
    }
    groups = [speechGroup(role, p.device.models)];
    const label = (key: string | null) => (key ? p.device!.models.find((m) => m.id === `speech:${key}`)?.name ?? key : null);
    autoName = label(role.auto);
    pin = role.pin ? { source: "local", model: role.pin } : pin;
    const language = LANG_LABELS[role.language as Lang] ?? role.language;
    if (role.note === "pinMissing") notes = [t("roles.fallback.missing", { model: label(role.pin) ?? "" })];
    if (role.note === "pinUnfit") notes = [t("roles.fallback.language", { model: label(role.pin) ?? "", language })];
    now = role.active ? t("roles.now", { model: label(role.active) ?? "" }) : t("roles.nowNone");
    spoken = language;
  } else {
    const info = p.data.tasks[task as OllamaTaskId];
    groups = ollamaGroups(task as OllamaTaskId, p.data);
    autoName = info.auto;
    if (info.fallback && pin) {
      const server = p.data.servers.find((s) => s.id === pin!.source);
      notes = [t(`roles.fallback.${info.fallback}` as I18nKey, { model: pin.model, name: server?.name ?? "" })];
    }
    now = info.now ? (info.now.server ? t("roles.nowServer", { model: info.now.model, name: info.now.server }) : t("roles.now", { model: info.now.model })) : t("roles.nowNone");
    // no pointing model: the model that answers places the points itself (lib/buddy/providers.ts localHelper)
    const answers = p.data.tasks.okfilowAnswers.now;
    if (task === "okfilowPointing" && !info.now && answers) {
      autoLabel = t("roles.autoPointing");
      now = t("roles.nowPointing", { model: answers.model });
    }
  }
  const value = selectedValue(pin);
  const gone = missingPin(pin, groups);
  const describedBy = `${id}-now${notes.length ? ` ${id}-note` : ""}`;
  return (
    <div className="roles-row" data-task={task}>
      <label className="roles-name" htmlFor={`${id}-select`}>{name}</label>
      <div className="roles-pick">
        <select id={`${id}-select`} className="btn freellm-input roles-select" value={value} aria-busy={p.busy} aria-describedby={describedBy} onChange={(e) => { if (!p.busy) p.onChoose(task, e.target.value); }}>
          <option value="">{autoLabel ?? (autoName ? t("roles.auto", { model: autoName }) : t("roles.autoNone"))}</option>
          {gone && pin && <option value={optionValue(pin.source, pin.model)} disabled>{t("roles.unavailable", { model: pin.model })}</option>}
          {groups.map((g) => (
            <optgroup key={g.source} label={g.serverName ? t("roles.yourServer", { name: g.serverName }) + (g.reachable ? "" : ` - ${t("roles.unreachableChip")}`) : t("roles.thisPc")}>
              {g.options.map((o) => (
                <option key={o.value} value={o.value} disabled={Boolean(o.unfit)}>
                  {o.unfit ? `${o.label} - ${t(`roles.unfit.${o.unfit}` as I18nKey, { language: spoken })}` : g.serverName ? t("roles.onServer", { model: o.label, name: g.serverName }) : o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <p className="hint roles-now" id={`${id}-now`}>{now}</p>
        {notes.length > 0 && <p className="hint roles-note" id={`${id}-note`} data-testid="roles-fallback">{notes.join(" ")}</p>}
        {p.ask && <ServerNotice ask={p.ask} t={t} busy={p.busy} onAgree={p.onAgree} onCancel={p.onCancel} returnTo={`${id}-select`} />}
      </div>
    </div>
  );
}

/** The first-send notice for a server: what goes, to which of the user's computers, and how it travels. */
function ServerNotice({ ask, t, busy, onAgree, onCancel, returnTo }: { ask: Ask; t: T; busy: boolean; onAgree: () => void; onCancel: () => void; returnTo: string }) {
  // the safe answer has the focus: a stray Enter keeps everything on this PC
  const keep = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => keep.current?.focus(), []);
  const cancel = () => {
    onCancel();
    document.getElementById(returnTo)?.focus();
  };
  return (
    <div className="roles-ask" role="alertdialog" aria-modal="false" aria-labelledby={`${id}-q`} aria-describedby={`${id}-w`} data-testid="roles-ask" onKeyDown={(e) => { if (e.key === "Escape") cancel(); }}>
      <p id={`${id}-q`}>{t("roles.confirm", { task: t(`roles.task.${ask.task}` as I18nKey), what: t(`roles.what.${ask.task}` as I18nKey), name: ask.server.name, url: ask.server.url })}</p>
      <div id={`${id}-w`}>
        {ask.server.warnings.map((w) => <p key={w} className="roles-warn">{t(`roles.warn.${w}` as I18nKey)}</p>)}
      </div>
      <div className="row">
        <button type="button" className="btn primary" disabled={busy} onClick={() => { onAgree(); document.getElementById(returnTo)?.focus(); }}>{t("roles.confirmYes", { name: ask.server.name })}</button>
        <button ref={keep} type="button" className="btn" onClick={cancel}>{t("roles.confirmNo")}</button>
      </div>
    </div>
  );
}

/** This PC's Ollama and the user's own computers: whether each answers, how many models, and its warnings. */
function Servers({ data, t, onChanged }: { data: RolesData; t: T; onChanged: (r: { ok: boolean; code?: string }, ok: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const r = await put({ action: "addServer", name, url });
    setBusy(false);
    if (!r.ok) return setError(errText(t, r.code));
    setError("");
    setName("");
    setUrl("");
    await onChanged(r, t("roles.added", { name: name.trim() || url.trim() }));
  };
  const remove = async (s: RolesServer) => {
    if (busy) return;
    setBusy(true);
    await onChanged(await put({ action: "removeServer", id: s.id }), t("roles.removed", { name: s.name }));
    setBusy(false);
  };
  const count = (s: { reachable: boolean; models: unknown[] }) => (s.reachable ? t("roles.reachable", { n: s.models.length }) : t("roles.unreachableChip"));
  return (
    <div className="roles-servers">
      <h3 className="label" id={`${id}-h`}>{t("roles.servers")}</h3>
      <p className="hint">{t("roles.serversHint")}</p>
      <ul className="roles-server-list" aria-labelledby={`${id}-h`}>
        <li className="roles-server" data-server="local">
          <div>
            <strong>{data.here.elsewhere ? t("roles.hereElsewhere", { host: data.here.elsewhere }) : t("roles.thisPc")}</strong>{" "}
            <span className={`chip ${data.here.reachable ? "live" : "err"}`}>{count(data.here)}</span>
          </div>
        </li>
        {data.servers.map((s) => (
          <li key={s.id} className="roles-server" data-server={s.id}>
            <div>
              <strong>{s.name}</strong>{" "}
              <span className={`chip ${s.reachable ? "live" : "err"}`} data-testid="server-state">{count(s)}</span>
              <span className="hint roles-url">{s.url}</span>
              {s.warnings.map((w) => <p key={w} className="hint roles-warn">{t(`roles.warn.${w}` as I18nKey)}</p>)}
            </div>
            <button type="button" className="btn danger" aria-label={t("roles.removeLabel", { name: s.name })} onClick={() => void remove(s)}>{t("roles.removeServer")}</button>
          </li>
        ))}
      </ul>
      <form className="freellm-fields roles-add" onSubmit={(e) => void add(e)} aria-label={t("roles.addTitle")}>
        <label htmlFor={`${id}-name`}>{t("roles.serverName")}</label>
        <input id={`${id}-name`} className="btn freellm-input" value={name} maxLength={40} autoComplete="off" placeholder={t("roles.serverNamePlaceholder")} onChange={(e) => setName(e.target.value)} />
        <label htmlFor={`${id}-url`}>{t("roles.serverUrl")}</label>
        <div>
          <input id={`${id}-url`} className="btn freellm-input" value={url} inputMode="url" autoComplete="off" spellCheck={false} placeholder="192.168.1.20:11434" aria-invalid={error ? true : undefined} aria-describedby={`${id}-err`} onChange={(e) => setUrl(e.target.value)} />
          <p className="hint roles-error" id={`${id}-err`} role="alert">{error}</p>
        </div>
        <span />
        <div>
          <button type="submit" className="btn primary" disabled={busy || !url.trim()}>{t("roles.addServer")}</button>
        </div>
      </form>
    </div>
  );
}
