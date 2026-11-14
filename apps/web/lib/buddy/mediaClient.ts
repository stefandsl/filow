// The panel's side of the pictures on the screen (lib/buddy/media.ts): it asks once for the batch, names
// the one source that gets the subjects, and looks every picture up in one go while the "going outside"
// signal is on. The user's own file, or a link to this PC, needs no yes: it does not leave the PC.
// The ways out are injected, so this is unit tested without a server.
import { batchRecipient, cleanItem, linkRecipient, ownHost, type MediaAsk, type MediaItem } from "./media";
import { photoLookup } from "./photo";
import type { Decision, Recipient } from "./outbound";

export type MediaDeps = {
  offline: boolean;
  /** The user's yes: stored, or asked for now with the notice naming the recipient. */
  allow(recipient: Recipient): Promise<Decision>;
  /** Runs `run` with the consent header while the signal says where it goes (outboundClient sending). */
  sending<T>(recipient: Recipient, run: (headers: Record<string, string>) => Promise<T>): Promise<T>;
  /** A GET to this app's server: its JSON, or null. */
  get(path: string, headers: Record<string, string>): Promise<unknown>;
  /** "Your file", in the user's language: the source line of their own pictures. */
  ownLabel: string;
  /** The language of the answer: a photo is looked up in that Wikipedia. */
  lang?: string;
};

/** The route a lookup goes to (one picture). */
export function lookupPath(a: MediaAsk, ownLabel: string, lang = "en"): string {
  if (a.own) return `/api/buddy/media?own=${encodeURIComponent(a.subject)}&label=${encodeURIComponent(ownLabel)}`;
  if (a.kind === "photo") {
    const l = (["it", "ru", "ro", "ja"] as const).find((x) => x === lang) ?? "en";
    return `/api/buddy/photo?q=${encodeURIComponent(photoLookup({ subject: a.subject, lang: l }))}`;
  }
  return `/api/buddy/media?kind=${a.kind}&q=${encodeURIComponent(a.subject)}`;
}

/** What a route answered, as an item (or null): /api/buddy/photo gives { dataUrl, source }, /api/buddy/media { item }. */
export function readAnswer(a: MediaAsk, json: unknown): MediaItem | null {
  if (!json || typeof json !== "object") return null;
  const j = json as { item?: unknown; dataUrl?: unknown; source?: unknown };
  if (j.item) return cleanItem(j.item);
  if (typeof j.dataUrl !== "string") return null;
  const kind = j.dataUrl.startsWith("data:image/gif") ? "gif" : "photo";
  return cleanItem({ kind, src: j.dataUrl, caption: a.subject, source: typeof j.source === "string" ? j.source : "Wikipedia" });
}

/**
 * Looks up every picture asked for. Items come back in the order asked (null where none was found or
 * nothing was sent); `declined`: the user said no to the source, so the reason can be said.
 */
export async function lookUpMedia(asks: MediaAsk[], deps: MediaDeps): Promise<{ items: Array<MediaItem | null>; declined: boolean }> {
  const items: Array<MediaItem | null> = asks.map(() => null);
  let declined = false;
  const fetchOne = async (i: number, headers: Record<string, string>) => {
    items[i] = readAnswer(asks[i], await deps.get(lookupPath(asks[i], deps.ownLabel, deps.lang), headers).catch(() => null));
  };
  const jobs: Array<Promise<unknown>> = [];
  // The web: one yes for the whole batch, one recipient named.
  const web = asks.map((a, i) => (a.own ? -1 : i)).filter((i) => i >= 0);
  const rec = batchRecipient(asks);
  if (rec && web.length && !deps.offline) {
    jobs.push((async () => {
      const d = await deps.allow(rec);
      if (d === "declined") declined = true;
      if (d !== "granted") return;
      await deps.sending(rec, (h) => Promise.all(web.map((i) => fetchOne(i, h))));
    })());
  }
  // The user's own: a file on this PC or a link to it stays here; a link to another computer asks for its site.
  const hosts = new Map<string, number[]>();
  asks.forEach((a, i) => {
    if (!a.own) return;
    const host = /^[A-Za-z]:\\/.test(a.subject) ? null : ownHost(a.subject);
    if (!host) jobs.push(fetchOne(i, {}));
    else hosts.set(host, [...(hosts.get(host) ?? []), i]);
  });
  for (const [host, list] of hosts) {
    if (deps.offline) continue;
    jobs.push((async () => {
      const r = linkRecipient(host);
      const d = await deps.allow(r);
      if (d === "declined") declined = true;
      if (d !== "granted") return;
      await deps.sending(r, (h) => Promise.all(list.map((i) => fetchOne(i, h))));
    })());
  }
  await Promise.all(jobs.map((j) => j.catch(() => {})));
  return { items, declined };
}
