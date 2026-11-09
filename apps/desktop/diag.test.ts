import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { redact, issueUrl } = require("./diag.js");

// Built from pieces so no key-shaped string sits in a tracked file (SUP-05 scans them).
const KEY_SHAPED = "sk-or-v1-" + "0123456789abcdef".repeat(2);

describe("report redaction", () => {
  it("masks a live public link, keys, tokens, e-mails and LAN addresses", () => {
    const log = [
      "public link: error tunnel https://drives-pulling-agrees-ambassador.trycloudflare.com/session?x=1 failed",
      `OPENROUTER_API_KEY=${KEY_SHAPED}`,
      "Authorization: Bearer abcdefghijklmnopqrstuvwx",
      "ACCESS_PASSWORD=Zx81_qwertyuiop",
      "sent by mario.rossi@example.com",
      "LAN 192.168.1.23:4747 and 10.0.0.5 and 172.20.3.4; public 8.8.8.8 stays",
    ].join("\n");
    const out = redact(log);
    expect(out).not.toMatch(/trycloudflare/);
    expect(out).not.toMatch(/sk-or-v1-0123/);
    expect(out).not.toMatch(/abcdefghijklmnop/);
    expect(out).not.toMatch(/Zx81_qwertyuiop/);
    expect(out).not.toMatch(/mario\.rossi/);
    expect(out).not.toMatch(/192\.168\.1\.23|10\.0\.0\.5|172\.20\.3\.4/);
    expect(out).toMatch(/8\.8\.8\.8/);
    expect(out).toMatch(/<public link> failed/);
  });

  it("replaces the home folder with either separator, and the user name elsewhere in paths", () => {
    const out = redact("at C:\\Users\\Mario\\AppData\\x.js and C:/Users/Mario/.filow and D:\\Backup\\Mario\\y", { home: "C:\\Users\\Mario", user: "Mario" });
    expect(out).toBe("at ~\\AppData\\x.js and ~/.filow and D:\\Backup\\<user>\\y");
  });

  it("leaves ordinary log lines alone", () => {
    const line = "2026-11-09T13:42:00.651Z startup: servers answering (7750 ms)";
    expect(redact(line, { home: "C:\\Users\\Asus", user: "Asus" })).toBe(line);
  });
});

describe("issue URL", () => {
  const base = "https://github.com/o/r/issues/new";
  it("keeps short reports whole", () => {
    const r = issueUrl(base, "t", { head: "h\n", log: "line 1\nline 2\n", tail: "```" });
    expect(r.truncated).toBe(false);
    expect(decodeURIComponent(r.url.split("&body=")[1])).toBe("h\nline 1\nline 2\n```");
  });

  it("cuts the oldest log lines to fit and never ends inside a %-escape", () => {
    const log = Array.from({ length: 2000 }, (_, i) => `line ${i} àèì "quoted" & more`).join("\n");
    const r = issueUrl(base, "title", { head: "**startup.log**\n```\n", log, tail: "\n```" }, 7800);
    expect(r.truncated).toBe(true);
    expect(r.url.length).toBeLessThanOrEqual(7800);
    const body = decodeURIComponent(r.url.split("&body=")[1]); // throws on a broken escape
    expect(body).toMatch(/line 1999/);
    expect(body).not.toMatch(/line 0 /);
    expect(body.endsWith("\n```")).toBe(true);
  });
});
