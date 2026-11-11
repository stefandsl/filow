// The eye as a button, Pause, Resume and Resume after Stop: the rules behind the pill (docs/okfilow/PILL.md).
import { describe, expect, it } from "vitest";
import { createPausableClock, overControls } from "./motion";
import { EYE_KEYS, PAUSE_KEYS, PILL_STATUSES, isPillAction, keyLabel, pauseKeyAction, pillView, withKey, type PillState } from "./pill";
import type { BuddyTurn } from "./prompt";
import { eyeToggle, seesScreen, stillSees } from "./sees";
import { OKF_TEXT } from "./text";
import { createAnswerTurn, cutToSentence, joinContinuation, resumePlan, splitSentences } from "./turn";

const pill = (over: Partial<PillState> = {}): PillState => ({ sees: true, paused: false, resumable: false, ...over });

describe("the eye button", () => {
  it("flips what the next question would do, and the result is the user's own choice", () => {
    // Chosen already: on <-> off.
    expect(eyeToggle("on", "local", "picture")).toBe("off");
    expect(eyeToggle("off", "local", "picture")).toBe("on");
    // Not chosen yet, and the setup looks: a click closes the eye for good.
    expect(eyeToggle("auto", "local", "picture")).toBe("off");
    expect(eyeToggle(undefined, "cloud", "text")).toBe("off");
    // Not chosen yet, on a modest PC where the setup does not look: a click opens it.
    expect(eyeToggle("auto", "local", "text")).toBe("on");
  });

  it("an explicit off stays off whatever the setup for this computer picks", () => {
    for (const route of ["local", "cloud", "freellm"] as const) {
      for (const local of ["picture", "text", "none", null] as const) expect(seesScreen("off", route, local)).toBe(false);
    }
  });

  it("closing the eye after the screenshot was taken drops it; opening it changes nothing for a question asked without", () => {
    expect(stillSees(true, "on")).toBe(true);
    expect(stillSees(true, "auto")).toBe(true);
    expect(stillSees(true, undefined)).toBe(true);
    expect(stillSees(true, "off")).toBe(false);
    expect(stillSees(false, "on")).toBe(false);
    expect(stillSees(false, "off")).toBe(false);
  });
});

describe("the shortcuts", () => {
  it("are three-modifier keys by default, shown the way people read them, and can be switched off", () => {
    expect(EYE_KEYS[0]).toBe("ctrl+alt+shift+h");
    expect(PAUSE_KEYS[0]).toBe("ctrl+alt+shift+g");
    expect(keyLabel("ctrl+alt+shift+h")).toBe("Ctrl + Alt + Shift + H");
    expect(keyLabel("ctrl+alt+shift+f7")).toBe("Ctrl + Alt + Shift + F7");
    expect(keyLabel("none")).toBe("");
    expect(keyLabel(undefined)).toBe("");
    expect(EYE_KEYS).toContain("none");
    expect(PAUSE_KEYS).toContain("none");
    // The two never share a key.
    expect(EYE_KEYS.filter((k) => k !== "none" && (PAUSE_KEYS as readonly string[]).includes(k))).toEqual([]);
  });

  it("a tooltip names the shortcut only when there is one", () => {
    expect(withKey("Pause the answer", "Ctrl + Alt + Shift + G")).toBe("Pause the answer (Ctrl + Alt + Shift + G)");
    expect(withKey("Pause the answer", "")).toBe("Pause the answer");
  });

  it("the Pause/Resume key acts only on an answer in progress or one that can be carried on", () => {
    expect(pauseKeyAction("thinking", pill())).toBe("pause");
    expect(pauseKeyAction("speaking", pill())).toBe("pause");
    expect(pauseKeyAction("speaking", pill({ paused: true }))).toBe("resume");
    expect(pauseKeyAction("idle", pill({ resumable: true }))).toBe("resume");
    expect(pauseKeyAction("idle", pill())).toBe(null);
    expect(pauseKeyAction("listening", pill())).toBe(null);
    expect(pauseKeyAction("error", pill())).toBe(null);
  });

  it("only the four actions of the pill are accepted", () => {
    expect(["eye", "pause", "resume", "stop"].every(isPillAction)).toBe(true);
    expect(["", "quit", null, 1, "Eye"].some(isPillAction)).toBe(false);
  });
});

describe("what the pill shows", () => {
  it("answering: status, Pause and Stop; the status says whether OK Filow is looking", () => {
    expect(pillView({ mode: "thinking", pill: pill() })).toEqual({ show: true, eye: true, status: "notchLooking", first: "pause", stop: true });
    expect(pillView({ mode: "thinking", pill: pill({ sees: false }) }).status).toBe("notchNotLooking");
    expect(pillView({ mode: "speaking", pill: pill() })).toEqual({ show: true, eye: true, status: "notchAnswering", first: "pause", stop: true });
  });

  it("paused: says so, Resume takes the place of Pause, Stop stays", () => {
    expect(pillView({ mode: "thinking", pill: pill({ paused: true }) })).toEqual({ show: true, eye: true, status: "paused", first: "resume", stop: true });
    expect(pillView({ mode: "speaking", pill: pill({ paused: true }) })).toEqual({ show: true, eye: true, status: "paused", first: "resume", stop: true });
  });

  it("stopped: Resume only while the answer can be carried on, and no Stop", () => {
    expect(pillView({ mode: "idle", stopped: true, pill: pill({ resumable: true }) })).toEqual({ show: true, eye: true, status: "stopped", first: "resume", stop: false });
    expect(pillView({ mode: "idle", stopped: true, pill: pill() }).show).toBe(false);
    expect(pillView({ mode: "idle", pill: pill({ resumable: true }) }).show).toBe(false);
    expect(pillView({ mode: "error", stopped: true, pill: pill({ resumable: true }) }).show).toBe(false);
  });

  it("listening: the eye is there for a question, not for a dictation; no Pause, no Stop", () => {
    expect(pillView({ mode: "listening", purpose: "talk", pill: pill() })).toEqual({ show: true, eye: true, status: "notchListening", first: null, stop: false });
    expect(pillView({ mode: "listening", purpose: "handsfree", pill: pill() }).status).toBe("notchHandsFree");
    expect(pillView({ mode: "listening", purpose: "dictate", pill: pill() })).toEqual({ show: true, eye: false, status: "notchDictating", first: null, stop: false });
  });

  it("every status it can show is in the list that sizes its room, and has words in the five languages", () => {
    const shown = new Set<string>();
    for (const mode of ["idle", "listening", "thinking", "speaking", "error"] as const) {
      for (const purpose of ["talk", "handsfree", "dictate"]) {
        for (const sees of [true, false]) for (const paused of [true, false]) for (const resumable of [true, false]) {
          const v = pillView({ mode, purpose, stopped: true, pill: { sees, paused, resumable } });
          if (v.show) shown.add(v.status);
        }
      }
    }
    expect([...shown].sort()).toEqual([...PILL_STATUSES].sort());
    for (const lang of ["en", "it", "ru", "ro", "ja"] as const) {
      for (const k of [...PILL_STATUSES, "pause", "resume", "pauseHint", "resumeHint", "eyeClose", "eyeKey", "eyeKeyLabel", "pauseKeyLabel", "keyNone", "keyTaken"] as const) expect(OKF_TEXT[lang][k], `${lang}.${k}`).toBeTruthy();
      expect(OKF_TEXT[lang].eyeKey).toContain("{key}");
      expect(OKF_TEXT[lang].keyTaken).toContain("{key}");
    }
  });
});

describe("the pointer on the pill", () => {
  const eye = { left: 100, top: 10, right: 130, bottom: 34 };
  const stop = { left: 300, top: 10, right: 360, bottom: 34 };
  it("is on a control when it is on any of them, with a few pixels of margin", () => {
    expect(overControls({ x: 110, y: 20 }, [eye, stop])).toBe(true);
    expect(overControls({ x: 330, y: 20 }, [eye, stop])).toBe(true);
    expect(overControls({ x: 363, y: 20 }, [eye, stop])).toBe(true);
    expect(overControls({ x: 200, y: 20 }, [eye, stop])).toBe(false);
    expect(overControls({ x: 110, y: 60 }, [eye, stop])).toBe(false);
    expect(overControls({ x: 110, y: 20 }, [null, undefined])).toBe(false);
    expect(overControls(null, [eye, stop])).toBe(false);
  });
});

describe("the clock of the flights and the pen", () => {
  it("stands still during a pause and carries on from the same moment", () => {
    const clock = createPausableClock();
    expect(clock.at(1000)).toBe(1000);
    clock.pause(1500);
    expect(clock.paused()).toBe(true);
    expect(clock.at(1500)).toBe(1500);
    expect(clock.at(9000)).toBe(1500);
    // A second pause while paused changes nothing.
    clock.pause(4000);
    clock.resume(9000);
    expect(clock.paused()).toBe(false);
    expect(clock.at(9000)).toBe(1500);
    expect(clock.at(9400)).toBe(1900);
    clock.resume(9900);
    expect(clock.at(10000)).toBe(2500);
  });
});

describe("pausing an answer", () => {
  it("holds back the text that arrives, hands it out on resume, and a stop meanwhile keeps only what was shown", () => {
    const turn = createAnswerTurn();
    turn.begin(1, "q", new AbortController());
    expect(turn.progress(1, "Plants take in light.")).toBe(true);
    expect(turn.pause()).toBe(true);
    expect(turn.pause()).toBe(false);
    expect(turn.paused()).toBe(true);
    expect(turn.progress(1, "Plants take in light. They make sugar.")).toBe(false);
    expect(turn.progress(1, "Plants take in light. They make sugar. Then they rest.")).toBe(false);
    expect(turn.resume()).toBe("Plants take in light. They make sugar. Then they rest.");
    expect(turn.paused()).toBe(false);
    expect(turn.resume()).toBe(null);
    expect(turn.progress(1, "Plants take in light. They make sugar. Then they rest. The end.")).toBe(true);

    turn.pause();
    turn.progress(1, "never shown");
    const was = turn.stop([]);
    expect(was?.shown).toBe("Plants take in light. They make sugar. Then they rest. The end.");
    expect(turn.paused()).toBe(false);
  });

  it("the text handed out on resume is shown from then on: a stop right after keeps it", () => {
    const turn = createAnswerTurn();
    turn.begin(1, "q", new AbortController());
    turn.progress(1, "One.");
    turn.pause();
    turn.progress(1, "One. Two.");
    turn.resume();
    expect(turn.stop([])?.shown).toBe("One. Two.");
  });

  it("resume with nothing new gives an empty text, and only an answer in progress can be paused", () => {
    const turn = createAnswerTurn();
    expect(turn.pause()).toBe(false);
    expect(turn.resume()).toBe(null);
    turn.begin(1, "q");
    turn.pause();
    expect(turn.resume()).toBe("");
  });

  it("what comes after the text (marks, voice, an error) waits for resume, and is dropped by a stop", async () => {
    const turn = createAnswerTurn();
    turn.begin(1, "q");
    expect(await turn.unpaused(1)).toBe(true);
    expect(await turn.unpaused(2)).toBe(false);
    turn.pause();
    let got: boolean | null = null;
    void turn.unpaused(1).then((v) => { got = v; });
    await Promise.resolve();
    expect(got).toBe(null);
    turn.resume();
    await Promise.resolve();
    expect(got).toBe(true);

    turn.pause();
    const waiting = turn.unpaused(1);
    turn.stop([]);
    expect(await waiting).toBe(false);

    turn.begin(2, "q2");
    turn.pause();
    const second = turn.unpaused(2);
    turn.begin(3, "q3");
    expect(await second).toBe(false);
    turn.pause();
    const third = turn.unpaused(3);
    turn.end(3);
    expect(await third).toBe(false);
  });
});

describe("Resume after Stop", () => {
  const before: BuddyTurn[] = [{ role: "user", text: "hi" }, { role: "assistant", text: "Hello." }];

  it("offers to continue when text was arriving, to ask again when none had come, to go on speaking when it was all there", () => {
    const turn = createAnswerTurn();
    turn.begin(1, "explain", new AbortController());
    turn.progress(1, "Plants take in light. They ma");
    turn.stop(before);
    expect(turn.offer()).toEqual({ kind: "continue", question: "explain", shown: "Plants take in light. They ma" });

    turn.begin(2, "explain");
    turn.stop(before);
    expect(turn.offer()).toEqual({ kind: "again", question: "explain", shown: "" });

    turn.begin(3, "explain");
    turn.progress(3, "The whole answer.");
    turn.kept(3);
    turn.stop(before);
    expect(turn.offer()).toEqual({ kind: "speak", question: "explain", shown: "The whole answer." });
  });

  it("is not offered for an answer that cannot be continued, after a new question, or once discarded", () => {
    const turn = createAnswerTurn();
    turn.begin(1, "draw a car", new AbortController(), { resumable: false });
    turn.progress(1, "Here is");
    turn.stop(before);
    expect(turn.offer()).toBe(null);

    turn.begin(2, "explain");
    turn.progress(2, "Plants.");
    turn.stop(before);
    expect(turn.offer()).not.toBe(null);
    turn.begin(3, "another question");
    expect(turn.offer()).toBe(null);
    turn.progress(3, "Yes.");
    turn.stop(before);
    turn.discard();
    expect(turn.offer()).toBe(null);
    // An answer that ended by itself leaves nothing to resume.
    turn.begin(4, "q");
    turn.end(4);
    expect(turn.offer()).toBe(null);
  });

  it("continues from the last whole sentence, as the conversation's last answer", () => {
    const stopped: BuddyTurn[] = [...before, { role: "user", text: "explain" }, { role: "assistant", text: "Plants take in light. They ma" }];
    const plan = resumePlan({ kind: "continue", question: "explain", shown: "Plants take in light. They ma" }, stopped);
    expect(plan.kind).toBe("continue");
    expect(plan.shown).toBe("Plants take in light.");
    expect(plan.history).toEqual([...before, { role: "user", text: "explain" }, { role: "assistant", text: "Plants take in light." }]);
    // No second question turn: still question, answer, question, answer.
    expect(plan.history.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("asks again when no whole sentence was shown, or when the conversation no longer ends with that answer", () => {
    const stopped: BuddyTurn[] = [...before, { role: "user", text: "explain" }, { role: "assistant", text: "Plants take" }];
    const none = resumePlan({ kind: "continue", question: "explain", shown: "Plants take" }, stopped);
    expect(none).toEqual({ kind: "again", question: "explain", shown: "", history: before });
    const cleared = resumePlan({ kind: "continue", question: "explain", shown: "Plants take in light. They" }, []);
    expect(cleared).toEqual({ kind: "again", question: "explain", shown: "", history: [] });
    const speak = resumePlan({ kind: "speak", question: "explain", shown: "All of it." }, stopped);
    expect(speak).toEqual({ kind: "speak", question: "explain", shown: "All of it.", history: stopped });
  });
});

describe("sentences", () => {
  it("are split at closing marks, also Japanese ones, and not inside numbers or file names", () => {
    expect(splitSentences("Open the File menu. Then choose Save! Is that all? Yes.")).toEqual(["Open the File menu.", "Then choose Save!", "Is that all?", "Yes."]);
    expect(splitSentences("It is 3.5 GB. Save it as notes.txt and close")).toEqual(["It is 3.5 GB.", "Save it as notes.txt and close"]);
    expect(splitSentences("ファイルを開きます。次に保存します。終わり")).toEqual(["ファイルを開きます。", "次に保存します。", "終わり"]);
    expect(splitSentences("He said \"stop.\" Then he left.")).toEqual(["He said \"stop.\"", "Then he left."]);
    expect(splitSentences("First line\nSecond line")).toEqual(["First line", "Second line"]);
    expect(splitSentences("  ")).toEqual([]);
  });

  it("a stopped text is cut back to its last whole sentence", () => {
    expect(cutToSentence("Plants take in light. They ma")).toBe("Plants take in light.");
    expect(cutToSentence("Plants take in light. They make sugar.")).toBe("Plants take in light. They make sugar.");
    expect(cutToSentence("Plants take")).toBe("");
    expect(cutToSentence("")).toBe("");
    expect(cutToSentence("光を取り込みます。そして")).toBe("光を取り込みます。");
    expect(cutToSentence("Version 3.5 is")).toBe("");
  });
});

describe("joining a continuation to the stopped answer", () => {
  it("adds new sentences after the ones shown", () => {
    expect(joinContinuation("Plants take in light.", "They make sugar from it. Then they grow.")).toBe("Plants take in light. They make sugar from it. Then they grow.");
  });

  it("drops the leading sentences the model says again, whatever the spacing, capitals and marks", () => {
    expect(joinContinuation("Plants take in light. They make sugar.", "Plants take in light. They make sugar. Then they grow.")).toBe("Plants take in light. They make sugar. Then they grow.");
    expect(joinContinuation("Plants take in light. They make sugar.", "  they  make SUGAR!\n\nThen they grow.")).toBe("Plants take in light. They make sugar. Then they grow.");
    // Only at the start: a sentence said again later is the model's own wording.
    expect(joinContinuation("Yes.", "It works. Yes. It does.")).toBe("Yes. It works. Yes. It does.");
  });

  it("a continuation that only repeats adds nothing", () => {
    expect(joinContinuation("Plants take in light.", "Plants take in light.")).toBe("Plants take in light.");
    expect(joinContinuation("Plants take in light.", "")).toBe("Plants take in light.");
    expect(joinContinuation("", "Plants take in light.")).toBe("Plants take in light.");
  });

  it("works in the five languages, Japanese joined without a space", () => {
    expect(joinContinuation("Le piante assorbono la luce.", "Le piante assorbono la luce. Poi producono zucchero.")).toBe("Le piante assorbono la luce. Poi producono zucchero.");
    expect(joinContinuation("Растения поглощают свет.", "Растения поглощают свет. Затем растут.")).toBe("Растения поглощают свет. Затем растут.");
    expect(joinContinuation("Plantele absorb lumina.", "Plantele absorb lumina. Apoi fac zahăr.")).toBe("Plantele absorb lumina. Apoi fac zahăr.");
    expect(joinContinuation("植物は光を吸収します。", "植物は光を吸収します。次に糖を作ります。")).toBe("植物は光を吸収します。次に糖を作ります。");
  });

  it("while the continuation is still arriving, a start that reads like a sentence already shown is held back", () => {
    const shown = "Plants take in light. They make sugar.";
    expect(joinContinuation(shown, "Plants take", { partial: true })).toBe(shown);
    expect(joinContinuation(shown, "Plants take in light. They", { partial: true })).toBe(shown);
    expect(joinContinuation(shown, "Plants take in light. They make sugar. Then", { partial: true })).toBe(shown + " Then");
    // New words appear as they come.
    expect(joinContinuation(shown, "After that", { partial: true })).toBe(shown + " After that");
    // Once everything arrived, an unfinished last sentence is kept as it is.
    expect(joinContinuation(shown, "Plants take")).toBe(shown + " Plants take");
  });

  it("a list goes on with a new line", () => {
    expect(joinContinuation("Do this:\n1. Open the menu.", "2. Choose Save.")).toBe("Do this:\n1. Open the menu.\n2. Choose Save.");
  });
});
