const { randomUUID } = require("node:crypto");
const { localDay, openDailyStore } = require("./day-by-day-store");

function dailyFrame(event, win, origin) {
  const frame = event.senderFrame;
  if (!win || win.isDestroyed() || event.sender !== win.webContents || !frame || frame !== win.webContents.mainFrame) return false;
  try {
    const url = new URL(frame.url);
    return url.origin === origin && url.pathname === "/day-by-day";
  } catch { return false; }
}

function createDaily({ store, now = () => new Date() }) {
  let session = "";
  let offset = 0;
  function close() { session = ""; }
  function view() {
    const stored = store.view();
    const date = now();
    const today = localDay(date);
    const day = localDay(date, offset);
    const tasks = stored.tasks.filter(row => row.due === day || (!offset && row.due < today && !row.done));
    return { session, version: stored.version, day, today, offset, tasks };
  }
  function control(action, p = {}) {
    if (action === "open") {
      close();
      session = randomUUID();
      offset = 0;
      return view();
    }
    if (!session || session !== p.session) throw Error("Closed");
    if (action === "close") { close(); return; }
    if (action === "state") return view();
    if (action === "day") { offset = p.offset === 1 ? 1 : 0; return view(); }
    const current = view();
    if (p.day !== current.day || p.version !== current.version) return { ...current, status: "stale" };
    if (!["create", "edit", "complete", "reopen", "undo"].includes(action)) throw Error("Invalid action");
    const row = current.tasks.find(item => item.id === p.id && item.rev === p.rev);
    if (action !== "create" && !row) return { ...current, status: "stale" };
    const ack = store.apply({ type: action, op: p.op, due: current.day, text: p.text, id: row?.id, rev: row?.rev });
    return { ...view(), status: ack ? "saved" : "stale", ack };
  }
  return { control, close };
}

function wireDaily({ win, appHandle, origin, userData, qaEpoch }) {
  let workspace;
  const launched = Date.now();
  const now = Number.isFinite(qaEpoch) ? () => new Date(qaEpoch + Date.now() - launched) : () => new Date();
  appHandle("daily:control", (event, action, p) => {
    if (!dailyFrame(event, win, origin)) throw Error("Denied");
    workspace ??= createDaily({ store: openDailyStore(userData), now });
    return workspace.control(action, p);
  });
  const close = () => workspace?.close();
  win.on("closed", close);
  win.webContents.on("render-process-gone", close);
  win.webContents.on("did-start-navigation", (_event, url, inPage, mainFrame) => {
    if (mainFrame && (!inPage || new URL(url).pathname !== "/day-by-day")) close();
  });
}

module.exports = { dailyFrame, createDaily, wireDaily };
