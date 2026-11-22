const fs = require("node:fs");
const path = require("node:path");
const { gunzipSync } = require("node:zlib");
const { cleanText } = require("./day-by-day-store");

let dictionary;
function lexicon() {
  if (!dictionary) {
    dictionary = JSON.parse(gunzipSync(fs.readFileSync(path.join(__dirname, "daily-lexicon", "verbs.json.gz"))));
    dictionary.humanTarget = new Set(dictionary.humanTarget);
    dictionary.roles = new Set(dictionary.roles);
    dictionary.nouns = new Set(dictionary.nouns);
  }
  return dictionary;
}

const normalize = s => s.normalize("NFKC").toLowerCase().replaceAll("’", "'").trim();
const objectKey = s => s.split(/\s+/).filter(w => !/^(?:the|a|an|my|our|il|lo|la|i|le|gli|un|una)$/.test(w)).join(" ");
const entries = (table, word) => Object.hasOwn(table, word) ? table[word] : [];
function lemmas(form, morphology) {
  const found = entries(lexicon()[morphology], form);
  if (found.length) return found;
  // A preceding auxiliary disambiguates the agreement suffix on an Italian participle.
  if (morphology === "participle" && /[aie]$/.test(form)) {
    const masculine = entries(lexicon().participle, form.slice(0, -1) + "o");
    if (masculine.length) return masculine;
  }
  if (morphology === "imperative") return [form];
  if (morphology === "participle" || morphology === "past") {
    if (form.endsWith("ed")) {
      const stem = form.slice(0,-2);
      return [stem, stem + "e", stem.replace(/(.)\1$/, "$1"), stem.replace(/i$/, "y")];
    }
    const ending = /(at|it|ut)[oaie]$/.exec(form);
    if (ending) return [form.slice(0,-3) + ({ at: "are", it: "ire", ut: "ere" })[ending[1]]];
  }
  return [];
}

function related(left, right) {
  const senses = lexicon().senses;
  return left.some(a => right.some(b => a === b || entries(senses, a).some(id => entries(senses, b).includes(id))));
}

// Transfer events can be described from either participant's perspective.
const transfer = ["give", "send", "deliver", "forward", "hand", "mail", "email", "dare", "inviare", "consegnare", "mandare", "inoltrare", "spedire"];
function splitArguments(rest, allowIndirect) {
  const trailing = /^(.+?) (?:to|a|ad) (.+)$/i.exec(rest);
  if (trailing) return { person: trailing[2], object: trailing[1] };
  const leading = allowIndirect && /^(.+?) ((?:the|a|an|my|our|their|his|her|your) .+)$/i.exec(rest);
  return leading ? { person: leading[1], object: leading[2] } : { object: rest };
}

const pronoun = /^(?:he|she|they|them|him|her|lei|lui|loro|gli|le|lo|la|li)$/u;
const determiner = /^(?:a|an|the|my|your|his|her|their|our|this|that|one|il|lo|la|i|le|gli|un|una|uno|al|alla|mio|mia|nostr[oa]|l['’])(?:\s|')/u;
function personMatches(reference, person) {
  if (!person) return false;
  const name = normalize(person);
  if (pronoun.test(reference)) return true;
  if (determiner.test(reference)) {
    if (/^(?:one|un[oa]) (?:of|dei|delle)\b/.test(reference)) return true;
    const words = reference.replace(determiner, "").split(/\s+/);
    const head = words.filter(word => lexicon().nouns.has(word)).at(-1);
    return !head || lexicon().roles.has(head);
  }
  return name === reference || name.split(/\s+/).some(part => part.startsWith(reference));
}

function parseReport(input, repair) {
  const phrase = input.replace(/(?:^|\s)(?:already|just|now|finally|recently|appena|già|gia|ora|finalmente)(?=\s|$)/gu, " ").trim().replace(/\s+/g, " ");
  if (/\b(?:but|unless|if|maybe|perhaps|will|would|might|never|ma|se|forse|mai|però)\b/u.test(phrase)) return;
  const possession = /^(.+?) (has(?:n't| not)? (?:received|got)|have (?:received|got)|received|got|has|didn't receive|did not receive|non (?:l[ei] )?ha ricevut[oaie]|ha(?:nno)? ricevut[oaie]|ha)(?: (.+))?$/.exec(phrase);
  if (possession) {
    const [, person, verb, object = ""] = possession;
    if (/(?:n't| not |^non )/.test(verb) !== repair || /\b(?:said|detto|never|not|non|che|that)\b/u.test(person)) return;
    return { delivery: true, person, object, implicit: repair && !object && /non l[ei] ha/.test(verb) };
  }
  if (!repair) {
    const recipient = /^(.+?) (?:is with|are with|reached|(?:è|sono) (?:arrivat[oaie] (?:a|ad)|da)) (.+)$/.exec(phrase);
    if (recipient) return { delivery: true, object: recipient[1], person: recipient[2] };
    const contracted = /^(.+?) (?:è|sono) d(?:allo|alla|agli|alle|ai|al|all')\s*(.+)$/.exec(phrase);
    if (contracted) return { delivery: true, object: contracted[1], person: contracted[2], article: true };
    const passive = /^(.+?) (?:is|are|was|were|has been|have been|(?:è|sono)(?: stat[oaie])?) (\p{L}+)$/u.exec(phrase);
    if (passive) return { object: passive[1], verbs: passive[2] === "done" ? null : lemmas(passive[2], "participle") };
    const finish = /^(?:done with|i(?:'ve| have)? (?:finished|completed)|(?:io )?ho (?:finito|completato)(?: di)?|fatto(?: con)?|finished) (.+)$/.exec(phrase);
    if (finish) {
      const [verb, ...rest] = finish[1].split(" ");
      const verbs = /ing$/.test(verb) ? lemmas(verb, "gerund") : /(?:are|ere|ire)$/.test(verb) ? [verb] : [];
      return rest.length && verbs.length ? { verbs, object: rest.join(" ") } : { verbs: null, object: finish[1] };
    }
  }
  const dislocated = /^(?:(.+?) )?(non )?(?:l'ho|l[aeio] ho) (\p{L}+)$/u.exec(phrase);
  if (dislocated && Boolean(dislocated[2]) === repair) {
    return { object: dislocated[1] || "", verbs: lemmas(dislocated[3], "participle"), implicitPerson: !dislocated[1] };
  }
  const active = /^(i did not|i didn't|i have not|i haven't|(?:io )?non ho|i have|i've|i|we have|we|(?:(?:gli|le) )?(?:io )?ho|abbiamo) (\p{L}+) (.+)$/u.exec(phrase);
  if (active) {
    const [, subject, verb, rest] = active;
    if (/non|not|n't/.test(subject) !== repair) return;
    const form = subject.includes("did") ? "imperative" : /^(?:i|we)$/.test(subject) ? "past" : "participle";
    return { verbs: lemmas(verb, form), object: rest, person: /^(?:gli|le) /.test(subject) ? subject.split(" ")[0] : undefined };
  }
  const italianPast = /^(\p{L}+) (.+)$/u.exec(phrase);
  if (!repair && italianPast && /[aiò]$/.test(italianPast[1]) && entries(lexicon().past, italianPast[1]).length) {
    return { verbs: entries(lexicon().past, italianPast[1]), object: italianPast[2] };
  }
}

function taskArguments(report, row) {
  const task = /^(\S+) (.+)$/.exec(row.text.trim().replace(/[.!]+$/, ""));
  if (!task) return false;
  const verbs = lemmas(normalize(task[1]), "imperative");
  const delivery = related(verbs, transfer);
  if (report.delivery && !delivery) return false;
  if (report.verbs && !related(verbs, report.verbs) && !(delivery && related(report.verbs, transfer))) return false;
  const dest = splitArguments(task[2], delivery);
  const src = report.person || report.delivery ? report : splitArguments(report.object, delivery);
  const nameLike = /^\p{Lu}[\p{L}'-]*(?: \p{Lu}[\p{L}'-]*)*$/u.test(dest.object);
  const humanArgument = verbs.some(v => lexicon().humanTarget.has(v)) && /^[\p{L}'-]+$/u.test(dest.object);
  const directName = !dest.person && (nameLike || humanArgument);
  return { src, dest, directName };
}

function recipientConflict(report, { src, dest, directName }) {
  if (dest.person && !src.person) return true;
  if (src.person && !personMatches(src.person, dest.person)) {
    return !report.article || !dest.person || !lexicon().roles.has(src.person);
  }
  return Boolean(directName && !src.person && !report.implicitPerson && report.verbs &&
    objectKey(src.object) !== objectKey(normalize(dest.object)) && !personMatches(src.object, dest.object));
}

function matchesTask(report, row) {
  const args = taskArguments(report, row);
  if (!args || recipientConflict(report, args)) return false;
  const { src, dest, directName } = args;
  if (report.implicitPerson) return directName;
  if (directName && !src.person && report.verbs && personMatches(src.object, dest.object)) return true;
  return report.implicit || objectKey(src.object) === objectKey(normalize(dest.object));
}

const correction = /^(?:correction|i mean|let me correct that|mi correggo|rettifica)\b[, :]*\s*/u;

function contradictsRecipient(words, row) {
  const phrase = normalize(words).replace(/[.!]+$/, "");
  const report = parseReport(phrase.replace(correction, ""), correction.test(phrase));
  const args = report && taskArguments(report, row);
  return Boolean(args && recipientConflict(report, args));
}

function interpret(input, tasks, { speech = false } = {}) {
  const words = cleanText(input);
  if (!words || /["“”«»?\n]/u.test(words)) return null;
  const normalized = normalize(words).replace(/[.!]+$/, "");
  const repair = correction.test(normalized);
  const phrase = normalized.replace(correction, "");
  if (/[;:.!]/.test(phrase)) return null;
  const report = parseReport(phrase, repair);
  if (report) {
    const targets = tasks.filter(row => row.done === repair && matchesTask(report, row)).map(({ id, rev, text }) => ({ id, rev, text }));
    return targets.length ? { type: repair ? "reopen" : "complete", words, which: targets.length > 1, targets } : null;
  }
  if (!speech || repair) return null;
  const tomorrow = /^(?:for tomorrow|tomorrow|per domani|domani)\b[,:]?\s*/iu;
  const prefix = /^(?:i need to|i have to|remind me to|add(?: a task to)?|devo|ricordami di|aggiungi)\s+/iu;
  const request = words.replace(tomorrow, "").replace(/[.!]+$/, "").trim();
  const text = request.replace(prefix, "").trim();
  const [verb, ...rest] = normalize(text).split(/\s+/);
  // Bare imperatives need an identifiable object. This keeps homographs at the
  // beginning of declarative speech from turning a lecture into a task.
  const imperative = entries(lexicon().imperative, verb).length && rest.length &&
    (tomorrow.test(words) || /^(?:the|an?|my|our|il|lo|la|le|i|gli|un|una)$/u.test(rest[0]) || /^\S+ \p{Lu}/u.test(text));
  if (!text || (!prefix.test(request) && !imperative)) return null;
  return { type: "create", words, text, dueTomorrow: tomorrow.test(words), targets: [] };
}

module.exports = { interpret, contradictsRecipient };
