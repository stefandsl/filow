/** Select the matching caption track, with English for an unsupported UI language. */
export function selectIntroCaptions(tracks: Iterable<Pick<TextTrack, "language" | "mode">>, lang: string) {
  const list = Array.from(tracks);
  const selected = list.find(track => track.language === lang) ?? list.find(track => track.language === "en");
  for (const track of list) track.mode = track === selected ? "showing" : "disabled";
}
