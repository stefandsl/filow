import { createRequire } from "node:module";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { staleTunnelPids, linkStartsForPairing } = require("./tunnels.js") as { staleTunnelPids: (l: string, p: number[], s?: number) => number[]; linkStartsForPairing: (now: { wanted: unknown; offline: boolean; hosted: boolean; state: string }) => boolean };

const listing = [
  "12592\tC:\\ProgramData\\chocolatey\\lib\\cloudflared\\tools\\cloudflared.exe tunnel --url http://127.0.0.1:4747 --no-autoupdate",
  "57664\t\"C:\\ProgramData\\chocolatey\\bin\\cloudflared.exe\" tunnel --url http://127.0.0.1:4748 --no-autoupdate",
  "52460\tcloudflared.exe tunnel --url http://127.0.0.1:4797 --no-autoupdate",
  "91584\tcloudflared.exe tunnel run my-named-tunnel",
  "30312\tnode.exe server.js --url http://127.0.0.1:4747",
  "",
  "garbage line",
].join("\r\n");

it("finds cloudflared quick tunnels to our ports only, including shim children", () => {
  expect(staleTunnelPids(listing, [4747, 4748], 1)).toEqual([12592, 57664]);
});

it("ignores other ports, named tunnels, non-cloudflared processes and itself", () => {
  expect(staleTunnelPids(listing, [4797], 52460)).toEqual([]);
  expect(staleTunnelPids(listing, [9999], 1)).toEqual([]);
});

// The public link starts when "Pair a phone" is opened, never at launch (main.js linkForPairing).
it("the link starts for pairing only when the user has it on, Filow may go online and no link is up", () => {
  const base = { wanted: true, offline: false, hosted: false, state: "off" };
  expect(linkStartsForPairing(base)).toBe(true);
  expect(linkStartsForPairing({ ...base, state: "error" })).toBe(true);
  for (const state of ["on", "connecting", "downloading"]) expect(linkStartsForPairing({ ...base, state }), state).toBe(false);
  expect(linkStartsForPairing({ ...base, wanted: false })).toBe(false);
  expect(linkStartsForPairing({ ...base, wanted: undefined })).toBe(false);
  expect(linkStartsForPairing({ ...base, offline: true })).toBe(false);
  expect(linkStartsForPairing({ ...base, hosted: true })).toBe(false);
});