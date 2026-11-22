import assert from "node:assert/strict";
const { it } = process.env.VITEST ? await import("vitest") : await import("node:test");
import { key, wavInfo, portsFor, pressTalk } from "./n05-windows.mjs";
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

async function keyboardEvents(name: string) {
  const events: unknown[] = [];
  await key({
    call(method: string, event: unknown) {
      assert.equal(method, "Input.dispatchKeyEvent");
      events.push(event);
      return {};
    }
  }, name);
  return events;
}

it("sends a carriage return on Enter keyDown to activate a focused submit button", async () => {
  const enter = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  assert.deepEqual(await keyboardEvents("Enter"), [
    { ...enter, type: "keyDown", text: "\r" },
    { ...enter, type: "keyUp" }
  ]);
});

it("keeps Tab and Space as raw key presses", async () => {
  for (const event of [
    { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
    { key: " ", code: "Space", windowsVirtualKeyCode: 32 }
  ]) {
    assert.deepEqual(await keyboardEvents(event.code), [
      { ...event, type: "rawKeyDown" },
      { ...event, type: "keyUp" }
    ]);
  }
});

it("presses Talk only for the foreground launch and its focused daily document", async () => {
  const launch = { pid: 10, hwnd: "200" };
  const presses: string[] = [];
  let documentFocused = true;
  const page = {
    evaluate: (expression: string) => expression === "document.hasFocus()" ? documentFocused : true,
    call: (_method: string, event: { type: string; key: string }) => {
      if (event.type === "keyDown") presses.push(event.key);
      return {};
    }
  };
  const granted = { foregroundPid: 10, foregroundHwnd: "200" };
  for (const other of [{ ...granted, foregroundPid: 11 }, { ...granted, foregroundHwnd: "201" }]) {
    await assert.rejects(pressTalk(page, launch, () => other), /Windows did not foreground/);
  }
  documentFocused = false;
  await assert.rejects(pressTalk(page, launch, () => ({ ...granted })), /document focus before Talk/);
  assert.deepEqual(presses, []);
  documentFocused = true;
  await pressTalk(page, launch, () => ({ ...granted }));
  assert.deepEqual(presses, ["Enter"]);
  assert.deepEqual(launch, { pid: 10, hwnd: "200", talkFocus: { ...granted, documentFocused: true } });
});
