// A question typed on a paired phone, on its way to OK Filow's panel (apps/web/lib/buddy/phoneAsk.ts).
// The session server already checked that the device may ask (a right the presenter gave on the PC)
// and the question's shape; here it is cleaned again (the same rules as packages/core/src/phone-ask.ts,
// kept equal by okfilow-phone.test.ts) and put in an inbox. Nothing of it reaches the screen by itself:
// the presenter sees a count (the panel's badge, the tray), and the text only when they open it from
// the panel. During a slide show the count is held at zero and nothing can be opened.
//
// Fair to every phone: one waiting question per device; a device whose question was ignored waits
// longer each time before it may send the next (cooldownMs, doubled per ignore), and after
// IGNORES_BEFORE_OFF ignores in a row its right to ask is switched off (the presenter can give it again).

const PHONE_QUESTION_MAX = 300;
const PHONE_QUESTION_RAW_MAX = 4096;
/** At most this many questions wait, all devices together. */
const PHONE_INBOX_MAX = 5;
/** A question nobody opened is dropped after this long. */
const PHONE_INBOX_TTL_MS = 10 * 60 * 1000;
/** After the first ignore a device waits this long before its next question; doubled per ignore. */
const PHONE_COOLDOWN_MS = 30_000;
/** Ignored this many times in a row: the device may no longer ask. */
const IGNORES_BEFORE_OFF = 3;

function cleanPhoneQuestion(raw, strict = false) {
  if (typeof raw !== "string" || raw.length > PHONE_QUESTION_RAW_MAX) return null;
  const text = raw.normalize("NFC").replace(/\s+/gu, " ").replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/ {2,}/g, " ").trim();
  const points = Array.from(text);
  if (!points.length || (strict && points.length > PHONE_QUESTION_MAX)) return null;
  return points.slice(0, PHONE_QUESTION_MAX).join("").trim() || null;
}

function cleanDeviceName(raw) {
  if (typeof raw !== "string") return "";
  return Array.from(raw.slice(0, 200).normalize("NFC").replace(/\s+/gu, " ").replace(/[\p{Cc}\p{Cf}]/gu, "").trim()).slice(0, 40).join("").trim();
}

/** A pairing id as the session server makes them (base64url), or "". */
const pairingId = (raw) => (typeof raw === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? raw : "");

/**
 * The inbox. `add(state, payload)`: state = { enabled }; payload = { text, device, id, peer } from the
 * main window (id: the pairing the session server named). Returns the answer for the phone: "asked"
 * (it waits in the inbox), "off", "bad", "busy" (this device already has one waiting, is cooling down,
 * or the inbox is full) or "blocked" (ignored too often: its right to ask is being switched off).
 * `count()`: questions waiting. `open()`: the oldest one, for the panel (one open at a time), or null.
 * `done(key, outcome)`: the presenter answered ("yes"), ignored ("no", the notice timing out too), or
 * the panel dropped it unseen ("dropped"); returns { askOff: id } when that device is to lose its right.
 * `keep(ids)`: only these pairings may ask now (the devices list); the rest leave the inbox, and
 * { withdrawn: key } says the open one went with them.
 */
function createPhoneInbox({ now = Date.now, max = PHONE_INBOX_MAX, ttlMs = PHONE_INBOX_TTL_MS, cooldownMs = PHONE_COOLDOWN_MS, ignoresBeforeOff = IGNORES_BEFORE_OFF } = {}) {
  /** Waiting entries, oldest first. */
  let waiting = [];
  /** The entry the panel shows now. */
  let opened = null;
  /** Per device: ignores in a row, and when it may send again. */
  const devices = new Map();
  let seq = 0;
  const stats = (id) => {
    let d = devices.get(id);
    if (!d) devices.set(id, (d = { ignores: 0, until: 0 }));
    return d;
  };
  const sweep = () => {
    const t = now();
    waiting = waiting.filter((e) => t - e.at < ttlMs);
  };
  return {
    add(state, payload) {
      if (!state || !state.enabled) return { answer: "off" };
      const p = payload && typeof payload === "object" ? payload : {};
      const question = cleanPhoneQuestion(p.text, true);
      const id = pairingId(p.id);
      if (!question || !id) return { answer: "bad" };
      sweep();
      const d = stats(id);
      if (d.ignores >= ignoresBeforeOff) return { answer: "blocked" };
      if (now() < d.until) return { answer: "busy" };
      if (waiting.some((e) => e.id === id) || opened?.id === id) return { answer: "busy" };
      if (waiting.length >= max) return { answer: "busy" };
      const entry = { key: `q${++seq}`, id, question, device: cleanDeviceName(p.device) || "phone", peer: p.peer === "lan" ? "lan" : "remote", at: now() };
      waiting.push(entry);
      return { answer: "asked", key: entry.key };
    },
    count() {
      sweep();
      return waiting.length;
    },
    open() {
      sweep();
      if (opened || !waiting.length) return null;
      opened = waiting.shift();
      const { key, question, device, peer, id } = opened;
      // The short code the devices list shows next to the same device.
      return { key, text: question, device, peer, fp: id.slice(0, 4) };
    },
    done(key, outcome) {
      if (!opened || opened.key !== key) return {};
      const { id } = opened;
      opened = null;
      const d = stats(id);
      if (outcome === "yes") {
        d.ignores = 0;
        d.until = 0;
        return {};
      }
      if (outcome !== "no") return {};
      d.ignores += 1;
      d.until = now() + cooldownMs * 2 ** (d.ignores - 1);
      return d.ignores >= ignoresBeforeOff ? { askOff: id } : {};
    },
    keep(ids) {
      const allowed = ids instanceof Set ? ids : new Set(Array.isArray(ids) ? ids : []);
      waiting = waiting.filter((e) => allowed.has(e.id));
      // A device given the right again starts afresh.
      for (const id of [...devices.keys()]) if (!allowed.has(id)) devices.delete(id);
      if (opened && !allowed.has(opened.id)) {
        const key = opened.key;
        opened = null;
        return { withdrawn: key };
      }
      return {};
    },
  };
}

module.exports = { createPhoneInbox, cleanPhoneQuestion, cleanDeviceName, PHONE_QUESTION_MAX, PHONE_INBOX_MAX, PHONE_INBOX_TTL_MS, PHONE_COOLDOWN_MS, IGNORES_BEFORE_OFF };
