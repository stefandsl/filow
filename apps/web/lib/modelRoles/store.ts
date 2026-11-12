// Where the per-task choices and the user's servers are kept: model-roles.json next to the script in
// the app's profile folder (the desktop app sets FILOW_SCRIPT to <profile>/script.md). The desktop's
// speech pickers read the same file (apps/desktop/model-roles.js). Read synchronously and cached by
// the file's change time: the pickers ask on every call.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isTaskId, type TaskId } from "./tasks";
import { MAX_SERVERS, normaliseServerUrl, redactUrl, serverName, type ModelServer } from "./servers";

/** "local": this PC (the Ollama Filow talks to anyway, OLLAMA_URL); otherwise a server id. */
export type Pin = { source: string; model: string; agreed?: true };
export type RolesFile = { version: 1; pins: Partial<Record<TaskId, Pin>>; servers: ModelServer[] };

export const EMPTY: RolesFile = { version: 1, pins: {}, servers: [] };

export function rolesPath(): string {
  if (process.env.FILOW_MODEL_ROLES) return process.env.FILOW_MODEL_ROLES;
  const script = process.env.FILOW_SCRIPT || path.join(process.cwd(), "script.md");
  return path.join(path.dirname(script), "model-roles.json");
}

/**
 * The OS key store, the one the desktop app keeps its API keys in (apps/desktop/secrets.js: Electron
 * safeStorage, DPAPI on Windows). main.js hands it to this in-process server; absent in a browser-only
 * run, where a server password cannot be kept at all.
 */
export type SecretBox = { available(): boolean; encrypt(text: string): string; decrypt(base64: string): string };
export const secretBox = (): SecretBox | null => {
  const box = (globalThis as { __filowSecretBox?: SecretBox }).__filowSecretBox;
  try {
    return box && box.available() ? box : null;
  } catch {
    return null;
  }
};

/** A user and password typed into an address: what the key store keeps, never the file. */
function credentialsOf(url: unknown): string | null {
  try {
    const u = new URL(String(url));
    return u.username || u.password ? `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}` : null;
  } catch {
    return null;
  }
}

/**
 * Anything that is not a valid entry is dropped: an old or hand-edited file never breaks a feature.
 * A password still written in an address (an older file, a hand edit) is moved into `secret`,
 * encrypted with the key store; without a key store it is dropped, never kept in clear text.
 */
export function cleanRoles(raw: unknown, box: SecretBox | null = secretBox()): RolesFile {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const servers: ModelServer[] = [];
  for (const s of Array.isArray(r.servers) ? r.servers : []) {
    if (!s || typeof s !== "object") continue;
    const { id, name, url, secret } = s as Record<string, unknown>;
    const ok = normaliseServerUrl(url);
    if (typeof id !== "string" || !/^[a-z0-9-]{1,40}$/i.test(id) || id === "local" || !ok.ok || servers.some((x) => x.id === id)) continue;
    const plain = credentialsOf(ok.url);
    const sealed = plain && box ? box.encrypt(plain) : typeof secret === "string" && /^[A-Za-z0-9+/=]{1,4096}$/.test(secret) ? secret : undefined;
    servers.push({ id, name: serverName(name, ok.url), url: redactUrl(ok.url), ...(sealed ? { secret: sealed } : {}) });
    if (servers.length >= MAX_SERVERS) break;
  }
  const pins: RolesFile["pins"] = {};
  const rawPins = r.pins && typeof r.pins === "object" ? (r.pins as Record<string, unknown>) : {};
  for (const [task, p] of Object.entries(rawPins)) {
    if (!isTaskId(task) || !p || typeof p !== "object") continue;
    const { source, model, agreed } = p as Record<string, unknown>;
    if (typeof source !== "string" || typeof model !== "string" || !model.trim() || model.length > 200) continue;
    // a pin to a server that is gone is dropped with it
    if (source !== "local" && !servers.some((s) => s.id === source)) continue;
    pins[task] = { source, model: model.trim(), ...(agreed === true && source !== "local" ? { agreed: true as const } : {}) };
  }
  return { version: 1, pins, servers };
}

let cache: { file: string; mtime: number; value: RolesFile } | null = null;

export function readRoles(file = rolesPath()): RolesFile {
  let mtime: number;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return EMPTY;
  }
  if (cache && cache.file === file && cache.mtime === mtime) return cache.value;
  let value = EMPTY;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { servers?: Array<{ url?: unknown }> };
    value = cleanRoles(raw);
    // a password found in clear text is rewritten encrypted at once (only when the key store can keep it)
    if (secretBox() && (raw.servers ?? []).some((s) => credentialsOf(s?.url))) return writeRoles(value, file);
  } catch {
    /* unreadable: as if nothing was chosen */
  }
  cache = { file, mtime, value };
  return value;
}

/** The address with its password, decrypted for the one request that needs it; never stored or shown. */
export function serverAddress(server: ModelServer, box: SecretBox | null = secretBox()): string {
  if (!server.secret || !box) return server.url;
  try {
    const plain = box.decrypt(server.secret);
    const i = plain.indexOf(":");
    const u = new URL(server.url);
    u.username = encodeURIComponent(i < 0 ? plain : plain.slice(0, i));
    u.password = encodeURIComponent(i < 0 ? "" : plain.slice(i + 1));
    return u.toString().replace(/\/+$/, "");
  } catch {
    return server.url;
  }
}

/** Writes through a temporary file, so a crash never leaves half a file. */
export function writeRoles(next: RolesFile, file = rolesPath()): RolesFile {
  const value = cleanRoles(next);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
  cache = null;
  return value;
}

export const newServerId = () => randomUUID().slice(0, 8);
