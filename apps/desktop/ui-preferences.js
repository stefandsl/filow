// Electron is injected: this service also runs in Vitest without a desktop session.

function trustedUiSender(event, { welcome, pages, welcomeUrl, appUrl }, welcomeOnly = false) {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame || event.sender.isDestroyed()) return false;
  if (event.sender === welcome) return event.senderFrame.url === welcomeUrl;
  if (welcomeOnly || !pages.includes(event.sender)) return false;
  try { return new URL(event.senderFrame.url).origin === new URL(appUrl).origin; } catch { return false; }
}

function createUiPreferences({ app, nativeTheme, systemPreferences, platform, execPath, portable = false, read, save, initial = {}, helpers = require("./vendor/ui-preferences"), canComplete = () => true }) {
  const { normalizeUiPreferences, resolveUiLanguage, parseSystemAccent, validUiPatch } = helpers;
  let revision = 0, last, queue = Promise.resolve(), disposed = false;
  const listeners = new Set();
  const committed = new Set();
  const startupSupported = app.isPackaged && !portable && (platform === "win32" || platform === "darwin");
  const accentSupported = platform === "win32" || platform === "darwin";
  const loginOptions = platform === "win32" ? { path: execPath, args: [] } : {};
  nativeTheme.themeSource = normalizeUiPreferences(read()).theme;

  function startup(strict = false, disabling = false) {
    const requested = read().runAtStartup === true;
    if (!startupSupported) return { supported: false, requested, enabled: false, status: "unsupported" };
    try {
      const os = app.getLoginItemSettings(loginOptions);
      // A disabled Windows entry can still be registered. Off must remove it,
      // not merely observe that Windows currently prevents it from launching.
      if (platform === "win32" && disabling && os.openAtLogin) throw new Error("Still registered");
      if (platform === "darwin") {
        const status = os.status === "requires-approval" ? "requires-approval" : os.status === "enabled" ? "enabled" : "disabled";
        return { supported: true, requested, enabled: status === "enabled", status };
      }
      const entries = (os.launchItems || []).filter(item => item.name === "Filow" && item.path.toLowerCase() === execPath.toLowerCase() && item.args.length === 0);
      const enabled = os.openAtLogin === true && entries.some(item => item.enabled);
      return { supported: true, requested, enabled, status: enabled ? "enabled" : entries.some(item => !item.enabled) ? "blocked" : "disabled" };
    } catch (error) { if (strict) throw error; return { supported: true, requested, enabled: false, status: "blocked" }; }
  }
  function snapshot() {
    const prefs = normalizeUiPreferences(read());
    let accentColor = null;
    if (accentSupported && prefs.followSystemAccent) {
      try { accentColor = parseSystemAccent(systemPreferences.getAccentColor()); } catch { /* brand fallback */ }
    }
    const next = {
      lang: prefs.lang, resolvedLang: resolveUiLanguage(prefs.lang, app.getLocale()),
      theme: prefs.theme, resolvedTheme: prefs.theme === "system" ? nativeTheme.shouldUseDarkColors ? "dark" : "light" : prefs.theme,
      followSystemAccent: prefs.followSystemAccent, accentColor, startup: startup(), accentSupported,
    };
    if (!last || JSON.stringify(next) !== JSON.stringify(last)) { last = next; revision++; }
    return { revision, ...next };
  }
  let published = 0;
  function refresh() {
    const state = snapshot();
    if (!disposed && state.revision !== published) {
      published = state.revision;
      for (const listener of listeners) listener(state);
    }
    return state;
  }
  function enqueue(work) {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  }
  async function applyUpdate(patch) {
    if (!validUiPatch(patch) || ("runAtStartup" in patch && !startupSupported) || ("followSystemAccent" in patch && !accentSupported)) {
      return { ok: false, code: "ui.saveError", state: snapshot() };
    }
    if (!Object.keys(patch).length) return { ok: true, state: snapshot() };
    if ("runAtStartup" in patch) {
      try {
        app.setLoginItemSettings({ ...loginOptions, openAtLogin: patch.runAtStartup, ...(platform === "win32" ? { name: "Filow", enabled: patch.runAtStartup } : {}) });
        const actual = startup(true, !patch.runAtStartup);
        if (patch.runAtStartup ? !actual.enabled && actual.status !== "requires-approval" : actual.enabled || actual.status === "requires-approval") throw new Error("readback");
      } catch { return { ok: false, code: "ui.startupError", state: refresh() }; }
    }
    try {
      await save({ ...read(), ...patch });
      Object.keys(patch).forEach(key => committed.add(key));
      nativeTheme.themeSource = normalizeUiPreferences(read()).theme;
      return { ok: true, state: refresh() };
    } catch { return { ok: false, code: "ui.saveError", state: refresh() }; }
  }
  function update(patch) { return enqueue(() => applyUpdate(patch)); }
  function complete() {
    return enqueue(async () => {
      try {
        if (!canComplete()) throw new Error("Shutdown or failed window");
        await save({ ...read(), ...normalizeUiPreferences(read()), welcomeCompleted: true });
        committed.add("lang"); committed.add("theme");
        return { ok: true, state: refresh() };
      } catch { return { ok: false, code: "ui.saveError", state: snapshot() }; }
    });
  }
  // Only an already-completed legacy profile can reach the main page without first
  // committing Welcome. Missing fields can be imported once; explicit values always win.
  function migrateLegacy(patch) {
    return enqueue(() => {
      if (!validUiPatch(patch) || Object.keys(patch).some(k => k !== "lang" && k !== "theme")) return { ok: false, code: "ui.saveError", state: snapshot() };
      const allowed = {};
      for (const key of ["lang", "theme"]) if (!(key in initial) && !committed.has(key) && key in patch) allowed[key] = patch[key];
      return applyUpdate(allowed);
    });
  }
  nativeTheme.on("updated", refresh);
  const notifications = [];
  if (platform === "win32") systemPreferences.on("accent-color-changed", refresh);
  if (platform === "darwin") for (const name of ["AppleColorPreferencesChangedNotification", "AppleAquaColorVariantChanged"]) {
    try { notifications.push(systemPreferences.subscribeNotification(name, refresh)); } catch { /* focus remains a recovery path */ }
  }
  return {
    get: snapshot, update, complete, refresh, migrateLegacy,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() {
      disposed = true; listeners.clear(); nativeTheme.removeListener("updated", refresh);
      if (platform === "win32") systemPreferences.removeListener("accent-color-changed", refresh);
      notifications.forEach(id => systemPreferences.unsubscribeNotification(id));
    },
  };
}

/** Window lifecycle is independent of startup: menu reopen only creates/focuses a window. */
function createWelcomeController({ createWindow, complete, isQuitting, onFailure, onSaveFailure, onClosed, onFocus }) {
  let window = null, gate = null, pending = null, finishGate, successful = false, failed = false;
  function show() {
    if (window && !window.isDestroyed()) { window.focus(); return gate; }
    successful = false; failed = false;
    window = createWindow();
    gate = new Promise(resolve => { finishGate = resolve; });
    window.on("close", event => {
      if (isQuitting() || failed) return;
      event.preventDefault();
      void finish().then(result => { if (!result.ok && !isQuitting()) onSaveFailure(result); });
    });
    window.on("focus", onFocus);
    window.on("closed", () => {
      window = null;
      // Unexpected destruction must not release first-start into server initialization.
      if (!successful && !isQuitting() && !failed) fail();
      onClosed(); finishGate(); gate = null;
    });
    return gate;
  }
  function fail() { if (!failed && !isQuitting()) { failed = true; onFailure(); } }
  function finish() {
    if (pending) return pending;
    if (!window || isQuitting() || failed) return Promise.resolve({ ok: false, code: "ui.saveError" });
    pending = (async () => {
      const result = await complete();
      if (result.ok && !isQuitting() && window) { successful = true; window.destroy(); }
      return result;
    })();
    pending.finally(() => { pending = null; });
    return pending;
  }
  return { show, finish, fail, getWindow: () => window };
}

module.exports = { createUiPreferences, trustedUiSender, createWelcomeController };
