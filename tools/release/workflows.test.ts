// Every external action a GitHub workflow runs is pinned to a full 40-hex commit SHA, so a moved or
// hijacked tag cannot change what CI executes. The tag stays readable in a comment (`# v4.4.0`).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflowsDir = path.join(root, ".github", "workflows");

/** Each `uses:` line of a workflow that is not a local action pinned as `owner/repo[/path]@<40 hex> # <tag>`. */
export function unpinnedUses(text: string): string[] {
  const bad: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!/^\s*(-\s+)?uses\s*:/.test(line)) return;
    const m = /^\s*(?:-\s+)?uses\s*:\s*(["']?)([^\s"'#]+)\1\s*(#.*)?$/.exec(line);
    const ref = m?.[2] ?? "";
    if (ref.startsWith("./")) return; // an action in this repository runs at the checked-out commit
    const pinned = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+@[0-9a-f]{40}$/.test(ref) && /^#\s*\S+/.test(m?.[3] ?? "");
    if (!pinned) bad.push(`line ${i + 1}: ${line.trim()}`);
  });
  return bad;
}

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

  it("flags a tag, a short SHA, a branch, a missing comment and an unparseable line", () => {
    const sha = "11d5960a326750d5838078e36cf38b85af677262";
    const text = [
      `      - uses: actions/checkout@${sha} # v4.4.0`,
      `        uses: "actions/setup-node@${sha}" # v4.4.0`,
      "      - uses: ./.github/actions/local",
      "      - uses: actions/checkout@v4",
      "      - uses: actions/checkout@11d5960",
      "        uses: softprops/action-gh-release@main # main",
      `      - uses: actions/upload-artifact@${sha}`,
      `      - uses: docker://alpine:3`,
      `      - uses: actions/checkout@${sha.toUpperCase()} # v4.4.0`,
    ].join("\n");
    expect(unpinnedUses(text)).toEqual([
      "line 4: - uses: actions/checkout@v4",
      "line 5: - uses: actions/checkout@11d5960",
      "line 6: uses: softprops/action-gh-release@main # main",
      `line 7: - uses: actions/upload-artifact@${sha}`,
      "line 8: - uses: docker://alpine:3",
      `line 9: - uses: actions/checkout@${sha.toUpperCase()} # v4.4.0`,
    ]);
  });
});
