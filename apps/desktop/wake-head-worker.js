// Both detectors share one serial utility process; one native thread per model.
const { createEmbedding, createStream, background, enrol } = require("./wake-head");
const port = process.parentPort;
let embedding, stream, spotter;
let queue = Promise.resolve();
port.on("message", ({ data: m }) => {
  queue = queue.then(async () => {
    if (m.type === "init") { embedding = await createEmbedding(m.dir); if (m.profile) { stream = createStream(embedding, m.profile); spotter = require("./wake-worker").createSpotter(m.dir, require("node:path").join(m.dir,"keywords.txt")); } return { type: "ready" }; }
    if (m.type === "reset") { stream?.reset(); spotter?.reset(); return { type: "reset" }; }
    if (m.type === "train") return { profile: await enrol(embedding, m.recordings, background(m.background, true), m.negatives) };
    if (m.type === "feed") { const start = performance.now(); const k = spotter.feed(m); return { ...k, score: await stream.feed(m.samples), at: m.at, ms: performance.now() - start }; }
    throw new Error("Unknown wake worker request");
  }).then((result) => port.postMessage({ id: m.id, ...result }), (e) => port.postMessage({ id: m.id, error: String(e.message || e) }));
});
