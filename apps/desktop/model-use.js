// Which of the models on this computer Filow would use right now, with the current settings.
// "Installed" says a model takes disk space; "in use" says a feature would pick it. Nothing is
// guessed here: every answer comes from the function the feature itself calls to pick its model
// (stt.js chooseModels and pickInstalled, dictation-cleanup.js decide, dictation-punctuate.js wanted,
// okfilow.js for the voice). A model that is selected but not loaded in memory is still in use.
const { chooseModels, pickInstalled, normaliseLanguage, hardwareOf } = require("./stt");
const { decide } = require("./dictation-cleanup");
const { wanted } = require("./dictation-punctuate");

/**
 * Pure. input:
 *  - speech: { installed: [catalogue keys that can run], language: the stored spoken language, hardware? }
 *  - okFilow: { enabled, voice: the voice that speaks ("natural" | "system" | "cloud" | "off"), voiceUsable }
 *  - dictation: { enabled, language, cleanup, punctuate }
 *  - cleanup / punctuation: { installed, runtime } (the model file and the program that runs it)
 * Returns { speech: { [key]: [{ use, language }] }, voice: [...], cleanup: [...], punctuation: [...] };
 * `use` is "tracking" (following a talk), "questions" (OK Filow questions), "dictation", "voice",
 * "cleanup" or "punctuation". An empty list means: installed at most, not in use.
 * Following a talk can also go to a cloud engine or to Whisper in the app: the settings page knows
 * that (its plan) and drops "tracking" then (apps/web/lib/modelUse.ts).
 */
function modelUse(input = {}) {
  const speechIn = input.speech || {};
  const okf = input.okFilow || {};
  const dict = input.dictation || {};
  const installed = Array.isArray(speechIn.installed) ? speechIn.installed : [];
  const language = normaliseLanguage(speechIn.language);
  // The same machine the recognizer measures (stt.js hardwareOf): a PC with few cores or little memory gets other models.
  const hw = hardwareOf(speechIn.hardware);
  const speech = {};
  const add = (use, lang, purpose) => {
    const key = pickInstalled(chooseModels({ language: lang, use: purpose, ramGb: hw.ramGb, cores: hw.cores }), installed).model;
    if (key) (speech[key] ||= []).push({ use, language: normaliseLanguage(lang) });
  };
  add("tracking", language, "tracking");
  if (okf.enabled) add("questions", language, "questions");
  // Dictation listens with the phrase models, in its own language or, on "auto", the spoken language.
  const dictLang = dict.language && dict.language !== "auto" ? dict.language : language;
  if (dict.enabled) add("dictation", dictLang, "questions");

  const voice = okf.enabled && okf.voice === "natural" && okf.voiceUsable ? [{ use: "voice", language: "auto" }] : [];
  // The same question each dictation asks before it goes through a model (a one-word probe text).
  const probe = { language: dict.language || "auto", spokenLanguage: language === "auto" ? "" : language };
  const cleanupOn = Boolean(dict.enabled && input.cleanup && input.cleanup.installed && input.cleanup.runtime && decide({ enabled: Boolean(dict.cleanup), ...probe, text: "word" }).clean);
  const punctuationOn = Boolean(dict.enabled && input.punctuation && input.punctuation.installed && input.punctuation.runtime && wanted("word", { enabled: dict.punctuate !== false, ...probe }).ok);
  return {
    speech,
    voice,
    cleanup: cleanupOn ? [{ use: "cleanup", language: "en" }] : [],
    punctuation: punctuationOn ? [{ use: "punctuation", language: normaliseLanguage(dictLang) }] : [],
  };
}

module.exports = { modelUse };
