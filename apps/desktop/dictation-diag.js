// Dictation: what happened in the last dictations, stage by stage, for "Report a problem"
// (docs/dictation/SPEC.md "Troubleshooting report"). Kept in memory only, for this run of Filow.
// It records times, counts, the target program's name and window class, and what was done with the
// words. It never records the words, a window title or anything typed.

const STAGES = ["keys-down", "listening", "audio", "keys-up", "recognised", "cleanup", "target", "done", "clipboard"];

/**
 * @param {{ now?: () => number, max?: number }} o
 * A run: { at (ms since epoch), kind: "hold" | "handsfree", stages: [{ name, ms, ...facts }], result }
 */
function createDictationDiag(o = {}) {
  const now = o.now || Date.now;
  const max = o.max || 5;
  const runs = [];
  let cur = null;

  /**
   * The keys went down (or the hands-free dictation started). `agoMs`: how long ago they really went down
   * (a hold is only known as one after the 250 ms start delay), so the times count from the key press.
   */
  function begin(kind, agoMs = 0) {
    // A run the next press overtook before its words (or their absence) came back: it gave nothing.
    if (cur && !cur.result) cur.result = cur.stages.some((s) => s.name === "recognised") ? "overtaken" : "nothing";
    cur = { at: now() - Math.max(0, Number(agoMs) || 0), kind: kind === "handsfree" ? "handsfree" : "hold", stages: [{ name: "keys-down", ms: 0 }], phrases: 0, result: "" };
    runs.push(cur);
    while (runs.length > max) runs.shift();
    return cur;
  }
  /** A hold that went on hands-free (a second short press): the same run, renamed. */
  function handsFree() { if (cur) cur.kind = "handsfree"; }
  /** One stage of the current run. Facts are numbers, booleans and short names only. `once`: only its first time. */
  function mark(name, facts = {}, { once = false } = {}) {
    if (!cur || !STAGES.includes(name)) return;
    if (once && cur.stages.some((s) => s.name === name)) return;
    if (cur.stages.length >= 40) return; // a long hands-free dictation: the first stages tell the story
    cur.stages.push({ name, ms: now() - cur.at, ...facts });
  }
  /** What became of the words: "pasted", "typed", "direct", "copied:<reason>", "refused:<reason>", "nothing", "cancelled". */
  function result(what) {
    if (!cur) return;
    cur.result = String(what || "").slice(0, 40);
    if (/^(pasted|typed|direct)/.test(cur.result)) cur.phrases += 1;
  }
  /** No words came back for a dictation whose keys are up. A run that is still listening is left alone. */
  function nothing() {
    if (cur && !cur.result && !cur.phrases && cur.stages.some((s) => s.name === "keys-up")) cur.result = "nothing";
  }
  const last = () => (runs.length ? runs[runs.length - 1] : null);

  return { begin, handsFree, mark, result, nothing, last, runs: () => runs.slice(), get current() { return cur; } };
}

const p2 = (n) => String(n).padStart(2, "0");
const clock = (ms) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };

/** One stage as words: "keys up +2032 ms", "recognised 36 chars +2650 ms". */
function stageText(s) {
  const at = `+${s.ms} ms`;
  switch (s.name) {
    case "keys-down": return "keys down +0 ms";
    case "listening": return `microphone asked ${at}`;
    case "audio": return `first sound ${at}`;
    case "keys-up": return `keys up ${at}`;
    case "recognised": return `recognised ${s.chars || 0} chars ${at}`;
    case "cleanup": return `cleanup ${s.used ? `used (${s.took || 0} ms)` : `skipped (${String(s.why || "?").slice(0, 60)}${s.took ? `, ${s.took} ms` : ""})`} ${at}`;
    case "target": return `target ${s.line || "?"} -> ${s.method || "?"} ${at}`;
    case "done": return `${s.what || "?"}${s.accepted === false ? " (Windows did not accept the keys)" : ""} ${at}`;
    case "clipboard": return `clipboard ${s.back ? "put back" : "left as is"} ${at}`;
    default: return `${s.name} ${at}`;
  }
}

/**
 * A short code the user can quote: FD-<hook><result>.
 *   hook:   H1 the keyboard hook is registered, H0 it is not
 *   result: OK typed or pasted; SHORT nothing recognised and the keys were up again within a second;
 *           NOTEXT nothing recognised after a longer hold; COPY-<reason> only copied; PW a password box;
 *           KEYS Windows did not accept the keys; NONE no dictation since Filow started
 */
function problemCode({ hookReady, run }) {
  const h = hookReady ? "H1" : "H0";
  if (!run) return `FD-${h}-NONE`;
  const up = run.stages.find((s) => s.name === "keys-up");
  const r = run.result || "";
  let code = "OPEN"; // still running, or it never reached an end
  if (/^(pasted|typed|direct)/.test(r)) code = "OK";
  else if (r === "nothing") code = run.kind === "hold" && up && up.ms < 1000 ? "SHORT" : "NOTEXT";
  else if (r.startsWith("refused:password")) code = "PW";
  else if (r === "copied:keys" || r === "copied:blocked") code = "KEYS";
  else if (r.startsWith("copied:")) code = `COPY-${r.slice(7).toUpperCase()}`;
  else if (r === "cancelled") code = "CANCEL";
  return `FD-${h}-${code}`;
}

/**
 * The "Dictation and keys" section of the report, as plain lines.
 * facts: { platform, settings: { enabled, chord, mode, insert, language }, hook: { ready, error, failures, lastTryAt },
 *          model: { ready, language }, mic: string, session: string[], helper: boolean, runs }
 */
function reportText(facts) {
  const f = facts || {};
  const s = f.settings || {};
  const hook = f.hook || {};
  const runs = Array.isArray(f.runs) ? f.runs : [];
  const lastRun = runs.length ? runs[runs.length - 1] : null;
  const lines = [
    `problem code: ${problemCode({ hookReady: Boolean(hook.ready), run: lastRun })}`,
    `dictation: ${s.enabled === false ? "off" : "on"}, keys ${s.chord || "?"}, ${s.mode === "toggle" ? "press once to start" : "hold to talk, two taps for hands-free"}, words ${s.insert === "copy" ? "only copied" : "typed where the cursor is"}, language ${s.language || "auto"}`,
    `keyboard hook: ${hook.ready ? "registered" : `NOT registered${hook.error ? ` (${String(hook.error).slice(0, 160)})` : ""}`}${hook.failures ? `, ${hook.failures} failed ${hook.failures === 1 ? "try" : "tries"}` : ""}${hook.lastTryAt ? `, last try ${clock(hook.lastTryAt)}` : ""}`,
    `speech: on this computer, model for "${(f.model && f.model.language) || "auto"}" ${f.model && f.model.ready === true ? "ready" : f.model && f.model.ready === false ? "NOT on this computer" : "unknown"}`,
    `microphone: ${f.mic || "unknown"}`,
    `cleanup (English only): S1-mini by Superwhisper, ${s.cleanup === false ? "off" : "on"}, style ${s.cleanupStyle || "semi-formal"}, lists ${s.cleanupLists ? "on" : "off"}; model ${f.cleanup && f.cleanup.model ? "on this computer" : "NOT on this computer"}, runtime ${f.cleanup && f.cleanup.runtime ? "in this build" : "NOT in this build"}${f.cleanup && f.cleanup.running ? `, running (started in ${f.cleanup.startedMs} ms)` : ""}${f.cleanup && f.cleanup.error ? `, last error: ${String(f.cleanup.error).slice(0, 80)}` : ""}`,
    `typing helper: ${f.helper ? "yes" : "no (keys go through the keyboard hook, the target is not known)"}`,
    ...(Array.isArray(f.session) ? f.session.map((x) => `system: ${x}`) : []),
  ];
  if (!runs.length) lines.push("last dictations: none since Filow started");
  else {
    lines.push("last dictations (newest first; times from the moment the keys went down; never the words):");
    for (const r of runs.slice().reverse()) {
      // A long hands-free dictation has dozens of stages: the first ones and the last ones tell the story,
      // and the section must stay short enough for the issue link (it is never cut there).
      const all = r.stages.map(stageText);
      const shown = all.length > 12 ? [...all.slice(0, 8), `(${all.length - 11} more stages)`, ...all.slice(-3)] : all;
      lines.push(`- ${clock(r.at)} ${r.kind}: ${shown.join(", ")} => ${r.result || "not finished"}`);
    }
  }
  return lines.join("\n");
}

module.exports = { createDictationDiag, reportText, problemCode, stageText, STAGES };
