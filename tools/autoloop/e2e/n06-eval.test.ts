import assert from "node:assert/strict";
import { hash, score, splitAlbums, wilson } from "./n06-eval.mjs";
import { calibrate, classify } from "./n06-classifier.mjs";
const { it } = process.env.VITEST ? await import("vitest") : await import("node:test");

const albums = ["en","it","ja","ro","ru"].flatMap(language => [0,1,2,3].map(n => ({
  language, speaker: language+n, album: language+n, split: n ? "heldout" : "development",
  tasks: ["Deliver the green poster", "Pick up the parcel"],
  cases: [1,2,1,null,null].map((expected,i) => ({ text: ["Delivered the green poster","Picked up the parcel","Green poster delivered","Unrelated","No report"][i],
    expected, kind: expected ? "clear" : "no_match" }))
})));
const bytes = Buffer.from(JSON.stringify({ albums }));
it("freezes all 100 reports and rejects cross-split reuse or changed bytes", () => {
  const split = splitAlbums(bytes, hash(bytes));
  assert.equal(split.held.length, 75);
  const calibration = calibrate(split.development);
  assert.equal(classify(split.held[0].input, calibration).id, "1");
  assert.throws(() => splitAlbums(Buffer.concat([bytes, Buffer.from(" ")]), hash(bytes)));
  const bad = structuredClone(albums);
  bad[1].speaker = bad[0].speaker;
  const overlap = Buffer.from(JSON.stringify({ albums: bad }));
  assert.throws(() => splitAlbums(overlap, hash(overlap)), /speaker/);
  assert.throws(() => calibrate(albums));
});
it("retains missed clear reports and keeps all language denominators independent", () => {
  const { held } = splitAlbums(bytes, hash(bytes));
  const predictions = held.map(r => ({ key:r.key, inputHash:hash(JSON.stringify(r.input)),
    prediction:r.expected ? { action:"complete", id:r.expected } : { action:"abstain" } }));
  predictions[0].prediction = { action:"clarify" };
  predictions[1].prediction = { action:"abstain" };
  const [en,it] = score(held,predictions);
  assert.deepEqual([en.clear,en.correct,en.clarification,en.qualified], [9,7,1,false]);
  assert.deepEqual([it.negative,it.falseTicks,it.correct,it.qualified], [6,0,9,true]);
  assert.ok(en.intervals.correct[0] < 7/9 && en.intervals.correct[1] > 7/9);
  assert.equal(wilson(0,0),null);
  assert.throws(() => score(held,predictions.slice(1)));
  assert.throws(() => score(held,[...predictions.slice(1),predictions[1]]));
  predictions[3].prediction = { action:"complete", id:"1" };
  assert.equal(score(held,predictions)[0].falseTicks,1);
});
