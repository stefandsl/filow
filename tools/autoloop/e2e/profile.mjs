// The profile the packaged-app probes (a11y.mjs, coldstart.mjs) share: tmp/autoloop-profile in this checkout.
// They measure a user past the first run, so the onboarding flags are set here; without them the welcome
// window holds the main window back and the probes report "app did not come up" on any fresh checkout.
import fs from "node:fs";
import path from "node:path";

export const PAST_ONBOARDING = { welcomeCompleted: true, localAiOffered: true, firewallOffered: true, pptAsked: true, remoteShareChosen: true };
/**
 * For probes that are not about the public link: Cloudflare refuses new quick tunnels after about 12
 * test launches. The profile is shared, so a probe that needs the link passes { remoteShare: true }.
 */
export const NO_PUBLIC_LINK = { remoteShare: false };

/**
 * Creates or updates <root>/tmp/autoloop-profile/settings.json, keeping every other setting; returns the
 * profile folder. `extra` settings (such as NO_PUBLIC_LINK) are written on top. A session that must keep
 * its instances apart from another session's moves the folder with FILOW_E2E_PROFILE, like the ports.
 */
export function seedProfile(root, extra = {}, dir = process.env.FILOW_E2E_PROFILE) {
  const profile = dir ? path.resolve(dir) : path.join(root, "tmp", "autoloop-profile");
  const file = path.join(profile, "settings.json");
  fs.mkdirSync(profile, { recursive: true });
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  fs.writeFileSync(file, JSON.stringify({ ...settings, ...PAST_ONBOARDING, ...extra }, null, 2));
  return profile;
}
