// Server side: where a task runs. Without a pin, where it always ran (the automatic pick, on the
// Ollama Filow talks to: OLLAMA_URL, this PC unless the user set it to another computer). With a pin,
// the pinned model on this PC or on one of the user's servers, when it is still there, still able to
// do the task, its server answers, and (for a server) the user said yes to sending there. Otherwise
// the automatic pick on this PC, with the reason, never the cloud.
import { OLLAMA_URL } from "@/lib/decide/clef";
import { readRoles, type Pin, type RolesFile } from "./store";
import { redactUrl, type ModelServer } from "./servers";
import { sameModel, taskDef, unfitFor, type OllamaModelInfo, type OllamaTaskId } from "./tasks";

export type SourceList = { reachable: boolean; models: OllamaModelInfo[] };

/** Where a call goes: the address, the header a password in it becomes, and the user's server (null on this PC). */
export type Place = { base: string; headers: Record<string, string>; server: { id: string; name: string } | null };

export type Fallback = "missing" | "unreachable" | "unfit" | "unagreed";
export type TaskTarget = Place & { model: string | null; pinned: boolean; fallback: Fallback | null };

/**
 * The fetch address (fetch refuses one with a user and password in it) and the Authorization header
 * they become. Only the user's own server ever gets it, and only the one it was typed for.
 */
export function requestParts(url: string): { base: string; headers: Record<string, string> } {
  const u = new URL(url);
  const headers: Record<string, string> = {};
  if (u.username || u.password) headers.Authorization = `Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64")}`;
  return { base: redactUrl(url), headers };
}

const LIST_TTL_MS = 5000;
const DOWN_TTL_MS = 20_000;
const lists = new Map<string, { at: number; value: SourceList }>();
const shows = new Map<string, string[] | null>();

/** What Ollama says the model can do; cached per model version (its digest). */
async function capabilitiesOf(base: string, headers: Record<string, string>, name: string, digest: string): Promise<string[] | null> {
  const key = `${base}|${name}|${digest}`;
  if (shows.has(key)) return shows.get(key)!;
  let caps: string[] | null;
  try {
    const res = await fetch(`${base}/api/show`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ model: name }), signal: AbortSignal.timeout(2000) });
    const json = res.ok ? ((await res.json()) as { capabilities?: unknown }) : {};
    caps = Array.isArray(json.capabilities) ? json.capabilities.filter((c): c is string => typeof c === "string") : null;
  } catch {
    caps = null;
  }
  shows.set(key, caps);
  return caps;
}

/** The models on one Ollama (this PC or a server) and whether it answers. Reads only: never pulls or deletes. */
export async function listSource(url: string, fresh = false): Promise<SourceList> {
  const hit = lists.get(url);
  // a server that did not answer is asked again less often: every picker call would wait for its timeout
  if (!fresh && hit && Date.now() - hit.at < (hit.value.reachable ? LIST_TTL_MS : DOWN_TTL_MS)) return hit.value;
  let value: SourceList = { reachable: false, models: [] };
  try {
    const { base, headers } = requestParts(url);
    const res = await fetch(`${base}/api/tags`, { headers, signal: AbortSignal.timeout(2500) });
    if (res.ok) {
      const tags = ((await res.json()) as { models?: Array<{ name?: unknown; size?: unknown; digest?: unknown }> }).models ?? [];
      const named = tags.filter((m): m is { name: string; size?: unknown; digest?: unknown } => typeof m.name === "string").slice(0, 200);
      const models = await Promise.all(named.map(async (m) => ({
        name: m.name,
        sizeBytes: typeof m.size === "number" ? m.size : undefined,
        capabilities: await capabilitiesOf(base, headers, m.name, typeof m.digest === "string" ? m.digest : ""),
      })));
      value = { reachable: true, models };
    }
  } catch {
    /* not reachable */
  }
  lists.set(url, { at: Date.now(), value });
  return value;
}

/** For tests: forget what was listed. */
export function forgetLists() {
  lists.clear();
  shows.clear();
}

export const localPlace = (): Place => ({ base: OLLAMA_URL(), headers: {}, server: null });

export function placeOf(server: ModelServer): Place {
  const { base, headers } = requestParts(server.url);
  return { base, headers, server: { id: server.id, name: server.name } };
}

/** Whether a pin can be used now, and where it runs; or why not. */
export async function checkPin(task: OllamaTaskId, pin: Pin, roles: RolesFile): Promise<{ ok: true; place: Place } | { ok: false; reason: Fallback }> {
  let place: Place;
  let url: string;
  if (pin.source === "local") {
    place = localPlace();
    url = place.base;
  } else {
    const server = roles.servers.find((s) => s.id === pin.source);
    if (!server) return { ok: false, reason: "missing" };
    // the second lock: nothing goes to a server without the yes given when it was chosen
    if (!pin.agreed) return { ok: false, reason: "unagreed" };
    place = placeOf(server);
    url = server.url;
  }
  const list = await listSource(url);
  if (!list.reachable) return { ok: false, reason: "unreachable" };
  const found = list.models.find((m) => sameModel(m.name, pin.model));
  if (!found) return { ok: false, reason: "missing" };
  if (unfitFor(taskDef(task).need!, found)) return { ok: false, reason: "unfit" };
  return { ok: true, place };
}

/** Where a task runs now: the pin when it can be used, else the automatic pick on this PC. */
export async function taskTarget(task: OllamaTaskId, auto: string | null, roles: RolesFile = readRoles()): Promise<TaskTarget> {
  const pin = roles.pins[task];
  const fallbackTo = (fallback: Fallback | null): TaskTarget => ({ ...localPlace(), model: auto, pinned: false, fallback });
  if (!pin) return fallbackTo(null);
  const check = await checkPin(task, pin, roles);
  if (!check.ok) return fallbackTo(check.reason);
  return { ...check.place, model: pin.model, pinned: true, fallback: null };
}

/** The place without the model fields, as a helper or a translation keeps it. */
export const placeOnly = (p: Place): Place => ({ base: p.base, headers: p.headers, server: p.server });

/** For a log line or an error: where a place is, without a password. */
export const placeText = (place: Place) => (place.server ? `your server ${place.server.name}` : redactUrl(place.base));
