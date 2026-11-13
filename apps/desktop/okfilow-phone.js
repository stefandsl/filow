// A question typed on a paired phone, on its way to OK Filow's panel (apps/web/lib/buddy/phoneAsk.ts).
// The session server already checked that the device may ask (a right the presenter gave on the PC)
// and the question's shape; here it is cleaned again (the same rules as packages/core/src/phone-ask.ts,
// kept equal by okfilow-phone.test.ts) and let through only when OK Filow is free: switched on, its
// panel loaded, idle, no other phone question waiting for the presenter, and not just after another.
// Nothing here can interrupt an answer: a phone gets "busy" instead.

const PHONE_QUESTION_MAX = 300;
const PHONE_QUESTION_RAW_MAX = 4096;
/** The shortest time between two phone questions. */
const PHONE_ASK_GAP_MS = 3000;
/** A question waiting for the presenter's yes stops blocking the next after this long (the panel's notice closes by then). */
const PHONE_PENDING_MS = 65_000;

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

/**
 * The gate in front of the panel. `decide(state, payload)`: state = { enabled, panelReady, mode };
 * payload = { text, device } from the main window. Returns { answer } with answer "asked" (then also
 * the cleaned `question` and `device`), "off", "busy" or "bad". `done()`: the presenter answered the
 * panel's notice (yes or no), the next phone question may come.
 */
function createPhoneGate({ now = Date.now, gapMs = PHONE_ASK_GAP_MS, pendingMs = PHONE_PENDING_MS } = {}) {
  let lastAt = -Infinity;
  let pendingSince = null;
  return {
    decide(state, payload) {
      if (!state || !state.enabled) return { answer: "off" };
      const p = payload && typeof payload === "object" ? payload : {};
      const question = cleanPhoneQuestion(p.text, true);
      if (!question) return { answer: "bad" };
      const device = cleanDeviceName(p.device) || "phone";
      const t = now();
      if (pendingSince !== null && t - pendingSince < pendingMs) return { answer: "busy" };
      if (!state.panelReady || state.mode !== "idle" || t - lastAt < gapMs) return { answer: "busy" };
      lastAt = t;
      pendingSince = t;
      return { answer: "asked", question, device };
    },
    done() {
      pendingSince = null;
    },
  };
}

module.exports = { createPhoneGate, cleanPhoneQuestion, cleanDeviceName, PHONE_QUESTION_MAX, PHONE_ASK_GAP_MS, PHONE_PENDING_MS };
