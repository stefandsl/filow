/** After stop acknowledgement, yield once for the renderer's final-result IPC.
 * Empty transcripts retain the bounded grace period; dictation keeps its immediate exit.
 */
export async function waitForTranscript(hasText: () => boolean, dictation: boolean, queued: () => boolean): Promise<void> {
  if (dictation && hasText()) return;
  for (let waited = 0; waited < 1500; waited += 50) {
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    if (hasText() || (dictation && queued())) return;
  }
}
