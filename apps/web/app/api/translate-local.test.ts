import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseScript } from "@filow/core";
import { GET as where, POST as translate } from "./script/translate/route";
import { POST as generate } from "./script/generate/route";
import { placeholderLeaks, restore } from "@/lib/pii/guard";
import { LOCAL_TRANSLATE_CHUNK, pickTranslateModel } from "@/lib/translateLocal";

// Script translation on this PC, against a fake Ollama (fetch is the fake: no real model, no
// network). What is pinned here: nothing leaves the PC on the local path, offline mode translates,
// a chunk that comes back with the wrong shape is asked again and then kept in the original (never
// dropped, never invented), local and cloud are never used one instead of the other, and a masked
// value the cloud model renamed ("[PERSON_NAME]") never reaches the editor.
const OLLAMA = "http://127.0.0.1:11434";
const ROUTER = "https://openrouter.ai/api/v1/chat/completions";
const YES = "script:openrouter/google";

const OUTLINE = `<!-- target: 12 min -->
# Perché nasce Filow (3 min)
- Buongiorno a tutti, sono Marta Bianchi
- Ogni relatore perde il filo almeno una volta
- Un gobbo classico scorre da solo
- Filow ascolta la tua voce

# Come funziona (5 min)
- Il riconoscimento vocale gira sul tuo PC
- Scrivi la scaletta in Markdown, un titolo per sezione
- Se salti un punto, Filow lo tiene in evidenza
- Il timer ti dice se sei in ritardo
- Funziona anche con PowerPoint
- Le slide avanzano quando chiudi la sezione
- Il telefono mostra lo stesso gobbo

# Prossimi passi (4 min)
- La versione 1.8 arriva a gennaio
- Grazie dell'attenzione, ci sono domande?`;

type Chat = { model: string; format: { required: string[] }; messages: Array<{ role: string; content: string }> };
/** How the fake model answers one chunk: by default every line "translated" as "The <line>". */
type Answer = (lines: Record<string, string>, call: number, body: Chat) => unknown;
const translated: Answer = (lines) => Object.fromEntries(Object.entries(lines).map(([k, v]) => [k, `The ${v}`]));

let net: ReturnType<typeof vi.fn>;
let answer: Answer;
let installed: string[];
let ollamaUp: boolean;
let chats: Chat[];
const urls = () => net.mock.calls.map((c) => String(c[0]));
/** requests to anything but the Ollama on this PC */
const notOllama = () => urls().filter((u) => !u.startsWith(`${OLLAMA}/`));
/** requests that leave this PC (the PII sidecar's address is on it) */
const outside = () => urls().filter((u) => !u.startsWith("http://127.0.0.1:"));

const post = (body: unknown, consent?: string) =>
  new Request("http://unit.invalid/api/script/translate", { method: "POST", body: JSON.stringify(body), headers: consent ? { "x-filow-consent": consent } : {} });
const lines = (text: string) => parseScript(text).sections.flatMap((s) => [s.title, ...s.bullets.map((b) => b.text)]);

beforeEach(() => {
  for (const [key, value] of Object.entries({ ACCESS_PASSWORD: "", FILOW_OFFLINE: "", PII_GUARD: "on", PII_SERVER_URL: "http://127.0.0.1:9", SCRIPT_CLOUD: "", GENERATE_PROVIDER: "", DECISION_PROVIDER: "",
    TRANSLATE_LOCAL_MODEL: "", OPENROUTER_API_KEY: "test-key-not-real", OPENROUTER_FALLBACK_MODELS: "", OPENROUTER_GENERATE_MODEL: "", OPENROUTER_GENERATE_VISION_MODEL: "", OLLAMA_URL: OLLAMA })) vi.stubEnv(key, value);
  answer = translated;
  installed = ["lfm3-vl:latest", "gemma4:e2b"];
  ollamaUp = true;
  chats = [];
  net = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith("http://127.0.0.1:9/")) throw new TypeError("fetch failed"); // no PII sidecar
    if (u.startsWith(`${OLLAMA}/`)) {
      if (!ollamaUp) throw new TypeError("fetch failed");
      if (u.endsWith("/api/tags")) return Response.json({ models: installed.map((name) => ({ name })) });
      const body = JSON.parse(String(init?.body)) as Chat;
      chats.push(body);
      const input = JSON.parse(body.messages.find((m) => m.role === "user")!.content) as Record<string, string>;
      const out = answer(input, chats.length, body);
      return Response.json({ message: { content: typeof out === "string" ? out : JSON.stringify(out) } });
    }
    return Response.json({ choices: [{ message: { content: "# CLOUD\n- CLOUD" } }], usage: { cost: 0 } });
  });
  vi.stubGlobal("fetch", net);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("a script is translated on this PC by default", () => {
  it("nothing leaves the PC: every request goes to Ollama, without a consent and without masking", async () => {
    const res = await translate(post({ text: `${OUTLINE}\n- Scrivi a marta@example.invalid`, to: "en" }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(notOllama()).toEqual([]);
    expect(urls().filter((u) => u.endsWith("/api/chat")).length).toBeGreaterThan(0);
    // not masked: the address reaches the local model as written, and comes back
    expect(JSON.stringify(chats)).toContain("marta@example.invalid");
    expect(j).toMatchObject({ where: "local", model: "gemma4:e2b", cost: 0, structureKept: true, untranslated: 0, expected: { sections: 3, points: 14 }, got: { sections: 3, points: 14 } });
    expect(lines(j.text)).toEqual(lines(`${OUTLINE}\n- Scrivi a marta@example.invalid`).map((l) => `The ${l}`));
  });
  it("the talk's and the sections' time targets stay as they were", async () => {
    const j = await (await translate(post({ text: OUTLINE, to: "en" }))).json();
    expect(j.text.split("\n")[0]).toBe("<!-- target: 12 min -->");
    expect(parseScript(j.text).minutes).toBe(12);
    expect(parseScript(j.text).sections.map((s) => s.minutes)).toEqual([3, 5, 4]);
    // "(3 min)" is not sent to the model as part of the title
    expect(JSON.stringify(chats)).not.toContain("min)");
  });
  it("asks in small chunks: no request carries more lines than the chunk size", async () => {
    await translate(post({ text: OUTLINE, to: "en" }));
    // 5 + 8 + 3 lines in three sections: 1 + 2 + 1 requests
    expect(chats.map((c) => c.format.required.length)).toEqual([5, LOCAL_TRANSLATE_CHUNK, 8 - LOCAL_TRANSLATE_CHUNK, 3]);
  });
  it("offline mode translates on this PC instead of saying unavailable", async () => {
    vi.stubEnv("FILOW_OFFLINE", "1");
    const res = await translate(post({ text: OUTLINE, to: "en" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ where: "local", structureKept: true, untranslated: 0 });
    expect(notOllama()).toEqual([]);
  });
  it("uses the best installed translation model, or the configured one", async () => {
    expect(pickTranslateModel(["lfm3-vl:latest", "qwen3-vl:2b", "gemma4:e2b"], "")).toBe("gemma4:e2b");
    expect(pickTranslateModel(["clef-flash:latest", "nomic-embed"], "")).toBeNull();
    expect(pickTranslateModel(["gemma4:e2b", "mymodel:latest"], "mymodel")).toBe("mymodel");
    expect(pickTranslateModel(["gemma4:e2b"], "mymodel")).toBeNull();
  });
});

describe("only the words change: every other line of the script stays as the user wrote it", () => {
  it("comment lines, transition lines, blank lines and Windows line endings come back in place", async () => {
    const text = ["<!-- slides -->", "<!-- target: 9 min -->", "# Apertura (2 min)", "<!-- slow down here -->", "- Ogni relatore perde il filo", "", "_Passiamo ora alla demo._", "", "## Demo [3 min]", "* Filow ascolta la tua voce", "<!-- slide: 4 -->"].join("\r\n");
    const j = await (await translate(post({ text, to: "en" }))).json();
    expect(j.text.split("\r\n")).toEqual(["<!-- slides -->", "<!-- target: 9 min -->", "# The Apertura (2 min)", "<!-- slow down here -->", "- The Ogni relatore perde il filo", "", "_The Passiamo ora alla demo._", "", "## The Demo [3 min]", "* The Filow ascolta la tua voce", "<!-- slide: 4 -->"]);
    expect(j).toMatchObject({ structureKept: true, untranslated: 0, expected: { sections: 2, points: 2 }, got: { sections: 2, points: 2 } });
    // the comments and the time targets never reached the model
    expect(JSON.stringify(chats)).not.toMatch(/slow down|slide: 4|min\)|3 min/);
  });
  it("points before the first heading get no heading that the user did not write", async () => {
    const j = await (await translate(post({ text: "- primo punto\n- secondo punto\n# Dopo\n- terzo", to: "en" }))).json();
    expect(j.text).toBe("- The primo punto\n- The secondo punto\n# The Dopo\n- The terzo");
    expect(JSON.stringify(chats)).not.toContain("Untitled");
  });
  it("a good Italian line is not taken for Spanish or English", async () => {
    answer = () => ({ l1: "Passa al menu e clicca su Salva subito dopo", l2: "Clicca su Avanti, poi su Salva subito", l3: "Apri il menu e scegli Esporta come PDF" });
    const j = await (await translate(post({ text: "# Go to the second point, then back to the first\n- Click Next, then Save right away\n- Open the menu and pick Export as PDF", to: "it" }))).json();
    expect(j).toMatchObject({ untranslated: 0 });
  });
});
describe("a chunk that comes back wrong", () => {
  it("is asked once more, and the second answer is used", async () => {
    // first answer of the first chunk lacks a line
    answer = (l, call) => (call === 1 ? Object.fromEntries(Object.entries(translated(l, call, {} as Chat) as Record<string, string>).slice(1)) : translated(l, call, {} as Chat));
    const j = await (await translate(post({ text: OUTLINE, to: "en" }))).json();
    expect(j).toMatchObject({ untranslated: 0, structureKept: true });
    expect(lines(j.text)).toEqual(lines(OUTLINE).map((l) => `The ${l}`));
    expect(chats).toHaveLength(5);
  });
  it("wrong twice: its lines stay in the original and the answer says which section, nothing dropped or invented", async () => {
    // the model merges the two last lines of the second section's first chunk, every time
    answer = (l, call, body) => (body.messages[1].content.includes("riconoscimento") ? { l1: "The merged", l2: "The merged", extra: "an invented point" } : translated(l, call, body));
    const j = await (await translate(post({ text: OUTLINE, to: "en" }))).json();
    const src = lines(OUTLINE);
    const got = lines(j.text);
    expect(got).toHaveLength(src.length);
    expect(j).toMatchObject({ structureKept: true, untranslated: LOCAL_TRANSLATE_CHUNK, untranslatedSections: [2], got: { sections: 3, points: 13 } });
    // the chunk is the source, word for word; the rest is translated
    expect(got.slice(5, 5 + LOCAL_TRANSLATE_CHUNK)).toEqual(src.slice(5, 5 + LOCAL_TRANSLATE_CHUNK));
    expect(got.filter((l) => l.startsWith("The "))).toHaveLength(src.length - LOCAL_TRANSLATE_CHUNK);
    expect(j.text).not.toContain("invented");
  });
  it("an answer that is not JSON at all is treated the same way", async () => {
    answer = () => "Sure! Here is the translation:";
    const j = await (await translate(post({ text: OUTLINE, to: "en" }))).json();
    expect(j).toMatchObject({ untranslated: 16, untranslatedSections: [1, 2, 3] });
    expect(lines(j.text)).toEqual(lines(OUTLINE));
  });
  it("a sentence handed back word for word counts as not translated, line by line", async () => {
    answer = (l, call, body) => ({ ...(translated(l, call, body) as Record<string, string>), l2: l.l2 });
    const j = await (await translate(post({ text: "# Titolo\n- Ogni relatore perde il filo\n- Filow ascolta la tua voce", to: "en" }))).json();
    expect(j).toMatchObject({ untranslated: 1, untranslatedSections: [1] });
    expect(lines(j.text)).toEqual(["The Titolo", "Ogni relatore perde il filo", "The Filow ascolta la tua voce"]);
  });
  it("a line in the wrong writing system is not accepted as Russian or Japanese", async () => {
    answer = () => ({ l1: "タイトル", l2: "Every speaker loses the thread at least once" });
    const ja = await (await translate(post({ text: "# Titolo\n- Ogni relatore perde il filo", to: "ja" }))).json();
    expect(ja).toMatchObject({ untranslated: 1 });
    expect(lines(ja.text)).toEqual(["タイトル", "Ogni relatore perde il filo"]);
    answer = () => ({ l1: "Заголовок", l2: "Каждый докладчик теряет 任何人" });
    const ru = await (await translate(post({ text: "# Titolo\n- Ogni relatore perde il filo", to: "ru" }))).json();
    expect(lines(ru.text)).toEqual(["Заголовок", "Ogni relatore perde il filo"]);
  });
  it("a sentence reworded in the source language is not accepted as a translation", async () => {
    // the model "translates" the second line into Italian again, with other words (measured with small models)
    answer = () => ({ l1: "Title", l2: "Qualsiasi oratore smarrisce il filo del discorso almeno una volta", l3: "Filow listens to your voice and ticks off the points" });
    const en = await (await translate(post({ text: "# Titolo\n- Ogni relatore perde il filo almeno una volta\n- Filow ascolta la tua voce e spunta i punti", to: "en" }))).json();
    expect(en).toMatchObject({ untranslated: 1, untranslatedSections: [1] });
    expect(lines(en.text)).toEqual(["Title", "Ogni relatore perde il filo almeno una volta", "Filow listens to your voice and ticks off the points"]);
    // and the other way round: English handed back when Italian was asked for
    answer = () => ({ l1: "Titolo", l2: "Every speaker loses the thread at least once, it happens to you" });
    const it = await (await translate(post({ text: "# Title\n- Each speaker drops the thread one time or more", to: "it" }))).json();
    expect(it).toMatchObject({ untranslated: 1 });
    // a short line, and a line with no small word of any language, are left alone
    answer = () => ({ l1: "PowerPoint, Markdown e Filow", l2: "Grazie mille" });
    expect(await (await translate(post({ text: "# PowerPoint, Markdown and Filow\n- Thank you very much", to: "it" }))).json()).toMatchObject({ untranslated: 0 });
  });

  it("markers and line breaks a model adds do not become new points", async () => {
    answer = () => ({ l1: "# Title", l2: "- First\n- Second" });
    const j = await (await translate(post({ text: "# Titolo\n- Primo e secondo", to: "en" }))).json();
    expect(lines(j.text)).toEqual(["Title", "First - Second"]);
  });
});

describe("local and cloud are never used one instead of the other", () => {
  it("Ollama not running: the answer says so and nothing goes to the cloud, even with the yes on record", async () => {
    ollamaUp = false;
    const res = await translate(post({ text: OUTLINE, to: "en" }, YES));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ unavailable: "ollama_down" });
    expect(notOllama()).toEqual([]);
  });
  it("no translation model installed: the answer says so and nothing goes to the cloud", async () => {
    installed = ["clef-flash:latest"];
    const res = await translate(post({ text: OUTLINE, to: "en" }, YES));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ unavailable: "no_model" });
    expect(notOllama()).toEqual([]);
  });
  it("Ollama stops in the middle: no half translation and no cloud", async () => {
    answer = (l, call, body) => {
      if (call === 2) ollamaUp = false;
      return translated(l, call, body);
    };
    const res = await translate(post({ text: OUTLINE, to: "en" }, YES));
    expect(res.status).toBe(503);
    const j = await res.json();
    expect(j).toMatchObject({ unavailable: "ollama_down" });
    expect(j.text).toBeUndefined();
    expect(notOllama()).toEqual([]);
  });
  it("the cloud, asked for by name, does not use the local model, and still needs the yes", async () => {
    expect((await translate(post({ text: OUTLINE, to: "en", provider: "cloud" }))).status).toBe(403);
    expect(net).not.toHaveBeenCalled();
    const res = await translate(post({ text: "# A\n- B", to: "en", provider: "cloud" }, YES));
    expect(await res.json()).toMatchObject({ where: "openrouter", text: "# CLOUD\n- CLOUD" });
    expect(outside()).toEqual([ROUTER]);
    expect(urls().filter((u) => u.startsWith(`${OLLAMA}/`))).toEqual([]);
  });
  it("offline, the cloud asked for by name is refused, not translated locally instead", async () => {
    vi.stubEnv("FILOW_OFFLINE", "1");
    expect(await (await translate(post({ text: OUTLINE, to: "en", provider: "cloud" }, YES))).json()).toMatchObject({ unavailable: "disabled" });
    expect(net).not.toHaveBeenCalled();
  });
  it("the editor can ask where a translation would run", async () => {
    expect(await (await where(new Request("http://unit.invalid/api/script/translate"))).json()).toEqual({ local: { ok: true, model: "gemma4:e2b" }, cloud: "openrouter", offline: false, ollamaHost: null });
    ollamaUp = false;
    expect((await (await where(new Request("http://unit.invalid/api/script/translate"))).json()).local).toEqual({ ok: false, reason: "ollama_down" });
    expect(notOllama()).toEqual([]);
    // an Ollama on another computer is named, so the editor does not say "on this PC"
    vi.stubEnv("OLLAMA_URL", "http://192.168.1.50:11434");
    expect((await (await where(new Request("http://unit.invalid/api/script/translate"))).json()).ollamaHost).toBe("192.168.1.50");
    vi.stubEnv("OLLAMA_URL", OLLAMA);
  });
});

describe("a masked value never reaches the editor as a placeholder", () => {
  const cloudSays = (content: string) =>
    net.mockImplementation(async (url: string) => {
      if (String(url).startsWith("http://127.0.0.1:9/")) throw new TypeError("fetch failed");
      return Response.json({ choices: [{ message: { content } }], usage: { cost: 0 } });
    });
  const source = "# PARTE I - Chi è marta@example.invalid?\n- Scrivile a marta@example.invalid\n- Poi ci vediamo";

  it("the owner's bug: the cloud model renamed the placeholder and the title was saved with it", async () => {
    // "[EMAIL_1]" went out; the model answered with a name of its own for it
    cloudSays("# PART I - Who is [PERSON_NAME]?\n- Write to her at [EMAIL_1]\n- See you then");
    const j = await (await translate(post({ text: source, to: "en", provider: "cloud" }, YES))).json();
    expect(JSON.stringify(net.mock.calls)).toContain("[EMAIL_1]");
    expect(j.text).not.toMatch(/\[[A-Z_]+\d*\]/);
    // the title is the source's again and is counted; the lines that came back whole are translated
    expect(lines(j.text)).toEqual(["PARTE I - Chi è marta@example.invalid?", "Write to her at marta@example.invalid", "See you then"]);
    expect(j).toMatchObject({ untranslated: 1, untranslatedSections: [1], structureKept: true });
  });
  it("a placeholder with other spacing or case is still put back", async () => {
    cloudSays("# PART I - Who is [email 1]?\n- Write to her at [ EMAIL_1 ]\n- See you then");
    const j = await (await translate(post({ text: source, to: "en", provider: "cloud" }, YES))).json();
    expect(lines(j.text)).toEqual(["PART I - Who is marta@example.invalid?", "Write to her at marta@example.invalid", "See you then"]);
    expect(j.untranslated).toBe(0);
  });
  it("with the structure lost there is no source line to take: the translation fails and nothing is returned", async () => {
    cloudSays("# PART I - Who is [PERSON_NAME]?\n- Write to her");
    const res = await translate(post({ text: source, to: "en", provider: "cloud" }, YES));
    expect(res.status).toBe(502);
    expect((await res.json()).text).toBeUndefined();
  });
  it("brackets the user wrote are theirs and stay", async () => {
    cloudSays("# Intro [TODO]\n- Hello");
    const j = await (await translate(post({ text: "# Intro [TODO]\n- Ciao", to: "en", provider: "cloud" }, YES))).json();
    expect(j).toMatchObject({ text: "# Intro [TODO]\n- Hello", untranslated: 0 });
    expect(placeholderLeaks("Who is [PERSON_NAME]? [TODO] [note]", "x [TODO]")).toEqual(["[PERSON_NAME]"]);
    expect(restore("a [fullname_2] b [FULLNAME 1]", new Map([["[FULLNAME_1]", "Ada"], ["[FULLNAME_2]", "Bo"]]))).toBe("a Bo b Ada");
  });
  it("a placeholder in other brackets or other letters is put back or caught; a speaker's own cue in brackets is not one", async () => {
    const map = new Map([["[EMAIL_1]", "a@b.invalid"]]);
    expect(restore("\u3010EMAIL_1\u3011 \uFF3BEMAIL_1\uFF3D {email 1} <EMAIL_1>", map)).toBe("a@b.invalid a@b.invalid a@b.invalid a@b.invalid");
    const caught = ["[PERSON_NAME]", "[Person_Name]", "[\u041F\u041E\u041B\u041D\u041E\u0415_\u0418\u041C\u042F_1]", "\u3010FULLNAME_1\u3011", "<PERSON>", "{FULLNAME_2}", "[EMAIL]", "[PHONE 2]", "[PR\u00C9NOM_1]"];
    for (const ph of caught) expect(placeholderLeaks(`Chi \u00E8 ${ph}?`, "Chi \u00E8 Ada?"), ph).toEqual([ph]);
    for (const own of ["[PAUSE]", "[LIVE DEMO]", "[CLIENT NAME]", "[applause]", "<b>", "{x}", "[1]", "(PERSON_NAME)"]) expect(placeholderLeaks(`Now ${own} then`, "x"), own).toEqual([]);
    // the cloud translating the user's own cue does not cost the line
    cloudSays("# Intro\n- Greet [CLIENT NAME] and [PAUSE]");
    const j = await (await translate(post({ text: "# Intro\n- Saluta [NOME CLIENTE] e [PAUSA]", to: "en", provider: "cloud" }, YES))).json();
    expect(j).toMatchObject({ text: "# Intro\n- Greet [CLIENT NAME] and [PAUSE]", untranslated: 0 });
  });
  it("a stage cue the slide writer adds is not a placeholder and does not fail the slide", async () => {
    cloudSays(JSON.stringify({ title: "Intro", points: ["[PAUSE] Then the [LIVE DEMO]"] }));
    const ok = await (await generate(post({ provider: "openrouter", slides: [{ index: 0, text: "Benvenuti alla demo" }] }, YES))).text();
    expect(ok).toContain('"done":true');
    expect(ok).toContain("[LIVE DEMO]");
  });  it("a script written from slides: a renamed placeholder fails the slide instead of landing in a title or a point", async () => {
    const deck = { provider: "openrouter", slides: [{ index: 0, text: "Che cos'è? Scrivi a marta@example.invalid per saperlo" }] };
    const generated = (o: unknown) => cloudSays(JSON.stringify(o));
    generated({ title: "PARTE I - Che cos'è [PERSON_NAME]?", points: ["Scrivi a [EMAIL_1]"] });
    const bad = await (await generate(post(deck, YES))).text();
    expect(bad).not.toContain('"done":true');
    expect(bad).toContain('"error"');
    expect(bad).not.toContain("# PARTE I");
    generated({ title: "PARTE I", points: ["Scrivi a [EMAIL_1]"] });
    const ok = await (await generate(post(deck, YES))).text();
    expect(ok).toContain('"done":true');
    expect(ok).toContain("Scrivi a marta@example.invalid");
  });
});
