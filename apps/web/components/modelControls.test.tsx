// The controls of a model row: "Stop" next to a download's percent, "in use" next to "installed",
// "Delete" with one question. Rendered as the page renders them; the handlers are called as a click would.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "@filow/core";
import { LangProvider } from "@filow/ui";
import type { SherpaStatus } from "@filow/stt";
import { DeviceModelRows, InUseChip, StopButton } from "./ModelControls";
import { SherpaLanguageNote } from "./SherpaLanguageNote";
import { SetupPicker } from "@/app/settings/local/SetupPicker";
import type { DeviceModels, UseContext } from "@/lib/modelUse";

const html = (node: ReactElement, lang: "en" | "it" | "ru" | "ro" | "ja" = "en") => renderToStaticMarkup(<LangProvider lang={lang}>{node}</LangProvider>);
const plain = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
/** Finds the element with this data-testid and gives its props (the handlers a click would call). */
function find(node: unknown, testid: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!n || typeof n !== "object") return;
    const el = n as { type?: unknown; props?: Record<string, unknown> };
    if (!el.props) return;
    if (el.props["data-testid"] === testid) out.push(el.props);
    if (typeof el.type === "function") return walk((el.type as (p: unknown) => unknown)(el.props));
    walk(el.props.children);
  };
  walk(node);
  return out;
}

/**
 * Runs fn while React renders (no DOM library in this repo): components that use hooks can then be
 * called as plain functions and their element tree searched for the handlers.
 */
function inRender<T>(fn: () => T): T {
  let out!: T;
  const Probe = () => { out = fn(); return null; };
  html(<Probe />);
  return out;
}

const ctx: UseContext = {
  plan: { stt: { backend: "sherpa" }, decision: { provider: "matcher" }, generate: { provider: "none", model: null } },
  startMode: "auto", decisionPref: "", okFilow: { enabled: true, provider: "local", offline: false }, translateWhere: "local", gateMode: "off", whisperModel: "", picks: null,
};
const data: DeviceModels = {
  downloading: ["cleanup"],
  models: [
    { id: "speech:nemotron", kind: "speech", name: "Nemotron 3.5 streaming", installed: true, bytes: 475271763, loaded: true, uses: [{ use: "tracking", language: "auto" }, { use: "dictation", language: "it" }] },
    { id: "speech:vosk-small-ru", kind: "speech", name: "Vosk small Russian streaming", installed: true, bytes: 24110855, loaded: false, uses: [] },
    // downloading right now: its percent and Stop are in the Dictation section, where it was started
    { id: "cleanup", kind: "cleanup", name: "S1-mini by Superwhisper", installed: false, bytes: 30 * 1024 * 1024, loaded: false, uses: [], downloading: true },
    // left unfinished by an earlier run: nothing is downloading it
    { id: "voice", kind: "voice", name: "Supertonic 3", installed: false, bytes: 62 * 1024 * 1024, loaded: false, uses: [], downloading: false },
  ],
};

describe("StopButton", () => {
  it("is a real button with the model's name in its accessible name, and calls onStop", () => {
    const onStop = vi.fn();
    const markup = html(<StopButton name="Nemotron 3.5 streaming" onStop={onStop} />);
    expect(markup).toMatch(/^<button type="button" class="btn stop-download"/);
    expect(markup).toContain('aria-label="Stop the download: Nemotron 3.5 streaming"');
    expect(markup).toContain(`title="${t("settings.stopHint", "en")}"`);
    expect(plain(markup)).toBe("Stop");
    expect(markup).not.toMatch(/tabindex="-1"|disabled/);
    // rendered without the provider it still works; the click handler is the one handed in
    const el = inRender(() => StopButton({ name: "x", onStop }) as ReactElement<{ onClick(): void }>);
    el.props.onClick();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("speaks the user's language", () => {
    expect(html(<StopButton name="X" onStop={() => {}} />, "it")).toContain('aria-label="Ferma il download: X"');
    expect(plain(html(<StopButton name="X" onStop={() => {}} />, "ja"))).toBe("停止");
  });
});

describe("InUseChip", () => {
  it("says what the model is in use for, and renders nothing for a model that is only installed", () => {
    const markup = html(<InUseChip uses={[{ use: "tracking", language: "auto" }, { use: "dictation", language: "it" }]} />);
    expect(markup).toBe('<span class="chip inuse" data-testid="in-use">in use: following a talk, dictation (Italiano)</span>');
    expect(html(<InUseChip uses={[]} />)).toBe("");
  });
});

describe("the list of models on this computer", () => {
  const render = (over: Partial<Parameters<typeof DeviceModelRows>[0]> = {}) => <DeviceModelRows data={data} ctx={ctx} busy={null} notice={null} onDelete={() => {}} {...over} />;

  it("two speech models installed, one in use: the badge is on that one only; size and 'loaded' are shown", () => {
    const markup = html(render());
    const rows = markup.split('<div class="model"').slice(1);
    expect(rows).toHaveLength(3);
    expect(plain(rows[0])).toContain("Nemotron 3.5 streaming Speech recognition installed in use: following a talk, dictation (Italiano) 453 MB loaded in memory");
    expect(rows[1]).toContain('<span class="chip live">installed</span>');
    expect(rows[1]).not.toContain("in use");
    expect(plain(rows[1])).toContain("23 MB");
    expect(plain(rows[1])).not.toContain("loaded in memory");
  });

  it("a cloud take drops 'following a talk' from the badge", () => {
    const rows = html(render({ ctx: { ...ctx, startMode: "cloud" } })).split('<div class="model"').slice(1);
    expect(plain(rows[0])).toContain("in use: dictation (Italiano)");
    expect(plain(rows[0])).not.toContain("following a talk");
  });

  it("a download in flight is not listed (no row appears above the button that started it); one left unfinished is, with Delete", () => {
    const markup = html(render());
    const rows = markup.split('<div class="model"').slice(1);
    expect(markup).not.toContain("S1-mini by Superwhisper");
    expect(markup).not.toContain('data-model="cleanup"');
    expect(rows[0]).toContain('data-testid="delete-model"');
    expect(rows[0]).toContain('aria-label="Delete Nemotron 3.5 streaming"');
    expect(rows[2]).toContain('data-model="voice"');
    expect(rows[2]).toContain('aria-label="Delete Supertonic 3"');
    expect(rows[2]).not.toContain("chip live");
    expect(plain(rows[2])).toContain("Supertonic 3 Natural voice unfinished download 62 MB");
    // once the download is done the model is listed like any other
    const done = html(render({ data: { ...data, models: data.models.map((m) => (m.id === "cleanup" ? { ...m, installed: true, downloading: false } : m)) } }));
    expect(done).toContain('data-model="cleanup"');
  });

  it("Delete calls the handler with the row's model", () => {
    const onDelete = vi.fn();
    const deletes = inRender(() => find(DeviceModelRows({ data, ctx, busy: null, notice: null, onDelete }), "delete-model"));
    expect(deletes).toHaveLength(3);
    (deletes[1].onClick as () => void)();
    expect(onDelete).toHaveBeenCalledWith(data.models[1]);
    (deletes[2].onClick as () => void)();
    expect(onDelete).toHaveBeenLastCalledWith(data.models[3]);
  });

  it("the row being deleted has its button disabled; the result is announced in a line that is always there", () => {
    const busy = html(render({ busy: "speech:vosk-small-ru" })).split('<div class="model"').slice(1);
    expect(busy[1]).toMatch(/data-testid="delete-model" disabled=""/);
    expect(busy[0]).not.toMatch(/data-testid="delete-model" disabled/);
    expect(html(render())).toContain('<div class="hint device-notice" role="status" data-testid="device-notice"></div>');
    const done = html(render({ notice: { kind: "freed", text: t("settings.freed", "en", { name: "Vosk small Russian streaming", size: "23 MB" }) } }));
    expect(done).toContain('role="status" data-testid="device-notice">Vosk small Russian streaming deleted: 23 MB freed.</div>');
    expect(html(render({ notice: { kind: "failed", text: "x" } }))).toContain('class="hint device-notice failed"');
  });

  it("nothing downloaded: says so", () => {
    expect(plain(html(render({ data: { models: [], downloading: [] } })))).toContain(t("settings.onThisPcNone", "en"));
  });
});

describe("Stop where a download's progress is shown", () => {
  afterEach(() => { delete (globalThis as { filow?: unknown }).filow; });
  const sherpa = (state: "downloading" | "missing"): SherpaStatus => ({
    model: "ready", pct: 100, running: false, language: "it", wanted: "nemotron", wantedLabel: "Nemotron 3.5 streaming", wantedStreaming: true, downloadBytes: 0, usable: true, active: "nemotron", activeLabel: "Nemotron 3.5 streaming", streaming: true, notes: [],
    questions: { wanted: "parakeet-v3", wantedLabel: "Parakeet TDT 0.6b v3", state, pct: 4, downloadBytes: 487211443, usable: true, active: "nemotron", notes: ["fallback"] },
  });

  it("the questions model: Stop appears next to the percent while it downloads, and stops the speech download", () => {
    const cancel = vi.fn(async () => ({ ok: true, stopped: true }));
    (globalThis as { filow?: unknown }).filow = { models: { cancel } };
    const busy = html(<SherpaLanguageNote s={sherpa("downloading")} />);
    expect(busy).toContain('<span class="dl-pct">4%</span>');
    expect(busy).toContain('aria-label="Stop the download: Parakeet TDT 0.6b v3"');
    expect(html(<SherpaLanguageNote s={sherpa("missing")} />)).not.toContain("stop-download");
    const stops = inRender(() => find(SherpaLanguageNote({ s: sherpa("downloading") }), "stop-download"));
    (stops[0].onClick as () => void)();
    expect(cancel).toHaveBeenCalledWith("speech");
  });

  it("an older desktop build without the models bridge shows no Stop it could not honour", () => {
    expect(html(<SherpaLanguageNote s={sherpa("downloading")} />)).not.toContain("stop-download");
  });

  it("the setup picker: Stop next to the S1-mini percent", () => {
    const onStopCleanup = vi.fn();
    const hardware = { ramGb: 32, cores: 16, gpu: { kind: "discrete" as const, vramGb: 16 }, freeDiskGb: 400 };
    const picker = (cleanup: { runtime: boolean; model: boolean; downloading: boolean; pct: number }, stop?: () => void) =>
      html(<SetupPicker hardware={hardware} gpuName="" preference="auto" onChange={() => {}} installed={{ ollama: [], sherpa: false }} onGet={() => {}} cleanup={cleanup} onStopCleanup={stop} />);
    const busy = picker({ runtime: true, model: false, downloading: true, pct: 7 }, onStopCleanup);
    expect(busy).toContain('data-cleanup-model="downloading"');
    expect(busy).toContain('aria-label="Stop the download: S1-mini by Superwhisper"');
    expect(picker({ runtime: true, model: false, downloading: false, pct: 0 }, onStopCleanup)).not.toContain("stop-download");
    expect(picker({ runtime: true, model: false, downloading: true, pct: 7 })).not.toContain("stop-download");
  });
});
