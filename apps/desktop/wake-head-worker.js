// Utility process, never the sherpa worker process. Serial queue, one inference thread.
const { createEmbedding, createStream, background, enrol } = require("./wake-head");
const port = process.parentPort;
let embedding, stream;
let queue = Promise.resolve();
port.on("message", ({ data: m }) => {
  queue = queue.then(async () => {
    if (m.type === "init") { embedding = await createEmbedding(m.dir); if (m.profile) stream = createStream(embedding, m.profile); return { type: "ready" }; }
    if (m.type === "reset") { stream?.reset(); return { type: "reset" }; }
    if (m.type === "train") return { profile: await enrol(embedding, m.recordings, background(m.background)) };
    if (m.type === "feed") { const start = performance.now(); return { score: await stream.feed(m.samples), at: m.at, ms: performance.now() - start }; }
    throw new Error("Unknown wake worker request");
  }).then((result) => port.postMessage({ id: m.id, ...result }), (e) => port.postMessage({ id: m.id, error: String(e.message || e) }));
});
