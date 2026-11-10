import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { afterAll, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { assetDigest, verifyGithubAsset, signatureOk, macDeveloperIdRequirement } = require("./integrity.js");

const dir = path.resolve(__dirname, "../../tmp/test-integrity");
fs.mkdirSync(dir, { recursive: true });
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const release = (digest: string) => ({ tag_name: "2026.11.0", assets: [{ name: "cloudflared-windows-amd64.exe", digest }] });

it("reads the published digest of one asset", () => {
  const hex = "a".repeat(64);
  expect(assetDigest(release(`sha256:${hex}`), "cloudflared-windows-amd64.exe")).toBe(hex);
  expect(assetDigest(release(`sha256:${hex}`), "other.exe")).toBeNull();
  expect(assetDigest(release("md5:abc"), "cloudflared-windows-amd64.exe")).toBeNull();
});

it("accepts the exact bytes, rejects changed bytes and a release without a digest", async () => {
  const f = path.join(dir, "cloudflared.exe");
  fs.writeFileSync(f, "binary");
  const good = crypto.createHash("sha256").update("binary").digest("hex");
  await expect(verifyGithubAsset(f, "cloudflare/cloudflared", "cloudflared-windows-amd64.exe", async () => release(`sha256:${good}`))).resolves.toBeUndefined();
  fs.writeFileSync(f, "binarY");
  await expect(verifyGithubAsset(f, "cloudflare/cloudflared", "cloudflared-windows-amd64.exe", async () => release(`sha256:${good}`))).rejects.toThrow(/integrity check/);
  await expect(verifyGithubAsset(f, "cloudflare/cloudflared", "cloudflared-windows-amd64.exe", async () => ({ assets: [] }))).rejects.toThrow(/no published SHA-256/);
});

it("macOS: requires Apple's Developer ID chain and pins the signer's Team ID, not just any signature", () => {
  const r = macDeveloperIdRequirement("3MU9H2V9Y9");
  expect(r).toMatch(/^anchor apple generic /);
  expect(r).toContain("certificate 1[field.1.2.840.113635.100.6.2.6] exists"); // Developer ID intermediate CA
  expect(r).toContain("certificate leaf[field.1.2.840.113635.100.6.1.13] exists"); // Developer ID Application leaf
  // the Team ID lives in subject.OU; subject.O is the legal entity ("Infra Technologies, Inc" for Ollama on
  // macOS), so pinning the Windows signer name there would reject the genuine app
  expect(r).toMatch(/ and certificate leaf\[subject\.OU\] = "3MU9H2V9Y9"$/);
  expect(r).not.toContain("subject.O]");
  // a quote cannot end the string early and widen the requirement
  expect(macDeveloperIdRequirement('Evil" or anchor trusted or "')).not.toMatch(/" or anchor/);
});

it("accepts only a valid signature from the named organisation", () => {
  const subject = "CN=Ollama Inc., O=Ollama Inc., L=Toronto, C=CA";
  expect(signatureOk(JSON.stringify({ Status: "Valid", Subject: subject }), "Ollama Inc.")).toBe(true);
  expect(signatureOk(JSON.stringify({ Status: 0, Subject: subject }), "Ollama Inc.")).toBe(true);
  expect(signatureOk(JSON.stringify({ Status: "HashMismatch", Subject: subject }), "Ollama Inc.")).toBe(false);
  expect(signatureOk(JSON.stringify({ Status: "Valid", Subject: "CN=Evil, O=Ollama Inc. Fake, C=XX" }), "Ollama Inc.")).toBe(false);
  expect(signatureOk(JSON.stringify({ Status: "NotSigned", Subject: "" }), "Ollama Inc.")).toBe(false);
  expect(signatureOk("not json", "Ollama Inc.")).toBe(false);
});
