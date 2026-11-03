import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseScript } from "@filow/core";
import { requireEngine } from "@/lib/engineAuth";

/** Where the talking points live. The desktop app points this at its user-data folder. */
const SCRIPT_PATH = process.env.FILOW_SCRIPT || path.join(process.cwd(), "script.md");

const DEFAULT_SCRIPT = `# Intro
- welcome everyone to the show
- today we build Filow

# Wrap up
- recap what we built
- thanks for watching
`;

async function readScript(): Promise<string> {
  try {
    return await fs.readFile(SCRIPT_PATH, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    await fs.mkdir(path.dirname(SCRIPT_PATH), { recursive: true });
    await fs.writeFile(SCRIPT_PATH, DEFAULT_SCRIPT, "utf8");
    return DEFAULT_SCRIPT;
  }
}

export async function GET() {
  const text = await readScript();
  return NextResponse.json({ text, script: parseScript(text) });
}

/** Saves the talking points. Engine token required while ACCESS_PASSWORD is set: anyone reaching a public server could otherwise replace the speaker's script mid-talk. */
export async function PUT(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  let text: unknown;
  try {
    ({ text } = (await req.json()) as { text?: unknown });
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof text !== "string") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  await fs.mkdir(path.dirname(SCRIPT_PATH), { recursive: true });
  await fs.writeFile(SCRIPT_PATH, text, "utf8");
  return NextResponse.json({ text, script: parseScript(text) });
}
