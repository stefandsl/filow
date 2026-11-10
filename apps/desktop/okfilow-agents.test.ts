import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tmpRoot } from "./test-tmp";

const require = createRequire(import.meta.url);
const { agentTask, titleOf, pickCli, parseReply, jobPrompt } = require("./okfilow-agents.js");

describe("OK Filow agents", () => {
  it("recognises 'agent, ...' requests in speech and typing, and nothing else", () => {
    expect(agentTask("agent, make me a two page PDF about rockets")).toBe("make me a two page PDF about rockets");
    expect(agentTask("Hey agent: research my competitors")).toBe("research my competitors");
    expect(agentTask("OK Filow agent build a landing page")).toBe("build a landing page");
    expect(agentTask("agents: summarise this PDF")).toBe("summarise this PDF");
    expect(agentTask("Agents in this list, which is best?")).toBeNull();
    expect(agentTask("Agenti di commercio, cosa fanno?")).toBeNull();
    expect(agentTask("Agents. summarise this PDF")).toBeNull();
    expect(agentTask("Agent write a short note about rockets")).toBe("write a short note about rockets");
    expect(agentTask("agente fammi un riassunto del PDF")).toBe("fammi un riassunto del PDF");
    expect(agentTask("agent settings where are they?")).toBeNull();
    expect(agentTask("where is the agent settings button?")).toBeNull();
    expect(agentTask("agent")).toBeNull();
    expect(agentTask("agentic workflows explained")).toBeNull();
    expect(agentTask("agente, fammi un riassunto")).toBe("fammi un riassunto");
  });

  it("titles a job from its first words", () => {
    expect(titleOf("make me a two page PDF about rockets please")).toBe("Make me a two page PDF");
  });

  it("picks the CLI the setting asks for, else Codex, else Claude, else none", () => {
    const has = (set: string[]) => (n: string) => set.includes(n);
    expect(pickCli("auto", has(["codex", "claude"]))).toBe("codex");
    expect(pickCli("auto", has(["claude"]))).toBe("claude");
    expect(pickCli("claude", has(["codex", "claude"]))).toBe("claude");
    expect(pickCli("claude", has(["codex"]))).toBeNull();
    expect(pickCli("auto", has([]))).toBeNull();
  });

  it("splits the final reply into a summary and the artifact list", () => {
    expect(parseReply("I made a PDF with four rivals.\nARTIFACTS: report.pdf, chart.png")).toEqual({ summary: "I made a PDF with four rivals.", artifacts: ["report.pdf", "chart.png"] });
    expect(parseReply("Nothing to save.\nARTIFACTS: none")).toEqual({ summary: "Nothing to save.", artifacts: [] });
    expect(parseReply("Done without the footer.").artifacts).toEqual([]);
  });

  it("keeps the job in its own folder and puts the user's words last", () => {
    const p = jobPrompt("make a PDF", "a spreadsheet of sales");
    expect(p).toContain("./output");
    expect(p).toContain("a spreadsheet of sales");
    expect(p.trim().endsWith("Task: make a PDF")).toBe(true);
  });

  it("runs a job end to end with a fake CLI, collects artifacts and survives a restart", async () => {
    const { createAgents } = require("./okfilow-agents.js");
    const base = tmpRoot("okf-agents");
    const bin = path.join(base, "bin");
    fs.mkdirSync(bin);
    // A stand-in "claude" that writes a file and replies like the real one.
    fs.writeFileSync(path.join(bin, "claude.cmd"), "@echo off\r\nmore > nul\r\necho hi> output\\note.txt\r\necho I wrote a note.\r\necho ARTIFACTS: note.txt\r\n");
    fs.writeFileSync(path.join(bin, "claude"), "#!/bin/sh\ncat >/dev/null\necho hi > output/note.txt\necho 'I wrote a note.'\necho 'ARTIFACTS: note.txt'\n", { mode: 0o755 });
    const oldPath = process.env.PATH;
    process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
    try {
      const announced: Array<{ status: string; summary: string; artifacts: string[] }> = [];
      const opened: string[] = [];
      const agents = createAgents({
        baseDir: path.join(base, "jobs"), logLine: () => {}, onChange: () => {}, cli: () => "claude",
        which: (n: string) => n === "claude", openPath: (p: string) => opened.push(p), announce: (j: { status: string; summary: string; artifacts: string[] }) => announced.push(j),
      });
      const job = agents.start("write a note");
      expect(job.status).toBe("running");
      for (let i = 0; i < 100 && !announced.length; i++) await new Promise((r) => setTimeout(r, 100));
      expect(announced[0]?.status).toBe("done");
      expect(announced[0]?.summary).toBe("I wrote a note.");
      expect(opened[0]?.endsWith(path.join("output", "note.txt"))).toBe(true);
      const again = createAgents({ baseDir: path.join(base, "jobs"), logLine: () => {}, onChange: () => {}, cli: () => "claude", which: () => true, openPath: () => {}, announce: () => {} });
      expect(again.list()[0]).toMatchObject({ id: job.id, status: "done" });
    } finally {
      process.env.PATH = oldPath;
      fs.rmSync(base, { recursive: true, force: true });
    }
  }, 20_000);
});

it("opens only documents and media by itself, never programs", () => {
  const { safeToOpen } = require("./okfilow-agents.js");
  expect(safeToOpen("C:/x/report.PDF")).toBe(true);
  expect(safeToOpen("C:/x/site/index.html")).toBe(true);
  for (const bad of ["run.bat", "setup.exe", "link.lnk", "script.js", "app.hta", "x.ps1", "noext"]) expect(safeToOpen(bad)).toBe(false);
});
