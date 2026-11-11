import { describe, expect, it } from "vitest";
import { buildRehearsalReport, countFillers, detectSpeechLanguage, rehearsalMarkdown, speechUnits, TakeRecorder, type TakeLog } from "./rehearsal";
import { Engine } from "./engine";
import { parseScript } from "./script";
import type { PointState, PointStatus, Script } from "./types";

/** A take without the engine: the test plays the presenter, the speech engine and the ticks. */
function take(script: Script) {
  let now = 0;
  const rec = new TakeRecorder(() => now);
  const state = { sectionIdx: 0, points: {} as Record<string, PointState>, engine: { recording: false, backend: null } };
  const observe = () => rec.observe(state);
  const api = {
    start() {
      state.engine.recording = true;
      observe();
      return api;
    },
    /** words in progress every half second from `from` to `to`, then the phrase is committed */
    say(from: number, to: number, text: string, partials = true) {
      if (partials) for (let at = from; at < to; at += 500) {
        now = at;
        rec.transcript({ partial: text.slice(0, 8) });
      }
      now = to;
      rec.transcript({ committed: text + " ", partial: "" });
      return api;
    },
    set(at: number, id: string, status: PointStatus) {
      now = at;
      state.points = { ...state.points, [id]: { status, confidence: 1 } };
      observe();
      return api;
    },
    /** forward moves mark the passed waiting points missed, as the engine does */
    go(at: number, idx: number) {
      now = at;
      const points = { ...state.points };
      for (const sec of script.sections.slice(state.sectionIdx, idx)) for (const b of sec.bullets) if ((points[b.id]?.status ?? "waiting") === "waiting") points[b.id] = { status: "missed", confidence: 0 };
      state.points = points;
      state.sectionIdx = idx;
      observe();
      return api;
    },
    stop(at: number): TakeLog {
      now = at;
      state.engine.recording = false;
      observe();
      return rec.result()!;
    },
  };
  return api;
}

const outcomes = (r: ReturnType<typeof buildRehearsalReport>) => Object.fromEntries(r.points.map((p) => [p.id, p.outcome]));

describe("rehearsal report on takes in the five speech languages", () => {
  it("English: pace, fillers, long pauses, time per section, a point not reached and the advice", () => {
    const script = parseScript("<!-- target: 1 min -->\n# Opening (0.5 min)\n- Revenue grew 20%\n- Two new markets\n# Next steps\n- Hire a team\n- Launch in spring");
    const log = take(script)
      .start()
      .say(0, 10_000, "Um, so revenue grew twenty percent this year, you know.")
      .set(10_500, "s0b0", "started")
      .say(16_000, 26_000, "Uh, we opened two new markets, basically Spain and Portugal.")
      .set(26_500, "s0b1", "started")
      .go(40_000, 1)
      .say(41_000, 51_000, "Next we hire a team, um, and I mean we hire fast.")
      .set(51_500, "s1b0", "started")
      .stop(60_000);
    const r = buildRehearsalReport(log, script, { lang: "auto" });
    expect(r.lang).toBe("en");
    expect(r.durationMs).toBe(60_000);
    expect(r.units).toBe(32);
    expect(r.pauses.list.map((p) => [p.atMs, p.ms, p.sectionIdx])).toEqual([[10_000, 6000, 0], [26_000, 15_000, 0]]);
    expect(r.speakingMs).toBe(30_000);
    expect(r.pace).toEqual({ unit: "wpm", value: 64, band: "slow", range: [120, 170] });
    // "I mean" before "we" is meant, not a filler; "you know." at the end of a phrase is one
    expect(r.fillers.total).toBe(5);
    expect(r.fillers.top).toEqual([{ label: "um", count: 2 }, { label: "basically", count: 1 }, { label: "uh", count: 1 }]);
    expect(r.sections.map((s) => [s.spentMs, s.targetMs, s.outcomes.covered, s.outcomes.notReached])).toEqual([[40_000, 30_000, 2, 0], [20_000, 30_000, 1, 1]]);
    // still open in the section showing at Stop: the take ended first, it was not skipped
    expect(outcomes(r)).toEqual({ s0b0: "covered", s0b1: "covered", s1b0: "covered", s1b1: "notReached" });
    expect(r.suggestions.map((s) => s.key)).toEqual(["report.tip.fillers", "report.tip.slow"]);
  });

  it("Italian: fillers including a phrase, and a point made after its section was left", () => {
    const script = parseScript("# Apertura\n- I ricavi sono cresciuti\n- Due nuovi mercati\n# Conclusione\n- Assumere un team");
    const log = take(script)
      .start()
      .say(0, 12_000, "Ehm, allora, i ricavi sono cresciuti molto quest'anno, cioè del venti per cento.")
      .set(12_500, "s0b0", "started")
      .go(13_000, 1)
      .say(13_500, 25_000, "Insomma, come dire, abbiamo anche due nuovi mercati, praticamente.")
      .set(25_500, "s0b1", "started")
      .say(26_000, 38_000, "E poi vogliamo assumere un team, diciamo, molto presto.")
      .set(38_500, "s1b0", "started")
      .stop(40_000);
    const r = buildRehearsalReport(log, script);
    expect(r.lang).toBe("it");
    expect(Object.fromEntries(r.fillers.top.map((f) => [f.label, f.count]))).toEqual({ "come dire": 1, "cioè": 1, diciamo: 1 });
    expect(r.fillers.total).toBe(6);
    expect(outcomes(r)).toEqual({ s0b0: "covered", s0b1: "late", s1b0: "covered" });
    expect(r.sections[0].outcomes).toEqual({ covered: 1, late: 1, earlier: 0, missed: 0, notReached: 0 });
    expect(r.pauses.count).toBe(0);
    expect(r.talkTargetMs).toBeNull();
  });

  it("Russian: fillers that are also everyday words count only before a pause; a section never reached", () => {
    const script = parseScript("# Начало\n- Выручка выросла\n- Новые рынки\n# Итоги\n- Нанять команду");
    const log = take(script)
      .start()
      .say(0, 10_000, "Ну, выручка выросла, как бы, на двадцать процентов, вот.")
      .set(10_200, "s0b0", "started")
      .say(10_500, 20_000, "Эээ, это самое, у нас типа новые рынки.")
      .set(20_500, "s0b1", "started")
      .stop(22_000);
    const r = buildRehearsalReport(log, script);
    expect(r.lang).toBe("ru");
    expect(Object.fromEntries(r.fillers.top.map((f) => [f.label, f.count]))).toEqual({ "как бы": 1, "ну": 1, "э": 1 }); // ties in alphabetical order
    expect(r.fillers.total).toBe(4); // + "это самое"; "вот" and "типа" are often meant, so they are never counted
    expect(outcomes(r)).toEqual({ s0b0: "covered", s0b1: "covered", s1b0: "notReached" });
    expect(r.sections[1]).toMatchObject({ visited: false, spentMs: 0 });
    expect(r.suggestions.map((s) => s.key)).toEqual(["report.tip.slow"]); // points not reached are no fault; four fillers in 22 s stay under the fillers tip
  });

  it("Romanian: hesitation sounds and phrases with or without diacritics", () => {
    const script = parseScript("# Început\n- Veniturile au crescut\n# Final\n- Angajăm o echipă");
    const log = take(script)
      .start()
      .say(0, 10_000, "Păi, veniturile au crescut, adică cu douăzeci la sută.")
      .set(10_200, "s0b0", "started")
      .say(10_500, 20_000, "Ăăă, practic, cum sa zic, este un an bun, deci.")
      .go(21_000, 1)
      .stop(25_000);
    const r = buildRehearsalReport(log, script);
    expect(r.lang).toBe("ro");
    expect(r.fillers.total).toBe(2); // the sound and "cum să zic"; "păi", "adică", "practic", "deci" are often meant
    expect(r.fillers.top.map((f) => f.label)).toEqual(["ă", "cum să zic"]);
    expect(countFillers("Am luat pai de la bunica. Păi, da.", "ro").size).toBe(0); // "pai" is straw: a meant word is never marked
    expect(outcomes(r)).toEqual({ s0b0: "covered", s1b0: "notReached" });
    expect(countFillers("ăă deci noi", "ro").get("deci")).toBeUndefined();
  });

  it("Japanese: characters a minute, word-cut fillers, and あの as a word is not a filler", () => {
    const script = parseScript("# はじめに (1 min)\n- 売上が伸びた\n# まとめ\n- チームを作る");
    const log = take(script)
      .start()
      .say(0, 10_000, "えーと、売上が二十パーセント伸びました。")
      .set(10_200, "s0b0", "started")
      .say(10_500, 20_000, "あのー、まあ、あの人のチームを作ります。えっと、以上です。")
      .go(20_500, 1)
      .set(21_000, "s1b0", "started")
      .say(21_500, 30_000, "ありがとうございました。")
      .stop(31_000);
    const r = buildRehearsalReport(log, script);
    expect(r.lang).toBe("ja");
    expect(r.pace.unit).toBe("cpm");
    expect(r.units).toBe(speechUnits("えーと売上が二十パーセント伸びましたあのーまああの人のチームを作りますえっと以上ですありがとうございました", "ja"));
    expect(r.pace.value).toBe(Math.round(r.units / 0.5));
    expect(Object.fromEntries(r.fillers.top.map((f) => [f.label, f.count]))).toEqual({ "あのー": 1, "えっと": 1, "えーと": 1 });
    expect(r.fillers.total).toBe(4);
    expect(outcomes(r)).toEqual({ s0b0: "covered", s1b0: "covered" });
  });
});

describe("rehearsal details", () => {
  it("finds the language of a transcript", () => {
    expect(detectSpeechLanguage("We think that this is the right plan")).toBe("en");
    expect(detectSpeechLanguage("Penso che questo sia il piano giusto per la azienda")).toBe("it");
    expect(detectSpeechLanguage("Cred că este planul bun pentru noi și pentru voi")).toBe("ro");
    expect(detectSpeechLanguage("Мы думаем, что это правильный план")).toBe("ru");
    expect(detectSpeechLanguage("これは正しい計画だと思います")).toBe("ja");
    expect(detectSpeechLanguage("")).toBe("en");
  });

  it("counts fillers on whole words only", () => {
    expect([...countFillers("Umbrella, ummm, hmm, uh-huh", "en")]).toEqual([["um", 1], ["hmm", 1], ["uh", 1]]);
    expect(countFillers("Ehm ehmmm eh", "it").get("ehm")).toBe(3);
    expect(countFillers("Нужно, вот это", "ru").size).toBe(0);
  });

  it("counts a point as late when it was skipped and made after going back to its section", () => {
    const script = parseScript("# A\n- one\n- two\n# B\n- three");
    const log = take(script).start().set(1000, "s0b0", "started").go(2000, 1).go(3000, 0).set(4000, "s0b1", "started").stop(5000);
    expect(outcomes(buildRehearsalReport(log, script))).toEqual({ s0b0: "covered", s0b1: "late", s1b0: "missed" });
  });

  it("estimates when a phrase began when the speech engine sends no partial text", () => {
    const script = parseScript("# A\n- x");
    const ten = "one two three four five six seven eight nine ten";
    const log = take(script).start().say(0, 5000, ten, false).say(15_000, 20_000, ten, false).stop(21_000);
    const r = buildRehearsalReport(log, script);
    expect(r.pauses.count).toBe(1);
    // the second phrase took about 4 s at an average pace, so the silence was about 11 s, not 15
    expect(r.pauses.list[0].ms).toBeGreaterThan(10_000);
    expect(r.pauses.list[0].ms).toBeLessThan(12_000);
  });

  it("ignores status text from the speech engine and speech outside a take", () => {
    const rec = new TakeRecorder(() => 0);
    rec.transcript({ committed: "before the take" });
    rec.observe({ sectionIdx: 0, points: {}, engine: { recording: true, backend: null } });
    rec.transcript({ partial: "(reconnecting 1/3…)" });
    rec.transcript({ partial: "…" });
    rec.observe({ sectionIdx: 0, points: {}, engine: { recording: false, backend: null } });
    const log = rec.result()!;
    expect([log.segments.length, log.activity.length]).toEqual([0, 0]);
    expect(buildRehearsalReport(log, parseScript("# A\n- x")).suggestions).toEqual([{ key: "report.tip.noSpeech", vars: {} }]);
  });

  it("asks for a shorter talk when it ran over, before anything else but missed points", () => {
    const script = parseScript("<!-- target: 1 min -->\n# A\n- x");
    const log = take(script).start().say(0, 150_000, "We say the point x now and keep talking for a while about it").set(150_500, "s0b0", "started").stop(180_000);
    const r = buildRehearsalReport(log, script);
    expect(r.suggestions[0]).toEqual({ key: "report.tip.talkLong", vars: { over: 2, target: 1 } });
  });

  it("works on the real engine: hand ticks, a missed point re-opened and made late", () => {
    const engine = new Engine({ decide: async () => ({ decisions: [] }) as never, now: () => 1000, setInterval: () => 0, clearInterval: () => {} });
    let now = 0;
    const rec = new TakeRecorder(() => now);
    engine.subscribe((s) => rec.observe(s));
    engine.loadScript(parseScript("# A\n- one\n- two\n# B\n- three"));
    engine.start();
    now = 1000;
    engine.dispatch({ type: "markStarted", id: "s0b0" });
    now = 2000;
    engine.dispatch({ type: "nextSection" });
    now = 3000;
    engine.dispatch({ type: "reopen", id: "s0b1" });
    engine.dispatch({ type: "markStarted", id: "s0b1" });
    now = 4000;
    engine.stop();
    const r = buildRehearsalReport(rec.result()!, engine.getState().script);
    expect(r.points.map((p) => [p.id, p.outcome, p.manual])).toEqual([["s0b0", "covered", true], ["s0b1", "late", true], ["s1b0", "notReached", false]]);
    expect(r.sections.map((s) => s.spentMs)).toEqual([2000, 2000]);
  });

  it("a second take without a reset: earlier ticks are not this take's work, earlier misses only count where it went", () => {
    const engine = new Engine({ decide: async () => ({ decisions: [] }) as never, now: () => 1000, setInterval: () => 0, clearInterval: () => {} });
    let now = 0;
    const rec = new TakeRecorder(() => now);
    engine.subscribe((s) => rec.observe(s));
    engine.loadScript(parseScript("# A\n- one\n- two\n# B\n- three\n# C\n- four"));
    engine.start();
    engine.dispatch({ type: "markStarted", id: "s0b0" });
    engine.dispatch({ type: "goToSection", idx: 2 }); // s0b1 and s1b0 missed
    engine.stop();
    engine.dispatch({ type: "goToSection", idx: 0 });
    now = 10_000;
    engine.start(); // take 2: never says anything, stays in section A
    now = 20_000;
    engine.stop();
    const r = buildRehearsalReport(rec.result()!, engine.getState().script);
    expect(Object.fromEntries(r.points.map((p) => [p.id, p.outcome]))).toEqual({ s0b0: "earlier", s0b1: "notReached", s1b0: "notReached", s2b0: "notReached" });
    expect(r.sections[0].outcomes.earlier).toBe(1);
  });

  it("a script loaded during the take starts the log again with it", () => {
    let now = 0;
    const rec = new TakeRecorder(() => now);
    const st = (sectionIdx: number, points: Record<string, PointState>) => ({ sectionIdx, points, engine: { recording: true, backend: null } });
    rec.observe(st(0, {}));
    now = 5000;
    rec.transcript({ committed: "old words" });
    rec.observe(st(1, { s0b0: { status: "started", confidence: 1 } }));
    now = 9000;
    rec.scriptLoading();
    rec.observe(st(0, {}));
    now = 12_000;
    rec.observe({ sectionIdx: 0, points: {}, engine: { recording: false, backend: null } });
    const log = rec.result()!;
    expect([log.clock.startedAt, log.segments.length, log.pointEvents.length, log.clock.entries.length]).toEqual([9000, 0, 0, 1]);
  });

  it("does not count everyday words that only look like fillers", () => {
    const n = (text: string, lang: Parameters<typeof countFillers>[1]) => [...countFillers(text, lang).values()].reduce((a, b) => a + b, 0);
    expect(n("Îi mulțumesc pentru exemplu practic bun.", "ro")).toBe(0);
    expect(n("Это самое главное. Что это значит?", "ru")).toBe(0);
    expect(n("Do you know? I mean it.", "en")).toBe(0);
    expect(n("Îîî, practic, asta e.", "ro")).toBe(1);
    expect(n("Короче, эта дорога короче. Такого типа, вот. Что это значит.", "ru")).toBe(0);
    expect(n("Как бы ни было, ну и ладно.", "ru")).toBe(0);
    expect(n("ええ、そうです。なんか変です。", "ja")).toBe(0); // "ええ" is yes
    expect(Object.fromEntries(countFillers("ええと、あのー、あの人は、えーと、えっと", "ja"))).toEqual({ "えーと": 2, "えっと": 1, "あのー": 1 });
    expect(n("あのう、それは、あの人です。", "ja")).toBe(1);
  });
});

describe("rehearsal Markdown", () => {
  it("writes the report in the interface language and appends the live notes one level down", () => {
    const script = parseScript("# Intro (1 min)\n- Hello | world");
    const log = take(script).start().say(0, 30_000, "Hello world, um, this is the intro and it goes on for a while").stop(31_000);
    const r = buildRehearsalReport(log, script, { lang: "en" });
    const en = rehearsalMarkdown(r, "en", "# Talk notes\n\n## 1. Slide");
    expect(en).toContain("# Rehearsal report");
    expect(en).toContain("| Intro | 0:31 | 1:00 | 1 not reached |");
    expect(en).toContain("## Points you did not get to (the take ended first)\n\n- Hello | world");
    expect(en).toContain("\n## Talk notes\n\n### 1. Slide");
    const it = rehearsalMarkdown(r, "it");
    expect(it).toContain("# Resoconto della prova");
    expect(it).toContain("| Sezione | Tempo | Obiettivo | Punti |");
    expect(it).not.toContain("Talk notes");
  });
});
