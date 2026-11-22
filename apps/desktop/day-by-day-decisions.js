const { cleanText } = require("./day-by-day-store");

const normalize = s => s.normalize("NFKC").toLowerCase().replaceAll("’", "'").trim();
const objectKey = s => s.split(/\s+/).filter(w => !/^(?:the|a|an|my|our|il|lo|la|i|le|gli|un|una)$/.test(w)).join(" ");

// Each entry links task verbs with observed completed forms, including paraphrases.
const actions = [
  ["send give deliver forward email mail hand inviare invia mandare manda dare consegnare consegna spedire spedisci inoltrare inoltra",
    "sent gave given delivered forwarded emailed mailed handed inviato mandato dato consegnato spedito inoltrato"],
  ["write scrivere scrivi", "wrote written scritto"],
  ["make fare fai", "made fatto"], ["buy purchase comprare compra acquistare acquista", "bought purchased comprato acquistato"],
  ["take prendere prendi", "took taken preso"], ["read leggere leggi", "read letto"],
  ["bring portare porta", "brought portato"], ["choose scegliere scegli", "chose chosen scelto"],
  ["print stampare stampa", "printed stampato"], ["prepare preparare prepara", "prepared preparato"],
  ["file archive archiviare archivia", "filed archived archiviato"], ["book reserve prenotare prenota", "booked reserved prenotato"],
  ["call phone chiamare chiama", "called phoned chiamato"], ["review rivedere rivedi", "reviewed rivisto"],
  ["pay pagare paga", "paid pagato"], ["meet incontrare incontra", "met incontrato"],
  ["sign firmare firma", "signed firmato"], ["finish complete finire finisci completare completa", "finished completed finito completato"],
  ["wash lavare lava", "washed lavato"], ["check controllare controlla", "checked controllato"],
  ["plan pianificare pianifica", "planned pianificato"], ["update aggiornare aggiorna", "updated aggiornato"],
];
const taskVerbs = new Map();
const completed = new Map();
for (const [group, [verbs, forms]] of actions.entries()) {
  for (const v of verbs.split(" ")) taskVerbs.set(v, group);
  for (const v of forms.split(" ")) {
    completed.set(v, group);
    if (v.endsWith("o")) for (const ending of ["a","i","e"]) completed.set(v.slice(0,-1) + ending, group);
  }
}

const contactGroups = new Set(["call", "meet"].map(verb => taskVerbs.get(verb)));

// Resolve a regular form back to the verb on the row when it has no dictionary entry.
function regularLemmas(verb, italian, infinitive) {
  if (infinitive) return [verb];
  if (italian) {
    const suffix = /(at|ut|it)[oaie]$/.exec(verb);
    return suffix ? [verb.slice(0, -3) + ({ at: "are", ut: "ere", it: "ire" })[suffix[1]]] : [];
  }
  if (!verb.endsWith("ed")) return [];
  const base = verb.slice(0, -2);
  const lemmas = [base, base + "e"];
  if (verb.endsWith("ied")) lemmas.push(verb.slice(0, -3) + "y");
  if (/(.)\1$/.test(base)) lemmas.push(base.slice(0, -1));
  return lemmas;
}

function splitDelivery(rest) {
  const trailing = /^(.+?) (?:to|a|ad) (.+)$/.exec(rest);
  if (trailing) return { person: trailing[2], object: trailing[1] };
  const leading = /^(.+?) ((?:the|a|an|my|our|their|his|her|your) .+)$/.exec(rest);
  return leading ? { person: leading[1], object: leading[2] } : { object: rest };
}

function personMatches(reference, person) {
  if (!person) return false;
  if (!reference || /^(?:he|she|they|them|him|her|lei|lui|loro|gli|le|one of (?:them|the two)|un[oa] (?:dei|delle) due|(?:my|the) (?:colleague|coworker|person(?: we mentioned)?)|(?:(?:il|la|al|alla|mio|mia) )*(?:collega|persona))$/.test(reference)) return true;
  return person === reference || person.split(/\s+/).some(part => part.startsWith(reference));
}

function parseReport(phrase, repair) {
  const recipient = /^(.+?) (has(?:n't| not)? received|have received|hasn't got|has not got|received|got|has|didn't receive|did not receive|non (?:l[ei] )?ha ricevut[oaie]|ha(?:nno)? ricevut[oaie])(?: (.+))?$/.exec(phrase);
  if (recipient) {
    const [, person, verb, object = ""] = recipient;
    if (/n't| not |^non /.test(verb + " ") !== repair) return;
    return { group: 0, person, object, implicit: repair && !object && /non l[ei] ha/.test(verb) };
  }
  if (!repair) {
    const possession = /^(.+?) (?:è|sono) (dal|dallo|dalla|dai|dagli|dalle|dall')\s*(.+)$/.exec(phrase);
    if (possession) return { group: 0, object: possession[1], person: possession[3] };
    const reached = /^(.+?) (?:reached|is with|are with|è (?:arrivat[oa] (?:a|ad)|da)|sono (?:arrivat[ie] (?:a|ad)|da)) (.+)$/.exec(phrase);
    if (reached) return { group: 0, object: reached[1], person: reached[2] };
    const passive = /^(.+?) (?:is|are|è|sono) (\p{L}+)$/u.exec(phrase);
    if (passive) return { object: passive[1], group: passive[2] === "done" ? null : completed.get(passive[2]) };
    const finish = /^(?:done with|i(?:'ve| have)? (?:finished|completed)|(?:io )?ho (?:finito|completato)(?: di)?|fatto(?: con)?|finished) (.+)$/.exec(phrase);
    if (finish) {
      const [, verb, rest] = /^(\S+)(?: (.+))?$/.exec(finish[1]);
      const base = /ing$/.test(verb) ? verb.slice(0,-3) : verb;
      const group = taskVerbs.get(base) ?? taskVerbs.get(base + "e");
      return group !== undefined && rest ? { group, object: rest } : { group: null, object: finish[1] };
    }
  }
  const clitic = /^(?:(non) )?(?:l'ho|li ho|le ho) (\p{L}+)$/u.exec(phrase);
  if (clitic && Boolean(clitic[1]) === repair && contactGroups.has(completed.get(clitic[2]))) {
    return { group: completed.get(clitic[2]), person: "loro", object: "" };
  }
  const statement = /^(i did not|i didn't|i have not|i haven't|(?:io )?non ho|i(?: have|'ve)?|(?:(?:gli|le) )?(?:io )?ho) (\p{L}+) (.+)$/u.exec(phrase);
  if (!statement) return;
  const [, subject, verb, object] = statement;
  if (/non|not|n't/.test(subject) !== repair) return;
  const group = /did/.test(subject) ? taskVerbs.get(verb) : completed.get(verb);
  if (group === undefined) return { object, lemmas: regularLemmas(verb, subject.endsWith("ho"), /did/.test(subject)) };
  return group === 0 ? { group, ...splitDelivery(object) } : { group, object };
}

function interpret(input, tasks, { speech = false } = {}) {
  const words = cleanText(input);
  if (!words || /["“”«»?\n]/u.test(words)) return null;
  const normalized = normalize(words).replace(/[.!]+$/, "");
  const correction = /^(?:correction|i mean|let me correct that|mi correggo|rettifica)\b[, :]*\s*/u;
  const repair = correction.test(normalized);
  const phrase = normalized.replace(correction, "");
  if (/[;:.!]/.test(phrase)) return null;
  const report = parseReport(phrase, repair);
  if (report) {
    const targets = tasks.filter(row => {
      if (row.done !== repair) return false;
      const task = /^(\S+) (.+)$/.exec(normalize(row.text).replace(/[.!]+$/, ""));
      if (!task) return false;
      const group = taskVerbs.get(task[1]);
      if (report.lemmas) {
        if (group !== undefined || !report.lemmas.includes(task[1])) return false;
      } else if (report.group !== null && (report.group === undefined || report.group !== group)) return false;
      if (contactGroups.has(group) && report.group === group) {
        return personMatches(report.person || report.object, task[2]);
      }
      const dest = group === 0 ? splitDelivery(task[2]) : { object: task[2] };
      if (report.person && !personMatches(report.person, dest.person)) return false;
      return report.implicit || objectKey(report.object) === objectKey(dest.object);
    }).map(({ id, rev, text }) => ({ id, rev, text }));
    return targets.length ? { type: repair ? "reopen" : "complete", words, which: targets.length > 1, targets } : null;
  }
  if (!speech || repair) return null;
  const tomorrow = /^(?:for tomorrow|tomorrow|per domani|domani)\b[,:]?\s*/iu;
  const prefix = /^(?:i need to|i have to|remind me to|add(?: a task to)?|devo|ricordami di|aggiungi)\s+/iu;
  const request = words.replace(tomorrow, "").replace(/[.!]+$/, "").trim();
  const text = request.replace(prefix, "").trim();
  const verb = normalize(text).split(/\s+/)[0];
  if (!text || (!prefix.test(request) && (!taskVerbs.has(verb) || !text.includes(" ")))) return null;
  return { type: "create", words, text, dueTomorrow: tomorrow.test(words), targets: [] };
}

module.exports = { interpret };
