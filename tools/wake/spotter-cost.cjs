// Compare old and current keyword lists against exactly the same 100 ms frames.
const fs = require("node:fs");
const path = require("node:path");
const { createSpotter } = require("../../apps/desktop/wake-worker");
const { readSample } = require("../../apps/desktop/wake-pcm");
const [models, speech, ...lists] = process.argv.slice(2);
const audio = readSample(speech).subarray(0, 60 * 16000);
for (const file of lists) {
  const spotter = createSpotter(models, file), times = [];
  for (let pass = 0; pass < 2; pass++) {
    spotter.reset();
    for (let i = 0; i < audio.length; i += 1600) {
      const event = spotter.feed({ samples: audio.subarray(i, i + 1600), at: (i + 1600) / 16 });
      if (pass) times.push(event.ms);
    }
  }
  times.sort((a, b) => a - b);
  console.log(JSON.stringify({ list: path.basename(file), keywords: fs.readFileSync(file, "utf8").trim().split(/\r?\n/).length,
    blocks: times.length, p50ms: times[Math.floor(times.length * .5)], p95ms: times[Math.floor(times.length * .95)], maxMs: times.at(-1) }));
}
