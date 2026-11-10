import fs from "node:fs";
import path from "node:path";
import { afterAll, expect, it } from "vitest";
import { PAST_ONBOARDING, seedProfile } from "./profile.mjs";
import { tmpRoot } from "../../../apps/desktop/test-tmp";

const root = tmpRoot("autoloop-profile");
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const read = (p: string) => JSON.parse(fs.readFileSync(path.join(p, "settings.json"), "utf8"));

it("creates a profile past the first run on a fresh checkout", () => {
  fs.rmSync(root, { recursive: true, force: true });
  const profile = seedProfile(root);
  expect(profile).toBe(path.join(root, "tmp", "autoloop-profile"));
  expect(read(profile)).toEqual(PAST_ONBOARDING);
  expect(PAST_ONBOARDING.welcomeCompleted).toBe(true);
});

it("keeps the settings already there and only turns the onboarding flags on", () => {
  const profile = path.join(root, "tmp", "autoloop-profile");
  fs.writeFileSync(path.join(profile, "settings.json"), JSON.stringify({ remoteShare: true, theme: "light", welcomeCompleted: false }));
  seedProfile(root);
  expect(read(profile)).toMatchObject({ remoteShare: true, theme: "light", welcomeCompleted: true, localAiOffered: true });
});
