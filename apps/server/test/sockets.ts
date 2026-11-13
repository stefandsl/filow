// Test helper: a socket to the session relay. The engine's bookkeeping (the devices list, each pairing)
// is kept apart: next() reads everything else, nextMeta(t) the next bookkeeping message of type t.
import WebSocket from "ws";

export type Msg = Record<string, unknown>;

export function openSocket(wsBase: string, id: string, hello: Msg, query = "") {
  const ws = new WebSocket(`${wsBase}/ws/session/${id}${query}`);
  const inbox: Msg[] = [];
  const waiters: Array<(m: Msg) => void> = [];
  const meta: Msg[] = [];
  const metaWaiters: Array<[string, (m: Msg) => void]> = [];
  ws.on("message", (d) => {
    const m = JSON.parse(String(d)) as Msg;
    if (m.t === "devices" || m.t === "paired") {
      const i = metaWaiters.findIndex(([t]) => t === m.t);
      if (i >= 0) metaWaiters.splice(i, 1)[0][1](m);
      else meta.push(m);
      return;
    }
    const w = waiters.shift();
    if (w) w(m);
    else inbox.push(m);
  });
  const next = () => new Promise<Msg>((r) => (inbox.length ? r(inbox.shift()!) : waiters.push(r)));
  /** The next message of type t that is not bookkeeping-free: skips others into nowhere (use only when order does not matter). */
  const nextOf = async (t: string) => {
    for (;;) {
      const m = await next();
      if (m.t === t) return m;
    }
  };
  const nextMeta = (t: string) =>
    new Promise<Msg>((r) => {
      const i = meta.findIndex((x) => x.t === t);
      if (i >= 0) return r(meta.splice(i, 1)[0]);
      metaWaiters.push([t, r]);
    });
  /** The devices list as it is after `ms` of quiet (the last one received). */
  const devicesNow = async (ms = 40) => {
    await new Promise((r) => setTimeout(r, ms));
    const lists = meta.filter((x) => x.t === "devices");
    return (lists.at(-1)?.devices ?? []) as Array<Record<string, unknown>>;
  };
  const closed = new Promise<{ code: number; reason: string }>((r) => ws.on("close", (code, reason) => r({ code, reason: String(reason) })));
  ws.on("open", () => ws.send(JSON.stringify({ t: "hello", ...hello })));
  return { ws, inbox, next, nextOf, nextMeta, devicesNow, closed, send: (m: Msg) => ws.send(JSON.stringify(m)) };
}
