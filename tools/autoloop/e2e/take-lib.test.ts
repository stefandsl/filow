import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM module without types
import { HeardTracker, classifyConnections, isLoopback, overlap, parseNetstat, passFresh, processTree, socketLogAudit } from "./take-lib.mjs";

const NETSTAT = `
Connessioni attive

  Proto  Indirizzo locale       Indirizzo esterno      Stato           PID
  TCP    0.0.0.0:4801           0.0.0.0:0              LISTENING       100
  TCP    0.0.0.0:4802           0.0.0.0:0              LISTENING       100
  TCP    127.0.0.1:11434        0.0.0.0:0              LISTENING       500
  TCP    127.0.0.1:3128         0.0.0.0:0              LISTENING       600
  TCP    127.0.0.1:50000        127.0.0.1:4801         ESTABLISHED     101
  TCP    127.0.0.1:50001        127.0.0.1:11434        ESTABLISHED     100
  TCP    192.168.1.5:50002      192.168.1.5:4802       ESTABLISHED     101
  TCP    192.168.1.5:4802       192.168.1.5:50002      ESTABLISHED     100
  TCP    192.168.1.5:50003      20.1.2.3:443           ESTABLISHED     101
  TCP    127.0.0.1:50004        127.0.0.1:3128         ESTABLISHED     100
  TCP    192.168.1.5:50005      8.8.8.8:443            SYN_SENT        600
  TCP    192.168.1.5:50006      9.9.9.9:443            ESTABLISHED     999
  TCP    [::1]:50007            [::1]:4801             ESTABLISHED     101
  UDP    192.168.1.5:5353       *:*                                    101
  UDP    127.0.0.1:60000        *:*                                    101
`;
const rows = parseNetstat(NETSTAT);
const tree = new Map([[100, "Filow.exe"], [101, "Filow.exe"]]);
const names = new Map([...tree, [500, "ollama.exe"], [600, "proxy.exe"], [999, "other.exe"]]);
const own = new Set(["192.168.1.5"]);

describe("netstat and connections", () => {
  it("parses TCP and UDP rows with their owner, and skips headers", () => {
    expect(rows).toHaveLength(15);
    expect(rows[0]).toEqual({ proto: "TCP", local: "0.0.0.0:4801", remote: "0.0.0.0:0", state: "LISTENING", pid: 100 });
    expect(rows.at(-1)).toEqual({ proto: "UDP", local: "127.0.0.1:60000", remote: "*:*", state: "", pid: 101 });
  });

  it("sorts our connections: outbound, own LAN address, local peers and what they send out, UDP", () => {
    const c = classifyConnections(rows, tree, names, own);
    expect(c.outbound).toEqual(["TCP 192.168.1.5:50003 20.1.2.3:443 ESTABLISHED Filow.exe#101"]);
    expect(c.self).toEqual(["TCP 192.168.1.5:50002 192.168.1.5:4802 ESTABLISHED Filow.exe#101", "TCP 192.168.1.5:4802 192.168.1.5:50002 ESTABLISHED Filow.exe#100"]);
    expect(c.peers).toEqual(["ollama.exe#500 :11434", "proxy.exe#600 :3128"]);
    // a local proxy cannot hide traffic: its own outbound connection is listed; an unrelated process is not
    expect(c.peerOutbound).toEqual(["TCP 192.168.1.5:50005 8.8.8.8:443 SYN_SENT proxy.exe#600"]);
    expect(c.udp).toEqual(["UDP 192.168.1.5:5353 *:*  Filow.exe#101"]); // bound to the LAN, not to loopback
    expect(c.keys).toHaveLength(11); // every row of ours, listeners and UDP included
  });

  it("builds the process tree from the root, ignoring a reused parent PID", () => {
    const table = [
      { ProcessId: 1, ParentProcessId: 0, created: 10 },
      { ProcessId: 2, ParentProcessId: 1, created: 11 },
      { ProcessId: 3, ParentProcessId: 2, created: 12 },
      { ProcessId: 4, ParentProcessId: 1, created: 5 }, // older than its "parent": the real parent died, PID 1 was reused
      { ProcessId: 5, ParentProcessId: 9, created: 20 },
    ];
    expect([...processTree(table, 1)].sort()).toEqual([1, 2, 3]);
    expect([...processTree(table, 42)]).toEqual([]);
  });

  it("reads the QA socket log: local, pipes, and every connection to another host", () => {
    const log = [
      { at: 1, host: "127.0.0.1", port: 11434 }, { at: 2, host: "localhost", port: 4802 }, { at: 3, host: "192.168.1.5", port: 4802 },
      { at: 4, host: "::1", port: 4801 }, { at: 5, path: "\\\\.\\pipe\\x" }, { at: 6, host: "api.openai.com", port: 443 }, { at: 7, host: "api.openai.com", port: 443 },
    ].map((e) => JSON.stringify(e)).join("\n") + '\n{"at":8,"ho';
    expect(socketLogAudit(log, own)).toEqual({ lines: 7, local: 4, pipes: 1, unreadable: 1, external: ["api.openai.com:443"] });
  });
});

describe("what was heard", () => {
  const lines = [
    "This is a different type of artificial intelligence: instead of writing text back to you, it simply gives you a decision.",
    "On a completely different note, I had a great espresso this morning and the weather in Milan was lovely.",
    "You cannot have a conversation with it, it is not able to use any tools, and it has no way to browse the internet.",
    "Now all the other companies are making their own version of it, and that tells you it has to be really good.",
  ];

  it("measures how much of a line a transcript holds, by its content words", () => {
    expect(overlap(lines[2], "you cannot have a conversation with it it is not able to use any tools")).toBeGreaterThan(0.6);
    expect(overlap(lines[2], "I had a great espresso this morning")).toBe(0);
    expect(overlap("", "anything")).toBe(0);
  });

  it("records a line each time it is said again, not each time a partial is revised", () => {
    const h = new HeardTracker(lines);
    h.update("", 0);
    h.update("this is a different type of artificial", 1000);
    h.update("this is a different type of artificial intelligence instead of writing text back", 1500);
    h.update("this is a different type of artificial intelligence instead of writing text bag", 1800); // revision
    h.update("on a completely different note I had a great espresso this morning and the weather", 6000);
    h.update("you cannot have a conversation with it it is not able to use any tools", 11000);
    h.update("now all the other companies are making their own version of it", 16000);
    h.update("this is a different type of artificial intelligence instead of writing text", 40000); // the loop again
    expect(h.edges).toEqual([{ line: 0, atMs: 1500 }, { line: 1, atMs: 6000 }, { line: 2, atMs: 11000 }, { line: 3, atMs: 16000 }, { line: 0, atMs: 40000 }]);
  });

  it("a partial that wavers while the line is still on screen is not heard twice", () => {
    const h = new HeardTracker(lines);
    h.update("different type artificial intelligence instead writing", 1500);
    h.update("different type artificial", 1600); // revised down, still on screen
    h.update("different type artificial intelligence instead writing text", 1700);
    expect(h.edges).toEqual([{ line: 0, atMs: 1500 }]);
  });

  it("a pass is fresh only when each point ticked after its own line was heard in that pass", () => {
    const edges = [{ line: 0, atMs: 1500 }, { line: 1, atMs: 6000 }, { line: 2, atMs: 11000 }, { line: 3, atMs: 16000 }, { line: 0, atMs: 40000 }, { line: 2, atMs: 50000 }, { line: 3, atMs: 55000 }];
    expect(passFresh({ startMs: 0, done: [3000, 13000, 18000] }, edges)).toEqual({ fresh: true, stale: [] });
    // the off-topic line (heard at 6 s) ticked points 2 and 3 before their own lines: not by their speech
    expect(passFresh({ startMs: 0, done: [3000, 6500, 6600] }, edges)).toEqual({ fresh: false, stale: [1, 2] });
    // after a Reset at 19 s every point ticked again within 2 s: words from before the reset
    expect(passFresh({ startMs: 19000, done: [20000, 20500, 21000] }, edges)).toEqual({ fresh: false, stale: [0, 1, 2] });
    expect(passFresh({ startMs: 19000, done: [41000, 51000, 56000] }, edges)).toEqual({ fresh: true, stale: [] });
    expect(passFresh({ startMs: 0, done: [null, null, null] }, edges)).toEqual({ fresh: false, stale: [] });
    // a pass where only one point ticked is not a fresh pass
    expect(passFresh({ startMs: 19000, done: [41000, null, null] }, edges)).toEqual({ fresh: false, stale: [] });
    // the off-topic control: point 1 ticked while the off-topic sentence (line 1) was the latest line heard
    expect(passFresh({ startMs: 0, done: [7000, 13000, 18000] }, edges, [0, 2, 3], 1)).toEqual({ fresh: false, stale: [0] });
    expect(passFresh({ startMs: 0, done: [3000, 13000, 18000] }, edges, [0, 2, 3], 1)).toEqual({ fresh: true, stale: [] });
  });

  it("counts as loopback only the exact local forms, never a host name that starts like one", () => {
    for (const a of ["127.0.0.1", "127.5.0.9", "[::1]", "::1", "0.0.0.0", "[::]", "*", "localhost", "[::ffff:127.0.0.1]"]) expect(isLoopback(a)).toBe(true);
    for (const a of ["127.evil.example", "localhost.example.com", "*x.example.com", "10.0.0.1", "[::2]", "1270.0.0.1"]) expect(isLoopback(a)).toBe(false);
    expect(socketLogAudit('{"at":1,"host":"127.evil.example","port":443}\n', own).external).toEqual(["127.evil.example:443"]);
  });
});
