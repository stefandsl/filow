import { createRequire } from "node:module";
import net from "node:net";
import tls from "node:tls";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { isQaBuild, installSocketLog, describeConnect } = require("./qa.js") as {
  isQaBuild: (app: { isPackaged: boolean } | null, pkg: () => Record<string, unknown>) => boolean;
  installSocketLog: (write: (line: string) => void) => () => void;
  describeConnect: (args: unknown[]) => { host?: string; port?: number; path?: string } | null;
};

it("allows test switches in development and in packages built as QA builds only", () => {
  expect(isQaBuild({ isPackaged: false }, () => ({}))).toBe(true);
  expect(isQaBuild({ isPackaged: true }, () => ({ filowQa: true }))).toBe(true);
  expect(isQaBuild({ isPackaged: true }, () => ({}))).toBe(false);
  expect(isQaBuild({ isPackaged: true }, () => ({ filowQa: "true" }))).toBe(false);
  expect(isQaBuild({ isPackaged: true }, () => { throw new Error("no package.json"); })).toBe(false);
});

it("describes every form of a connect() call", () => {
  expect(describeConnect([[{ host: "api.example.com", port: 443 }, () => {}]])).toEqual({ host: "api.example.com", port: 443 });
  expect(describeConnect([{ port: 11434 }])).toEqual({ host: "localhost", port: 11434 });
  expect(describeConnect([8080, "10.0.0.2"])).toEqual({ host: "10.0.0.2", port: 8080 });
  expect(describeConnect(["8080"])).toEqual({ host: "localhost", port: 8080 });
  expect(describeConnect(["\\\\.\\pipe\\filow"])).toEqual({ path: "\\\\.\\pipe\\filow" });
  expect(describeConnect([[{ path: "/tmp/s.sock" }]])).toEqual({ path: "/tmp/s.sock" });
});

it("the QA socket log records every connection the process opens: net, tls, http and fetch, even one that fails at once", async () => {
  const server = net.createServer((s) => s.on("error", () => {}).end("HTTP/1.1 200 OK\r\ncontent-length: 2\r\nconnection: close\r\n\r\nok"));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  const lines: string[] = [];
  const uninstall = installSocketLog((l) => lines.push(l));
  try {
    await new Promise<void>((r) => net.connect(port, "127.0.0.1", r).on("connect", function (this: net.Socket) { this.destroy(); }));
    await new Promise<void>((r) => { const t = tls.connect({ host: "127.0.0.1", port, rejectUnauthorized: false }); t.on("error", () => r()); t.on("close", () => r()); });
    expect(await (await fetch(`http://127.0.0.1:${port}/`)).text()).toBe("ok");
    await new Promise<void>((r) => net.connect({ host: "192.0.2.1", port: 9, timeout: 1 }).on("error", () => r()).on("timeout", function (this: net.Socket) { this.destroy(); r(); }));
  } finally {
    uninstall();
    server.close();
  }
  const seen = lines.map((l) => JSON.parse(l) as { at: number; host: string; port: number });
  expect(seen.filter((s) => s.host === "127.0.0.1" && s.port === port).length).toBeGreaterThanOrEqual(3);
  expect(seen).toContainEqual(expect.objectContaining({ host: "192.0.2.1", port: 9 }));
  expect(seen.every((s) => typeof s.at === "number")).toBe(true);
  lines.length = 0;
  await new Promise<void>((r) => net.connect(port, "127.0.0.1").on("error", () => r()).on("close", () => r()).on("connect", function (this: net.Socket) { this.destroy(); }));
  expect(lines).toEqual([]); // uninstalled
});