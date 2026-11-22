import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PairPanel, firewallMessage } from "./PairPanel";

it("shows the session code on the prompter without triggering the legacy public-link bridge", () => {
  const info = { id: "session", code: "123456", codeExpiresAt: 0, engineToken: "", serverUrl: "http://192.168.1.2:5002", mirrorUrl: "http://192.168.1.2:5001/mirror?code=123456" };
  const html = renderToStaticMarkup(<PairPanel info={info} prompter status="open" error={null} />);
  expect(html).toContain(">123456</button>");
  // In an older shell pairingOpened starts cloudflared. Opening a local panel must work there too.
  const panel = readFileSync(new URL("./PairPanel.tsx", import.meta.url), "utf8");
  expect(panel).not.toMatch(/\.pairingOpened\s*\??\./);
});

it("selects guidance for the available firewall controls", () => {
  expect(firewallMessage("missing", true)).toBe("pair.firewallMissing");
  expect(firewallMessage("missing", false)).toBe("pair.firewallMissingPrivate");
  expect(firewallMessage("blocked", true)).toBe("pair.firewallBlocked");
  expect(firewallMessage("blocked", false)).toBe("pair.firewallBlocked");
});
