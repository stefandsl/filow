// The profile the packaged-app probes (a11y.mjs, coldstart.mjs) share: tmp/autoloop-profile in this checkout.
// They measure a user past the first run, so the onboarding flags are set here; without them the welcome
// window holds the main window back and the probes report "app did not come up" on any fresh checkout.
import fs from "node:fs";
import path from "node:path";

export const PAST_ONBOARDING = { welcomeCompleted: true, localAiOffered: true, firewallOffered: true, pptAsked: true, remoteShareChosen: true };

/** Creates or updates <root>/tmp/autoloop-profile/settings.json, keeping every other setting; returns the profile folder. */
export function seedProfile(root) {
  const profile = path.join(root, "tmp", "autoloop-profile");
  const file = path.join(profile, "settings.json");
  fs.mkdirSync(profile, { recursive: true });
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  fs.writeFileSync(file, JSON.stringify({ ...settings, ...PAST_ONBOARDING }, null, 2));
  return profile;
}
