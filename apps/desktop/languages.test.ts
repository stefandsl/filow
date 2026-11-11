import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { LANG_LABELS, LANGS } from "@filow/core";

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

// "The UI language picker must offer all five wherever it offers two today."
it("offers every interface language in the welcome, both as first choice and under More options", () => {
  const html = read("./welcome.html");
  for (const lang of LANGS) {
    expect(html, `radio ${lang}`).toContain(`<input type="radio" name="lang" value="${lang}"><span lang="${lang}">${LANG_LABELS[lang]}</span>`);
    expect(html, `option ${lang}`).toContain(`<option value="${lang}" lang="${lang}">${LANG_LABELS[lang]}</option>`);
  }
});

it("builds the pickers of the web app, the PowerPoint pane and the browser extension from the shared list", () => {
  for (const file of ["../web/components/LangSwitch.tsx", "../powerpoint/src/taskpane.tsx", "../browser/src/sidepanel.tsx"]) {
    expect(read(file), file).toMatch(/LANGS\.map\(\(?l\)? => <option key=\{l\} value=\{l\} lang=\{l\}>\{LANG_LABELS\[l\]\}<\/option>\)/);
  }
});
