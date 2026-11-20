/** Recognizers may capitalize, strip accents, or add terminal punctuation. */
export function isBubbleCloseCommand(text: string): boolean {
  const words = text.trim().toLowerCase().normalize("NFC").replace(/[.!?。！？]+$/u, "").trim();
  return /^(?:close(?: it)?|chiudi|закрой|закрыть|[îi]nchide|閉じて|閉じる|とじて)$/u.test(words);
}
