import { describe, expect, it, vi } from "vitest";
import { createProgressiveSpeech, moreFollows } from "./progressive";
import { parseBuddyAnswer } from "./prompt";

const screens = [{ index: 1, width: 1920, height: 1080 }];
const flat = (s: string) => s.replace(/\s+/g, "");

/** Feeds the answer the way the panel does: every network chunk is parsed, then the voice is updated. */
async function stream(chunks: string[]) {
  const spoken: string[] = [];
  /** How many sentences had started after each chunk. */
  const heard: number[] = [];
  const voice = createProgressiveSpeech({ speak: vi.fn(async (s: string) => { spoken.push(s); }), isCurrent: () => true });
  let got = "";
  for (const chunk of chunks) {
    got += chunk;
    const text = parseBuddyAnswer(got, screens).text;
    voice.update(text, false, moreFollows(got, text));
    await Promise.resolve();
    heard.push(spoken.length);
  }
  const final = parseBuddyAnswer(got, screens).text;
  await voice.finish(final);
  return { spoken, final, heard };
}
const chars = (s: string) => [...s];

describe("progressive voice over a streamed answer", () => {
  const answers = [
    "Click Save [POINT:500,500:Save] . Then choose a folder.",
    "First.\n\nYou: Second sentence. Third one!",
    "Open the menu.  Then  click the button [BOX:100,100,300,200:Button]. Done.",
    "Here it is. [CARD:500,500:Piston|It moves up. And down.|Piston] It turns the crank.",
    "Wait... really? Yes. Open example.com and type 3.5 there.",
    "これは保存ボタンです。クリックしてください。[POINT:10,10:保存]次へ進みます。",
    "A sun for you.\n```drawing2d\n{\"title\":\"Sun. Big.\",\"shapes\":[{\"type\":\"circle\",\"cx\":200,\"cy\":150,\"r\":60,\"fill\":\"#ffcc00\"}]}\n```",
    "Click [POINT:5,5:Save. Then press [BOX:1,1,200,200:x] now. After that you are done.",
  ];
  for (const raw of answers) {
    it(`says the whole answer once, whatever the chunking: ${raw.slice(0, 40)}`, async () => {
      for (const chunks of [chars(raw), raw.split(/(?<= )/), [raw]]) {
        const { spoken, final } = await stream(chunks);
        expect(flat(spoken.join(" "))).toBe(flat(final));
        expect(spoken.join(" ")).not.toMatch(/\[|POINT|BOX|CARD|```/);
      }
    });
  }
  it("says the sentence as soon as the picture's block starts, not after the whole picture", async () => {
    const { spoken, heard } = await stream(["A sun for you.", "\n```drawing2d\n{\"title\":\"Sun\",", "\"shapes\":[{\"type\":\"circle\",\"cx\":200,\"cy\":150,\"r\":60,\"fill\":\"#ffcc00\"}]}\n```"]);
    expect(spoken).toEqual(["A sun for you."]);
    expect(heard).toEqual([0, 1, 1]);
  });
  it("says a sentence that is followed by a tag still being written, or by a line break", async () => {
    expect((await stream(["Click Save.", " [POINT:500,", "500:Save]"])).heard).toEqual([0, 1, 1]);
    expect((await stream(["Click Save.\n", "Then wait."])).heard).toEqual([1, 1]);
  });
  it("does not cut a sentence at a full stop that only ends the chunk", async () => {
    const { spoken } = await stream(["Open example.", "com and press Enter. Then", " wait."]);
    expect(spoken).toEqual(["Open example.com and press Enter.", "Then wait."]);
  });
});
