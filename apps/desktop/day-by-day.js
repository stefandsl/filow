const { randomUUID } = require("node:crypto");
const { manualOrDraft } = require("./day-by-day-model");
const { localDay } = require("./day-by-day-store");

function dailyFrame(event, win, origin, pathname = "/day-by-day") {
  const frame = event.senderFrame;
  if (!win || win.isDestroyed() || event.sender !== win.webContents || !frame || frame !== win.webContents.mainFrame) return false;
  try {
    const url = new URL(frame.url);
    return url.origin === origin && url.pathname === pathname;
  } catch { return false; }
}

const { dailyChoice, qualified } = require("./bounded-decision");

function createDaily({ store, match = manualOrDraft, isQualified = qualified, now = () => new Date(), recognizer, notify = () => {} }) {
  let session = "";
  let offset = 0;
  let dayGeneration = 0;

  let capture;
  let pending = [];
  let lastReview;
  function stop() {
    const ended = capture;
    capture = undefined;
    pending = pending.filter(review => !review.speech);
    if (ended) void ended.worker.dispose();
  }
  function close() { stop(); pending = []; session = ""; }

  function view() {
    const stored = store.view();
    const date = now();
    const today = localDay(date);
    const day = localDay(date, offset === 1 ? 1 : 0);
    const tasks = stored.tasks.filter(row => offset === 2 ? row.done : !row.done && (row.due === day || (!offset && row.due < today)));
    pending = pending.filter(r => r.day === day && r.version === stored.version && r.expires > Date.now());
    return { session, version: stored.version, day, today, offset, tasks, review: pending[0] || null };
  }

  function review(words, from, op, speech, segment) {
    const current = view();
    if (from.day !== current.day || from.version !== current.version) return { ...current, status: "stale" };
    const generation = dayGeneration;
    const source = capture;
    function enqueue(proposal) {
      const latest = view();
      if (from.session !== session || from.day !== latest.day || from.version !== latest.version ||
          generation !== dayGeneration || (speech && (source !== capture || segment?.retired))) return { ...latest, status: "stale" };
      if (!proposal) return { ...latest, status: "noMatch" };
      if (proposal.type !== "create") {
        const choice = dailyChoice(proposal, [...from.tasks, ...archived]);
        if (choice.action === "abstain") return { ...latest, status: "noMatch" };
        if (speech && !segment?.repair && choice.action === "complete" && isQualified(proposal.route, source.language)) {
          const row = from.tasks.find(r => r.id === choice.id && !r.done);
          if (row) {
            const ack = store.apply({ type: "complete", id: row.id, rev: row.rev, op, words });
            return { ...view(), ack, status: ack ? "saved" : "stale" };
          }
        }
      }
      if (!pending.some(p => p.op === op) && pending.length < 30) pending.push({ ...proposal, words: segment?.evidence ?? proposal.words, token: randomUUID(), op, speech,
        day: from.day, due: proposal.dueTomorrow ? localDay(now(), 1) : from.day,
        version: from.version, expires: Date.now() + 120000 });
      return view();
    }
    const archived = offset === 2 ? [] : store.view().tasks.filter(row => row.done && row.due === from.day);
    const result = match(words, [...from.tasks, ...archived], { speech, yesterday: localDay(now(), -1) });
    return result instanceof Promise ? result.then(enqueue) : enqueue(result);
  }
  function confirm(p, current) {
    const proposal = current.review;
    if (!proposal || proposal.token !== p.token) return { ...current, status: "stale" };
    const target = proposal.targets.find(t => t.id === p.id);
    if (proposal.type !== "create" && !target) return { ...current, status: "stale" };
    const ack = store.apply({ type: proposal.type, op: proposal.op, words: proposal.words, text: p.text,
      due: proposal.due, id: target?.id, rev: target?.rev });
    pending.shift();
    if (ack && proposal.type === "create") {
      offset = proposal.due === current.today ? 0 : 1;
      for (const next of pending) {
        if (next.type === "create" && next.due === proposal.due) {
          next.day = proposal.due;
          next.version = current.version + 1;
        }
      }
    }
    return { ...view(), status: ack ? "saved" : "stale", ack };
  }
  async function arm(p) {
    stop();
    const worker = recognizer();
    const take = { id: p.capture, language: p.language, worker, sequence: 0, context: 0, live: false, from: null, frames: 0, samples: 0 };
    capture = take;
    worker.onError = () => {
      if (capture !== take) return;
      stop();
      notify({ session, capture: take.id, error: true });
    };
    worker.onResult = result => {
      if (capture !== take || !take.live || result.context !== take.context) return;
      if (!result.committed) {
        if (result.partial) notify({ session, capture: take.id, partial: result.partial });
        return;
      }
      if (!Number.isSafeInteger(result.sequence) || result.sequence <= take.sequence) return;
      take.sequence = result.sequence;
      const from = take.from;
      // Keep the displayed list until a new version or civil day reaches capture.
      if (from) {
        const op = take.id + "/" + result.sequence;
        let words = result.committed;
        const previous = take.segment;
        const segment = { op, words, context: take.context };
        take.segment = segment;
        const replacement = /^(?:I mean|intendevo)\s+([\p{L}][\p{L}'’ -]{0,70})[.!]?$/iu.exec(words);
        if (replacement && previous && previous.context === take.context) {
          previous.retired = true;
          pending = pending.filter(r => r.op !== previous.op);
          // Reassess the report with the corrected recipient and retain both spoken finals.
          const recipient = replacement[1].trim();
          const prior = /^([\p{Lu}][\p{L}'’-]*(?:\s+[\p{Lu}][\p{L}'’-]*)*)\s+(received|has|ha)\b(.*)$/u.exec(previous.words);
          if (prior && from.tasks.some(row => row.text.toLowerCase().endsWith(" " + recipient.toLowerCase()))) {
            words = recipient + " " + prior[2] + prior[3];
          }
          segment.repair = true;
          segment.evidence = previous.words + " / " + result.committed;
        }
        const next = review(words, from, op, true, segment);
        const publish = state => {
          if (capture === take) notify({ session, capture: take.id, final: result.committed, status: state.status });
        };
        if (next instanceof Promise) void next.then(publish, () => publish({ status: "error" }));
        else publish(next);
      }
    };
    try {
      const model = await worker.start(p.language);
      if (capture !== take) throw Error("Closed");
      take.model = model.model;
      return { ...view(), model: model.model };
    } catch {
      if (capture === take) stop();
      else void worker.dispose();
      throw Error("Local speech unavailable");
    }
  }
  function feed(p, samples) {
    if (!session || p?.session !== session || !capture || p.capture !== capture.id || !capture.worker.ready ||
        !(samples instanceof Float32Array) || !samples.length || samples.length > 3200) return;
    capture.live = true;
    if (!capture.from || capture.from.version !== store.version || capture.from.day !== localDay(now(), offset)) {
      capture.from = view();
      capture.context++;
      capture.worker.worker.postMessage({ type: "daily-boundary", context: capture.context });
    }
    capture.frames++;
    capture.samples += samples.length;
    capture.worker.feed(samples);
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
    if (action === "disarm") {
      if (capture && capture.id === p.capture) stop();
      return view();
    }
    if (action === "day") { dayGeneration++; stop(); pending = []; offset = [1, 2].includes(p.offset) ? p.offset : 0; return view(); }
    const current = view();
    if (p.day !== current.day || p.version !== current.version) return { ...current, status: "stale" };
    if (action === "arm") {
      if (typeof p.capture !== "string" || !/^[a-f0-9-]{36}$/i.test(p.capture)) throw Error("Invalid capture");
      return arm(p);
    }
    if (action === "review") {
      if (typeof p.op !== "string" || p.op.length > 100 || !p.op) throw Error("Invalid operation");
      if (lastReview === p.op) return current;
      lastReview = p.op;
      return review(p.text, current, p.op, false);
    }
    if (action === "dismiss") {
      if (current.review?.token === p.token) pending.shift();
      return view();
    }
    if (action === "confirm") return confirm(p, current);
    if (!["clear", "delete", "create", "edit", "complete", "reopen", "undo"].includes(action)) throw Error("Invalid action");
    const row = current.tasks.find(item => item.id === p.id && item.rev === p.rev);
    if (action !== "create" && action !== "clear" && !row) return { ...current, status: "stale" };
    const ack = store.apply({ type: action, op: p.op, due: current.day, text: p.text, id: row?.id, rev: row?.rev });
    return { ...view(), status: ack ? "saved" : "stale", ack };
  }
  return { control, close, feed, meter: () => capture && ({ frames: capture.frames, samples: capture.samples, model: capture.model }), interrupt() {
    if (capture) { const id = capture.id; stop(); notify({ session, capture: id, stopped: true }); }
  } };
}

function wireDaily({ win, appHandle, appOn, origin, getStore, qaEpoch, recognizer, hasGrant, saveGrant }) {
  let workspace;
  const model = require("./day-by-day-model").dailyModel({ hasGrant });
  const launched = Date.now();
  const now = Number.isFinite(qaEpoch) ? () => new Date(qaEpoch + Date.now() - launched) : () => new Date();
  appHandle("daily:control", async (event, action, p) => {
    if (action === "modelPermission" || action === "withdrawModel") {
      if (!dailyFrame(event, win, origin, "/settings/local")) throw Error("Denied");
      if (action === "withdrawModel") {
        saveGrant(null);
        workspace?.close();
      }
      return { modelGranted: model.granted() };
    }
    if (!dailyFrame(event, win, origin) || (action === "arm" && !win.isFocused())) throw Error("Denied");
    if (action === "meter" && Number.isFinite(qaEpoch)) return workspace?.meter();
    const frame = event.senderFrame;
    workspace ??= createDaily({ match: model.match, store: getStore(), now, recognizer, notify(message) {
      if (dailyFrame({ sender: win.webContents, senderFrame: frame }, win, origin)) frame.send("daily:speech", message);
    } });
    if (action === "grantModel") {
      workspace.control("state", p);
      if (model.grant) saveGrant(model.grant);
      action = "state";
      await model.available();
    }
    const result = await workspace.control(action, p);
    if (action === "open") await model.available();
    return result && { ...result, modelGranted: model.granted(), modelReady: model.ready() };
  });
  appOn("daily:pcm", (event, p, samples) => {
    if (dailyFrame(event, win, origin)) workspace?.feed(p, samples);
  });
  const close = () => { workspace?.close(); workspace = undefined; };
  win.on("blur", () => workspace?.interrupt());
  win.on("closed", close);
  win.webContents.on("render-process-gone", close);
  win.webContents.on("did-start-navigation", (_event, url, inPage, mainFrame) => {
    if (mainFrame && (!inPage || new URL(url).pathname !== "/day-by-day")) close();
  });
}

module.exports = { dailyFrame, createDaily, wireDaily };
