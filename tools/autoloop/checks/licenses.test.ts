// The licence check's allow-list: MIT-0 (nodemailer in apps/cloud) passes, an unknown licence is reported.
// The script runs as it does in the autoloop (a path to an SBOM as its argument), from an empty folder so no packaged build is found.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const script = path.join(root, "tools", "autoloop", "checks", "licenses.mjs");
let dir = "";

beforeAll(() => {
  fs.mkdirSync(path.join(root, "tmp"), { recursive: true });
  dir = fs.mkdtempSync(path.join(root, "tmp", "licenses-test-"));
});
afterAll(() => {
  if (dir && path.basename(dir).startsWith("licenses-test-")) fs.rmSync(dir, { recursive: true, force: true });
});

function check(components: { name: string; version: string; license?: string }[]): string {
  const sbom = path.join(dir, "sbom.json");
  fs.writeFileSync(sbom, JSON.stringify({ components: components.map((c) => ({ name: c.name, version: c.version, licenses: c.license ? [{ license: { id: c.license } }] : [] })) }));
  const r = spawnSync(process.execPath, [script, sbom], { cwd: dir, encoding: "utf8" });
  return r.stdout + r.stderr;
}

describe("licenses check allow-list", () => {
  it("accepts MIT-0 and MIT", () => {
    const out = check([{ name: "nodemailer", version: "7.0.0", license: "MIT-0" }, { name: "left-pad", version: "1.0.0", license: "MIT" }]);
    expect(out).not.toContain("nodemailer@");
    expect(out).not.toContain("left-pad@");
  });

  it("refuses an unknown licence and a missing one, naming the package", () => {
    const out = check([{ name: "weird", version: "1.2.3", license: "SSPL-1.0" }, { name: "nolicense", version: "0.1.0" }]);
    expect(out).toContain("weird@1.2.3: SSPL-1.0");
    expect(out).toContain("nolicense@0.1.0: no license");
  });
});