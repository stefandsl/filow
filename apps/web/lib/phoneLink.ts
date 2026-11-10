// Where a phone should go to mirror this session, and the link the pairing QR carries.
// In the desktop app the public link (a Cloudflare tunnel) comes up a few seconds after the window
// opens, and can go away. The page is not reloaded for that: it gets a "remote:status" event and
// redraws the QR from these functions (docs/OWNER-DECISIONS.md, D2).
import { desktopBridge, mirrorOrigin, mirrorServerUrl, sessionServerUrl, type RemoteStatus } from "./sessionUrl";

export type PhoneTargets = {
  /** origin the phone opens for /mirror */
  origin: string;
  /** session relay the phone talks to */
  relay: string;
  /** true when the phone can be on any network (the public link is up) */
  anyNetwork: boolean;
};

/** What the page was loaded with: the addresses the desktop shell (or the browser) knew at that time. */
export type LoadedTargets = PhoneTargets & {
  /** the address on this network; absent in a browser and in shells older than 0.9.31 */
  lanOrigin?: string;
  /** the relay the engine itself uses: the phone's relay too whenever the public link is not up */
  engineRelay: string;
};

/**
 * The current targets. With no status yet (first render, or a browser without the desktop shell) the
 * page's own values stand. Once the shell reports the public link, "on" with an address means the
 * public pair; anything else (off, connecting, downloading, error) means this network.
 */
export function phoneTargets(loaded: LoadedTargets, status: RemoteStatus | null): PhoneTargets {
  if (!status) return { origin: loaded.origin, relay: loaded.relay, anyNetwork: loaded.anyNetwork };
  if (status.state === "on" && status.url) {
    // A shell that sends no `session` reloads the page instead: the loaded relay is then already the public one.
    return { origin: status.url, relay: status.session || loaded.relay, anyNetwork: true };
  }
  return { origin: loaded.lanOrigin ?? loaded.origin, relay: loaded.engineRelay, anyNetwork: false };
}

/** The targets this page was loaded with, read from the desktop shell or the browser's own address. */
export function loadedTargets(): LoadedTargets {
  const bridge = desktopBridge();
  return { origin: mirrorOrigin(), relay: mirrorServerUrl(), anyNetwork: Boolean(bridge?.remoteShare), lanOrigin: bridge?.lanMirrorOrigin, engineRelay: sessionServerUrl() };
}

/** The link in the pairing QR: the mirror page with the code, plus the relay when it is on another origin. */
export function phoneLink(code: string, t: Pick<PhoneTargets, "origin" | "relay">): string {
  return `${t.origin}/mirror?code=${code}` + (t.relay === t.origin ? "" : `&server=${encodeURIComponent(t.relay)}`);
}
