// The eye as a button, Pause / Resume, and the two shortcut choices (docs/okfilow/PILL.md).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LANGS } from "@filow/core";
import { ANSWER_STATUSES, pillView, statusRoom, type PillState } from "@/lib/buddy/pill";
import { okfText } from "@/lib/buddy/text";
import { AnswerControls, EyeButton, KeyChoice, PauseButton, SeeScreenSwitch, Slot } from "./controls";

const t = okfText("en");
const render = (el: React.ReactElement) => renderToStaticMarkup(el);
/** Every handler of that name in the tree, in order, each with the test id of its element. */
function handlers(el: React.ReactElement, name: string): Array<{ id: string; fn: (...a: unknown[]) => void }> {
  const out: Array<{ id: string; fn: (...a: unknown[]) => void }> = [];
  const seen: unknown[] = [el];
  while (seen.length) {
    const n = seen.shift() as { type?: unknown; props?: Record<string, unknown> } | null;
    if (!n || typeof n !== "object" || !n.props) continue;
    if (typeof n.type === "function") { seen.unshift((n.type as (p: unknown) => unknown)(n.props)); continue; }
    if (typeof n.props[name] === "function") out.push({ id: String(n.props["data-testid"] ?? ""), fn: n.props[name] as (...a: unknown[]) => void });
    const kids = n.props.children;
    seen.unshift(...(Array.isArray(kids) ? kids : [kids]));
  }
  return out;
}
const KEY = "Ctrl + Alt + Shift + H";
const pill = (over: Partial<PillState> = {}): PillState => ({ sees: true, paused: false, resumable: false, ...over });

describe("a room for several labels", () => {
  it("holds every label, shows one, and hides the others from sight and from screen readers", () => {
    const html = render(<Slot show="b" labels={[{ key: "a", text: "Pause" }, { key: "b", text: "Resume" }]} />);
    expect(html).toBe('<span class="okf-slot"><span class="okf-slot-off" aria-hidden="true">Pause</span><span class="okf-slot-on">Resume</span></span>');
  });
});

describe("the eye as a button", () => {
  it("open: a pressed button named after what a click does, with the shortcut in its tooltip and the state in a word", () => {
    const html = render(<EyeButton open t={t} keyLabel={KEY} onToggle={() => {}} />);
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Stop looking at my screen"');
    expect(html).toContain(`title="Stop looking at my screen (${KEY})"`);
    expect(html).toContain('<span class="okf-slot-on">On</span>');
    expect(html).toContain('<span class="okf-slot-off" aria-hidden="true">Off</span>');
    // not struck through
    expect(html).not.toContain("M2.5 13.5 13.5 2.5");
    expect(html).not.toContain("okf-ctl--shut");
  });

  it("closed: not pressed, struck through, says Off, and a click would open it", () => {
    const html = render(<EyeButton open={false} t={t} keyLabel={KEY} onToggle={() => {}} />);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Look at my screen"');
    expect(html).toContain(`title="Look at my screen (${KEY})"`);
    expect(html).toContain('<span class="okf-slot-on">Off</span>');
    expect(html).toContain('<span class="okf-slot-off" aria-hidden="true">On</span>');
    expect(html).toContain("M2.5 13.5 13.5 2.5");
    expect(html).toContain("okf-ctl--shut");
  });

  it("a click toggles it, and without a shortcut the tooltip names none", () => {
    const onToggle = vi.fn();
    const el = <EyeButton open t={t} keyLabel="" onToggle={onToggle} />;
    const clicks = handlers(el, "onClick");
    expect(clicks.map((c) => c.id)).toEqual(["okf-eye"]);
    clicks[0].fn();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(render(el)).toContain('title="Stop looking at my screen"');
  });

  it("has its two names and its two words in every language", () => {
    for (const lang of LANGS) {
      const tt = okfText(lang);
      const open = render(<EyeButton open t={tt} keyLabel="" onToggle={() => {}} />);
      const shut = render(<EyeButton open={false} t={tt} keyLabel="" onToggle={() => {}} />);
      expect(open, lang).toContain(`aria-label="${tt("eyeClose")}"`);
      expect(shut, lang).toContain(`aria-label="${tt("seeScreen")}"`);
      expect(tt("eyeClose"), lang).not.toBe(tt("seeScreen"));
      expect(tt("seeStateOn"), lang).not.toBe(tt("seeStateOff"));
    }
  });
});

describe("Pause and Resume", () => {
  it("one button with room for both words: Pause while the answer goes on, Resume while it is paused", () => {
    const pause = render(<PauseButton state="pause" t={t} keyLabel="Ctrl + Alt + Shift + G" onPause={() => {}} onResume={() => {}} />);
    expect(pause).toContain('data-testid="okf-pause"');
    expect(pause).toContain('aria-label="Pause the answer"');
    expect(pause).toContain('title="Pause the answer (Ctrl + Alt + Shift + G)"');
    expect(pause).toContain('<span class="okf-slot-on">Pause</span><span class="okf-slot-off" aria-hidden="true">Resume</span>');
    const resume = render(<PauseButton state="resume" t={t} keyLabel="" onPause={() => {}} onResume={() => {}} />);
    expect(resume).toContain('data-testid="okf-resume"');
    expect(resume).toContain('aria-label="Carry on with the answer"');
    expect(resume).toContain('title="Carry on with the answer"');
    expect(resume).toContain('<span class="okf-slot-off" aria-hidden="true">Pause</span><span class="okf-slot-on">Resume</span>');
  });

  it("a click pauses in one state and resumes in the other", () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    handlers(<PauseButton state="pause" t={t} keyLabel="" onPause={onPause} onResume={onResume} />, "onClick")[0].fn();
    expect([onPause.mock.calls.length, onResume.mock.calls.length]).toEqual([1, 0]);
    handlers(<PauseButton state="resume" t={t} keyLabel="" onPause={onPause} onResume={onResume} />, "onClick")[0].fn();
    expect([onPause.mock.calls.length, onResume.mock.calls.length]).toEqual([1, 1]);
  });
});

describe("the controls of an answer", () => {
  const ids = (el: React.ReactElement) => handlers(el, "onClick").map((c) => c.id);
  const controls = (mode: "idle" | "thinking" | "speaking", p: PillState, stopped = false, onAction: (a: "pause" | "resume" | "stop") => void = () => {}) =>
    <AnswerControls pill view={pillView({ mode, stopped, pill: p })} t={t} pauseKey="" onAction={onAction} />;

  it("answering: Pause and Stop; paused: Resume and Stop; stopped: Resume only; idle: nothing at all", () => {
    expect(ids(controls("thinking", pill()))).toEqual(["okf-pause", "okf-stop"]);
    expect(ids(controls("speaking", pill()))).toEqual(["okf-pause", "okf-stop"]);
    expect(ids(controls("speaking", pill({ paused: true })))).toEqual(["okf-resume", "okf-stop"]);
    expect(ids(controls("idle", pill({ resumable: true }), true))).toEqual(["okf-resume"]);
    expect(render(controls("idle", pill()))).toBe("");
    expect(render(controls("idle", pill(), true))).toBe("");
  });

  it("each button asks for its own action", () => {
    const onAction = vi.fn();
    for (const c of handlers(controls("thinking", pill(), false, onAction), "onClick")) c.fn();
    for (const c of handlers(controls("thinking", pill({ paused: true }), false, onAction), "onClick")) c.fn();
    for (const c of handlers(controls("idle", pill({ resumable: true }), true, onAction), "onClick")) c.fn();
    expect(onAction.mock.calls.map((c) => c[0])).toEqual(["pause", "stop", "resume", "stop", "resume"]);
  });

  it("on the pill Stop names its key; on the panel's row the same controls come without it", () => {
    expect(render(controls("thinking", pill()))).toContain("<kbd>Esc</kbd>");
    expect(render(controls("thinking", pill()))).toContain("okf-ctls--pill");
    const row = render(<AnswerControls view={{ first: "pause", stop: true }} t={t} pauseKey="" onAction={() => {}} />);
    expect(row).not.toContain("<kbd>");
    expect(row).not.toContain("okf-ctls--pill");
    expect(row).toContain('data-testid="okf-pause"');
  });

  it("the statuses of an answer share one room, so the pill is as wide answering as paused", () => {
    for (const s of ANSWER_STATUSES) expect(statusRoom(s)).toEqual(ANSWER_STATUSES);
    expect(statusRoom("stopped")).toEqual(["stopped"]);
    expect(statusRoom("notchDictating")).toEqual(["notchDictating"]);
    // every status an answer in progress can show is in that room
    for (const mode of ["thinking", "speaking"] as const) {
      for (const sees of [true, false]) for (const paused of [true, false]) expect(ANSWER_STATUSES).toContain(pillView({ mode, pill: pill({ sees, paused }) }).status);
    }
  });
});

describe("choosing a shortcut", () => {
  const choices = ["ctrl+alt+shift+h", "ctrl+alt+shift+f7", "none"];
  it("lists the choices as people read them, the last one being no shortcut", () => {
    const html = render(<KeyChoice label="Open or close the eye" value="ctrl+alt+shift+h" choices={choices} state="ok" t={t} onChange={() => {}} />);
    expect(html).toContain("<span>Open or close the eye</span>");
    expect(html).toContain('<option value="ctrl+alt+shift+h" selected="">Ctrl + Alt + Shift + H</option>');
    expect(html).toContain('<option value="ctrl+alt+shift+f7">Ctrl + Alt + Shift + F7</option>');
    expect(html).toContain('<option value="none">No shortcut</option>');
    expect(html).not.toContain("okf-key-taken");
  });

  it("says so in plain words when Windows refused the key, and only then", () => {
    const taken = render(<KeyChoice label="x" value="ctrl+alt+shift+h" choices={choices} state="taken" t={t} onChange={() => {}} />);
    expect(taken).toContain('role="status"');
    expect(taken).toContain("Windows did not accept Ctrl + Alt + Shift + H: another app is already using it. Choose another one.");
    for (const state of ["ok", "none", "off", undefined]) expect(render(<KeyChoice label="x" value="none" choices={choices} state={state} t={t} onChange={() => {}} />)).not.toContain("okf-key-taken");
  });

  it("a choice is passed on", () => {
    const onChange = vi.fn();
    handlers(<KeyChoice label="x" value="none" choices={choices} t={t} onChange={onChange} />, "onChange")[0].fn({ target: { value: "ctrl+alt+shift+f7" } });
    expect(onChange).toHaveBeenCalledWith("ctrl+alt+shift+f7");
  });
});

describe("the switch names the eye's shortcut", () => {
  it("in a line under it that belongs to its description, and not at all when there is none", () => {
    const withKey = render(<SeeScreenSwitch on slow={false} leaves={false} who="" t={t} keyLabel={KEY} onChange={() => {}} />);
    expect(withKey).toContain(`<p id="okf-see-key" class="okf-see-key">Shortcut: ${KEY}</p>`);
    expect(withKey).toContain('aria-describedby="okf-see-what okf-see-key"');
    const without = render(<SeeScreenSwitch on slow={false} leaves={false} who="" t={t} onChange={() => {}} />);
    expect(without).not.toContain("okf-see-key");
    expect(without).toContain('aria-describedby="okf-see-what"');
    const leaving = render(<SeeScreenSwitch on slow={false} leaves who="Google" t={t} keyLabel={KEY} onChange={() => {}} />);
    expect(leaving).toContain('aria-describedby="okf-see-what okf-see-out okf-see-key"');
  });
});
