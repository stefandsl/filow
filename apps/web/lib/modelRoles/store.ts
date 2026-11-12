// Where the per-task choices and the user's servers are kept: model-roles.json next to the script in
// the app's profile folder (the desktop app sets FILOW_SCRIPT to <profile>/script.md). The desktop's
// speech pickers read the same file (apps/desktop/model-roles.js). Read synchronously and cached by
// the file's change time: the pickers ask on every call.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { isTaskId, type TaskId } from "./tasks";
import { MAX_SERVERS, normaliseServerUrl, serverName, type ModelServer } from "./servers";

/** "local": this PC (the Ollama Filow talks to anyway, OLLAMA_URL); otherwise a server id. */
export type Pin = { source: string; model: string; agreed?: true };
export type RolesFile = { version: 1; pins: Partial<Record<TaskId, Pin>>; servers: ModelServer[] };

export const EMPTY: RolesFile = { version: 1, pins: {}, servers: [] };

export function rolesPath(): string {
  if (process.env.FILOW_MODEL_ROLES) return process.env.FILOW_MODEL_ROLES;
  const script = process.env.FILOW_SCRIPT || path.join(process.cwd(), "script.md");
  return path.join(path.dirname(script), "model-roles.json");
}

/** Anything that is not a valid entry is dropped: an old or hand-edited file never breaks a feature. */
export function cleanRoles(raw: unknown): RolesFile {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const servers: ModelServer[] = [];
  for (const s of Array.isArray(r.servers) ? r.servers : []) {
    if (!s || typeof s !== "object") continue;
    const { id, name, url } = s as Record<string, unknown>;
    const ok = normaliseServerUrl(url);
    if (typeof id !== "string" || !/^[a-z0-9-]{1,40}$/i.test(id) || id === "local" || !ok.ok || servers.some((x) => x.id === id)) continue;
    servers.push({ id, name: serverName(name, ok.url), url: ok.url });
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
    value = cleanRoles(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    /* unreadable: as if nothing was chosen */
  }
  cache = { file, mtime, value };
  return value;
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
