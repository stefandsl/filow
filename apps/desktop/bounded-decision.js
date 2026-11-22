// Predictions refer to the exact choices offered for one decision.
function offeredChoice(value, choices) {
  return typeof value === "string" && choices.includes(value) ? value : null;
}

function dailyChoice(proposal, rows) {
  if (!proposal || !["complete", "reopen"].includes(proposal.type)) return { action: "abstain" };
  const ids = rows.map(row => row.id);
  const targets = proposal.targets;
  if (!Array.isArray(targets) || !targets.length || targets.some(t =>
    !t || !offeredChoice(t.id, ids) || !rows.some(r => r.id === t.id && r.rev === t.rev))) return { action: "abstain" };
  if (proposal.which || targets.length !== 1) return { action: "clarify", ids: targets.map(row => row.id) };
  return { action: proposal.type, id: targets[0].id };
}

function passesBar(counts) {
  const { clear, correct, negative, falseTicks, clarification } = counts ?? {};
  return [clear, correct, negative, falseTicks, clarification].every(n => Number.isSafeInteger(n) && n >= 0) &&
    clear > 0 && negative > 0 && falseTicks === 0 && correct + clarification <= clear &&
    correct / clear >= 0.8 && clarification / clear <= 0.2;
}

// Only reviewed, shipped evidence can enable an automatic tick.
const qualifications = Object.freeze([]);
const pilotDigest = "5a3978d89b3f78ba3a1fac7545adc9b7327bb1be224e42b60b4269e1c9320642";
function qualified(route, locale, receipts = qualifications) {
  return Boolean(route && locale && receipts.some(r => r.qualified === true && r.corpus === pilotDigest &&
    r.route === route && r.locale === locale && passesBar(r)));
}

module.exports = { offeredChoice, dailyChoice, passesBar, qualified, pilotDigest };
