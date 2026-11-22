import assert from "node:assert/strict";
const { it } = process.env.VITEST ? await import("vitest") : await import("node:test");
import { wavInfo, portsFor } from "./n05-windows.mjs";
it("requires four independent non-default ports", () => {
  const ports = [52451,52452,52453,52454];
  assert.deepEqual(portsFor(ports),ports);
  for (const value of [4747,4748,11434,52452,0]) assert.throws(() => portsFor([value,...ports.slice(1)]));
});
it("verifies actual WAV format and frame count before paced playback", () => {
  const wav = Buffer.alloc(3244);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length-8,4); wav.write("WAVEfmt ",8); wav.writeUInt32LE(16,16);
  wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(16000,24); wav.writeUInt16LE(16,34);
  wav.write("data",36); wav.writeUInt32LE(3200,40);
  assert.equal(wavInfo(wav).samples,1600);
  wav.writeUInt16LE(2,22);
  assert.throws(() => wavInfo(wav));
});
