// OK Filow, "going outside": what is leaving this PC right now, and which sends the user allowed.
// Pure (no Electron), so it is unit-tested. The inventory of outbound paths is docs/okfilow/OUTBOUND.md;
// the web side of the same model is apps/web/lib/buddy/outbound.ts.

const KINDS = ["ask", "voice", "audio", "photo", "agent", "transcript", "screen", "script"];
const KEY = /^(ask|voice|audio|photo|agent|transcript|screen|script):[a-z0-9._/+-]{1,80}$/;
const MAX_ENTRIES = 50;

/** Up to three short display names; anything else is dropped. */
function cleanNames(names) {
  if (!Array.isArray(names)) return [];
  return names
    .filter((n) => typeof n === "string")
    .map((n) => n.replace(/[\p{Cc}<>]/gu, "").trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, 3);
}

/** The stored choices, per kind of content and per recipient. Unknown keys, states and shapes are dropped. */
function sanitizeConsent(map) {
  const out = {};
  if (!map || typeof map !== "object" || Array.isArray(map)) return out;
  for (const [key, entry] of Object.entries(map)) {
    if (Object.keys(out).length >= MAX_ENTRIES) break;
    if (!KEY.test(key) || !entry || typeof entry !== "object") continue;
    if (entry.state !== "granted" && entry.state !== "declined") continue;
    const at = typeof entry.at === "string" && !Number.isNaN(Date.parse(entry.at)) ? entry.at.slice(0, 40) : new Date(0).toISOString();
    out[key] = { state: entry.state, at, names: cleanNames(entry.names) };
  }
  return out;
}

/** Who a coding agent's CLI talks to. */
const AGENT_RECIPIENTS = {
  codex: { id: "openai", names: ["OpenAI"], cli: "Codex" },
  claude: { id: "anthropic", names: ["Anthropic"], cli: "Claude Code" },
};
const agentRecipient = (cli) => AGENT_RECIPIENTS[cli] || null;
const agentConsentKey = (cli) => (AGENT_RECIPIENTS[cli] ? `agent:${AGENT_RECIPIENTS[cli].id}` : "");
const agentGranted = (consent, cli) => {
  const entry = consent && consent[agentConsentKey(cli)];
  return Boolean(entry && entry.state === "granted");
};

/**
 * Tracks the sends in flight. `begin` when a request carrying user content starts, `end` when it is over.
 * The signal stays up for at least `minMs` (a 200 ms request must still be seen) and goes away
 * `lingerMs` after the last send ended. `end(id, { cancel: true })` drops it at once: nothing went out.
 * `onChange(snapshot)` fires only when what the user should see changes.
 */
function createOutboundState({ onChange, minMs = 1200, lingerMs = 300, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  /** id -> { kind, names, since, timer } */
  const items = new Map();
  let last = JSON.stringify({ active: false, kinds: [], names: [] });

  function snapshot() {
    const kinds = [];
    const names = [];
    for (const it of items.values()) {
      if (!kinds.includes(it.kind)) kinds.push(it.kind);
      for (const n of it.names) if (!names.includes(n)) names.push(n);
    }
    return { active: items.size > 0, kinds, names: names.slice(0, 4) };
  }
  function publish() {
    const snap = snapshot();
    const json = JSON.stringify(snap);
    if (json === last) return;
    last = json;
    if (onChange) onChange(snap);
  }
  function drop(id) {
    const it = items.get(id);
    if (!it) return;
    clearTimer(it.timer);
    items.delete(id);
    publish();
  }

  /** Returns false (and shows nothing) when the kind or the names are not usable. */
  function begin(id, kind, names) {
    const key = String(id || "").slice(0, 80);
    const who = cleanNames(names);
    if (!key || !KINDS.includes(kind) || !who.length) return false;
    const old = items.get(key);
    if (old) clearTimer(old.timer);
    items.set(key, { kind, names: who, since: now(), timer: null });
    publish();
    return true;
  }
  function end(id, opts = {}) {
    const key = String(id || "").slice(0, 80);
    const it = items.get(key);
    if (!it) return;
    if (opts && opts.cancel) return drop(key);
    clearTimer(it.timer);
    it.timer = setTimer(() => drop(key), Math.max(lingerMs, minMs - (now() - it.since)));
  }
  /** Drops every send, or only those whose id starts with `prefix` (a window that went away). */
  function clear(prefix = "") {
    for (const [id, it] of [...items]) {
      if (!id.startsWith(prefix)) continue;
      clearTimer(it.timer);
      items.delete(id);
    }
    publish();
  }
  return { begin, end, clear, snapshot, active: () => items.size > 0 };
}

module.exports = { createOutboundState, sanitizeConsent, cleanNames, agentRecipient, agentConsentKey, agentGranted, AGENT_RECIPIENTS, KINDS };
