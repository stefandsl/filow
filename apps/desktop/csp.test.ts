import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { POLICY, cspHeaders } = require("./csp.js") as {
  POLICY: string;
  cspHeaders: (d: { url: string; resourceType: string; responseHeaders?: Record<string, string[]> }, ports: number[], reportOnly?: boolean) => Record<string, string[]>;
};

it("has no eval and no remote script sources", () => {
  const script = POLICY.split("; ").find((d) => d.startsWith("script-src"))!;
  expect(script).not.toContain("'unsafe-eval'");
  expect(script).not.toMatch(/https?:|\*/);
  expect(POLICY).toContain("object-src 'none'");
});

it("keeps blob: and data: out of script-src; the microphone worklet is a same-origin file 'self' covers", () => {
  // Worklets follow script-src. The worklet used to come from a blob: URL, which needed blob: here
  // (without it every take failed with "Failed to load worklet module script"); blob: would let any
  // running script execute strings once 'unsafe-inline' goes. Now it is apps/web/public/mic-worklet.js.
  const script = POLICY.split("; ").find((d) => d.startsWith("script-src"))!.split(" ");
  expect(script).not.toContain("blob:");
  expect(script).not.toContain("data:");
  expect(script).toContain("'self'");
  const mic = fs.readFileSync(path.join(__dirname, "../../packages/stt/src/mic.ts"), "utf8");
  expect(mic).not.toMatch(/createObjectURL|new Blob\(/);
  const url = /MIC_WORKLET_URL = "(\/[^"]+)"/.exec(mic)?.[1];
  expect(url).toBe("/mic-worklet.js");
  expect(mic).toMatch(/audioWorklet\.addModule\(MIC_WORKLET_URL\)/);
  expect(fs.readFileSync(path.join(__dirname, "../web/public", url!), "utf8")).toMatch(/registerProcessor\("pcm-chunker"/);
});

it("sets the policy only on our own pages and replaces any existing one", () => {
  const own = cspHeaders({ url: "http://127.0.0.1:4747/", resourceType: "mainFrame", responseHeaders: { "content-security-policy": ["x"] } }, [4747]);
  expect(own["Content-Security-Policy"]).toEqual([POLICY]);
  expect(own["content-security-policy"]).toBeUndefined();
  expect(cspHeaders({ url: "https://example.com/", resourceType: "mainFrame" }, [4747])["Content-Security-Policy"]).toBeUndefined();
  expect(cspHeaders({ url: "http://127.0.0.1:9999/", resourceType: "mainFrame" }, [4747])["Content-Security-Policy"]).toBeUndefined();
  expect(cspHeaders({ url: "http://127.0.0.1:4747/a.js", resourceType: "script" }, [4747])["Content-Security-Policy"]).toBeUndefined();
});

it("lets our pages reach the session relay on this PC's LAN address (found in report-only mode)", () => {
  const h = cspHeaders({ url: "http://192.168.1.100:4747/", resourceType: "mainFrame" }, [4747], false, ["192.168.1.100"]);
  expect(h["Content-Security-Policy"][0]).toContain("ws://192.168.1.100:*");
  expect(h["Content-Security-Policy"][0]).toContain("http://192.168.1.100:*");
});

it("can run report-only while a new policy is checked", () => {
  const h = cspHeaders({ url: "http://localhost:4747/okfilow/panel", resourceType: "subFrame" }, [4747], true);
  expect(h["Content-Security-Policy-Report-Only"]).toEqual([POLICY]);
  expect(h["Content-Security-Policy"]).toBeUndefined();
});
