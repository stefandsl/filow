import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, expect, it } from "vitest";
import { tmpRoot } from "./test-tmp";

const require = createRequire(import.meta.url);
const { MODEL, verifyArchive, sha256File } = require("./stt.js");

// Test files live in the project's own tmp folder (never on C:).
const dir = tmpRoot("stt-integrity");
fs.mkdirSync(dir, { recursive: true });
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

it("pins a SHA-256 for the speech model archive", () => {
  expect(MODEL.sha256).toMatch(/^[0-9a-f]{64}$/);
});

it("accepts a file with the expected hash and rejects one changed by a single byte", async () => {
  const f = path.join(dir, "archive.bin");
  fs.writeFileSync(f, Buffer.from("filow model archive"));
  const good = await sha256File(f);
  await expect(verifyArchive(f, good)).resolves.toBeUndefined();
  fs.writeFileSync(f, Buffer.from("filow model archivE"));
  await expect(verifyArchive(f, good)).rejects.toThrow(/integrity check/);
});
