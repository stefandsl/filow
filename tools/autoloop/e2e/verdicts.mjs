// Pure verdicts for the platform e2e scripts (linux.mjs, pwa.mjs). Each takes what the script observed and
// returns { ok, detail }, so the rule that decides PASS or FAIL is unit-tested (verdicts.test.ts) apart
// from the launch that feeds it.

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Keys at rest. With a key ring the app moves the key out of .env into secrets.json, encrypted, blanks the
 * line and logs "secrets: encrypted NAME". Without one it must leave .env alone and write nothing.
 * keyring: "yes" | "no" | "auto" ("auto" trusts the app's own log line to say which branch it took).
 */
export function secretsVerdict({ envText, storeText = "", startupLog = "", fakeKey, name, keyring = "auto" }) {
  const logged = new RegExp(`secrets: encrypted [^\\n]*\\b${escape(name)}\\b`).test(startupLog);
  const anyLog = /secrets: encrypted/.test(startupLog);
  const inEnv = envText.includes(fakeKey);
  const blanked = new RegExp(`^${escape(name)}=\\s*$`, "m").test(envText);
  const store = storeText.trim();
  const moved = !inEnv && blanked && store.includes(name) && !store.includes(fakeKey) && logged;
  const kept = inEnv && !store && !anyLog;
  const expected = keyring === "yes" ? "moved" : keyring === "no" ? "kept" : logged ? "moved" : "kept";
  const ok = expected === "moved" ? moved : kept;
  if (ok) return { ok, detail: expected === "moved" ? "key ring: key encrypted into secrets.json, .env line blanked" : "no key ring: key left in .env, nothing written" };
  return { ok, detail: { expected, keyInEnv: inEnv, envLineBlanked: blanked, storeNamesKey: store.includes(name), storeHoldsPlainKey: store.includes(fakeKey), logLine: logged } };
}

/** Lower-case words, punctuation dropped, the live "[partial]" tail left out. */
export function words(text) {
  return String(text || "").replace(/\s*\[[^\]]*\]\s*$/, "").toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").split(/\s+/).filter(Boolean);
}

/**
 * Speech to text: the model reported ready, no errors, at least minWords committed words and, when the
 * words of the recording are known (expect), at least minShare of them heard.
 */
export function sttVerdict({ ready, text, errors = [], expect, minWords = 3, minShare = 0.6 }) {
  const heard = words(text);
  const want = expect ? [...new Set(words(expect))] : [];
  const got = new Set(heard);
  const share = want.length ? want.filter((w) => got.has(w)).length / want.length : 1;
  const ok = Boolean(ready) && errors.length === 0 && heard.length >= minWords && share >= minShare;
  return { ok, detail: { ready: ready || null, words: heard.length, ...(want.length ? { expectedShare: Math.round(share * 100) / 100 } : {}), errors } };
}

/**
 * OK Filow's hold-to-talk keyboard hook (uiohook). ok only when the hook started; `final` says whether the
 * log has reached an end state, so the caller can stop polling.
 */
export function hotkeyVerdict(startupLog = "") {
  const started = /okfilow: hold-to-talk hook started/.test(startupLog);
  const unavailable = (startupLog.match(/okfilow: keyboard hook unavailable[^\n]*/) || [""])[0];
  const failed = (startupLog.match(/okfilow failed to start[^\n]*/) || [""])[0];
  if (started) return { ok: true, final: true, detail: "hold-to-talk hook started" };
  if (unavailable || failed) return { ok: false, final: true, detail: unavailable || failed };
  return { ok: false, final: false, detail: "no hook line in startup.log yet" };
}
