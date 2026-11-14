// OK Filow's opt-in memory (okfilow-memory.js, docs/okfilow/MEMORY.md): off by default, only on this
// PC, never anything forbidden, Delete really deletes, recall picks the right facts.
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const { createMemory, keepFacts, recall, refusal, MAX_NEW, MAX_RECALL } = require("./okfilow-memory.js");
const { nextCfg, DEFAULTS } = require("./okfilow.js");

type Fact = { id: string; kind: "answer" | "me"; text: string; at: string; question: string };
const parent = path.resolve("tmp/memory-tests");
const dirs: string[] = [];
afterEach(() => {
  // Only the folders these tests made, inside their own parent.
  for (const dir of dirs.splice(0)) if (path.dirname(dir) === parent) fs.rmSync(dir, { recursive: true, force: true });
});
function profile() {
  fs.mkdirSync(parent, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parent, "profile-"));
  dirs.push(dir);
  return dir;
}

describe("the memory switch", () => {
  it("is off by default and only an explicit true turns it on", () => {
    expect(DEFAULTS.memory).toBe(false);
    expect(nextCfg({}, {}).memory).toBe(false);
    expect(nextCfg({}, { memory: "yes" }).memory).toBe(false);
    expect(nextCfg({}, { memory: true }).memory).toBe(true);
    expect(nextCfg({ memory: true }, { speed: 1.2 }).memory).toBe(true);
  });

  it("off: nothing is stored and nothing is recalled, the file is never created", () => {
    const m = createMemory(profile());
    expect(m.learn(false, "Please answer in short sentences", [{ kind: "answer", text: "Answer in short sentences" }])).toEqual([]);
    expect(m.learn(undefined, "Please answer in short sentences", [{ kind: "answer", text: "Answer in short sentences" }])).toEqual([]);
    expect(fs.existsSync(m.file)).toBe(false);
    expect(m.list()).toEqual([]);
    m.learn(true, "Please answer in short sentences", [{ kind: "answer", text: "Answer in short sentences" }]);
    expect(m.recall(false, "how do I export")).toEqual([]);
    expect(m.recall(true, "how do I export")).toHaveLength(1);
  });
});

describe("what may be kept", () => {
  const q = "My presentation is about solar panels, and please answer in short sentences";
  it("keeps short facts the user said, with when and the question they came from", () => {
    const m = createMemory(profile());
    const kept = m.learn(true, q, [{ kind: "me", text: "The user's presentation is about solar panels" }, { kind: "answer", text: "Answer in short sentences" }]) as Fact[];
    expect(kept.map((f) => f.text)).toEqual(["The user's presentation is about solar panels", "Answer in short sentences"]);
    const stored = JSON.parse(fs.readFileSync(m.file, "utf8")).facts as Fact[];
    expect(stored).toHaveLength(2);
    expect(stored[0].question).toBe(q);
    expect(Number.isNaN(Date.parse(stored[0].at))).toBe(false);
    // the file is in the profile folder it was given, nowhere else
    expect(m.file.startsWith(parent)).toBe(true);
  });

  it("at most three from one answer, and never the same fact twice", () => {
    const many = ["solar panels talk", "presentation solar", "short sentences", "panels and sentences"].map((text) => ({ kind: "me", text }));
    expect(keepFacts(q, many)).toHaveLength(MAX_NEW);
    const m = createMemory(profile());
    m.learn(true, q, [{ kind: "answer", text: "Answer in short sentences" }]);
    expect(m.learn(true, q, [{ kind: "answer", text: "answer in  SHORT sentences" }])).toEqual([]);
    expect(m.list()).toHaveLength(1);
  });

  // Fixtures of forbidden content: each is refused for its own reason, even when the question holds it.
  const forbidden: Array<[string, string, string]> = [
    ["secret", "my password is hunter2 please remember it", "The user's password is hunter2"],
    ["secret", "il mio pin della banca è il mio compleanno", "Il pin dell'utente è il compleanno"],
    ["secret", "мой пароль от почты котик", "Пароль пользователя котик"],
    ["number", "my employee number is 4471 2209", "The user's employee number is 4471 2209"],
    ["number", "my badge code is AB12CD", "The user's badge code is AB12CD"],
    ["address", "my email is ana@example.com, write to it", "The user's email is ana@example.com"],
    ["address", "I read this on example.com today", "The user reads example.com"],
    ["others", "my boss Marco wants the report on Friday", "The user's boss Marco wants the report on Friday"],
    ["others", "mia moglie lavora in banca", "La moglie dell'utente lavora in banca"],
    ["others", "моя коллега Анна ведёт проект", "Коллега пользователя Анна ведёт проект"],
    ["others", "上司は短い答えが好きです", "上司は短い答えが好き"],
    ["unsaid", "what is on this slide?", "The slide shows quarterly revenue for Contoso"],
    ["long", "tell me about panels", `The user likes panels ${"very ".repeat(40)}much`],
  ];
  it.each(forbidden)("refuses %s: %s", (why, question, text) => {
    expect(refusal(text, question)).toBe(why);
    const m = createMemory(profile());
    expect(m.learn(true, question, [{ kind: "me", text }])).toEqual([]);
    expect(fs.existsSync(m.file)).toBe(false);
  });

  it("a question that names a password teaches nothing, not even its harmless part", () => {
    expect(keepFacts("answer in short sentences, and my password is in the drawer", [{ kind: "answer", text: "Answer in short sentences" }])).toEqual([]);
  });

  it("does not refuse ordinary words that look like forbidden ones", () => {
    for (const [text, question] of [
      ["Answer in short sentences", "please answer in short sentences"],
      ["Rispondi in poche parole", "rispondi in poche parole per favore"],
      ["Отвечай в другом формате, списком", "отвечай в другом формате, списком"],
      ["The user is pinning slides in PowerPoint", "I am pinning slides in PowerPoint"],
      ["L'utente lavora con materiale per la scuola", "sono un insegnante, lavoro con materiale per la scuola"],
      ["Răspunde scurt, utilizatorul preferă liste", "răspunde scurt, prefer liste"],
      ["ユーザーの母語はイタリア語", "私の母語はイタリア語です"],
    ]) expect(refusal(text, question), text).toBeNull();
  });

  it("the stored question has numbers, codes and addresses masked", () => {
    const [f] = keepFacts("I teach physics, my desk phone is 555 0199 and site school.org", [{ kind: "me", text: "The user teaches physics" }]) as Fact[];
    expect(f.question).not.toMatch(/555|0199|school\.org/);
    expect(f.question).toContain("I teach physics");
  });
});

describe("Delete", () => {
  it("one: gone from the file on disk; all: the file is gone", () => {
    const m = createMemory(profile());
    const kept = m.learn(true, "I teach physics and I prefer answers as lists", [{ kind: "me", text: "The user teaches physics" }, { kind: "answer", text: "Answers as lists" }]) as Fact[];
    expect(kept).toHaveLength(2);
    m.remove(kept[0].id);
    const raw = fs.readFileSync(m.file, "utf8");
    expect(raw).not.toContain("The user teaches physics");
    expect(raw).not.toContain(kept[0].id);
    expect(raw).toContain("Answers as lists");
    m.clear();
    expect(fs.existsSync(m.file)).toBe(false);
    expect(fs.existsSync(`${m.file}.tmp`)).toBe(false);
    expect(m.list()).toEqual([]);
  });

  it("deleting the last fact removes the file too", () => {
    const m = createMemory(profile());
    const [f] = m.learn(true, "I teach physics", [{ kind: "me", text: "The user teaches physics" }]) as Fact[];
    m.remove(f.id);
    expect(fs.existsSync(m.file)).toBe(false);
  });
});

describe("recall by shared words (a fixed set)", () => {
  const fact = (id: string, kind: "answer" | "me", text: string): Fact => ({ id, kind, text, at: "2026-11-14T10:00:00.000Z", question: "" });
  const set = [
    fact("style-old", "answer", "Answer in short sentences"),
    fact("solar", "me", "The user's presentation is about solar panels"),
    fact("excel", "me", "The user works with Excel pivot tables every day"),
    fact("italian", "me", "The user writes slides in Italian"),
    fact("garden", "me", "The user grows tomatoes in a garden"),
    fact("style-new", "answer", "Use numbered steps"),
    fact("chart", "me", "The user likes charts with solar data"),
  ];
  it("how to answer always comes first, newest first; then the facts that share the most words", () => {
    expect(recall("How do I add a chart about solar panels to my presentation?", set).map((f: Fact) => f.id)).toEqual(["style-new", "style-old", "solar", "chart"]);
    expect(recall("Make a pivot table in Excel", set).map((f: Fact) => f.id)).toEqual(["style-new", "style-old", "excel"]);
    expect(recall("Che tempo fa?", set).map((f: Fact) => f.id)).toEqual(["style-new", "style-old"]);
  });
  it("never more than five", () => {
    const lots = Array.from({ length: 9 }, (_, i) => fact(`p${i}`, "me", `The user likes panels number ${i}`));
    expect(recall("panels", lots)).toHaveLength(MAX_RECALL);
  });
  it("Japanese is matched two characters at a time", () => {
    const ja = [fact("ja", "me", "ユーザーの発表は太陽光パネルについて"), fact("other", "me", "ユーザーは庭でトマトを育てる")];
    expect(recall("太陽光パネルの図を追加して", ja).map((f: Fact) => f.id)).toEqual(["ja"]);
  });
});
