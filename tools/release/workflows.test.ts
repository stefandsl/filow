// Every external action a GitHub workflow runs is pinned to a full 40-hex commit SHA, so a moved or
// hijacked tag cannot change what CI executes. The tag stays readable in a comment (`# v4.4.0`).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflowsDir = path.join(root, ".github", "workflows");

/** Every `uses:` value in a parsed workflow, in any shape (block step, inline map, job-level reusable workflow). */
export function usesRefs(doc: unknown): string[] {
  const refs: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (k === "uses" && typeof v === "string") refs.push(v);
        else visit(v);
      }
    }
  };
  visit(doc);
  return refs;
}

/** Each `uses:` of a workflow that is not a local action pinned as `owner/repo[/path]@<40 hex> # <tag>`. The YAML is parsed
 *  (so `- { uses: x@v4 }` counts); the tag comment is not part of the parsed data, so it is read from the line that holds the ref. */
export function unpinnedUses(text: string): string[] {
  const bad: string[] = [];
  const lines = text.split(/\r?\n/);
  for (const ref of usesRefs(yaml.load(text))) {
    if (ref.startsWith("./")) continue; // an action in this repository runs at the checked-out commit
    const line = lines.find((l) => l.includes(ref) && /\buses\s*:/.test(l)) ?? ref;
    const comment = /(?:^|\s)(#\s*\S+)/.exec(line.slice(line.indexOf(ref) + ref.length))?.[1] ?? "";
    const pinned = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40}$/.test(ref) && comment !== "";
    if (!pinned) bad.push(`${ref}: ${line.trim()}`);
  }
  return bad;
}

const loadWorkflow = (file: string): any => yaml.load(fs.readFileSync(path.join(workflowsDir, file), "utf8"));
const workflowFiles = () => fs.readdirSync(workflowsDir).filter((f) => /\.ya?ml$/.test(f));

describe("GitHub workflows pin every action to a commit", () => {
  it("finds the workflows", () => {
    expect(workflowFiles()).toContain("desktop.yml");
  });

  it.each(workflowFiles())("%s has no external action without a full SHA and a tag comment", (file) => {
    const text = fs.readFileSync(path.join(workflowsDir, file), "utf8");
    expect(text).toMatch(/uses\s*:/);
    expect(unpinnedUses(text)).toEqual([]);
  });

  it("the build job records the commit in the desktop package, after typecheck and before the installer build", () => {
    const lines = fs.readFileSync(path.join(workflowsDir, "desktop.yml"), "utf8").split(/\r?\n/);
    const runAt = lines.findIndex((l) => l.trim() === "run: npm pkg set sourceSha=$(git rev-parse HEAD) -w apps/desktop");
    expect(runAt, "the sourceSha step is missing from desktop.yml").toBeGreaterThan(-1);
    // the step's own keys: from its `- name:` line to the next `- ` item
    let start = runAt;
    while (start > 0 && !/^\s*-\s/.test(lines[start]!)) start--;
    let end = runAt + 1;
    while (end < lines.length && !/^\s*-\s/.test(lines[end]!)) end++;
    const step = lines.slice(start, end).map((l) => l.trim());
    expect(step).toContain("if: env.HERE == 'true'");
    expect(step).toContain("shell: bash");
    const typecheckAt = lines.findIndex((l, i) => i > lines.findIndex((x) => x.trim() === "build:") && l.trim() === "- run: npm run typecheck");
    const buildAt = lines.findIndex((l) => l.trim() === "- run: npm run ${{ matrix.script }}");
    expect(typecheckAt).toBeGreaterThan(-1);
    expect(buildAt).toBeGreaterThan(-1);
    expect(runAt).toBeGreaterThan(typecheckAt);
    expect(runAt).toBeLessThan(buildAt);
  });

  it("grants read-only permissions to the workflow and write only to the build job, which waits for the checks", () => {
    const wf = loadWorkflow("desktop.yml");
    expect(wf.permissions).toEqual({ contents: "read" });
    expect(wf.jobs.build.permissions).toEqual({ contents: "write" });
    expect(wf.jobs.build.needs).toBe("checks");
    expect(wf.jobs.checks.permissions).toBeUndefined(); // the checks job inherits the read-only default
  });

  it("flags a tag, a short SHA, a branch, a missing comment, an inline-map step and an unparseable ref", () => {
    const sha = "11d5960a326750d5838078e36cf38b85af677262";
    const text = [
      "jobs:",
      "  j:",
      "    steps:",
      `      - uses: actions/checkout@${sha} # v4.4.0`,
      `      - uses: "actions/setup-node@${sha}" # v4.4.0`,
      "      - uses: ./.github/actions/local",
      "      - uses: actions/checkout@v4",
      "      - uses: actions/checkout@11d5960",
      "      - uses: softprops/action-gh-release@main # main",
      `      - uses: actions/upload-artifact@${sha}`,
      "      - uses: docker://alpine:3",
      `      - uses: actions/checkout@${sha.toUpperCase()} # v4.4.0`,
      "      - { uses: actions/cache@v4 }",
      `      - { uses: actions/cache@${sha}, with: { path: x } }`,
    ].join("\n");
    expect(unpinnedUses(text).map((b) => b.split(": ")[0])).toEqual([
      "actions/checkout@v4",
      "actions/checkout@11d5960",
      "softprops/action-gh-release@main",
      `actions/upload-artifact@${sha}`,
      "docker://alpine:3",
      `actions/checkout@${sha.toUpperCase()}`,
      "actions/cache@v4",
      `actions/cache@${sha}`,
    ]);
  });
});