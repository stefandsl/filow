import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DICTIONARIES } from "@filow/core";

const require = createRequire(import.meta.url);
const { portFree, takenPorts } = require("./ports.js");

const HOST = "127.0.0.1";
const open: net.Server[] = [];
/** A program that holds a port: listens on one the system picks and never answers. */
const hold = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    open.push(s);
    s.once("error", reject);
    s.listen({ port: 0, host: HOST, exclusive: true }, () => resolve((s.address() as net.AddressInfo).port));
  });
/** A port nobody holds: one the system just gave out, released again. */
const freePort = async () => {
  const port = await hold();
  const s = open.pop()!;
  await new Promise((r) => s.close(r));
  return port;
};
afterEach(async () => {
  await Promise.all(open.splice(0).map((s) => new Promise((r) => s.close(r))));
});

describe("ports Filow's servers need (ports.js)", () => {
  it("says a port is free when nothing listens on it, and leaves it free", async () => {
    const port = await freePort();
    expect(await portFree(port, HOST)).toBe(true);
    expect(await portFree(port, HOST)).toBe(true); // the question itself must not keep the port
  });

  it("says a port is not free while another program holds it", async () => {
    const port = await hold();
    expect(await portFree(port, HOST)).toBe(false);
  });

  it("lists the taken ports in the order asked, and none when all are free", async () => {
    const [heldA, heldB, free] = [await hold(), await hold(), await freePort()];
    expect(await takenPorts([heldA, free, heldB], HOST)).toEqual([heldA, heldB]);
    expect(await takenPorts([free], HOST)).toEqual([]);
    expect(await takenPorts([], HOST)).toEqual([]);
  });
});

describe("main.js asks before it starts the servers", () => {
  const main = readFileSync(path.resolve(__dirname, "main.js"), "utf8").replace(/\r\n/g, "\n");
  const body = main.slice(main.indexOf("async function main()"));

  it("checks the app port and the relay port on the host the servers bind, then stops with the reason", () => {
    const ask = body.indexOf('require("./ports").takenPorts(process.env.FILOW_SESSION_URL ? [PORT] : [PORT, SESSION_PORT], serverHost())');
    const start = body.indexOf("    startServers();");
    expect(ask).toBeGreaterThan(0);
    expect(start).toBeGreaterThan(ask);
    const between = body.slice(ask, start);
    expect(between).toContain("if (taken.length) {");
    expect(between).toContain('failStartup(sharedText("shell.start.portTaken", menuLang(), { port: taken.join(", ") }));');
    expect(between).toMatch(/failStartup\([^\n]+\n\s+return;/); // never falls through to startServers
  });

  it("hides the splash before the error box, which blocks the thread a closing window needs", () => {
    const fail = main.slice(main.indexOf("function failStartup(err)"));
    const hide = fail.indexOf("if (splash && !splash.isDestroyed()) splash.hide();");
    expect(hide).toBeGreaterThan(0);
    expect(fail.indexOf("dialog.showMessageBoxSync(")).toBeGreaterThan(hide);
    // and a splash closed before its first paint is never shown afterwards
    expect(main).toContain("if (splash === w && !w.isDestroyed() && !w.isVisible()) {");
  });

  it("binds the servers where it asked", () => {
    expect(main).toContain("const bind = serverHost();");
  });

  it("has the sentence, with the port in it, in every language", () => {
    for (const [lang, dict] of Object.entries(DICTIONARIES)) {
      expect((dict as Record<string, string>)["shell.start.portTaken"], lang).toMatch(/\{port\}/);
    }
  });
});
