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
      .say(16_000, 26_000, "Uh, we opened two new markets, basically, Spain and Portugal.")
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
    expect(r.pace).toEqual({ unit: "wpm", value: 64, band: "slow", range: [120, 170], basis: "words" });
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
      .say(0, 12_000, "Ehm, allora, i ricavi sono cresciuti molto quest'anno, cioè, del venti per cento.")
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
    // "uh-huh" is a yes, not a hesitation
    expect([...countFillers("Umbrella, ummm, hmm, uh-huh, uh", "en")]).toEqual([["um", 1], ["hmm", 1], ["uh", 1]]);
    expect(countFillers("Ehm ehmmm eh", "it").get("ehm")).toBe(3);
    expect(countFillers("Нужно, вот это", "ru").size).toBe(0);
  });

  it("counts a point as late when it was skipped and made after going back to its section", () => {
    const script = parseScript("# A\n- one\n- two\n# B\n- three");
    const log = take(script).start().set(1000, "s0b0", "started").go(2000, 1).go(3000, 0).set(4000, "s0b1", "started").stop(5000);
    expect(outcomes(buildRehearsalReport(log, script))).toEqual({ s0b0: "covered", s0b1: "late", s1b0: "missed" });
  });

  it("counts only sure silence as a pause when the speech engine sends no partial text", () => {
    const script = parseScript("# A\n- x");
    const ten = "one two three four five six seven eight nine ten";
    const log = take(script).start().say(0, 5000, ten, false).say(15_000, 20_000, ten, false).stop(21_000);
    const r = buildRehearsalReport(log, script);
    // ten words take at most 10 s even at half the slow end of the usual pace: at least 5 s of the 15 were silence
    expect(r.pauses.list.map((p) => [p.atMs, p.ms])).toEqual([[5000, 5000]]);
    expect(r.pace.basis).toBe("phrases");
  });

  // Review M3: phrases committed whole every 10 s were reported at an "ok" 125 words a minute.
  it("measures the pace of whole phrases on the real time between them, in the take's language", () => {
    const script = parseScript("# A\n- x");
    const ten = "one two three four five six seven eight nine ten";
    const slow = take(script).start();
    for (let i = 1; i <= 12; i++) slow.say(0, i * 10_000, ten, false);
    const r = buildRehearsalReport(slow.stop(125_000), script, { lang: "en" });
    expect(r.pace).toEqual({ unit: "wpm", value: 60, band: "slow", range: [120, 170], basis: "phrases" });
    expect(r.pauses.count).toBe(0);
    // the saved report says the number is approximate, and why
    expect(rehearsalMarkdown(r, "en")).toContain("- Pace: 60 words a minute (slow, usual 120-170); approximate: this speech model sends only whole phrases");
    const fast = take(script).start();
    for (let i = 1; i <= 12; i++) fast.say(0, i * 3000, ten, false);
    expect(buildRehearsalReport(fast.stop(40_000), script, { lang: "en" }).pace).toMatchObject({ value: 200, band: "fast" });
    // Russian: 8 words every 4 s is 120 a minute, inside the Russian range (100-150), not judged by the English one
    const ru = take(script).start();
    for (let i = 1; i <= 12; i++) ru.say(0, i * 4000, "мы говорим о том что важно для нас", false);
    expect(buildRehearsalReport(ru.stop(50_000), script, { lang: "ru" }).pace).toMatchObject({ value: 120, band: "ok", range: [100, 150] });
  });

  // Review M4: 40 partials, a 4.5 s "(transcription lagging…)" gap, then words: one long pause was reported.
  it("does not call a stretch the engine was lagging on a pause, nor time it for the pace", () => {
    let now = 0;
    const rec = new TakeRecorder(() => now);
    rec.observe({ sectionIdx: 0, points: {}, engine: { recording: true, backend: null } });
    for (; now < 20_000; now += 500) rec.transcript({ partial: "we talk" });
    rec.transcript({ committed: "we talk about the plan for the year and the people who run it today" });
    now = 22_000;
    rec.transcript({ partial: "(transcription lagging…)" });
    now = 24_500;
    for (; now < 45_000; now += 500) rec.transcript({ partial: "and then" });
    rec.transcript({ committed: "and then we talk about the money and the time it takes to get there" });
    now = 46_000;
    rec.observe({ sectionIdx: 0, points: {}, engine: { recording: false, backend: null } });
    const log = rec.result()!;
    expect(log.stalls).toEqual([22_000]);
    const r = buildRehearsalReport(log, parseScript("# A\n- x"), { lang: "en" });
    expect(r.pauses.count).toBe(0);
    // 40.5 s of heard speech (0-20 s and 24.5-45 s), the 4.5 s gap left out
    expect(r.speakingMs).toBe(40_500);
    expect(r.pace.basis).toBe("words");
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
    expect(n("Îîîî, practic, asta e.", "ro")).toBe(1);
    // Review of this pass: letters, units and numbers that only look like hesitation sounds.
    expect(n("Bateriile AA. Clasa a III-a. Grosime 5 mm. Cum să zic asta mai simplu?", "ro")).toBe(0);
    expect(n("Толщина листа 5 мм, ширина 20 мм. Буква э, буква м.", "ru")).toBe(0);
    expect(n("Эээ, ммм, cum", "ru")).toBe(2);
    expect(n("Короче, эта дорога короче. Такого типа, вот. Что это значит.", "ru")).toBe(0);
    expect(n("Как бы ни было, ну и ладно.", "ru")).toBe(0);
    expect(n("ええ、そうです。なんか変です。", "ja")).toBe(0); // "ええ" is yes
    expect(Object.fromEntries(countFillers("ええと、あのー、あの人は、えーと、えっと", "ja"))).toEqual({ "えーと": 2, "えっと": 1, "あのー": 1 });
    expect(n("あのう、それは、あの人です。", "ja")).toBe(1);
  });

  it("English and Italian: a word that is meant is never a filler, a word set off by pauses still is", () => {
    const n = (text: string, lang: Parameters<typeof countFillers>[1]) => [text, [...countFillers(text, lang).values()].reduce((a, b) => a + b, 0)];
    const meantEn = [
      "That is what I mean.", "As you know.", "Now you know, so act.", "I know what you know.",
      "Uh-huh.", "Um-hum, yes.", "Mm-hmm.", "Uh huh, go on.", "Uh-oh, the slide is gone.", "Uh-uh, not that one.",
      "It is literally translated.", "Translated literally.", "Basically it is the basis.", "It is basically done.",
      "We err on the side of caution.", "The ER was full.", "The gap is 5 mm.", "Mm, yes.",
      "Mm-mm, not that one.", "Nuh-uh.", "Huh-uh.", "Uh\u2013huh.",
      // a whole sentence is an answer or a statement, not an aside
      "You know.", "I told you. You know.", "Basically.",
    ];
    for (const s of meantEn) expect(n(s, "en")).toEqual([s, 0]);
    const meantIt = [
      "Praticamente tutto.", "Insomma ha vinto.", "Non so come dire.", "Come dire di no?", "Lo facciamo come diciamo.",
      "Diciamo la verità.", "È cresciuto, cioè del venti per cento.", "Com'è andata? Insomma.",
    ];
    for (const s of meantIt) expect(n(s, "it")).toEqual([s, 0]);
    expect(Object.fromEntries(countFillers("Um, you know, it is, basically, done. I mean, uh, er, literally. Uh, uh, well.", "en"))).toEqual({ um: 1, "you know": 1, basically: 1, "I mean": 1, uh: 3, er: 1, literally: 1 });
    expect(Object.fromEntries(countFillers("Ehm, cioè, insomma, abbiamo, praticamente, finito, diciamo. Come dire, sì.", "it"))).toEqual({ ehm: 1, "cioè": 1, insomma: 1, praticamente: 1, diciamo: 1, "come dire": 1 });
  });

  it("a phrase the speech engine cut in two is read with its neighbours: the cut is not a pause", () => {
    const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
    expect(total(countFillers("I mean, more or less.", "en"))).toBe(1);
    expect(total(countFillers("I mean, more or less.", "en", { before: "That is exactly what" }))).toBe(0);
    expect(total(countFillers("And then, I mean", "en"))).toBe(1);
    expect(total(countFillers("And then, I mean", "en", { after: "that we should go" }))).toBe(0);
    expect(total(countFillers("praticamente", "it", { before: "Abbiamo venduto,", after: "tutto" }))).toBe(0);
    expect(total(countFillers("you know", "en", { before: "It grew this year,", after: "" }))).toBe(1);
    const script = parseScript("# A\n- One");
    const log = take(script).start().say(0, 4000, "That is exactly what").say(4500, 6000, "I mean, more or less.").say(7000, 12_000, "As").say(12_500, 14_000, "you know, it grew.").stop(15_000);
    expect(buildRehearsalReport(log, script, { lang: "en" }).fillers.total).toBe(0);
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
    // words in progress were seen: the pace is not flagged as approximate
    expect(en).not.toContain("approximate");
    const it = rehearsalMarkdown(r, "it");
    expect(it).toContain("# Resoconto della prova");
    expect(it).toContain("| Sezione | Tempo | Obiettivo | Punti |");
    expect(it).not.toContain("Talk notes");
  });

  it("writes times and section names as the timer and the screen do: hours, no label prefix, 'not shown', time over", () => {
    const script = parseScript("<!-- target: 60 min -->\n# Intro - Why now (20 min)\n- One\n# Part 2 - Never shown\n- Two");
    const r = buildRehearsalReport(take(script).start().stop(90 * 60_000 + 59_900), script, { lang: "en" });
    const md = rehearsalMarkdown(r, "en");
    expect(md).toContain("- Length: 1:30:59 of 1:00:00 (30:59 over)");
    expect(md).not.toMatch(/\b9[01]:\d\d\b/);
    expect(md).toContain("| Why now | 1:30:59 (+1:10:59) | 20:00 | 1 not reached |");
    expect(md).toContain("| Never shown | not shown | 40:00 | 1 not reached |");
    expect(rehearsalMarkdown(r, "it")).toContain("- Durata: 1:30:59 su 1:00:00 (30:59 oltre)");
    const short = parseScript("<!-- target: 10 min -->\n# A\n- One");
    expect(rehearsalMarkdown(buildRehearsalReport(take(short).start().stop(8 * 60_000), short, { lang: "en" }), "en")).toContain("- Length: 8:00 of 10:00 (2:00 left)");
  });
});
