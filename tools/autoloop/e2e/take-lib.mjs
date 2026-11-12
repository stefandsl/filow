// The pure parts of the take probe (tools/autoloop/e2e/take.mjs), kept apart so they have tests
// (take-lib.test.ts): netstat parsing, the app's process tree, classifying its connections, the QA
// socket log of the server side, and when each spoken line was heard on screen.

/** What the voice says, in order (take-voice.ps1): the paraphrase of point 1, an off-topic sentence,
 *  the paraphrases of points 2 and 3. lineOfPoint[i] is the line that says point i. */
export const VOICE = { lineOfPoint: [0, 2, 3], offTopicLine: 1 };

// ---------- addresses ----------
/** An address or host name on this machine only (exact forms: "127.evil.example" is a host name, not loopback). */
export const isLoopback = (addr) => /^(127(\.\d{1,3}){3}|\[?::1\]?|\[?::ffff:127(\.\d{1,3}){3}\]?|0\.0\.0\.0|\[::\]|::|\*|localhost)$/i.test(String(addr));
/** "1.2.3.4:80" or "[::1]:80" -> ["1.2.3.4", "80"] */
export const splitAddr = (a) => { const i = a.lastIndexOf(":"); return [a.slice(0, i), a.slice(i + 1)]; };

/** netstat -ano output -> rows. Lines that are not TCP or UDP sockets are skipped. */
export function parseNetstat(stdout) {
  const rows = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const f = line.trim().split(/\s+/);
    if (f[0] !== "TCP" && f[0] !== "UDP") continue;
    rows.push({ proto: f[0], local: f[1], remote: f[2], state: f[0] === "TCP" ? f[3] : "", pid: Number(f[f.length - 1]) });
  }
  return rows;
}

/** CIM CreationDate ("/Date(1731230000000)/" or "20261110...") -> a number that orders processes. */
export const created = (creationDate) => Number(/\d+/.exec(String(creationDate ?? ""))?.[0] ?? 0);

/**
 * PIDs of the tree rooted at rootPid in a process table ({ ProcessId, ParentProcessId, created }).
 * A child counts only if it was created after its parent: Windows keeps a dead parent's PID on its
 * children, and that PID can be reused by our app.
 */
export function processTree(table, rootPid) {
  const byPid = new Map(table.map((p) => [p.ProcessId, p]));
  const inTree = new Set(byPid.has(rootPid) ? [rootPid] : []);
  for (let grew = inTree.size > 0; grew;) {
    grew = false;
    for (const p of table) {
      const parent = byPid.get(p.ParentProcessId);
      if (!inTree.has(p.ProcessId) && inTree.has(p.ParentProcessId) && parent && p.created >= parent.created) { inTree.add(p.ProcessId); grew = true; }
    }
  }
  return inTree;
}

/**
 * One netstat sample, sorted out for the app's process tree.
 * - outbound: a TCP connection of ours to another host (a finding in offline mode). This includes a
 *   connection another host opened to one of our listeners: data leaves the PC either way.
 * - self: to one of this PC's own LAN addresses. The engine page reaches the in-process session relay
 *   over the LAN address (window.filow.sessionUrl); Windows routes that inside the machine, so it does
 *   not leave the PC. Listed apart, never hidden.
 * - peers: a local process outside the tree listening at the other end of a loopback or own-address
 *   connection (Ollama, a proxy). Its own connections are audited too (peerOutbound), so a local
 *   proxy cannot hide outbound traffic.
 * - udp: UDP sockets of ours bound to a non-loopback address (QUIC, mDNS, WebRTC); netstat shows no peer.
 * @param rows parseNetstat() rows
 * @param tree Map pid -> process name, our tree
 * @param names Map pid -> process name, every process
 * @param own Set of this PC's addresses (IPv6 in brackets)
 */
export function classifyConnections(rows, tree, names, own) {
  const out = { keys: [], outbound: [], self: [], peers: [], peerOutbound: [], udp: [] };
  const listener = new Map(); // TCP port -> pid listening on it
  for (const r of rows) if (r.proto === "TCP" && r.state === "LISTENING") listener.set(Number(splitAddr(r.local)[1]), r.pid);
  const local = (addr) => isLoopback(addr) || own.has(addr);
  const peerPids = new Set();
  for (const r of rows) {
    if (!tree.has(r.pid)) continue;
    const key = `${r.proto} ${r.local} ${r.remote} ${r.state} ${tree.get(r.pid)}#${r.pid}`;
    out.keys.push(key);
    const [remoteAddr, remotePort] = splitAddr(r.remote);
    if (r.proto === "UDP") {
      if (!isLoopback(splitAddr(r.local)[0])) out.udp.push(key);
      continue;
    }
    if (r.state === "LISTENING") continue;
    if (!local(remoteAddr)) { out.outbound.push(key); continue; }
    const owner = listener.get(Number(remotePort));
    if (owner != null && !tree.has(owner)) { peerPids.add(owner); out.peers.push(`${names.get(owner) ?? "?"}#${owner} :${remotePort}`); }
    if (!isLoopback(remoteAddr)) out.self.push(key);
  }
  for (const r of rows) {
    if (!peerPids.has(r.pid) || r.proto !== "TCP" || r.state === "LISTENING") continue;
    if (!local(splitAddr(r.remote)[0])) out.peerOutbound.push(`${r.proto} ${r.local} ${r.remote} ${r.state} ${names.get(r.pid) ?? "?"}#${r.pid}`);
  }
  return out;
}

/**
 * The QA socket log of the app's main process (FILOW_QA_SOCKET_LOG, apps/desktop/qa.js): one JSON
 * line per TCP connection it opened, at the moment it opened it. Returns how many there were, how many
 * stayed on this PC and the ones that did not ("host:port"). A cut-off last line is skipped.
 */
export function socketLogAudit(text, own) {
  let lines = 0, local = 0, pipes = 0, unreadable = 0;
  const external = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { unreadable++; continue; }
    lines++;
    if (e.path) { pipes++; continue; }
    const host = String(e.host ?? "");
    const bare = host.replace(/^\[|\]$/g, "");
    if (isLoopback(host) || isLoopback(bare) || own.has(host) || own.has(bare) || own.has(`[${bare}]`)) { local++; continue; }
    const k = `${host}:${e.port}`;
    external.set(k, (external.get(k) ?? 0) + 1);
  }
  return { lines, local, pipes, unreadable, external: [...external.keys()] };
}

// ---------- what was heard ----------
const STOP = new Set(["this", "that", "with", "have", "your", "from", "they", "them", "then", "than", "what", "when", "will", "just", "into", "also", "there", "their", "about"]);
/** The words of a sentence that carry its meaning: lower case, 4 letters or more, no filler words. */
export const contentWords = (text) => new Set(String(text).toLowerCase().match(/[a-z']{4,}/g)?.map((w) => w.replace(/'/g, "")).filter((w) => !STOP.has(w)) ?? []);
/** Share of the line's content words found in the text (0..1). */
export function overlap(line, text) {
  const want = contentWords(line);
  if (!want.size) return 0;
  const have = contentWords(text);
  let n = 0;
  for (const w of want) if (have.has(w)) n++;
  return n / want.size;
}

/**
 * When each spoken line shows up in the on-screen transcript (the last ~160 characters). A line is
 * "heard" each time its share of words in the text rises to `rise` or more, after having fallen below
 * `fall` (it scrolled away): a loop of the audio says it again, a revision of a partial does not.
 */
export class HeardTracker {
  constructor(lines, { rise = 0.4, fall = 0.15, maxEdges = 4000 } = {}) {
    this.lines = lines;
    this.rise = rise;
    this.fall = fall;
    this.maxEdges = maxEdges;
    this.above = lines.map(() => false);
    this.best = lines.map(() => 0);
    /** { line, atMs } every time a line was heard */
    this.edges = [];
  }
  update(text, atMs) {
    this.lines.forEach((line, i) => {
      const o = overlap(line, text);
      this.best[i] = Math.max(this.best[i], o);
      if (!this.above[i] && o >= this.rise) { this.above[i] = true; if (this.edges.length < this.maxEdges) this.edges.push({ line: i, atMs }); }
      else if (this.above[i] && o < this.fall) this.above[i] = false;
    });
  }
}

/**
 * Whether every point of a pass ticked from speech heard in that pass: point i is "fresh" when its own
 * line was heard between the start of the pass (Start, or the Reset that began it) and its tick. With
 * offTopicLine, a tick that lands while the off-topic sentence is the latest line heard is stale too
 * (the negative control: that sentence must tick nothing).
 * @param pass { startMs, done: (number|null)[] } done times of the points, ms since Start
 * @param edges HeardTracker edges
 * @returns {{ fresh: boolean, stale: number[] }} fresh: every point ticked, none stale; stale: points
 *   that ticked without their line being heard in the pass (or during the off-topic sentence)
 */
export function passFresh(pass, edges, lineOfPoint = VOICE.lineOfPoint, offTopicLine = null) {
  const stale = [];
  pass.done.forEach((doneAt, i) => {
    if (doneAt == null) return;
    const heard = edges.some((e) => e.line === lineOfPoint[i] && e.atMs >= pass.startMs && e.atMs <= doneAt);
    const latest = edges.filter((e) => e.atMs <= doneAt).at(-1);
    if (!heard || (offTopicLine !== null && latest?.line === offTopicLine)) stale.push(i);
  });
  return { fresh: stale.length === 0 && pass.done.length > 0 && pass.done.every((d) => d != null), stale };
}

/**
 * Which speech-to-text backend the take log names in its "<label>: live" line. `sherpaLabels` are the
 * dictionary's texts for the on-device streaming backend (ctl.backend.sherpa, every language), so a
 * rewording of the label is followed; the older wordings named sherpa or Nemotron.
 */
export function sttBackendOf(line, sherpaLabels = []) {
  if (!line) return null;
  const said = line.toLowerCase();
  if (sherpaLabels.some((l) => l && said.includes(l.toLowerCase())) || /sherpa|nemotron/i.test(line)) return "sherpa";
  return /whisper/i.test(line) ? "whisper" : "other";
}
