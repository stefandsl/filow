// OK Filow agents (docs/OKFILOW-GAUNTLET.md row 13), HeyClicky's "agent, ..." background jobs.
// Saying or typing "agent, <task>" starts a coding-agent CLI the user already has (Codex or Claude
// Code) in a folder of its own. The job runs in the background; when it ends, OK Filow says so and
// opens what it made. Nothing runs unless the user asked for it in words.
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

/**
 * "agent, make a PDF..." / "agent: ..." / "OK Filow agent ..." / "hey agent ..." -> the task, else null.
 * Without a wake word ("ok", "hey", "filow") the word must be followed by a comma or colon, so a
 * question that merely starts with "Agents in this list..." is answered, not run as a job.
 */
const WOKEN_RE = /^\s*(?:(?:hey|ok|okay)[\s,]+(?:filow[\s,]+)?|filow[\s,]+)(?:agents?|agente|agenti)\b[\s,:.\-]*(.*)$/is;
const PLAIN_RE = /^\s*(?:agents?|agente|agenti)\s*[,:]\s*(.*)$/is;
// Speech-to-text writes no commas: "Agent write a note about rockets". The singular word followed by
// a request counts; a question ("agent settings, where are they?") does not.
const SPOKEN_RE = /^\s*(?:agent|agente)[\s.]+([^?]*[^?\s])\s*[.!]?\s*$/is;
function agentTask(text) {
  const t = String(text || "");
  const m = WOKEN_RE.exec(t) || PLAIN_RE.exec(t) || SPOKEN_RE.exec(t);
  if (!m) return null;
  const task = m[1].trim();
  return task.length >= 3 ? task : null;
}

/** Results OK Filow may open by itself: documents and media only, never anything that runs. */
const OPENABLE = new Set([".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".md", ".txt", ".csv", ".html", ".htm", ".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp", ".mp3", ".wav", ".mp4", ".json"]);
function safeToOpen(p) {
  return OPENABLE.has(path.extname(String(p || "")).toLowerCase());
}

/** A short title from the task: its first words, capitalised. */
function titleOf(task) {
  const words = String(task).replace(/[\r\n]+/g, " ").split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  const t = words.length > 48 ? `${words.slice(0, 47)}…` : words;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The instructions every job gets, around the user's own words. */
function jobPrompt(task, context) {
  return [
    "You are an OK Filow agent running in the background on the user's Windows PC.",
    "Do the task below on your own; do not ask questions unless you truly cannot continue.",
    "Work only inside the current folder. Save every file you make in ./output (create it).",
    "Do not open files or apps yourself; OK Filow opens your results when you finish.",
    "When done, reply with two or three plain sentences saying what you made, then a line",
    "ARTIFACTS: followed by the output file names separated by commas (or none).",
    context ? `\nWhat was on the user's screen when they asked: ${context}` : "",
    `\nTask: ${task}`,
  ].join("\n");
}

/** Which CLI to use: the setting, else Codex, else Claude Code. Returns null when neither exists. */
function pickCli(setting, has) {
  if (setting === "codex" || setting === "claude") return has(setting) ? setting : null;
  if (has("codex")) return "codex";
  if (has("claude")) return "claude";
  return null;
}

/** Splits the agent's final reply into the summary and the ARTIFACTS list. */
function parseReply(reply) {
  const text = String(reply || "").trim();
  const m = /^\s*ARTIFACTS:\s*(.*)$/im.exec(text);
  const artifacts = m && !/^none\.?$/i.test(m[1].trim())
    ? m[1].split(",").map((s) => s.trim().replace(/^["'`]|["'`]$/g, "")).filter(Boolean)
    : [];
  const summary = (m ? text.slice(0, m.index) : text).trim().split(/\n+/).slice(-4).join(" ").slice(0, 600);
  return { summary, artifacts };
}

/** With shell: true on Windows the args are joined into one command line: quote paths (spaces, &). */
const quote = (s) => (process.platform === "win32" ? '"' + String(s).replace(/"/g, "") + '"' : String(s));
function commandFor(cli, dir) {
  if (cli === "codex") {
    return { cmd: "codex", args: ["exec", "--skip-git-repo-check", "-s", "workspace-write", "-C", quote(dir), "-o", quote(path.join(dir, "reply.txt")), "-"] };
  }
  return { cmd: "claude", args: ["-p", "--permission-mode", "acceptEdits", "--output-format", "text"] };
}

/**
 * @param {{ baseDir: string, logLine: (s: string) => void, onChange: (jobs: object[]) => void,
 *           cli: () => string, which: (name: string) => boolean, openPath: (p: string) => void,
 *           announce: (job: object) => void }} o
 */
function createAgents(o) {
  const file = path.join(o.baseDir, "jobs.json");
  let jobs = [];
  const procs = new Map();
  try { jobs = JSON.parse(fs.readFileSync(file, "utf8")); } catch { jobs = []; }
  // A job that was running when Filow quit did not finish.
  for (const j of jobs) if (j.status === "running") j.status = "stopped";

  const save = () => {
    try { fs.mkdirSync(o.baseDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(jobs.slice(-50), null, 2)); } catch (e) { o.logLine(`okfilow agents: save failed ${e.message}`); }
    o.onChange(list());
  };
  const list = () => jobs.slice().reverse().map((j) => ({ ...j }));

  function start(task, context = "") {
    const cli = pickCli(o.cli(), o.which);
    if (!cli) throw new Error("No agent CLI found. Install Codex (npm i -g @openai/codex) or Claude Code, then try again.");
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const dir = path.join(o.baseDir, id);
    fs.mkdirSync(path.join(dir, "output"), { recursive: true });
    const job = { id, title: titleOf(task), task, cli, dir, status: "running", startedAt: new Date().toISOString(), summary: "", artifacts: [] };
    jobs.push(job);
    const { cmd, args } = commandFor(cli, dir);
    const log = fs.createWriteStream(path.join(dir, "agent.log"));
    let out = "";
    const child = spawn(cmd, args, { cwd: dir, shell: process.platform === "win32", windowsHide: true, env: { ...process.env, NO_COLOR: "1" } });
    procs.set(id, child);
    child.stdout.on("data", (d) => { log.write(d); out = (out + d.toString()).slice(-20000); });
    child.stderr.on("data", (d) => log.write(d));
    child.on("error", (e) => finish(job, "failed", `Could not start ${cli}: ${e.message}`));
    child.on("close", (code) => {
      log.end();
      if (job.status !== "running") return;
      let reply = out;
      try { reply = fs.readFileSync(path.join(dir, "reply.txt"), "utf8") || out; } catch { /* claude: stdout is the reply */ }
      const { summary, artifacts } = parseReply(reply);
      const made = artifacts.map((a) => path.resolve(dir, "output", path.basename(a))).filter((p) => fs.existsSync(p));
      if (!made.length) {
        try { for (const f of fs.readdirSync(path.join(dir, "output"))) made.push(path.join(dir, "output", f)); } catch { /* no output */ }
      }
      job.artifacts = made.slice(0, 10);
      finish(job, code === 0 ? "done" : "failed", summary || (code === 0 ? "Done." : `The agent stopped with code ${code}.`));
    });
    child.stdin.end(jobPrompt(task, context));
    o.logLine(`okfilow agents: started ${id} with ${cli}`);
    save();
    return { ...job };
  }

  function finish(job, status, summary) {
    if (job.status !== "running") return;
    job.status = status;
    job.summary = summary;
    job.finishedAt = new Date().toISOString();
    procs.delete(job.id);
    o.logLine(`okfilow agents: ${job.id} ${status}`);
    save();
    o.announce({ ...job });
    if (status === "done" && job.artifacts[0]) {
      if (safeToOpen(job.artifacts[0])) o.openPath(job.artifacts[0]);
      else o.showItem(job.artifacts[0]);
    }
  }

  function stop(id) {
    const child = procs.get(id);
    const job = jobs.find((j) => j.id === id);
    if (!job || job.status !== "running") return list();
    job.status = "stopped";
    job.summary = "Stopped.";
    procs.delete(id);
    if (child) {
      // The CLI runs under a shell on Windows: end the whole tree.
      if (process.platform === "win32") spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
      else child.kill();
    }
    save();
    return list();
  }

  function remove(id) {
    const job = jobs.find((j) => j.id === id);
    if (!job || job.status === "running") return list();
    jobs = jobs.filter((j) => j.id !== id);
    save();
    return list();
  }

  function dispose() {
    for (const id of [...procs.keys()]) stop(id);
  }

  return { start, stop, remove, list, dispose };
}

module.exports = { createAgents, agentTask, titleOf, jobPrompt, pickCli, parseReply, safeToOpen };
