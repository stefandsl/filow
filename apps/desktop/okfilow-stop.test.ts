import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { answering, overlayMouse, seeChoice, wordsOnlyList } = require("./okfilow-stop.js");
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const source = (name: string) => fs.readFileSync(path.join(here, name), "utf8");

describe("stopping an answer (desktop shell)", () => {
  it("an answer is in progress while OK Filow is thinking or speaking, at no other time", () => {
    expect(["idle", "listening", "thinking", "speaking", "error"].filter((m) => answering(m))).toEqual(["thinking", "speaking"]);
  });

  it("the overlay stays click-through, except for the Stop button during an answer and the highlighter", () => {
    // idle, listening, or an answer in progress with the pointer elsewhere: clicks go through
    for (const mode of ["idle", "listening", "thinking", "speaking", "error"]) expect(overlayMouse({ caught: false, hover: false, mode })).toEqual({ ignore: true });
    // the pointer is on the button: this overlay takes the click
    expect(overlayMouse({ caught: false, hover: true, mode: "thinking" })).toEqual({ ignore: false });
    expect(overlayMouse({ caught: false, hover: true, mode: "speaking" })).toEqual({ ignore: false });
    // a hover left over from an answer that ended must not swallow the user's clicks
    expect(overlayMouse({ caught: false, hover: true, mode: "idle" })).toEqual({ ignore: true });
    // the talk keys are held: the overlay takes the mouse for the highlighter, as before
    expect(overlayMouse({ caught: true, hover: false, mode: "listening" })).toEqual({ ignore: false });
  });

  it('"Look at my screen" is on, off, or not chosen yet', () => {
    expect(seeChoice("on")).toBe("on");
    expect(seeChoice("off")).toBe("off");
    expect(seeChoice("auto")).toBe("auto");
    for (const v of [undefined, null, true, "yes", 1]) expect(seeChoice(v)).toBe("auto");
    // whose yes was given to the words-only notice: plain recipient ids, nothing else is stored
    expect(wordsOnlyList(["openrouter/google", "openrouter/google", 7, "", null, "freellm"])).toEqual(["openrouter/google", "freellm"]);
    expect(wordsOnlyList("openrouter/google")).toEqual([]);
    expect(wordsOnlyList(Array.from({ length: 30 }, (_, i) => "r" + i))).toHaveLength(20);
  });

  it("the shell wires them: Escape stops an answer before it wipes drawings, the panel is told, the setting is stored and the file ships", () => {
    const main = source("okfilow.js");
    expect(main).toMatch(/function onEscape\(\) \{\s*for \(const step of escapePlan\(mode\)\) \{\s*if \(step === "stop"\) stopAnswer\("escape"\);/);
    expect(main).toContain("if (e.keycode === K.Escape) onEscape();");
    expect(main).toContain('sendPanel("okfilow:stop", { source });');
    expect(main).toMatch(/function stopAnswer\(source\) \{\s*if \(!answering\(mode\)\) return false;/);
    expect(main).toContain("next.seeScreen = seeChoice(next.seeScreen);");
    expect(require("./okfilow.js").DEFAULTS.seeScreen).toBe("auto");
    // an overlay that loads after the question began still learns whether the question took the screen
    expect(main).toContain('if (typeof extra.sees === "boolean") asksSee = extra.sees;');
    expect(main.match(/sees: asksSee \}\);/g)).toHaveLength(2);
    // "Look at my screen" off: the screen is not captured at all
    expect(main).toMatch(/const wantImages = mayCapture\(want\);[\s\S]{0,1600}await screenSources\(want, async \(\) => \{[\s\S]{0,200}desktopCapturer\.getSources/);
    expect(main).toContain('if (wantImages && !out.images.length) throw');
    const preload = source("okfilow-preload.js");
    expect(preload).toContain('onStop: on("okfilow:stop")');
    expect(preload).toContain('ipcRenderer.send("okfilow:stopAnswer", source)');
    expect(JSON.parse(source("package.json")).build.files).toContain("okfilow-stop.js");
  });
});
