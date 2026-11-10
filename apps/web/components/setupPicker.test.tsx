import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { t, type MachineInfo, type SetupPreference } from "@filow/core";
import { LangProvider } from "@filow/ui";
import { SetupPicker } from "@/app/settings/local/SetupPicker";

// Review T2 finding 8: the setup picker had no test
const render = (hardware: MachineInfo, preference: SetupPreference = "auto", installed = { ollama: [] as string[], sherpa: false }, gpuName = "") =>
  renderToStaticMarkup(
    <LangProvider lang="en">
      <SetupPicker hardware={hardware} gpuName={gpuName} preference={preference} onChange={() => {}} installed={installed} onGet={() => {}} />
    </LangProvider>,
  );
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");

const oldLaptop: MachineInfo = { ramGb: 8, cores: 4, gpu: { kind: "none", vramGb: null }, freeDiskGb: 40 };
const rtx8: MachineInfo = { ramGb: 32, cores: 16, gpu: { kind: "discrete", vramGb: 8 }, freeDiskGb: 400 };
const rtx16: MachineInfo = { ramGb: 32, cores: 16, gpu: { kind: "discrete", vramGb: 16 }, freeDiskGb: 400 };

describe("SetupPicker", () => {
  it("one native radio group (arrow keys, a named group), Automatic names what it picks", () => {
    const html = render(oldLaptop);
    expect(html.match(/type="radio"/g)).toHaveLength(4);
    expect(html).toContain("<fieldset");
    expect(html).toContain(`<legend class="sr-only">${t("setup.groupLabel", "en")}</legend>`);
    expect(html.match(/aria-describedby="/g)).toHaveLength(4);
    expect(plain(html)).toContain(t("setup.autoIs", "en", { name: t("setup.lite", "en") }));
    expect(html).toMatch(/<input type="radio"[^>]*value="auto" checked=""|<input type="radio"[^>]*checked=""[^>]*value="auto"/);
  });

  it("a pinned choice is the checked one, and a heavier one says it may be slow", () => {
    const html = plain(render(oldLaptop, "advanced"));
    expect(render(oldLaptop, "advanced")).toMatch(/<input type="radio"[^>]*value="advanced" checked=""|<input type="radio"[^>]*checked=""[^>]*value="advanced"/);
    expect(html).toContain(t("setup.heavier", "en", { name: t("setup.lite", "en") }));
  });

  it("Best quality on an 8 GB card says screen answers can take minutes; from 12 GB, about a second", () => {
    expect(plain(render(rtx8))).toContain(t("setup.advanced.descShared", "en"));
    expect(plain(render(rtx8))).not.toContain(t("setup.advanced.desc", "en"));
    expect(plain(render(rtx16))).toContain(t("setup.advanced.desc", "en"));
  });

  it("lists the downloads in plain words, never model names", () => {
    const html = plain(render(rtx16, "auto", { ollama: [], sherpa: false }));
    expect(html).toContain(t("setup.model.clef-flash", "en"));
    expect(html).not.toMatch(/Clef Flash|qwen|lfm|nemotron/i);
    expect(plain(render(rtx16, "auto", { ollama: ["clef-flash:latest", "qwen3-vl:2b"], sherpa: true }))).toContain(t("setup.ready", "en"));
  });

  it("too little free disk: says how much Best quality needs, and that OK Filow's answers do not fit", () => {
    const html = plain(render({ ...rtx16, freeDiskGb: 5 }));
    expect(html).toContain(t("setup.why.low-disk", "en", { disk: 5, need: 17 }));
    expect(html).toContain(t("setup.screen.noDisk", "en"));
    expect(plain(render({ ...rtx16, freeDiskGb: 50 }))).not.toContain(t("setup.screen.noDisk", "en"));
  });

  it("an old laptop under 6 GB is told OK Filow has no local answers here", () => {
    expect(plain(render({ ...oldLaptop, ramGb: 4, cores: 2 }))).toContain(t("setup.lite.descNone", "en"));
  });
});
