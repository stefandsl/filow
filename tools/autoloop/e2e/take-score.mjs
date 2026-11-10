// Scorecard rows read from tmp/autoloop/take.json (written by tools/autoloop/e2e/take.mjs). Kept apart
// from score.mjs so the rules have their own tests (take-score.test.ts): each one is shown able to fail.
// A missing, unreadable or older than 48 hours result counts as failing.

const MAX_AGE_H = 48;
// PERF-02 (docs/autoloop/STANDARDS.md): memory grows 10% or less after the warm-up, over 45 minutes.
const PERF02_MINUTES = 45;
const PERF02_MIN_RUN = 20;
const PERF02_GROWTH_PCT = 10;

const fresh = (r, now) => r && typeof r.at === "string" && (now - Date.parse(r.at)) / 3.6e6 <= MAX_AGE_H;
/** Points ticked after the first words were heard (a tick before any speech is not a tick by speech). */
const ticked = (r) => (Array.isArray(r.points) ? r.points.filter((p) => p.doneAtMs != null && r.stt?.firstTranscriptMs != null && p.doneAtMs >= r.stt.firstTranscriptMs).length : 0);
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
      detail = notLocal(r) ?? (total ? null : "no points recorded");
      if (!detail) {
        credit = ticked(r) / total;
        detail = `${ticked(r)}/${total} points ticked by sherpa + ${Object.keys(r.decide.models).join(", ")}` +
          (r.timeToAllDoneMs != null ? ` in ${Math.round(r.timeToAllDoneMs / 100) / 10} s` : "");
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
      if (!r.offline) detail = "the run was not in offline mode";
      else if (r.recordingAtMs == null || !(r.decide?.ok > 0)) detail = "no take ran (nothing recorded or decided), so silence proves nothing";
      else if (!(n.samples >= 5)) detail = `only ${n.samples ?? 0} connection samples`;
      else if (!(n.loopbackSeen > 0)) detail = "the probe saw no connection at all, so it cannot be trusted";
      else if (log.error || !(log.events > 0)) detail = `no readable net log (${log.error ?? "0 events"})`;
      else if (n.outbound !== 0 || n.peerOutbound || leaks.length) detail = `left the PC: ${leaks.slice(0, 3).join("; ")}`;
      else {
        const why = notLocal(r);
        const total = r.points?.length ?? 0;
        credit = 0.5 + (why || !total ? 0 : 0.5 * (ticked(r) / total));
        detail = `0 outbound over ${n.samples} netstat samples and ${log.events} net log events (${n.loopbackSeen} loopback, ` +
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
      else if (!(m.minutes >= PERF02_MIN_RUN)) detail = `run of ${m.minutes} min (needs ${PERF02_MIN_RUN})`;
      else if (!(m.samples >= m.minutes * 6 * 0.9)) detail = `${m.samples} samples over ${m.minutes} min (one per 10 s expected)`;
      else if (typeof m.growthAfterWarmupPct !== "number") detail = "no growth figure";
      else {
        const within = m.growthAfterWarmupPct <= PERF02_GROWTH_PCT;
        credit = within ? Math.min(1, m.minutes / PERF02_MINUTES) : 0;
        detail = `working set ${m.startMB} -> ${m.endMB} MB (max ${m.maxMB}), private ${m.privateStartMB} -> ${m.privateEndMB} MB over ${m.minutes} min` +
          ` (${m.cycles ?? 0} passes); after ${m.warmupMin} min warm-up +${m.growthAfterWarmupPct}% (budget ${PERF02_GROWTH_PCT}%)` +
          (within && m.minutes < PERF02_MINUTES ? `; ${PERF02_MINUTES}-minute run still to do` : "");
      }
    }
    out.push({ id: "PERF-02 memory over a long take", weight: 3, credit, detail });
  }
  return out;
}
