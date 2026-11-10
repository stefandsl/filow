import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

it("packages every local module the main process requires", () => {
  const files: string[] = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).build.files;
  const sources = fs.readdirSync(__dirname).filter((f) => /^(main|okfilow[\w-]*|dictation[\w-]*)\.js$/.test(f));
  const required = new Set(sources.flatMap((f) => [...fs.readFileSync(path.join(__dirname, f), "utf8").matchAll(/require\("\.\/([\w-]+)"\)/g)].map((m) => `${m[1]}.js`)));
  expect([...required].filter((r) => !files.includes(r) && fs.existsSync(path.join(__dirname, r)))).toEqual([]);
});
