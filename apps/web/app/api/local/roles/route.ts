// Which model does each task (Settings > Advanced). GET: the models on this PC and on the user's
// servers, what each task would use now and why; PUT: pin a task, add or remove a server. Reads
// servers only (their model lists): never pulls, deletes or sends a key to them.
import { NextResponse } from "next/server";
import { isSetupPreference, resolveSetup, type ResolvedSetup } from "@filow/core";
import { requireEngine } from "@/lib/engineAuth";
import { OLLAMA_URL } from "@/lib/decide/clef";
import { ollamaElsewhere } from "@/lib/translateLocal";
import { gpuInfo, machineInfo } from "@/lib/sysinfo";
import { automatic } from "@/lib/modelRoles/auto";
import { fromDesktop } from "@/lib/modelRoles/desktopAuth";
import { listSource, taskTarget, type SourceList } from "@/lib/modelRoles/resolve";
import { newServerId, readRoles, secretBox, serverAddress, writeRoles, type Pin } from "@/lib/modelRoles/store";
import { MAX_SERVERS, normaliseServerUrl, redactUrl, serverName, serverWarnings, whereIs } from "@/lib/modelRoles/servers";
import { OLLAMA_TASKS, canChat, canSee, isClef, isOllamaTask, isSpeechTask, isTaskId, sameModel, taskDef, unfitFor } from "@/lib/modelRoles/tasks";

export const dynamic = "force-dynamic";

const view = (list: SourceList) => ({
  reachable: list.reachable,
  models: list.models.map((m) => ({ name: m.name, sizeBytes: m.sizeBytes ?? null, vision: canSee(m), chat: canChat(m), clef: isClef(m.name) })),
});

let setupCache: { key: string; value: ResolvedSetup } | null = null;

export async function GET(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  const roles = readRoles();
  // offline: not even the list of models is asked of another computer
  const offline = process.env.FILOW_OFFLINE === "1";
  const [here, ...lists] = await Promise.all([listSource(OLLAMA_URL(), fresh), ...roles.servers.map((s) => (offline ? Promise.resolve({ reachable: false, models: [] }) : listSource(serverAddress(s), fresh)))]);
  const names = here.models.map((m) => m.name);
  const pref = new URL(req.url).searchParams.get("setup");
  const key = `${pref}|${names.join(",")}`;
  if (!setupCache || setupCache.key !== key) setupCache = { key, value: resolveSetup(isSetupPreference(pref) ? pref : "auto", machineInfo(await gpuInfo(), names)) };
  const auto = automatic(setupCache.value, names);
  const tasks = Object.fromEntries(await Promise.all(OLLAMA_TASKS.map(async (task) => {
    const t = await taskTarget(task, auto[task], roles);
    return [task, { auto: auto[task], now: t.model ? { model: t.model, server: t.server?.name ?? null } : null, pinned: t.pinned, fallback: t.fallback }] as const;
  })));
  return NextResponse.json({
    here: { url: redactUrl(OLLAMA_URL()), elsewhere: ollamaElsewhere(), ...view(here) },
    servers: roles.servers.map((s, i) => ({ id: s.id, name: s.name, url: redactUrl(s.url), where: whereIs(s.url), warnings: serverWarnings(s.url), ...view(lists[i]) })),
    pins: roles.pins,
    tasks,
  });
}

type PutBody = { action?: unknown; task?: unknown; pin?: unknown; name?: unknown; url?: unknown; id?: unknown };

const bad = (code: string, status = 400) => NextResponse.json({ error: code, code }, { status });

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** The same Ollama under another spelling of this PC ("localhost" for "127.0.0.1"). */
const sameAddress = (a: string, b: string) => {
  const key = (u: string) => {
    const x = new URL(u);
    return `${x.protocol}//${LOOPBACK.has(x.hostname) ? "loopback" : x.hostname}:${x.port || (x.protocol === "https:" ? "443" : "80")}${x.pathname.replace(/\/+$/, "")}`;
  };
  try {
    return key(a) === key(b);
  } catch {
    return false;
  }
};

export async function PUT(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  // the desktop window only (lib/modelRoles/desktopAuth.ts): paired clients can read, never redirect a task
  if (!fromDesktop(req)) return bad("this_pc_only", 403);
  if (Number(req.headers.get("content-length") ?? 0) > 4096) return bad("too_large", 413);
  const raw = await req.text().catch(() => "");
  if (raw.length > 4096) return bad("too_large", 413);
  let body: PutBody;
  try {
    body = JSON.parse(raw || "{}") as PutBody;
  } catch {
    body = {};
  }
  const roles = readRoles();
  if (body.action === "addServer") {
    if (typeof body.url === "string" && body.url.length > 500) return bad("url_invalid");
    const ok = normaliseServerUrl(body.url);
    if (!ok.ok) return bad(`url_${ok.reason}`);
    // a password is kept only encrypted by the OS key store; without one it is refused, never written
    if (new URL(ok.url).username || new URL(ok.url).password) {
      if (!secretBox()) return bad("no_secret_store", 409);
    }
    if (roles.servers.length >= MAX_SERVERS) return bad("too_many");
    // this PC's own Ollama is already "This PC"
    if (roles.servers.some((s) => sameAddress(s.url, ok.url)) || sameAddress(ok.url, OLLAMA_URL())) return bad("duplicate", 409);
    const server = { id: newServerId(), name: serverName(body.name, ok.url), url: ok.url };
    writeRoles({ ...roles, servers: [...roles.servers, server] });
    return NextResponse.json({ ok: true, id: server.id });
  }
  if (body.action === "removeServer") {
    if (!roles.servers.some((s) => s.id === body.id)) return bad("unknown_server", 404);
    // its pins go with it (store.cleanRoles): the tasks are automatic again
    writeRoles({ ...roles, servers: roles.servers.filter((s) => s.id !== body.id) });
    return NextResponse.json({ ok: true });
  }
  if (body.action === "pin") {
    if (!isTaskId(body.task)) return bad("unknown_task");
    const task = body.task;
    const pins = { ...roles.pins };
    if (body.pin === null) {
      delete pins[task];
      writeRoles({ ...roles, pins });
      return NextResponse.json({ ok: true });
    }
    const p = (body.pin && typeof body.pin === "object" ? body.pin : {}) as Record<string, unknown>;
    if (typeof p.source !== "string" || typeof p.model !== "string" || !p.model.trim()) return bad("bad_pin");
    if (isSpeechTask(task)) {
      // speech runs in the desktop app on this PC; which models can listen is checked there (apps/desktop/model-roles.js)
      if (p.source !== "local" || !/^[a-z0-9-]{1,60}$/.test(p.model)) return bad("bad_pin");
      pins[task] = { source: "local", model: p.model };
    } else if (isOllamaTask(task)) {
      const server = p.source === "local" ? null : roles.servers.find((s) => s.id === p.source);
      if (p.source !== "local" && !server) return bad("unknown_server", 404);
      // sending to a server needs the yes the page asked for when the user chose it
      if (server && p.agreed !== true) return bad("agree_first", 409);
      if (server && process.env.FILOW_OFFLINE === "1") return bad("offline", 409);
      const list = await listSource(server ? serverAddress(server) : OLLAMA_URL(), true);
      if (!list.reachable) return bad("unreachable", 409);
      const found = list.models.find((m) => sameModel(m.name, p.model as string));
      if (!found) return bad("missing", 409);
      const unfit = unfitFor(taskDef(task).need!, found);
      if (unfit) return bad(`unfit_${unfit}`, 409);
      const pin: Pin = { source: p.source, model: found.name, ...(server ? { agreed: true as const } : {}) };
      pins[task] = pin;
    } else {
      return bad("not_pinnable");
    }
    // The server was asked above (up to a few seconds): what changed meanwhile (a server removed, another
    // task chosen) is kept, and only this task's choice is written on top of it.
    const latest = readRoles();
    if (pins[task]!.source !== "local" && !latest.servers.some((s) => s.id === pins[task]!.source)) return bad("unknown_server", 404);
    writeRoles({ ...latest, pins: { ...latest.pins, [task]: pins[task] } });
    return NextResponse.json({ ok: true });
  }
  return bad("unknown_action");
}
