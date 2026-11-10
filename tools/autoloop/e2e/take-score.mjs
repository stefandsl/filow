// Scorecard rows read from tmp/autoloop/take.json (written by tools/autoloop/e2e/take.mjs). Kept apart
// from score.mjs so the rules have their own tests (take-score.test.ts): each one is shown able to fail.
// A missing, unreadable or older than 48 hours result counts as failing.
import { passFresh } from "./take-lib.mjs";

const MAX_AGE_H = 48;
// A long take must still be deciding at the end, not idle after its first pass.
const PERF02_LAST_DECISION_S = 120;
// Share of the rehearsal passes that must tick from speech said again after the Reset.
const PERF02_FRESH_SHARE = 0.9;
// A rehearsal that stalls (a point that never ticks again) is not a take: one pass every 5 minutes at least.
const PERF02_MIN_PER_PASS = 5;
const minPasses = (m) => Math.max(2, Math.floor((m.minutes ?? 0) / PERF02_MIN_PER_PASS));
// PERF-02 (docs/autoloop/STANDARDS.md): memory grows 10% or less after the warm-up, over 45 minutes.
const PERF02_MINUTES = 45;
const PERF02_MIN_RUN = 20;
const PERF02_GROWTH_PCT = 10;

const fresh = (r, now) => r && typeof r.at === "string" && (now - Date.parse(r.at)) / 3.6e6 <= MAX_AGE_H;
const edgesOf = (r) => (Array.isArray(r.heard?.edges) ? r.heard.edges : []);
/**
 * Points ticked by their own paraphrase: after the first words were heard, and after the line that
 * says that point showed on screen (take-lib.mjs HeardTracker), and not while the off-topic sentence was
 * the latest line heard. A tick from the off-topic sentence, or from nothing, does not count.
 */
function ticked(r) {
  if (!Array.isArray(r.points) || !Array.isArray(r.audio?.lineOfPoint) || r.stt?.firstTranscriptMs == null) return 0;
  const done = r.points.map((p) => (p.doneAtMs != null && p.doneAtMs >= r.stt.firstTranscriptMs ? p.doneAtMs : null));
  const { stale } = passFresh({ startMs: 0, done }, edgesOf(r), r.audio.lineOfPoint, r.audio.offTopicLine ?? null);
  return done.filter((d, i) => d != null && !stale.includes(i)).length;
}
/** Rehearsal passes of a long take, and how many ticked every point from its paraphrase said again in that pass. */
function stalePasses(r) {
  const passes = Array.isArray(r.cycles) ? r.cycles.filter((c) => Array.isArray(c.done)) : [];
  const fresh = passes.filter((c) => passFresh(c, edgesOf(r), r.audio?.lineOfPoint).fresh).length;
  return { total: passes.length, fresh };
}
/** Why the probe cannot judge which speech ticked what, or null. */
function unjudgeable(r) {
  if (!Array.isArray(r.audio?.lineOfPoint) || typeof r.audio?.offTopicLine !== "number") return "the run does not say which line speaks which point";
  if (!edgesOf(r).some((e) => e.line === r.audio.offTopicLine)) return "the off-topic sentence never showed on screen, so the negative control did not run";
  return null;
}
const command = { local: "", offline: " --offline", memory: " --minutes 20" };
const stale = (r, now, run) => (!r ? `no ${run} result (run node tools/autoloop/e2e/take.mjs${command[run]})` : !fresh(r, now) ? `${run} result older than ${MAX_AGE_H} h` : null);

/** Why a run does not count as a local take, or null when it does. */
function notLocal(r) {
  if (r.appExit) return `the app exited during the take (code ${r.appExit.code})`;
  if (r.devtoolsClosed) return "the page connection closed during the take";
  if (r.errors?.length) return `harness errors: ${r.errors.slice(0, 2).join("; ")}`;
  if (r.recordingAtMs == null) return "the take never started recording";
  if (r.stt?.backend !== "sherpa") return `speech-to-text was ${r.stt?.backend ?? "not seen"}, not sherpa`;
  if (!r.decide?.allLocal) return `decisions not all local (${JSON.stringify(r.decide?.models ?? {})})`;
  if (!Array.isArray(r.pageErrors)) return "no record of errors on the page";
  if (r.pageErrors.length) return `errors on the page: ${r.pageErrors.slice(0, 2).join("; ")}`;
  return null;
}

/** @returns {{ id: string, weight: number, credit: number, detail: string }[]} */
export function takeChecks(all, now = Date.now()) {
  const out = [];

  // TST-02 (part): a full local take in the packaged app with the fake microphone ticks section 1.
  {
    const r = all?.local;
    let credit = 0, detail = stale(r, now, "local");
    if (!detail) {
      const total = r.points?.length ?? 0;
      detail = notLocal(r) ?? (total ? null : "no points recorded") ?? unjudgeable(r);
      if (!detail) {
        credit = ticked(r) / total;
        detail = `${ticked(r)}/${total} points ticked by their own paraphrase (sherpa + ${Object.keys(r.decide.models).join(", ")})` +
          (r.timeToAllDoneMs != null ? ` in ${Math.round(r.timeToAllDoneMs / 100) / 10} s` : "") +
          (ticked(r) < r.points.filter((p) => p.doneAtMs != null).length
            ? "; some ticked before their own paraphrase was heard (from the off-topic sentence or nothing)"
            : "; the off-topic sentence ticked nothing");
      }
    }
    out.push({ id: "TST-02 local take ticks section 1 (fake mic)", weight: 3, credit, detail });
  }

  // PR-01 (part): in offline mode a take runs and nothing leaves the PC: no TCP connection from the app's
  // process tree or from a local process it talks to (Ollama, a proxy) to another host, and no request
  // for, or connection to, another host in Chromium's net log. Half credit for that during a take that
  // ran; the other half for the points it ticked.
  {
    const r = all?.offline;
    let credit = 0, detail = stale(r, now, "offline");
    if (!detail) {
      const n = r.network ?? {}, log = n.netLog ?? {};
      const leaks = [...(n.outboundSeen ?? []), ...(n.peerOutboundSeen ?? []), ...(log.externalUrls ?? []), ...(log.externalTcp ?? [])];
      const sock = n.serverSockets ?? {}, seen = r.offlineSeen ?? {};
      leaks.push(...(sock.external ?? []).map((h) => `server socket to ${h}`));
      if (!r.offline) detail = "the run was not in offline mode";
      // what the app itself says, not only how the probe launched it
      else if (seen.preload !== true || seen.server !== true || seen.chip !== true) detail = `the app did not show offline mode (shell ${seen.preload}, server ${seen.server}, OFFLINE chip ${seen.chip})`;
      else if (r.recordingAtMs == null || !(r.decide?.ok > 0)) detail = "no take ran (nothing recorded or decided), so silence proves nothing";
      else if (!(n.samples >= 5)) detail = `only ${n.samples ?? 0} connection samples`;
      else if (!(n.loopbackSeen > 0)) detail = "the probe saw no connection at all, so it cannot be trusted";
      else if (log.error || !(log.events > 0)) detail = `no readable net log (${log.error ?? "0 events"})`;
      // the server side: every connection the main process opened, however short (QA socket log)
      else if (sock.error || !(sock.local > 0)) detail = `no server socket log with the take's own connections (${sock.error ?? `${sock.lines ?? 0} lines`})`;
      else if (n.outbound !== 0 || n.peerOutbound || leaks.length) detail = `left the PC: ${leaks.slice(0, 3).join("; ")}`;
      else {
        const why = notLocal(r);
        const total = r.points?.length ?? 0;
        credit = 0.5 + (why || !total ? 0 : 0.5 * (ticked(r) / total));
        detail = `0 outbound over ${n.samples} netstat samples, ${log.events} net log events and ${sock.lines} server sockets (${n.loopbackSeen} loopback, ` +
          `${n.selfLan ?? 0} to this PC's LAN address, peers ${(n.peers ?? []).join(", ") || "none"}); ` + (why ? `take: ${why}` : `${ticked(r)}/${total} points ticked`);
      }
    }
    out.push({ id: "PR-01 offline take, 0 outbound connections", weight: 3, credit, detail });
  }

  // PERF-02: memory of the whole process tree over a long take that is still running at the end. Credit
  // only when growth after the warm-up (the larger of working set and private bytes) stays within budget,
  // scaled by how much of the 45-minute standard the run covered.
  {
    const r = all?.memory;
    let credit = 0, detail = stale(r, now, "memory");
    const m = r?.memory;
    if (!detail) {
      if (!m) detail = "no memory series";
      else if (r.appExit) detail = `the app exited during the take (code ${r.appExit.code})`;
      else if (r.devtoolsClosed || r.errors?.length) detail = `harness problem: ${r.devtoolsClosed ? "page connection closed" : r.errors.slice(0, 2).join("; ")}`;
      else if (!r.stillRecording) detail = "the take was no longer running at the end, so this is not memory under a take";
      // a live LOCAL take: speech on this device, local decisions, no errors on screen
      else if (notLocal(r)) detail = `not a live local take: ${notLocal(r)}`;
      else if (!(ticked(r) > 0)) detail = "nothing was ticked by speech";
      else if (!(r.takeMs > 0) || r.decide?.lastAtMs == null || r.decide.lastAtMs < r.takeMs - PERF02_LAST_DECISION_S * 1000)
        detail = `no decision in the last ${PERF02_LAST_DECISION_S} s of the take (last at ${r.decide?.lastAtMs == null ? "never" : `${Math.round(r.decide.lastAtMs / 1000)} s`}): the take went idle`;
      else if (!(stalePasses(r).total >= minPasses(m))) detail = `${stalePasses(r).total} rehearsal passes in ${m.minutes} min (needs ${minPasses(m)}: one every ${PERF02_MIN_PER_PASS} min, 2 or more)`;
      else if (stalePasses(r).fresh < PERF02_FRESH_SHARE * stalePasses(r).total)
        detail = `only ${stalePasses(r).fresh}/${stalePasses(r).total} passes ticked from speech said again after the Reset (a Reset that does not start the section over)`;
      else if (!(m.minutes >= PERF02_MIN_RUN)) detail = `run of ${m.minutes} min (needs ${PERF02_MIN_RUN})`;
      else if (!(m.samples >= m.minutes * 6 * 0.9)) detail = `${m.samples} samples over ${m.minutes} min (one per 10 s expected)`;
      else if (typeof m.growthAfterWarmupPct !== "number") detail = "no growth figure";
      else {
        const within = m.growthAfterWarmupPct <= PERF02_GROWTH_PCT;
        credit = within ? Math.min(1, m.minutes / PERF02_MINUTES) : 0;
        detail = `working set ${m.startMB} -> ${m.endMB} MB (max ${m.maxMB}), private ${m.privateStartMB} -> ${m.privateEndMB} MB over ${m.minutes} min` +
          ` (${stalePasses(r).fresh}/${stalePasses(r).total} rehearsal passes ticked from fresh speech); after ${m.warmupMin} min warm-up +${m.growthAfterWarmupPct}% (budget ${PERF02_GROWTH_PCT}%)` +
          (within && m.minutes < PERF02_MINUTES ? `; ${PERF02_MINUTES}-minute run still to do` : "");
      }
    }
    out.push({ id: "PERF-02 memory over a long take", weight: 3, credit, detail });
  }
  return out;
}
