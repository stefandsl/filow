import { describe, expect, it } from "vitest";
import { parseBuddyAnswer } from "./prompt";
import { parseBuddyAnswer as main } from "./fixtures/main-prompt";

const screens = [{ index: 1, width: 1920, height: 1080, cursor: true }];
const drawing = '```drawing2d\n{"title":"Map","shapes":[{"type":"circle","cx":20,"cy":20,"r":10}]}\n```';
const model = '```model3d\n{"title":"Engine","parts":[{"name":"Block","shape":"box","size":[2,2,1]}]}\n```';
const tags = ["[POINT:100,100:Target]", "[CARD:100,100:Title|Text|]", "[MEDIA:photo:Sun]", "[SLIDE:Title|One;Two|]", drawing, model];
const corpus = [
  "", "Hello.", "Ciao, ecco la risposta.\nI nomi sono stati nascosti.",
  "Before. [CARD:bad] After.\nNames were hidden.",
  "Prima. [CARD:bad [EMAIL]] Dopo.\nI nomi sono stati nascosti.",
  "Before. [CARD:100,100:Title|Text|] After.",
  "[CARD:-1,20:Title|Text|]", "[CARD:1,2:|Text]", "[CARD:1,2:Title|Text:screen9]",
  "Before. [CARD:1,2:unfinished", "Before. [CAR", "Before. [CARD:bad [EMAIL]",
  "Before. [CARD:1,2:Open [|Text|] After.",
  "Before. [CARD:1,2:Title|Open [|Photo [] After.",
  ...tags.flatMap((tag) => [
    `Before. [CARD:bad\n${tag}\nAfter.\nNames were hidden.`,
    `Prima. [CARD:bad [EMAIL] ${tag} Dopo.\nI nomi sono stati nascosti.`,
    `Before. [CARD:bad] Middle. ${tag} After.\nNames were hidden.`,
    `Prima. ${tag} Dopo.`,
  ]),
  "Before. [CARD:bad [EMAIL]] Middle. [MEDIA:photo:Sun] [CARD:bad] After. [POINT:100,100:Target] Done.\nNames were hidden.",
  "[CIRCLE:100,100,10:Here] [ARROW:1,2,3,4:There] [BOX:10,20:Click]",
  "[CARD:1,2:One|Text|] [CARD:3,4:Two|Text|] [CARD:5,6:Three|Text|]",
  'Before. [CARD:bad\n```drawing2d\n{"shapes":',
  'Before. [CARD:bad\n```model3d\n{"parts":',
];

describe("answer parsing stays compatible with main", () => {
  it.each(corpus)("matches main for %s", (raw) => {
    expect(parseBuddyAnswer(raw, screens)).toEqual(main(raw, screens));
  });
  it.each([drawing, model])("review-4 F3: preserves main's unclosed-card behavior before fence %s", (fence) => {
    const raw = `Before. [CARD:bad\n${fence}\nAfter.\nNames were hidden.`;
    // The exact reviewer example also loses this tail on main. Round 3 requires parity,
    // not a new malformed-card recovery policy; preserve this known limitation explicitly.
    expect(main(raw, screens).text).toBe("Before.");
    expect(parseBuddyAnswer(raw, screens)).toEqual(main(raw, screens));
  });
  it.each(["[key:value]", "[PERSON_NAME]", "[EMAIL][PHONE_NUMBER]"])("review-4 F4: accepts complete nested card fields %s", (token) => {
    const raw = `Before. [CARD:100,100:Use ${token}|Keep ${token}|Photo ${token}:screen1] After.\nNames were hidden.`;
    const parsed = parseBuddyAnswer(raw, screens, 1, `Explain ${token}`);
    expect(parsed.cards).toEqual([{ x: 100, y: 100, screen: 1, title: `Use ${token}`, text: `Keep ${token}`, photo: `Photo ${token}` }]);
    expect(parsed.text).toBe("Before. After.\nNames were hidden.");
    expect(parsed.marks).toEqual([]);
  });
});
