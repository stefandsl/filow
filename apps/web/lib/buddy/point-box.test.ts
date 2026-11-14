import { expect, it } from "vitest";
import { normalizePointBoxes, parseBuddyAnswer, trimHistory } from "./prompt";
import { placeTags, withPlacedTags } from "./ground";
import { createProgressiveSpeech } from "./progressive";

const screens = [{ index: 1, width: 1920, height: 1080 }];
const elements = [{ name: "Customer name", screen: 1, x1: 200, y1: 560, x2: 300, y2: 600 }];
const tag = "[BOX:241,588:Customer name field:screen1]";
it("salvages the measured two-coordinate BOX without inventing coordinates", () => {
  expect(parseBuddyAnswer(tag, screens).points).toEqual([{x:241,y:588,label:"Customer name field",screen:1}]);
  expect(parseBuddyAnswer(tag, screens).marks).toEqual([]);
  expect(parseBuddyAnswer(placeTags(tag, elements), screens).points[0]).toMatchObject({x:250,y:580});
});
it("places a salvaged BOX for every possible stream split", async () => {
  for (let split=1; split<tag.length; split++) {
    async function* pieces() { yield tag.slice(0,split); yield tag.slice(split); }
    let result=""; for await (const part of withPlacedTags(pieces(), elements)) result+=part;
    expect(parseBuddyAnswer(result,screens).points[0]).toMatchObject({x:250,y:580});
  }
});
it.each(["[BOX:241]", "[BOX:241,588,600:Name]", "[BOX:241,588,600,700,800:Name]", "[BOX:1001,588:Name]", "[BOX:-1,588:Name]", "[BOX:NaN,588:Name]", "[BOX:241,588:Name:screen2]", "[BOX:241,588"])("rejects ambiguous, invalid or unfinished shape %s", raw => {
  const parsed=parseBuddyAnswer(raw,screens);
  expect(parsed.points).toEqual([]); expect(parsed.marks).toEqual([]); expect(parsed.text).toBe("");
});
it("keeps four-coordinate boxes and ordinary points found in the saved samples", () => {
  const box="[BOX:200,560,300,600:Customer name:screen1]";
  expect(normalizePointBoxes(box)).toBe(box);
  expect(parseBuddyAnswer(box,screens).marks[0]).toMatchObject({kind:"box",x1:200,y1:560,x2:300,y2:600});
  expect(parseBuddyAnswer("[POINT:241,588:Customer name:screen1]",screens).points[0]).toMatchObject({x:241,y:588});
});
it("accepts unlabelled, fractional and spaced pairs with the same grid rules", () => {
  expect(parseBuddyAnswer("[box: 241.5, 588 ]",screens).points[0]).toMatchObject({x:241.5,y:588,label:""});
});
it("treats a bare screen suffix as a screen, not a label", () => {
  expect(parseBuddyAnswer("[CIRCLE:241,588,20:screen2]",[...screens,{index:2,width:1920,height:1080}]).marks[0]).toMatchObject({screen:2,label:""});
  for (const kind of ["POINT", "BOX"]) {
    const raw = `[${kind}:241,588:screen2]`;
    const parsed=parseBuddyAnswer(raw,[...screens,{index:2,width:1920,height:1080}]);
    expect(parsed.points).toEqual([{x:241,y:588,label:"",screen:2}]);
    const placed=placeTags(raw,[{...elements[0],screen:2}]);
    expect(parseBuddyAnswer(placed,[...screens,{index:2,width:1920,height:1080}]).points[0]).toMatchObject({x:250,y:580,screen:2,label:""});
  }
});
it("shows and speaks app words once, never partial provenance tags", async () => {
  const spoken: string[] = [];
  const voice = createProgressiveSpeech({speak: async text => { spoken.push(text); }, isCurrent: () => true});
  const raw = tag + "\n[POINT:]\n[APP_WORDS:it]Campo Nome cliente: qui.";
  for (let end=1; end<=raw.length; end++) {
    const parsed=parseBuddyAnswer(raw.slice(0,end),screens);
    expect(parsed.text).not.toContain("[");
    voice.update(parsed.text);
  }
  const parsed=parseBuddyAnswer(raw,screens);
  await voice.finish(parsed.text);
  expect(parsed.appWordsLanguage).toBe("it");
  expect(spoken).toEqual(["Campo Nome cliente: qui."]);
});
it("keeps app provenance out of follow-up model instructions", () => {
  expect(trimHistory([{role:"user",text:"Where?"},{role:"assistant",text:"[POINT:50,60:Save][APP_WORDS:en]Save: here."}])[1].text).toBe("[POINT:50,60:Save]Save: here.");
});
