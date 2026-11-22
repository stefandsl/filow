const { cleanText } = require("./day-by-day-store");

const word = "[\\p{L}\\p{M}]+(?:[-'][\\p{L}\\p{M}]+)*";
const name = new RegExp("^(" + word + ")\\s+", "u");
const delivery = /^(?:send|give|deliver|forward|email|hand|mail|invia(?:re)?|manda(?:re)?|consegna(?:re)?|spedi(?:re|sci)|inoltra(?:re)?)\s+(.+)$/u;
const normal = text => text.normalize("NFKC").toLowerCase().replaceAll("’", "'").trim();
const terms = text => (text.match(/[\p{L}\p{N}]+/gu) || []).filter(w => !/^(?:the|a|an|to|of|my|her|his|their|il|i|la|le|gli|lo|un|una|di|del|dei|delle)$/.test(w));

function destination(task) {
  const phrase = delivery.exec(normal(task).replace(/[.!]$/, ""));
  if (!phrase) return null;
  const trailing = /^(.+?)\s+(?:to|a|ad)\s+(.+)$/u.exec(phrase[1]);
  if (trailing) return { person: trailing[2], object: trailing[1] };
  const leading = /^(.+?)\s+((?:the|a|an|my|our|their|his|her|your)\s+.+)$/u.exec(phrase[1]);
  return leading ? { person: leading[1], object: leading[2] } : null;
}

// Unqualified recognition can suggest a task. Only the confirmation path writes a revision.
function interpret(input, tasks, { speech = false } = {}) {
  const words = cleanText(input);
  if (!words || /["“”«»?\n]/u.test(words)) return null;
  let phrase = normal(words).replace(/[.!]+$/, "");
  const correction = /^(?:correction|i mean|let me correct that|mi correggo|rettifica)\b[, :]*\s*/u;
  const repair = correction.test(phrase);
  phrase = phrase.replace(correction, "");
  const report = /^(.+?)\s+(has(?:n't| not)? received|hasn't got|has not got|received|got|has|didn't receive|did not receive|non (?:l[ei] )?ha ricevut[oaie]|ha ricevut[oaie])(?:\s+(.+))?$/u.exec(phrase);
  if (report) {
    const [, person, verb, object = ""] = report;
    const negative = /n't| not |^non /.test(verb + " ");
    if (negative !== repair || /[,;.!]|\b(?:if|unless|but|or|maybe|forse|ma|oppure|se)\b/u.test(object)) return null;
    const pronoun = /^(?:he|she|they|lui|lei|loro)$/u.test(person);
    const options = tasks.flatMap(task => {
      const target = destination(task.text);
      if (task.done !== repair || !target || (!pronoun && target.person !== person)) return [];
      return [{ task, object: target.object, person: target.person }];
    });
    const matches = options.filter(target => terms(object).some(w => terms(target.object).includes(w)));
    // A possession report can paraphrase a delivery. Offer the full row and original words for review.
    // An object pronoun in a correction can refer back to the preceding delivery.
    const implicit = verb === "has" || pronoun || (!object && repair && /non l[ei] ha/.test(verb));
    const choices = matches.length ? matches : implicit ? options : [];
    if (!choices.length) return null;
    return { type: repair ? "reopen" : "complete", words,
      which: new Set(choices.map(c => c.person)).size > 1,
      targets: choices.map(({ task }) => ({ id: task.id, rev: task.rev, text: task.text })) };
  }
  if (!speech || repair || /[;.!]/u.test(phrase)) return null;
  const tomorrow = /^(?:for tomorrow|tomorrow|per domani|domani)\b[,:]?\s*/u;
  const dueTomorrow = tomorrow.test(phrase);
  const text = words.replace(new RegExp(tomorrow.source, "iu"), "")
    .replace(/^(?:i need to|i have to|devo)\s+/iu, "").replace(/[.!]+$/, "").trim();
  if (!name.test(normal(text))) return null;
  return { type: "create", words, text, dueTomorrow, targets: [] };
}

module.exports = { interpret };
