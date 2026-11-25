const INTRO_MEDIA_LANGS = new Set(["en", "it", "ru", "ro", "ja"]);

/** First caption cue per UI language, matching apps/desktop/media/intro.<lang>.vtt. */
const INTRO_FIRST_CUES: Record<string, string> = {
  en: "Hold the talk shortcut and ask a question. You choose screen sharing.",
  it: "Tieni premuta la scorciatoia per parlare e fai una domanda. Decidi tu se condividere lo schermo.",
  ru: "Удерживайте сочетание клавиш для разговора и задайте вопрос. Экран показывается только с вашего согласия.",
  ro: "Ține apăsată combinația de taste pentru vorbire și pune o întrebare. Tu alegi dacă partajezi ecranul.",
  ja: "会話用のショートカットキーを押したまま質問します。画面を共有するかどうかは自分で選べます。",
};

/** Select the matching caption track, with English for an unsupported UI language. */
export function selectIntroCaptions(tracks: Iterable<Pick<TextTrack, "language" | "mode">>, lang: string) {
  const list = Array.from(tracks);
  const selected = list.find(track => track.language === lang) ?? list.find(track => track.language === "en");
  for (const track of list) track.mode = track === selected ? "showing" : "disabled";
}

/** First caption cue for the UI language, with English fallback. */
export function firstIntroCaption(lang: string): string {
  return INTRO_FIRST_CUES[lang] ?? INTRO_FIRST_CUES.en;
}

type CaptionCueLike = TextTrackCue | { text?: string };
type CaptionTrackLike = {
  activeCues?: ArrayLike<CaptionCueLike> | null;
  cues?: ArrayLike<CaptionCueLike> | null;
};

/**
 * Pick the caption text for #intro-live-caption: the active cue during playback, or the first cue
 * of the UI language before Play so the reserved caption box is never left blank.
 */
export function resolveIntroCaptionText(
  showing: CaptionTrackLike | undefined,
  lang: string,
  beforePlay: boolean,
): string {
  if (!showing) return "";
  const active = (showing.activeCues?.[0] as { text?: string } | undefined)?.text?.trim();
  if (active) return active;
  if (beforePlay) {
    const first = (showing.cues?.[0] as { text?: string } | undefined)?.text?.trim();
    return first || firstIntroCaption(lang);
  }
  return "";
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
