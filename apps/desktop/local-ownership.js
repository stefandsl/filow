// Local provenance, never inferred from catalogue membership. Missing/corrupt records preserve everything.
const fs = require("node:fs");
const path = require("node:path");
const canonical = name => name.replace(/:latest$/, "");
function ownership(profile) {
  const file = path.join(profile, "local-ownership.json");
  const read = () => {
    if (!fs.existsSync(file)) return { version: 1, models: {}, runtime: null };
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (data.version !== 1 || !data.models || typeof data.models !== "object") throw new Error("ownership_record_invalid");
    return data;
  };
  const update = fn => {
    fs.mkdirSync(profile, { recursive: true });
    const lock = file + ".lock";
    const fd = fs.openSync(lock, "wx");
    const temporary = file + ".tmp";
    try { const data = read(); fn(data); fs.writeFileSync(temporary, JSON.stringify(data, null, 2)); fs.renameSync(temporary, file); }
    finally { fs.closeSync(fd); fs.rmSync(lock, { force: true }); if (fs.existsSync(temporary)) fs.rmSync(temporary); }
  };
  const key = (base, name) => JSON.stringify([base.replace(/\/$/, ""), canonical(name)]);
  return {
    read,
    beginModel(base, name, installed) {
      update(data => {
        const k = key(base, name), old = data.models[k];
        const found = installed.find(m => canonical(m.name) === canonical(name));
        if (old?.state === "complete" && !old.preexisting && found?.digest === old.digest) return;
        data.models[k] = { name: canonical(name), base, storeHint: process.env.OLLAMA_MODELS || null, preexisting: Boolean(found), state: "pulling", startedAt: new Date().toISOString() };
      });
    },
    completeModel(base, name, digest) {
      update(data => {
        const entry = data.models[key(base, name)];
        if (!entry || entry.preexisting || typeof digest !== "string" || !digest) return;
        entry.state = "complete"; entry.digest = digest; entry.completedAt = new Date().toISOString();
      });
    },
    ownsModel(base, name, digest) {
      try { const entry = read().models[key(base, name)]; return Boolean(entry && !entry.preexisting && entry.storeHint === (process.env.OLLAMA_MODELS || null) && entry.state === "complete" && digest && entry.digest === digest); }
      catch { return false; }
    },
    forgetModel(base, name) { update(data => { delete data.models[key(base, name)]; }); },
    beginRuntime(platform) { update(data => { if (!data.runtime) data.runtime = { platform, state: "installing", startedAt: new Date().toISOString() }; }); },
    completeRuntime(executable) { update(data => { if (data.runtime?.state === "installing") data.runtime = { ...data.runtime, state: "complete", executable, completedAt: new Date().toISOString() }; }); },
  };
}
module.exports = { ownership, canonical };
