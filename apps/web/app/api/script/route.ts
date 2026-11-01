import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseScript } from "@filow/core";

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

export async function PUT(req: Request) {
  const { text } = (await req.json()) as { text?: string };
  if (typeof text !== "string") {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  await fs.mkdir(path.dirname(SCRIPT_PATH), { recursive: true });
  await fs.writeFile(SCRIPT_PATH, text, "utf8");
  return NextResponse.json({ text, script: parseScript(text) });
}
