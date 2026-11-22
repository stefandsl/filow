const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const id = v => typeof v === "string" && v.length > 0 && v.length <= 256 && !Object.hasOwn(Object.prototype, v);
const score = v => Number.isFinite(v) && v >= 0 && v <= 1;

// Project fields on both sides of disk I/O. A relay snapshot contains speech, commands and
// other live state which have no place in a resume file.
function evidenceOf(e) {
  if (!e || !Number.isFinite(e.fromMs) || !Number.isFinite(e.toMs)) return null;
  const times = { fromMs: e.fromMs, toMs: e.toMs };
  if (e.source === "manual") return { source: "manual", ...times };
  if (e.source !== "model" || typeof e.quote !== "string" || typeof e.model !== "string" ||
      !score(e.decision) || !score(e.lexical)) return null;
  return { source: "model", ...times, quote: e.quote.slice(0, 512), model: e.model.slice(0, 160),
    decision: e.decision, lexical: e.lexical, ...(score(e.gate) ? { gate: e.gate } : {}),
    ...(score(e.verified?.real) && score(e.verified.sameParty) ? { verified: { real: e.verified.real, sameParty: e.verified.sameParty } } : {}) };
}

function committedFields(value) {
  if (!id(value?.sectionId) || (value.here !== undefined && !id(value.here)) ||
      !value.points || typeof value.points !== "object" || Array.isArray(value.points)) return null;
  const points = {};
  for (const [key, p] of Object.entries(value.points)) {
    if (!id(key) || !p || !score(p.confidence)) return null;
    if (p.status === "started") {
      const evidence = evidenceOf(p.evidence);
      if (!evidence) return null;
      points[key] = { status: p.status, confidence: p.confidence, evidence,
        ...(Number.isFinite(p.startedAt) ? { startedAt: p.startedAt } : {}) };
    } else if (p.status === "missed") points[key] = { status: "missed", confidence: p.confidence };
    else if (p.status === "waiting" && p.reopened === true) points[key] = { status: "waiting", confidence: 0, reopened: true };
    else return null;
  }
  return { sectionId: value.sectionId, ...(value.here ? { here: value.here } : {}), points };
}

function createTakeCheckpoint(profile) {
  const file = path.join(profile, "take-place.json");
  let active;
  return {
    finish() {
      active = undefined;
      fs.rmSync(file, { force: true });
    },
    begin(key, recover = true) {
      if (typeof key !== "string") throw new TypeError("Missing script identity");
      active = { writer: randomUUID(), digest: createHash("sha256").update(key).digest("hex"), version: -1 };
      let place = null;
      try {
        const saved = JSON.parse(fs.readFileSync(file, "utf8"));
        if (recover && key && saved?.schema === 1 && saved.script === active.digest) place = committedFields(saved);
        if (!place) fs.rmSync(file, { force: true });
      } catch (err) {
        if (err.code !== "ENOENT" && !(err instanceof SyntaxError)) throw err;
      }
      return { writer: active.writer, place };
    },
    save(writer, version, input) {
      if (!active || active.writer !== writer || !Number.isSafeInteger(version) || version <= active.version) return false;
      if (input === null) {
        fs.rmSync(file, { force: true });
        active.version = version;
        return true;
      }
      const place = committedFields(input);
      if (!place) return false;
      fs.writeFileSync(file + ".tmp", JSON.stringify({ schema: 1, script: active.digest, ...place }), { mode: 0o600, flush: true });
      fs.renameSync(file + ".tmp", file);
      active.version = version;
      return true;
    },
  };
}

module.exports = { createTakeCheckpoint };
