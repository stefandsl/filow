// Owner report 14/11: a click on a sample topic of the whiteboard already sent the question to the
// online model (and showed "Leaving this PC"), before "Explain". The end-to-end proof is
// tools/whiteboard/no-send-before-explain.mjs; this file holds the page to the rule: only the
// "Explain" form, a follow-up, a retry, the panel's own topic and a saved replay may start a lesson.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const page = fs.readFileSync(path.join(here, "page.tsx"), "utf8").replace(/\r\n/g, "\n");

/** The JSX of every element with this data-action, up to its closing tag. */
const elements = (action: string) => page.split("\n").filter((l) => l.includes(`data-action="${action}"`));

describe("nothing leaves before Explain", () => {
  it("a sample topic only fills the field and focuses it", () => {
    const samples = elements("sample");
    expect(samples).toHaveLength(1);
    expect(samples[0]).toContain("setQuestion(t(k))");
    expect(samples[0]).not.toMatch(/\bask\(|askRef|followUp|retry\(|requestSubmit|submit\(/);
  });

  it("the topic field only keeps what is typed", () => {
    const field = page.split("\n").find((l) => l.includes("ref={askInput}"));
    expect(field).toBeDefined();
    expect(field).toContain("onChange={(e) => setQuestion(e.target.value)}");
  });

  it("the places that start a lesson are the known ones", () => {
    // onAsk (Explain), the panel's topic (onWhiteboard), the browser's ?q=, followUp (2), a node
    // picked on the board (onPick), retry (3): a new caller makes this red and has to be looked at
    const calls = page.match(/\bvoid ask(Ref\.current)?\(/g) ?? [];
    expect(calls).toHaveLength(9);
  });
});
