// "Nothing leaves without a yes, and every send is shown" for the clients that run outside the
// Filow window: the PowerPoint add-in and the browser extension. Same controller as the take page
// (outboundPage.ts); here only what those clients need on top: where they keep the choices, who
// would receive what when the server picks the engine, and a take that starts on this PC first.
// No React and no DOM, so it is tested with fakes. The UI is components/RemoteOutbound.tsx.
import { applyConsentChanges, decisionRecipient, sttRecipient, type BuddyRecipients, type ConsentMap, type Decision, type OutboundKind, type Recipient } from "./outbound";
import type { ConsentStore } from "./outboundPage";

const isMap = (v: unknown): v is ConsentMap => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/**
 * Choices kept in the client's own storage (the add-in's localStorage, the extension's
 * chrome.storage). Writes merge this window's changes into what is stored now.
 */
export function kvConsentStore(kv: { get(): unknown | Promise<unknown>; set(next: ConsentMap): void | Promise<void> }): ConsentStore {
  const read = async (): Promise<ConsentMap> => {
    const v = await kv.get();
    return isMap(v) ? v : {};
  };
  return {
    read,
    async write(changes) {
      try {
        const merged = applyConsentChanges(await read(), changes);
        await kv.set(merged);
        return merged;
      } catch {
        return null; // not stored, so not a yes
      }
    },
  };
}

/** The choices in a Web Storage (localStorage) under one key, as JSON. */
export function webStorageConsentStore(storage: () => Storage, key: string): ConsentStore {
  return kvConsentStore({
    get: () => {
      try {
        return JSON.parse(storage().getItem(key) ?? "{}");
      } catch {
        return {};
      }
    },
    set: (next) => storage().setItem(key, JSON.stringify(next)),
  });
}

/** Who reads the slides when the server writes a script for a client that does not pick the writer. Null: on this PC. */
export function scriptOut(known: BuddyRecipients): Recipient | null {
  if (known.offline) return null;
  // An older server does not say: assume the cloud, so the user is asked rather than surprised.
  return known.defaults?.generate === "ollama" ? null : known.script;
}

/** Who reads the spoken words when the server picks the decider. Null: on this PC. */
export function decideOut(known: BuddyRecipients): Recipient | null {
  if (known.offline) return null;
  return decisionRecipient(known.defaults?.decide ?? "openrouter", known.decision);
}

/** Who reads a picture of the screen. Null: the server does not look at it (offline). */
export function screenOut(known: BuddyRecipients): Recipient | null {
  return known.offline ? null : known.screen;
}

/** Engines that run on this PC first, then those that send the microphone out (cloud or the browser maker). */
export function splitEngines<Id extends string>(ids: Id[], userAgent: string): { local: Id[]; remote: Id[] } {
  const local = ids.filter((id) => sttRecipient(id, userAgent) === null);
  return { local, remote: ids.filter((id) => !local.includes(id)) };
}

/** What a take start needs from the page's outbound controller (outboundPage.ts). */
export type TakeGate = {
  allow(kind: OutboundKind, recipient: Recipient): Promise<Decision>;
  header(kind: OutboundKind, recipient: Recipient | null | undefined): Record<string, string>;
  hold(kind: OutboundKind, recipient: Recipient): () => void;
};

export type LocalFirstResult<B> =
  | { ok: true; backend: B; audio: Recipient | null; release: () => void }
  | { ok: false; reason: "declined" | "dismissed"; kind: OutboundKind; recipient: Recipient }
  | { ok: false; reason: "failed"; error: string };

/**
 * The automatic engine choice of a take that cannot ask the Filow window: an engine on this PC
 * first. Only when none is available, or none could start, the first engine that sends the
 * microphone out is offered, through the notice; it starts only after a yes, with the consent
 * header on its token request and the signal on until `release`. A no, or a closed notice, starts
 * nothing and sends nothing. `start` starts the given engines (in order) with these extra headers.
 */
export async function startLocalFirst<Id extends string, B>(o: {
  available: Id[];
  userAgent: string;
  gate: TakeGate;
  start: (ids: Id[], headers: Record<string, string>) => Promise<B>;
}): Promise<LocalFirstResult<B>> {
  const { local, remote } = splitEngines(o.available, o.userAgent);
  let error = "no speech-to-text engine is available here";
  if (local.length) {
    try {
      return { ok: true, backend: await o.start(local, {}), audio: null, release: () => {} };
    } catch (err) {
      error = (err as Error).message;
    }
  }
  const id = remote[0];
  const to = id ? sttRecipient(id, o.userAgent) : null;
  if (!id || !to) return { ok: false, reason: "failed", error };
  const decision = await o.gate.allow("audio", to);
  if (decision !== "granted") return { ok: false, reason: decision, kind: "audio", recipient: to };
  // The signal is on from before the first sound can leave until the take ends.
  const release = o.gate.hold("audio", to);
  try {
    return { ok: true, backend: await o.start([id], o.gate.header("audio", to)), audio: to, release };
  } catch (err) {
    release();
    return { ok: false, reason: "failed", error: (err as Error).message };
  }
}
