/** Recognizers may capitalize, strip accents, or add terminal punctuation. */
export function isBubbleCloseCommand(text: string): boolean {
  const words = text.trim().toLowerCase().normalize("NFC").replace(/[.!?。！？]+$/u, "").trim();
  return /^(?:close(?: it| the bubble)?|chiudi(?:lo| il fumetto)?|закрой(?: это)?|закрыть|[îi]nchide(?:-l)?|(?:閉じて|とじて)(?:ください)?|閉じる)$/u.test(words);
}
