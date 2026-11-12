// docs/okfilow/OUTBOUND.md is the inventory of everything that leaves this PC. Its "Gate (server)"
// column names the kinds of content; this keeps it and OUTBOUND_KINDS (the kinds the code knows) one list.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OUTBOUND_KINDS } from "./outbound";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const doc = fs.readFileSync(path.join(root, "docs/okfilow/OUTBOUND.md"), "utf8").replace(/\r\n/g, "\n");

/** The backticked tokens of column 5 ("Gate (server)") of the inventory table's rows. */
function gateTokens(): string[] {
  const rows = doc.split("\n").filter((l) => /^\| \d+ \|/.test(l));
  expect(rows.length).toBeGreaterThan(10);
  return rows.flatMap((row) => {
    const cells = row.split("|");
    // "| # | Where | What leaves | To whom | Gate (server) | Notice / signal |": cells[0] is empty, cells[5] is the gate
    expect(cells.length).toBe(8);
    return [...cells[5].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  });
}

describe("the outbound inventory (docs/okfilow/OUTBOUND.md)", () => {
  it("has the gate column where this test reads it", () => {
    expect(doc).toContain("| # | Where | What leaves | To whom | Gate (server) | Notice / signal |");
  });

  it("every kind named in the gate column is a kind the code knows", () => {
    const named = gateTokens().filter((t) => /^[a-z]+$/.test(t));
    expect(named.length).toBeGreaterThan(0);
    for (const kind of named) expect(OUTBOUND_KINDS as string[]).toContain(kind);
  });

  it("every kind the code knows appears in the gate column", () => {
    const named = new Set(gateTokens());
    for (const kind of OUTBOUND_KINDS) expect(named.has(kind), `kind "${kind}" is not in OUTBOUND.md's gate column`).toBe(true);
  });

  it("the account page tells what leaves before Sign in", () => {
    const page = fs.readFileSync(path.join(root, "apps/web/app/account/page.tsx"), "utf8");
    expect(page).toContain('okfText(lang)("notice_account")');
    expect(page.indexOf('data-testid="account-outbound"')).toBeLessThan(page.indexOf('tr("account.signIn")'));
    expect(page.indexOf('data-testid="account-outbound"')).toBeGreaterThan(0);
  });
});
