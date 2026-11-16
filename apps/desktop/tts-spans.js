// Conservative English UI vocabulary. Never infer English from capitalization alone.
const ENGLISH = new Set(('file save download settings upload cancel open close print preview export import copy paste undo redo next back finish help search home insert view tools share edit delete browser microsoft powerpoint excel windows chrome firefox google github youtube outlook onedrive dropbox photoshop bluetooth wifi login logout dashboard feedback update online offline zoom teams slack workspace').split(' '));

/** Screen labels are hints only when quoted verbatim, ASCII, and recognizably English.
 * A label alone cannot turn an Italian/Romanian sentence into English. */
function languageSpans(text, lang, labels = []) {
  if (lang === 'en') return [{ text, lang }];
  const hints = new Set(labels.filter(s => typeof s === 'string' && s.length <= 80 && /^[A-Za-z][A-Za-z0-9 -]*$/.test(s) && s.split(/\s+/).some(w => ENGLISH.has(w.toLowerCase()))));
  // A word is a run of Latin letters, accented ones included: "Exportă" and "PIÙ" stay whole words
  // of the answer's language (with [A-Za-z] the English voice read "Export" and "PI").
  const tokens = [...text.matchAll(/\p{Script=Latin}[\p{Script=Latin}\p{M}]*|[^\p{Script=Latin}]+/gu)];
  const spans = [];
  for (const token of tokens) {
    const word = token[0], at = token.index;
    const inLabel = [...hints].some(label => {
      for (const quote of ['"', '“', '«', '「', "'"]) {
        const start = text.indexOf(quote + label);
        if (start >= 0 && at >= start + 1 && at < start + 1 + label.length) return true;
      }
      return false;
    });
    // A currency code belongs to its amount so normalization can name the currency.
    const currency = /^(EUR|USD|GBP|RUB|RON|JPY)$/.test(word) && /\d\s*$/.test(text.slice(0,at));
    const foreign = !currency && (ENGLISH.has(word.toLowerCase()) || /^[A-Z]{2,5}$/.test(word) || /^[A-Z][a-z]+[A-Z][A-Za-z]*$/.test(word) || inLabel);
    const chosen = foreign ? 'en' : lang;
    const previous = spans.at(-1);
    if (previous?.lang === chosen) previous.text += word;
    else spans.push({text: word, lang: chosen});
  }
  // Spaces between English words belong to the same phrase, not another request.
  for (let i = 1; i < spans.length - 1; i++) {
    if (/^\s+$/.test(spans[i].text) && spans[i-1].lang === 'en' && spans[i+1].lang === 'en') {
      spans.splice(i-1, 3, {text: spans[i-1].text + spans[i].text + spans[i+1].text, lang: 'en'});
      i = Math.max(0, i-2);
    }
  }
  // Punctuation alone needs no synthesis request.
  for (let i = spans.length - 1; i >= 0; i--) {
    if (!/[\p{L}\p{N}]/u.test(spans[i].text) && spans.length > 1) {
      if (i) spans[i-1].text += spans[i].text;
      else spans[1].text = spans[0].text + spans[1].text;
      spans.splice(i, 1);
    }
  }
  return spans;
}

/** Equal-amplitude 8 ms overlap. Caller retains the end of each unfinished span. */
function crossfade(left, right, rate) {
  const n = Math.min(left.length, right.length, Math.round(rate * 0.008));
  const out = new Float32Array(left.length + right.length - n);
  out.set(left);
  for (let i = 0; i < n; i++) {
    const mix = (i + 1) / (n + 1);
    out[left.length - n + i] = left[left.length - n + i] * (1-mix) + right[i] * mix;
  }
  out.set(right.subarray(n), left.length);
  return out;
}
module.exports = { languageSpans, crossfade };
