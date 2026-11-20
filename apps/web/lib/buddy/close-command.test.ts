import { expect, it } from "vitest";
import { isBubbleCloseCommand } from "./close-command";

it.each(["Close.", "Close it!", "Chiudi", "Закрой.", "Închide", "閉じて。"])("recognizes %s", text => {
  expect(isBubbleCloseCommand(text)).toBe(true);
});
it.each(["Close the document", "Chiudi la porta", "How close is it?", "Почему?", "Închide ușa", "閉じてくださいと言った"])("preserves the question %s", text => {
  expect(isBubbleCloseCommand(text)).toBe(false);
});
