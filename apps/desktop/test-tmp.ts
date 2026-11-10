import fs from "node:fs";
import path from "node:path";

/**
 * A fresh scratch folder for one test file: under FILOW_TEST_TMP when set, else under the checkout's
 * own tmp/test (gitignored, on the repo's drive). The name is unique per call, so two runs at once
 * never share a folder. The caller removes it in afterAll.
 */
export function tmpRoot(name: string): string {
  const base = process.env.FILOW_TEST_TMP || path.resolve(__dirname, "../../tmp/test");
  fs.mkdirSync(base, { recursive: true });
  return fs.mkdtempSync(path.join(base, `${name}-`));
}
