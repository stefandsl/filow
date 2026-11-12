import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as ask } from "@/app/api/buddy/ask/route";
import { GET as photo } from "@/app/api/buddy/photo/route";
import { parseBuddyAnswer } from "./prompt";
import { readFileSync } from "node:fs";
import { parsePhotoLookup, photoAnswer, photoLookup, photoOnly, wantsPhoto } from "./photo";
import { OKF_TEXT } from "./text";
import { wantsDrawing } from "./visuals";

// The owner asked "show me a picture of a heart" and "a rocket photo" and got a card with a real
// photo from the online model. Local models rarely write the card, so a plain photo request makes
// the card itself. No network here: every fetch is a stub.

describe("a plain request for a photo is recognised in the five languages", () => {
  it.each([
    ["show me a picture of a heart", "heart", "en"],
    ["Show me a rocket photo", "rocket", "en"],
    ["can you show me a photo of the Eiffel Tower?", "Eiffel Tower", "en"],
    ["find me an image of a red panda please", "red panda", "en"],
    // the owner's own wordings: where it is shown or where it comes from is not part of the thing
    ["show me a heart image on my screen", "heart", "en"],
    ["pull up a heart image from the web", "heart", "en"],
    ["I want to see a photo of a rocket", "rocket", "en"],
    ["show me a picture of a heart, please", "heart", "en"],
    ["покажи мне, пожалуйста, фото ракеты", "ракеты", "ru"],
    // only the user's own words count: the selected text the panel adds on the next lines does not
    ["show me a picture of a heart\n(Text I have selected: \"click this button here\")", "heart", "en"],
    ["mostrami una foto di un cuore", "cuore", "it"],
    ["mostrami la foto di un razzo", "razzo", "it"],
    ["fammi vedere un'immagine della Torre di Pisa", "Torre di Pisa", "it"],
    ["arată-mi o poză cu o inimă", "inimă", "ro"],
    ["găsește o fotografie a unei rachete", "rachete", "ro"],
    ["покажи фото сердца", "сердца", "ru"],
    ["найди мне картинку ракеты", "ракеты", "ru"],
    ["ハートの写真を見せて", "ハート", "ja"],
    ["ロケットの画像を表示してください", "ロケット", "ja"],
  ] as const)("%s -> %s (%s)", (q, subject, lang) => expect(wantsPhoto(q)).toEqual({ subject, lang }));

  it.each([
    "", "what is a heart?", "how do I take a photo of my screen?", "show me this picture", "where is the photo of my dog?",
    "show me a picture of this", "mostrami la foto di questo", "come faccio una foto dello schermo?", "покажи фото этого",
    "delete the photo", "open Photos", "is this a picture of a heart?", "この写真を見せて",
    // found in review: the user's own pictures and files, sets of photos, and words with no request to see anything
    "a picture of a rocket", "show me the picture", "find photos of cats", "show me the docker images", "find duplicate photos", "find all photos",
    "photo of the error message", "show me an image of the file on the desktop", "find a picture of me", "show me a photo of yesterday",
    "картинка не загружается", "фото в папке загрузки", "покажи фото в папке", "foto di ieri", "immagine di sfondo", "mostrami la foto di ieri",
    "imagine de fundal", "arată-mi o poză de ieri", "昨日の写真", "旅行の写真を探して", "昨日の写真を見せて",
    // the words are in the selected text the panel adds on the next lines, not in what the user said
    "What does it mean?\n(Text I have selected: \"show me a picture of a heart\")",
  ])("%s -> not a photo request", (q) => expect(wantsPhoto(q)).toBeNull());

  it("a request to draw stays a drawing", () => {
    expect(wantsDrawing("draw a picture of a heart")).toBe("2d");
  });

  it("the card alone answers a plain photo request, but not a drawing and not a continuation after Stop", () => {
    expect(photoOnly("show me a picture of a heart")).toEqual({ subject: "heart", lang: "en" });
    expect(photoOnly("show me a picture of a heart", { drawing: true })).toBeNull();
    expect(photoOnly("show me a picture of a heart", { resume: true })).toBeNull();
    expect(photoOnly("what is on my screen?")).toBeNull();
  });

  it("the panel asks the same rule before it looks at where answers come from, so no cloud notice opens for a photo", () => {
    const panel = readFileSync(new URL("../../app/okfilow/panel/page.tsx", import.meta.url), "utf8");
    expect(panel).toContain('const photo = photoOnly(question, { drawing: wantsDrawing(question) !== null, resume: !!resume });');
    expect(panel).toContain('let route = photo ? "local" : askRoute(statusRef.current);');
    // nor a notice for the user's own server: a photo is answered by the card alone
    expect(panel).toContain('const viaServer = !photo && route === "local"');
    // the reason for a card without its picture is given at every no, not only the first
    expect(panel).toContain('if (decision === "declined" && run.current === id) setNote(t("kept_photo"));');
  });
});

describe("the answer to a photo request is a card the page can show", () => {
  const screens = [{ index: 1, width: 1024, height: 576, cursor: true }];
  it("carries the subject as the card's title and as the photo to look up", () => {
    const { text, cards } = parseBuddyAnswer(photoAnswer({ subject: "heart", lang: "en" }, OKF_TEXT.en.photoHere), screens);
    expect(text).toBe("Here is heart, with a photo from Wikipedia.");
    expect(cards).toEqual([{ x: 500, y: 400, title: "heart", text: "", photo: "heart", screen: 1 }]);
  });
  it("names the Wikipedia of the question's language", () => {
    const { cards } = parseBuddyAnswer(photoAnswer({ subject: "cuore", lang: "it" }, OKF_TEXT.it.photoHere), screens);
    expect(cards[0]).toMatchObject({ title: "cuore", photo: "it/cuore" });
    expect(parsePhotoLookup(cards[0].photo)).toEqual({ wiki: "it", name: "cuore" });
    expect(parsePhotoLookup("Piston")).toEqual({ wiki: "en", name: "Piston" });
    expect(photoLookup({ subject: "ハート", lang: "ja" })).toBe("ja/ハート");
  });
  it("a subject cannot break out of the card", () => {
    const { cards, text } = parseBuddyAnswer(photoAnswer({ subject: "a]b|c[d:e", lang: "en" }, "{subject}."), screens);
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe("a b c d e");
    expect(text).toBe("a b c d e.");
  });
  it("is said in each of the five languages", () => {
    for (const table of Object.values(OKF_TEXT)) {
      expect(table.photoHere).toContain("{subject}");
      expect(table.photoOffline.length).toBeGreaterThan(20);
    }
  });
});

describe("the routes", () => {
  let net: ReturnType<typeof vi.fn>;
  const post = (body: unknown) => new Request("http://unit.invalid/api/buddy/ask", { method: "POST", body: JSON.stringify(body) });
  const get = (q: string) => new Request(`http://unit.invalid/api/buddy/photo?q=${encodeURIComponent(q)}`, { headers: { "x-filow-consent": "photo:wikipedia" } });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  beforeEach(() => {
    vi.stubEnv("ACCESS_PASSWORD", "");
    vi.stubEnv("FILOW_OFFLINE", "");
    net = vi.fn(async () => { throw new Error("no network in this test"); });
    vi.stubGlobal("fetch", net);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("a photo request is answered at once with the card: no model, no provider, no screenshot, nothing sent", async () => {
    // "cloud" without a yes would be refused (403) for any other question: this one needs no provider at all
    const res = await ask(post({ question: "show me a picture of a heart", provider: "cloud", sees: false, screens: [{ index: 1, width: 10, height: 10 }] }));
    expect(res.status).toBe(200);
    expect(res.headers.get("X-Buddy-Sees")).toBe("text");
    expect(await res.text()).toBe("Here is heart, with a photo from Wikipedia. [CARD:500,400:heart||heart]");
    expect(net).not.toHaveBeenCalled();
  });
  it("answers in the question's language and looks the photo up in that Wikipedia", async () => {
    const res = await ask(post({ question: "mostrami una foto di un cuore", provider: "local", sees: false, screens: [] }));
    expect(res.headers.get("X-Buddy-Lang")).toBe("it");
    expect(await res.text()).toBe("Ecco cuore, con una foto da Wikipedia. [CARD:500,400:cuore||it/cuore]");
  });
  it("in Offline mode it says in one sentence why no photo comes, and makes no card", async () => {
    vi.stubEnv("FILOW_OFFLINE", "1");
    const res = await ask(post({ question: "show me a rocket photo", provider: "local", sees: false, screens: [] }));
    const said = await res.text();
    expect(said).toBe(OKF_TEXT.en.photoOffline);
    expect(said).not.toContain("[CARD");
    expect(net).not.toHaveBeenCalled();
  });

  it("the photo comes from the Wikipedia the card names, by title", async () => {
    net.mockImplementation(async (url: string) => {
      if (url.startsWith("https://it.wikipedia.org/api/rest_v1/page/summary/cuore")) return json({ thumbnail: { source: "https://upload.wikimedia.org/x/330px-Cuore.jpg" } });
      if (url === "https://upload.wikimedia.org/x/330px-Cuore.jpg") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
      throw new Error(`unexpected ${url}`);
    });
    const res = await photo(get("it/cuore"));
    expect(await res.json()).toEqual({ dataUrl: "data:image/jpeg;base64,AQID" });
    expect(net.mock.calls.map((c) => String(c[0]))).toEqual(["https://it.wikipedia.org/api/rest_v1/page/summary/cuore?redirect=true", "https://upload.wikimedia.org/x/330px-Cuore.jpg"]);
  });
  it("when no page has that title it takes the first page Wikipedia's search finds, and sends only the subject", async () => {
    net.mockImplementation(async (url: string) => {
      if (url.includes("/api/rest_v1/page/summary/")) return json({}, 404);
      if (url === "https://ru.wikipedia.org/w/rest.php/v1/search/page?q=%D1%81%D0%B5%D1%80%D0%B4%D1%86%D0%B0&limit=3") return json({ pages: [{ thumbnail: null }, { thumbnail: { url: "//upload.wikimedia.org/y/60px-Heart.png" } }] });
      if (url === "https://upload.wikimedia.org/y/330px-Heart.png") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } });
      throw new Error(`unexpected ${url}`);
    });
    const res = await photo(get("ru/сердца"));
    expect(await res.json()).toEqual({ dataUrl: "data:image/png;base64,AQID" });
    // every address asked is Wikipedia's or Wikimedia's
    for (const call of net.mock.calls) expect(String(call[0])).toMatch(/^https:\/\/(ru\.wikipedia\.org|upload\.wikimedia\.org)\//);
  });
  it("an address that is not Wikimedia's is never fetched", async () => {
    net.mockImplementation(async (url: string) => {
      if (url.includes("/api/rest_v1/page/summary/")) return json({ thumbnail: { source: "https://evil.example/x.jpg" } });
      throw new Error(`unexpected ${url}`);
    });
    expect(await (await photo(get("Piston"))).json()).toEqual({ dataUrl: null });
    expect(net).toHaveBeenCalledTimes(1);
  });
});
