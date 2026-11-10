// Verdict of the onboarding probe (onboarding.mjs): what it observed -> the list of failures. Pure, so the
// rule that makes the probe exit non-zero is unit-tested apart from the launch (onboarding-verdict.test.ts).
// Review T3 finding 6: "no point ticked", axe violations, zoom and keyboard failures used to land only in
// report.json while the probe exited 0.

/** report: the probe's report.json object. Returns one plain line per failure; [] = PASS. */
export function onboardingFailures(report) {
  const out = [...(report.problems || [])];
  for (const [label, v] of Object.entries(report.axe || {})) {
    if (Array.isArray(v)) {
      if (v.length) out.push(`axe ${label}: ${v.map((x) => `${x.id} (${x.impact}, ${x.nodes})`).join(", ")}`);
    } else out.push(`axe ${label} could not run: ${v && v.error ? v.error : "no result"}`);
  }
  const kb = report.keyboardPass;
  if (kb) {
    const bad = (kb.order || []).filter((d) => !d || !d.outline || d.visible === false);
    if (!kb.order || !kb.order.length) out.push("keyboard: Tab reached no control");
    else if (bad.length) out.push(`keyboard: ${bad.length} Tab stop(s) without visible focus: ${bad.map((d) => (d ? d.id || d.name || d.tag : "page")).join(", ")}`);
  }
  // Finding 2: the welcome must be on screen before the hardware scan runs (startup.log order).
  const log = report.welcomeLog || [];
  const shown = log.findIndex((l) => /welcome: window shown/.test(l));
  const scan = log.findIndex((l) => /welcome: hardware scan/.test(l));
  if (scan >= 0 && (shown < 0 || scan < shown)) out.push("welcome: the hardware scan ran before the window was shown");
  for (const [label, z] of Object.entries(report.zoom || {})) {
    if (!z) continue;
    if (z.hOverflow) out.push(`zoom ${label}: the page scrolls sideways`);
    if (z.primaryVisible === false) out.push(`zoom ${label}: the primary button is off screen`);
  }
  return out;
}

/** The probe's exit code: its own (crash 1, no main window 2, timeout 3) wins, then 4 for failed checks. */
export function onboardingExitCode(code, failures) {
  return code || (failures.length ? 4 : 0);
}
