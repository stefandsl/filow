import { NextResponse } from "next/server";
import { requireEngine } from "@/lib/engineAuth";
import { checkFreeLlm, freellmConfig, scriptCloud } from "@/lib/freellm";

export const dynamic = "force-dynamic";

/**
 * "Check connection" in Settings > FreeLLMAPI: asks the user's router for its model list
 * (GET <address>/models) with the saved key. No user content is sent, and nothing at all in Offline
 * mode. The answer never contains the key. Gated like the other spend endpoints (`requireEngine`):
 * in the desktop app, where the server listens on the Wi-Fi, a caller needs the engine token. The
 * only address it can reach is the saved one, which was checked to be local (`normalizeBaseUrl`).
 */
export async function POST(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { lang?: string };
  return NextResponse.json(await checkFreeLlm(body.lang === "it" ? "it" : "en"));
}

/** What is set, for the settings section when there is no desktop bridge (the browser). Never the key. */
export async function GET(req: Request) {
  const denied = requireEngine(req);
  if (denied) return denied;
  const c = freellmConfig();
  return NextResponse.json({ baseUrl: c.baseUrl, model: c.model, hasKey: Boolean(c.key), scripts: scriptCloud() === "freellm", offline: process.env.FILOW_OFFLINE === "1" });
}
