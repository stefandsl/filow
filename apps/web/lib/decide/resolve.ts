import type { ServerDecisionProviderId } from "@filow/core";

const SERVER_PROVIDERS: ServerDecisionProviderId[] = ["openrouter", "clef-local", "clef-cloudflare", "freellm"];

/**
 * The decision provider /api/decide uses: the one the request names, else DECISION_PROVIDER, else
 * openrouter. Offline, only the local one. Also what GET /api/buddy/recipients reports as the
 * default, so a client that does not choose (the PowerPoint add-in) knows who would read the words.
 */
export function resolveDecisionProvider(requested?: string): ServerDecisionProviderId {
  const offline = process.env.FILOW_OFFLINE === "1";
  const env = process.env.DECISION_PROVIDER as ServerDecisionProviderId;
  const fallback = SERVER_PROVIDERS.includes(env) ? env : "openrouter";
  const id = requested && (SERVER_PROVIDERS as string[]).includes(requested) ? (requested as ServerDecisionProviderId) : fallback;
  if (offline && id !== "clef-local") return "clef-local";
  return id;
}
