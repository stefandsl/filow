// OK Filow's opt-in memory (docs/okfilow/MEMORY.md): a few short preferences and facts the user said
// about themselves, kept in one JSON file in the app profile on this PC and never synced. Off by
// default. Every rule about what may be kept lives here, at the door of the file, whatever proposed it.
//
// The approach follows grokbot-clone (MIT, server/src/agent/memory.ts at 7ee6a7e; the idea only, no
// code copied): extract at most a few facts after an answer, recall by shared words.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const FILE = "okfilow-memory.json";
/** At most this many facts are kept; the oldest go first. */
const MAX_FACTS = 100;
/** At most this many new facts from one answer. */
const MAX_NEW = 3;
/** At most this many facts go with one question. */
const MAX_RECALL = 5;
/** A fact longer than this is not short: it is not kept (never cut, a cut fact may say something else). */
const MAX_LEN = 140;
/** "answer": how the user wants answers (goes with every question). "me": something about the user (goes when it shares words with the question). */
const KINDS = ["answer", "me"];

// Letters and digits of any script: \b knows only ASCII, so the word edges are written out.
// word(): whole words. stem(): words that start so (Russian endings vary).
const word = (body) => `(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`;
const stem = (body) => `(?<![\\p{L}\\p{N}])(?:${body})`;
const any = (...parts) => new RegExp(parts.join("|"), "iu");

/** Passwords, codes and keys, in the five languages: a question that names one teaches nothing. */
const SECRET = any(word("pass(?:word|phrase|code)s?|pwd|pins?|pin-?code|otp|tokens?|api ?keys?|secrets?|credentials?|parolă|parola mea|parolei|codul pin|codice pin|пин|пин-?код"), stem("парол|токен"), "パスワード|暗証");
/** Four digits or more in a row (spaces, dots or dashes between them too): ids, phone, card and account numbers, dates. */
const NUMBER = /\d(?:[\s.\-/]?\d){3,}/u;
/** A word that mixes letters and two digits or more (AB12CD, x9k2): codes and ids. */
const CODE = /(?=[\p{L}\p{N}]*\p{L})(?=[\p{L}\p{N}]*\p{N}[\p{L}\p{N}]*\p{N})[\p{L}\p{N}]{4,}/u;
/** Addresses: e-mail, web links, site names. Nothing from a web page or an inbox is kept. */
const ADDRESS = /@|https?:|www\.|[\p{L}\p{N}-]+\.(?:com|net|org|io|ai|app|dev|it|ru|ro|jp|eu|uk|de|fr|edu|gov)(?![\p{L}\p{N}])/iu;
/** Other people: a fact names only the user. Family, work and friends, in the five languages. */
const OTHERS = any(
  word("wife|husband|partner|boss|manager|colleagues?|coworkers?|friends?|sons?|daughters?|mother|father|mom|dad|brothers?|sisters?|clients?|customers?|neighbou?rs?|kids?|children|" +
    "moglie|marito|colleg[ahi]e?|amic[oaie]|figli[oa]?|madre|padre|mamma|papà|fratell[oi]|sorell[ae]|client[ei]|vicin[oaie]|" +
    "soți[ae]|soțul|șef(?:ul|a)?|coleg[aiu]?|colegii|prieten[aiu]?|prietenii|fiul|fiica|mama|tata|frate|fratele|sora|clientul|vecin[aiu]?|" +
    "жена|жены|жене|жену|муж|мужа|мужу|друг|друга|друзья|друзей"),
  stem("начальни|коллег|подруг|сын|доч|мать|матер(?:и|ью)|отец|отц|мам[аыуе]|пап[аыуе]|брат|сестр|клиент|сосед"),
);
const OTHERS_JA = /同僚|上司|妻|夫[がはの]|主人|旦那|友達|友人|息子|娘|母親|父親|お母|お父|兄|弟|姉|妹|顧客|お客|隣人|彼女|彼氏|彼[がはの]/u;
/** Words too common to tell two texts apart. */
const STOP = new Set(("the and for are you your with that this from have has was were will would can could should into about what when where which who how why not all any some more most very just also than then them they their there here our out use used using user users answer answers answering please want wants like likes " +
  "che per con una uno del della delle dei degli gli non sono come quando dove cosa questo questa quello quella anche più molto mio mia miei mie tuo tua suo sua alla alle allo agli nel nella nelle sul sulla utente risposta risposte rispondi voglio vorrei " +
  "это как что для его она они мне мой моя мои твой ваш при над под без или уже еще ещё так тоже очень пожалуйста ответ ответы отвечай хочу пользователь " +
  "care este sunt pentru din cum unde când ceea acest această meu mea mei tău tale lui fie sau mai foarte răspuns răspunsuri răspunde vreau utilizatorul").split(/\s+/));

const clean = (s) => String(s ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
/** The words of a text that carry its meaning; text with no spaces (Japanese) is read two characters at a time. */
function words(text) {
  const s = clean(text).toLowerCase();
  const out = new Set();
  for (const w of s.match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(w)) {
      const chars = [...w];
      for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1]);
    } else if ([...w].length >= 3 && !STOP.has(w)) out.add(w);
  }
  return out;
}
const shared = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n; };

/** Why a proposed fact may not be kept (null: it may). Each rule is tested on its own (okfilow-memory.test.ts). */
function refusal(text, question) {
  const t = clean(text);
  if (!t) return "empty";
  if ([...t].length > MAX_LEN) return "long";
  if (SECRET.test(t)) return "secret";
  if (NUMBER.test(t) || CODE.test(t)) return "number";
  if (ADDRESS.test(t)) return "address";
  if (OTHERS.test(t) || OTHERS_JA.test(t)) return "others";
  // Only what the user said: a fact whose words are mostly not in the question came from somewhere
  // else (the screen, a web page, the model's own answer). At least half of them must be there.
  const own = words(t);
  if (!own.size || shared(own, words(question)) * 2 < own.size) return "unsaid";
  return null;
}

/** The question as it is kept next to its facts: short, with numbers, codes and addresses masked. */
function provenance(question) {
  return [...clean(question).replace(/\S*@\S*|https?:\/\/\S+|www\.\S+/giu, "…").replace(new RegExp(ADDRESS.source, "giu"), "…").replace(new RegExp(NUMBER.source, "gu"), "…").replace(new RegExp(CODE.source, "gu"), "…")].slice(0, 160).join("");
}
const key = (text) => [...words(text)].sort().join(" ") || clean(text).toLowerCase();

/**
 * The facts of one answer that may be kept: at most MAX_NEW, each short, none already known. A
 * question that names a password or a code teaches nothing at all.
 */
function keepFacts(question, proposed, known = [], now = new Date()) {
  const q = clean(question);
  if (!q || SECRET.test(q) || !Array.isArray(proposed)) return [];
  const seen = new Set(known.map((f) => key(f.text)));
  const out = [];
  for (const p of proposed) {
    if (out.length >= MAX_NEW) break;
    const kind = p && KINDS.includes(p.kind) ? p.kind : "me";
    const text = clean(p && typeof p === "object" ? p.text : p);
    if (refusal(text, q) || seen.has(key(text))) continue;
    seen.add(key(text));
    out.push({ id: crypto.randomUUID(), kind, text, at: now.toISOString(), question: provenance(q) });
  }
  return out;
}

/**
 * The facts that go with a question: how the user wants answers first (always, newest first), then
 * facts about the user that share the most words with it; at most MAX_RECALL in all.
 */
function recall(question, facts) {
  const q = words(question);
  const style = facts.filter((f) => f.kind === "answer").reverse();
  const about = facts
    .filter((f) => f.kind !== "answer")
    .map((f, i) => ({ f, i, n: shared(words(f.text), q) }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || b.i - a.i)
    .map((x) => x.f);
  return [...style.slice(0, 2), ...about, ...style.slice(2)].slice(0, MAX_RECALL);
}

const valid = (f) => f && typeof f === "object" && typeof f.id === "string" && typeof f.text === "string" && KINDS.includes(f.kind) && typeof f.at === "string";

/** The file in the app profile (`userData`). Nothing here reaches the network. */
function createMemory(userData) {
  const file = path.join(userData, FILE);
  const read = () => {
    try {
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(data?.facts) ? data.facts.filter(valid).map((f) => ({ id: f.id, kind: f.kind, text: f.text, at: f.at, question: String(f.question ?? "") })) : [];
    } catch {
      return [];
    }
  };
  const clear = () => {
    for (const f of [file, `${file}.tmp`]) fs.rmSync(f, { force: true });
    return [];
  };
  const write = (facts) => {
    if (!facts.length) return clear();
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ version: 1, facts }, null, 1));
    fs.renameSync(`${file}.tmp`, file);
    return facts;
  };
  return {
    file,
    list: read,
    /** Off: nothing is read for a question. */
    recall: (enabled, question) => (enabled === true ? recall(String(question ?? ""), read()) : []),
    /** Off: nothing is kept. Returns the facts kept now. */
    learn(enabled, question, proposed) {
      if (enabled !== true) return [];
      const known = read();
      const kept = keepFacts(question, proposed, known);
      if (kept.length) write([...known, ...kept].slice(-MAX_FACTS));
      return kept;
    },
    /** Deletes one fact from the file; returns what is left. */
    remove: (id) => write(read().filter((f) => f.id !== id)),
    /** Deletes the file. */
    clear,
  };
}

module.exports = { createMemory, keepFacts, recall, refusal, words, MAX_NEW, MAX_RECALL, MAX_LEN, FILE };
