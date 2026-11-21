import { expect, it } from "vitest";
import { isBubbleCloseCommand } from "./close-command";

const corpus = [
  { language: "EN", commands: ["Close.", "Close it!", "Close the bubble"], questions: ["How close is it?", "Close the document", "What does close mean?"] },
  { language: "IT", commands: ["Chiudi", "Chiudilo!", "Chiudi il fumetto"], questions: ["Chiudi la porta", "Come chiudi il fumetto?", "Perché lo chiudi?"] },
  { language: "RU", commands: ["Закрой.", "Закрыть", "Закрой это"], questions: ["Закрой окно", "Что значит закрой?", "Как закрыть это?"] },
  { language: "RO", commands: ["Închide", "Inchide!", "Închide-l"], questions: ["Închide ușa", "Cum se închide?", "Ce înseamnă închide-l?"] },
  { language: "JA", commands: ["閉じて。", "とじて", "閉じてください"], questions: ["どうやって閉じるの？", "閉じてくださいと言った", "ドアを閉じて"] },
];
it.each(corpus)("scores every labelled $language utterance correctly", ({ commands, questions }) => {
  const misses = [...commands.filter(text => !isBubbleCloseCommand(text)), ...questions.filter(isBubbleCloseCommand)];
  expect(misses).toEqual([]);
});
