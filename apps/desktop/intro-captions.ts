const INTRO_MEDIA_LANGS = new Set(["en", "it", "ru", "ro", "ja"]);

/** Select the matching caption track, with English for an unsupported UI language. */
export function selectIntroCaptions(tracks: Iterable<Pick<TextTrack, "language" | "mode">>, lang: string) {
  const list = Array.from(tracks);
  const selected = list.find(track => track.language === lang) ?? list.find(track => track.language === "en");
  for (const track of list) track.mode = track === selected ? "showing" : "disabled";
}

/** Select the localized intro video and poster for the UI language, with English fallback. */
export function selectIntroMedia(lang: string) {
  const resolved = INTRO_MEDIA_LANGS.has(lang) ? lang : "en";
  return {
    lang: resolved,
    src: `media/intro.${resolved}.mp4`,
    poster: `media/intro-poster.${resolved}.png`,
  };
}
