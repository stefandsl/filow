import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// FILOW_QA_HEADLESS (qa-headless.js) only works if every window, tray icon and message box of the shell
// goes through its helpers. A new `win.show()` or a plain `dialog.showMessageBox` would put something
// on the screens of the person using the PC during a measured run: this fails first.
const source = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
/** The code without comments, so a sentence about `.show()` does not count. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

describe("FILOW_QA_HEADLESS wiring in main.js and okfilow.js", () => {
  for (const file of ["main.js", "okfilow.js"]) {
    it(`${file}: no window, notification or tray is shown except through the helpers`, () => {
      const c = code(source(file));
      const shows = [...c.matchAll(/[\w\]).?]+\.show(Inactive)?\(/g)].map((m) => m[0]);
      // the welcome's controller is not a window: it shows the welcome window through showWindow
      // (practiceState.show draws the tour's practice mark on the overlays, which showOverlays shows through showWindow)
      expect(shows.filter((s) => s !== "welcomeController.show(" && s !== "practiceState.show(")).toEqual([]);
      expect(c).not.toMatch(/new\s+Tray\s*\(/);
    });
  }

  it("main.js: every message box goes through dialogFor, and the switch is refused in a released build before anything starts", () => {
    const c = code(source("main.js"));
    expect(c).toMatch(/\bdialog: electronDialog\b/);
    expect(c).toMatch(/const dialog = dialogFor\(electronDialog\);/);
    // no other way to Electron's own dialog object
    expect(c).not.toMatch(/require\("electron"\)\.dialog\b/);
    // the one other handle on it (dictation's): destructured once, handed on only wrapped
    for (const m of c.matchAll(/\bdialog: (\w+)/g)) expect(["electronDialog", "dlg", "dialogFor"]).toContain(m[1]);
    expect(c.match(/\bdialog: dlg\b/g)).toHaveLength(1);
    expect(c).toContain("dialog: dialogFor(dlg),");
    expect(c).not.toMatch(/\bdlg\.show/);
    const refused = c.indexOf("qaHeadless.refusedInRelease(");
    expect(refused).toBeGreaterThan(0);
    expect(refused).toBeLessThan(c.indexOf('app.setPath("userData"'));
    expect(c).toMatch(/const showAtStart = \(w, name = "main window"\) => showWindow\(w, name, INPUT_OFF\);/);
    expect(c).toMatch(/if \(HEADLESS\) logLine\(qaHeadless\.HEADLESS_LINE\);/);
  });

  it("okfilow.js: no message box at all, the tray through trayFor, and the synthetic screen before any real capture", () => {
    const c = code(source("okfilow.js"));
    expect(c).not.toMatch(/showMessageBox/);
    expect(c).toMatch(/const TrayClass = trayFor\(Tray\);\s*tray = new TrayClass\(img\);/);
    const capture = c.slice(c.indexOf("async function capture("));
    expect(capture.indexOf("if (qaScreen)")).toBeGreaterThan(0);
    expect(capture.indexOf("if (qaScreen)")).toBeLessThan(capture.indexOf("screen.getAllDisplays()"));
    expect(capture.indexOf("if (qaScreen)")).toBeLessThan(capture.indexOf("desktopCapturer.getSources"));
  });

  it("main.js keeps the test switches of the speed baseline out of a released build", () => {
    const c = code(source("main.js"));
    expect(c).toMatch(/if \(!require\("\.\/qa\.js"\)\.isQaBuild\(app\)\) for \(const k of \["FILOW_OKF_QA_SCREEN", "FILOW_QA_HARDWARE"\]\) delete process\.env\[k\];/);
  });
});
