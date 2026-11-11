// Short Latin-script sentences with the language a person would say they are in. A labeled table for
// spoken.table.test.ts: the detector may leave a sentence undecided (null), it must not name the wrong
// language. Romanian is written mostly without diacritics, the way speech-to-text and hurried typing
// give it. "review" holds the sentences from the review of the five-language pass; "pairs" was written
// with the detector; "heldout" was written after it and never used to tune it.

import type { LatinLang } from "./spoken";

export type LatinCase = readonly [text: string, lang: LatinLang];
const table = (lang: LatinLang, list: string[]): LatinCase[] => list.map((text) => [text, lang] as const);

export const REVIEW_CASES: LatinCase[] = [
  ...table("ro", [
    "Când începem?", "Cât e ceasul?", "Îmi place", "Câte slide-uri am?", "El are dreptate", "Are cineva intrebari?",
    "I-am spus ieri", "Mi-e foame", "Mi se pare bine", "Te rog sa repeti", "O sa mai vedem",
  ]),
  ...table("it", ["Come faccio a esportare?", "Come si salva?", "Un attimo e arrivo"]),
  ...table("en", ["Come here and look at this", "I am here", "Are you there?"]),
];

/** Each list leans on the words its language shares with the one it is paired against. */
export const PAIR_CASES: Record<string, LatinCase[]> = {
  "ro against en": table("ro", [
    "Am o intrebare", "Are dreptate", "Pot sa incep?", "Ce face butonul asta?", "Care e urmatorul slide?",
    "Am terminat prezentarea", "Nu am inteles", "Unde e fisierul meu?", "Cum pot schimba vocea?", "Vreau sa schimb limba",
    "Sunt gata, putem incepe", "Mai am cinci minute", "Ai auzit ce am zis?", "Da, e bine asa",
  ]),
  "ro against it": table("ro", [
    "Tu ce zici?", "La ce ora incepem?", "Mai e mult?", "Nu ma auzi?", "Noi am ajuns la timp", "Mi-a placut mult",
    "Si tu ai dreptate", "Unde ma duc acum?", "Da-mi un exemplu", "Se aude bine?", "Ma poti ajuta?", "E gata prezentarea?",
    "Cine vorbeste acum?", "Las-o asa",
  ]),
  "it against en": table("it", [
    "Come va?", "No, non ancora", "Per me va bene", "Fine della presentazione", "Come mai non parte?", "Ho due domande",
    "Dove lo trovo?", "Puoi ripetere, per favore?", "Sono pronto a cominciare", "Quanto tempo mi resta?", "Apri le impostazioni",
    "Che ore sono?",
  ]),
  "it against ro": table("it", [
    "La voce e troppo veloce", "Mi pare giusto", "Se vuoi, andiamo avanti", "Ma dai, non ci credo", "Tu che ne pensi?",
    "Mai sentito prima", "Ti sento male", "Un momento, arrivo subito", "E la prossima slide?", "Ieri sera ho provato",
    "Lui ha ragione", "Noi siamo pronti", "Va tutto bene?",
  ]),
  "en against ro": table("en", [
    "Are we done?", "I am ready", "Face the camera", "Take care", "Put the pot on", "Am I too fast?", "An example, please",
    "Are there any questions?", "Can you hear me?", "Next slide, please", "Am I late?", "Who cares about that?",
  ]),
  "en against it": table("en", [
    "Come on, start again", "No, not yet", "Fine, let me try", "Tell me more", "The report is due today", "Come back later",
    "Give me a minute", "No problem at all", "It works fine now", "So far so good", "Do it again", "Let me see",
  ]),
};

/** Written after the detector was finished and never used to tune it: the same everyday talk in the three languages. */
export const HELDOUT_CASES: LatinCase[] = [
  ...table("ro", [
    "Putem incepe acum?", "Nu stiu ce sa spun", "Cat mai dureaza?", "Imi dai te rog textul?", "Hai sa repetam", "A fost foarte bine",
    "Mi-ai trimis fisierul?", "Unde am ramas?", "Vorbesc prea repede?", "S-a oprit microfonul", "Ne vedem maine", "Am uitat ce urma",
    "Poti sa dai mai incet?", "Asta e tot",
  ]),
  ...table("it", [
    "Possiamo cominciare adesso?", "Non so cosa dire", "Quanto manca?", "Mi passi il testo?", "Proviamo ancora una volta",
    "E andata molto bene", "Mi hai mandato il file?", "Dove eravamo rimasti?", "Parlo troppo in fretta?", "Si e spento il microfono",
    "Ci vediamo domani", "Ho dimenticato il seguito", "Puoi abbassare la voce?", "Tutto qui",
  ]),
  ...table("en", [
    "Can we start now?", "I do not know what to say", "How long is left?", "Pass me the text", "One more time", "It went really well",
    "Did you send me the file?", "Where were we?", "Am I speaking too fast?", "The microphone turned off", "See you tomorrow",
    "I forgot what came next", "Can you lower the voice?", "That is all",
  ]),
];

/** Words and scraps that more than one of the three languages owns: the detector must not pick. */
export const UNDECIDABLE: string[] = ["OK", "Da", "No", "Pare", "Ieri", "Come", "Are", "La radio", "Mare"];
