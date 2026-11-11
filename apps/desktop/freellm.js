// FreeLLMAPI settings in the desktop app (apps/web/lib/freellm.ts explains what FreeLLMAPI is).
// The address, the model and the "scripts through FreeLLMAPI" switch live in settings.json; the
// unified key is encrypted in secrets.json like the OpenRouter key (secrets.js) and is never logged,
// never sent back to a page and never written in clear text. The Next server runs in this process
// and reads process.env on every request, so a change applies at once.
// Filow does not install, start or bundle FreeLLMAPI.

const KEY_NAME = "FREELLMAPI_API_KEY";
const DEFAULT_URL = "http://localhost:3001/v1";
const DEFAULT_MODEL = "auto";

/** Loopback or a private network address. Same rule as apps/web/lib/freellm.ts isLocalHost (a test keeps them equal). */
function isLocalHost(hostname) {
  const h = String(hostname).toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b, c, d] = m.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return false;
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (h === "::1") return true;
  return /^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h);
}

/** http(s), this PC or the user's network, no credentials or query; "/v1" added to a bare address. Null when refused. */
function normalizeBaseUrl(raw) {
  if (typeof raw !== "string" || raw.length > 300) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password || u.search || u.hash) return null;
  if (!isLocalHost(u.hostname)) return null;
  const path = u.pathname.replace(/\/+$/, "");
  return `${u.protocol}//${u.host}${path || "/v1"}`;
}

function normalizeModel(raw) {
  if (typeof raw !== "string") return null;
  const m = raw.trim();
  if (!m) return DEFAULT_MODEL;
  return /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/.test(m) ? m : null;
}

/** A key as typed: one line, no spaces, a sane length. Null when it cannot be a key. */
function cleanKey(raw) {
  if (typeof raw !== "string") return null;
  const k = raw.trim();
  return /^[\x21-\x7e]{8,300}$/.test(k) ? k : null;
}

/**
 * deps: getSettings() / saveSettings(next) (settings.json), env (process.env),
 * storeKey(value | null) -> boolean (false when the OS key store is unavailable), logLine.
 */
function createFreeLlm({ getSettings, saveSettings, env, storeKey, logLine = () => {} }) {
  const saved = () => {
    const s = getSettings().freellm;
    return s && typeof s === "object" ? s : {};
  };
  /** What a page may know: never the key, only whether one is saved and its last four characters. */
  function status() {
    const s = saved();
    const key = env[KEY_NAME] || "";
    return {
      baseUrl: normalizeBaseUrl(s.baseUrl || env.FREELLMAPI_BASE_URL || DEFAULT_URL) || DEFAULT_URL,
      model: normalizeModel(s.model || env.FREELLMAPI_MODEL || "") || DEFAULT_MODEL,
      scripts: env.SCRIPT_CLOUD === "freellm",
      hasKey: Boolean(key),
      keyHint: key.length >= 12 ? key.slice(-4) : "",
      offline: env.FILOW_OFFLINE === "1",
    };
  }
  /** At startup, after .env and the secrets: what the user saved in Settings wins over .env. */
  function apply() {
    const s = saved();
    const url = normalizeBaseUrl(s.baseUrl || "");
    if (url) env.FREELLMAPI_BASE_URL = url;
    const model = s.model ? normalizeModel(s.model) : null;
    if (model) env.FREELLMAPI_MODEL = model;
    if (typeof s.scripts === "boolean") env.SCRIPT_CLOUD = s.scripts ? "freellm" : "";
  }
  /**
   * One change from the settings page: { baseUrl?, model?, scripts?, key? } (key "" removes it).
   * Nothing is saved when any part is refused. Returns { ok, error?, status }.
   */
  function configure(patch) {
    if (!patch || typeof patch !== "object") return { ok: false, error: "invalid", status: status() };
    const next = { ...saved() };
    if ("baseUrl" in patch) {
      const url = normalizeBaseUrl(patch.baseUrl);
      if (!url) return { ok: false, error: "badUrl", status: status() };
      next.baseUrl = url;
    }
    if ("model" in patch) {
      const model = normalizeModel(patch.model);
      if (!model) return { ok: false, error: "badModel", status: status() };
      next.model = model;
    }
    if ("scripts" in patch) next.scripts = patch.scripts === true;
    let key;
    if ("key" in patch && patch.key !== undefined) {
      key = patch.key === "" || patch.key === null ? "" : cleanKey(patch.key);
      if (key === null) return { ok: false, error: "badKey", status: status() };
      if (!storeKey(key || null)) return { ok: false, error: "noKeyStore", status: status() };
      if (key) env[KEY_NAME] = key;
      else delete env[KEY_NAME];
      logLine(key ? "freellm: unified key saved (encrypted)" : "freellm: unified key removed");
    }
    saveSettings({ ...getSettings(), freellm: next });
    apply();
    return { ok: true, status: status() };
  }
  return { status, apply, configure };
}

module.exports = { createFreeLlm, normalizeBaseUrl, normalizeModel, isLocalHost, cleanKey, KEY_NAME, DEFAULT_URL, DEFAULT_MODEL };
