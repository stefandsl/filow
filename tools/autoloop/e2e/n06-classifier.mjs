// Multilingual character trigram nearest-neighbour baseline. Development labels calibrate
// the minimum cosine similarity and the margin to the second row separately in each locale.
const locales = ["en", "it", "ja", "ro", "ru"];
const negatives = {
  en: /\b(?:not|never)\b|n['’]t\b/i, it: /\b(?:non|mai)\b/i, ja: /ません|していない|できていない/,
  ro: /\b(?:nu|niciodată)\b/iu, ru: /(?:^|\s)(?:не|нет)(?:\s|$)/u,
};
const grams = text => {
  const words = [...text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()];
  const features = new Set();
  for (let i = 0; i < words.length - 2; i++) features.add(words.slice(i, i + 3).join(""));
  return features;
};
function similarity(a, b) {
  let overlap = 0;
  for (const feature of a) if (b.has(feature)) overlap++;
  return overlap / (Math.sqrt(a.size * b.size) || 1);
}
export function classify({ locale, utterance, choices }, calibration) {
  if (!locales.includes(locale) || !calibration?.[locale] || negatives[locale].test(utterance)) return { action: "abstain" };
  const { threshold, margin } = calibration[locale];
  const input = grams(utterance);
  const ranked = choices.map(row => ({ id: row.id, score: similarity(input, grams(row.text)) })).sort((a, b) => b.score - a.score);
  if (!ranked.length || ranked[0].score < threshold) return { action: "abstain" };
  if (ranked.length > 1 && ranked[0].score - ranked[1].score <= margin) return { action: "clarify" };
  return { action: "complete", id: ranked[0].id };
}

export function calibrate(albums) {
  if (albums.length !== 5 || albums.some(a => a.split !== "development" || a.cases.length !== 5)) throw Error("Expected development groups only");
  const calibration = {};
  for (const locale of locales) {
    const a = albums.find(album => album.language === locale);
    if (!a) throw Error("Missing development locale");
    const choices = a.tasks.map((text, i) => ({ id: String(i + 1), text }));
    let best = -Infinity;
    for (const threshold of [0.35, 0.25, 0.15, 0.08]) for (const margin of [0.1, 0.05, 0.02]) {
      const score = a.cases.reduce((sum, c) => {
        const pick = classify({ locale, utterance: c.text, choices }, { [locale]: { threshold, margin } });
        if (pick.action !== "complete") return sum;
        return sum + (pick.id === String(c.expected) ? 1 : -5);
      }, 0);
      if (score > best) { best = score; calibration[locale] = { threshold, margin }; }
    }
  }
  return calibration;
}
