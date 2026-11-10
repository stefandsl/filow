// "Nothing leaves without a yes, and every send is shown" for a page of the main window (the take
// page): the same controller as the OK Filow panel, plus the page's own notice and signal state.
// No React and no DOM, so it is tested with fakes. The wiring to the app is in components/usePageOutbound.ts.
import {
  CONSENT_HEADER,
  consentKey,
  isGranted,
  type BuddyRecipients,
  type ConsentMap,
  type Decision,
  type KeepLocalPatch,
  type NoticeRequest,
  type OutboundKind,
  type OutboundSnapshot,
  type Recipient,
} from "./outbound";
import { createOutboundController, NoConsentError } from "./outboundClient";

/** Where the choices are kept: OK Filow's settings on the desktop, the browser's storage elsewhere. */
export type ConsentStore = {
  read(): Promise<ConsentMap | null>;
  write(next: ConsentMap, also: KeepLocalPatch): Promise<boolean>;
};

export type PageOutboundState = { notice: NoticeRequest | null; snap: OutboundSnapshot; consent: ConsentMap };

const IDLE: OutboundSnapshot = { active: false, kinds: [], names: [] };
/** A send shorter than this still shows the signal this long, so it can be seen and read. */
export const MIN_SIGNAL_MS = 1200;

export type PageOutbound = ReturnType<typeof createPageOutbound>;

export function createPageOutbound(o: {
  store: ConsentStore;
  fetchRecipients(): Promise<BuddyRecipients | null>;
  minMs?: number;
  now?: () => number;
  later?: (fn: () => void, ms: number) => unknown;
}) {
  const minMs = o.minMs ?? MIN_SIGNAL_MS;
  const now = o.now ?? Date.now;
  const later = o.later ?? ((fn, ms) => setTimeout(fn, ms));

  let consent: ConsentMap = {};
  let notice: NoticeRequest | null = null;
  const flights = new Map<string, { kind: OutboundKind; names: string[]; since: number }>();
  const routes = new Map<OutboundKind, Recipient>();
  let state: PageOutboundState = { notice, snap: IDLE, consent };
  const listeners = new Set<() => void>();
  let holds = 0;

  const snapshot = (): OutboundSnapshot => {
    if (!flights.size) return IDLE;
    const kinds: OutboundKind[] = [];
    const names: string[] = [];
    for (const f of flights.values()) {
      if (!kinds.includes(f.kind)) kinds.push(f.kind);
      for (const n of f.names) if (!names.includes(n)) names.push(n);
    }
    return { active: true, kinds, names };
  };
  const publish = () => {
    state = { notice, snap: snapshot(), consent };
    for (const fn of [...listeners]) fn();
  };

  const signal = {
    begin(id: string, kind: OutboundKind, names: string[]) {
      flights.set(id, { kind, names: [...names], since: now() });
      publish();
    },
    end(id: string, opts?: { cancel?: boolean }) {
      const flight = flights.get(id);
      if (!flight) return;
      const left = opts?.cancel ? 0 : flight.since + minMs - now();
      const drop = () => { if (flights.get(id) === flight && flights.delete(id)) publish(); };
      if (left <= 0) drop();
      else later(drop, left);
    },
  };

  const controller = createOutboundController({
    consent: () => consent,
    save: async (next, also) => {
      if (!(await o.store.write(next, also))) return false;
      consent = next;
      publish();
      return true;
    },
    fetchRecipients: o.fetchRecipients,
    signal,
    onNotice: (head) => { notice = head; publish(); },
  });

  /** The stored choices as they are now: another window (the OK Filow panel) may have changed them. */
  const load = async (): Promise<ConsentMap> => {
    try {
      const fresh = await o.store.read();
      if (fresh) { consent = fresh; publish(); }
    } catch { /* keep the last known choices; the server still refuses a send without its key */ }
    return consent;
  };

  const header = (kind: OutboundKind, recipient: Recipient | null | undefined): Record<string, string> =>
    recipient && isGranted(consent, kind, recipient) ? { [CONSENT_HEADER]: consentKey(kind, recipient) } : {};

  return {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getState: () => state,
    load,
    recipients: () => controller.recipients(),
    /** "granted" only from a stored yes or from the user pressing Send on the notice. */
    async allow(kind: OutboundKind, recipient: Recipient): Promise<Decision> {
      await load();
      return controller.allow(kind, recipient);
    },
    decide: (decision: Decision) => controller.decide(decision),
    dismissAll: () => controller.dismissAll(),
    forget: (key: string) => controller.forget(key),
    /** The consent header for one send: empty without a stored yes, so the server refuses it. */
    header,
    /** Who a kind of content goes to for the running take (null: it stays on this PC). */
    setRoute(kind: OutboundKind, recipient: Recipient | null) {
      if (recipient) routes.set(kind, recipient);
      else routes.delete(kind);
    },
    route: (kind: OutboundKind) => routes.get(kind) ?? null,
    /** The header for a send made by code that only knows the kind (the decide call of a take). */
    routeHeader: (kind: OutboundKind) => header(kind, routes.get(kind)),
    /**
     * A stream that stays open (the microphone of a take): the signal is on from here until the
     * returned function is called. Refuses without a stored yes.
     */
    hold(kind: OutboundKind, recipient: Recipient): () => void {
      if (!isGranted(consent, kind, recipient)) throw new NoConsentError(kind, recipient);
      const id = `hold-${kind}-${++holds}`;
      signal.begin(id, kind, recipient.names);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        signal.end(id);
      };
    },
    /** One request: refuses without a stored yes, carries the header, shows the signal while it runs. */
    sending: <T>(kind: OutboundKind, recipient: Recipient, run: (headers: Record<string, string>, quiet: () => void) => Promise<T>) =>
      controller.sending(kind, recipient, run),
  };
}
