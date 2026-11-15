// A settings change in the panel (the voice, the online model's yes) must reach an open whiteboard
// at once, as it reaches the panel and the overlays. feat-board-library committed the send inside the
// test-only qaShot() block, where a normal session never runs it, so the whiteboard kept the old voice
// (tools/whiteboard/video-voice.mjs: "no voice to record" failed). The end-to-end proof is that script.
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const src = fs.readFileSync(path.join(here, "okfilow.js"), "utf8").replace(/\r\n/g, "\n");

/** The body of `function <name>(`, up to the first closing brace at its own indentation. */
function body(name: string): string {
  const start = src.search(new RegExp(`\\n( *)function ${name}\\(`));
  expect(start, name).toBeGreaterThan(-1);
  const indent = /\n( *)/.exec(src.slice(start))![1];
  const end = src.indexOf(`\n${indent}}\n`, start + 1);
  return src.slice(start, end);
}

const BOARD_SEND = 'boardWin.webContents.send("okfilow:config", status())';

it("applyConfig sends the new settings to the whiteboard, beside the panel and the overlays", () => {
  const apply = body("applyConfig");
  expect(apply).toContain('sendPanel("okfilow:config", status())');
  expect(apply).toContain(BOARD_SEND);
});

it("the test-only screenshot code sends no settings", () => {
  expect(body("qaShot")).not.toContain("okfilow:config");
});
