import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { answering, overlayMouse, seeChoice } = require("./okfilow-stop.js");
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const source = (name: string) => fs.readFileSync(path.join(here, name), "utf8");

describe("stopping an answer (desktop shell)", () => {
  it("an answer is in progress while OK Filow is thinking or speaking, at no other time", () => {
    expect(["idle", "listening", "thinking", "speaking", "error"].filter((m) => answering(m))).toEqual(["thinking", "speaking"]);
  });

  it("the overlay stays click-through, except for the Stop button during an answer and the highlighter", () => {
    // idle or listening: clicks go through and no mouse moves are forwarded
    expect(overlayMouse({ caught: false, hover: false, mode: "idle" })).toEqual({ ignore: true, forward: false });
    expect(overlayMouse({ caught: false, hover: false, mode: "listening" })).toEqual({ ignore: true, forward: false });
    // an answer in progress: still click-through, but the page hears the pointer so it can find the button
    expect(overlayMouse({ caught: false, hover: false, mode: "thinking" })).toEqual({ ignore: true, forward: true });
    expect(overlayMouse({ caught: false, hover: false, mode: "speaking" })).toEqual({ ignore: true, forward: true });
    // the pointer is on the button: this overlay takes the click
    expect(overlayMouse({ caught: false, hover: true, mode: "speaking" })).toEqual({ ignore: false, forward: false });
    // a hover left over from an answer that ended must not swallow the user's clicks
    expect(overlayMouse({ caught: false, hover: true, mode: "idle" })).toEqual({ ignore: true, forward: false });
    // the talk keys are held: the overlay takes the mouse for the highlighter, as before
    expect(overlayMouse({ caught: true, hover: false, mode: "listening" })).toEqual({ ignore: false, forward: false });
  });

  it('"Look at my screen" is on, off, or not chosen yet', () => {
    expect(seeChoice("on")).toBe("on");
    expect(seeChoice("off")).toBe("off");
    expect(seeChoice("auto")).toBe("auto");
    for (const v of [undefined, null, true, "yes", 1]) expect(seeChoice(v)).toBe("auto");
  });

  it("the shell wires them: Escape stops an answer before it wipes drawings, the panel is told, the setting is stored and the file ships", () => {
    const main = source("okfilow.js");
    expect(main).toMatch(/function onEscape\(\) \{\s*if \(!stopAnswer\("escape"\)\) clearDrawings\(\);/);
    expect(main).toContain("if (e.keycode === K.Escape) onEscape();");
    expect(main).toContain('sendPanel("okfilow:stop", { source });');
    expect(main).toMatch(/function stopAnswer\(source\) \{\s*if \(!answering\(mode\)\) return false;/);
    expect(main).toContain("next.seeScreen = seeChoice(next.seeScreen);");
    expect(require("./okfilow.js").DEFAULTS.seeScreen).toBe("auto");
    // "Look at my screen" off: the screen is not captured at all
    expect(main).toMatch(/const wantImages = opts\.images !== false;[\s\S]{0,400}if \(wantImages\) \{[\s\S]{0,200}desktopCapturer\.getSources/);
    expect(main).toContain('if (wantImages && !out.images.length) throw');
    const preload = source("okfilow-preload.js");
    expect(preload).toContain('onStop: on("okfilow:stop")');
    expect(preload).toContain('ipcRenderer.send("okfilow:stopAnswer", source)');
    expect(JSON.parse(source("package.json")).build.files).toContain("okfilow-stop.js");
  });
});
