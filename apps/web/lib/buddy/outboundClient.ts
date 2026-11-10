// The client side of "nothing leaves without a yes, and every send is shown": one controller used
// by the OK Filow panel and by the take page. No React and no DOM, so it is tested with fakes.
import {
  CONSENT_HEADER,
  consentKey,
  createNoticeQueue,
  isGranted,
  keepLocalPatch,
  standing,
  withConsent,
  withoutConsent,
  type BuddyRecipients,
  type ConsentMap,
  type Decision,
  type KeepLocalPatch,
  type NoticeRequest,
  type OutboundKind,
  type Recipient,
} from "./outbound";

export type OutboundDeps = {
  /** The stored choices, read at the moment of each decision (never a stale copy). */
  consent(): ConsentMap | undefined | null;
  /** Persists the choices (and, on a "no", the switch to this PC). False when it could not be saved. */
  save(next: ConsentMap, also: KeepLocalPatch): Promise<boolean>;
  /** GET /api/buddy/recipients: who would receive what, from the providers and models configured now. */
  fetchRecipients(): Promise<BuddyRecipients | null>;
  /** The going-outside signal (main process on the desktop, a local pill on the take page). */
  signal?: { begin(id: string, kind: OutboundKind, names: string[]): void; end(id: string, opts?: { cancel?: boolean }): void } | null;
  /** The notice to show now, or null when none is waiting. */
  onNotice(head: NoticeRequest | null): void;
};

/** Thrown by `sending` when there is no yes for exactly this kind and this recipient. */
export class NoConsentError extends Error {
  constructor(readonly kind: OutboundKind, readonly recipient: Recipient) {
    super("consent_required");
    this.name = "NoConsentError";
  }
}

export type OutboundController = ReturnType<typeof createOutboundController>;

export function createOutboundController(deps: OutboundDeps) {
  const queue = createNoticeQueue(deps.onNotice);
  let known: BuddyRecipients | null = null;
  let seq = 0;
  let deciding = false;
  // Consent writes run one after the other, each on top of what the previous one stored.
  let writes: Promise<unknown> = Promise.resolve();
  const write = (make: () => { next: ConsentMap; also?: KeepLocalPatch }): Promise<boolean> => {
    const run = writes.then(async () => {
      const { next, also } = make();
      return (await deps.save(next, also ?? {})) === true;
    }).catch(() => false);
    writes = run;
    return run;
  };

  return {
    /** Who would receive what right now. Null when it cannot be told: the caller must not send. */
    async recipients(): Promise<BuddyRecipients | null> {
      try {
        const fresh = await deps.fetchRecipients();
        if (fresh) known = fresh;
      } catch { /* keep what we knew; the server refuses a send whose recipient changed */ }
      return known;
    },
    standing: (kind: OutboundKind, recipient: Recipient) => standing(deps.consent(), kind, recipient),
    /** Resolves "granted" only from a stored yes or from the user pressing Send on the notice. */
    allow(kind: OutboundKind, recipient: Recipient, cli?: string): Promise<Decision> {
      const now = standing(deps.consent(), kind, recipient);
      if (now !== "ask") return Promise.resolve(now);
      return queue.ask(cli ? { kind, recipient, cli } : { kind, recipient });
    },
    /** The user's answer to the notice on screen. A yes that could not be stored is not a yes. */
    async decide(decision: Decision): Promise<void> {
      const head = queue.head();
      if (!head || deciding) return;
      deciding = true;
      try {
        let answer: Decision = decision;
        if (decision === "granted") {
          const stored = await write(() => ({ next: withConsent(deps.consent(), head.kind, head.recipient, "granted") }));
          if (!stored) answer = "dismissed";
        } else if (decision === "declined") {
          await write(() => ({ next: withConsent(deps.consent(), head.kind, head.recipient, "declined"), also: keepLocalPatch(head.kind) }));
        }
        // The question may have been dropped while the choice was being stored.
        if (queue.head() === head) queue.settle(answer);
      } finally {
        deciding = false;
      }
    },
    /** The question was dropped: every waiting notice is answered "dismissed", nothing is stored. */
    dismissAll: () => queue.dismissAll(),
    /** Withdraw a yes, or forget a no, from the review list. */
    forget: (key: string) => write(() => ({ next: withoutConsent(deps.consent(), key) })),
    /**
     * The only way a request carrying the user's content is made: refuses without a stored yes,
     * hands `run` the consent header the server checks, and keeps the signal on while it runs.
     * `quiet()` tells the signal nothing left this PC after all (the server answered locally).
     */
    async sending<T>(kind: OutboundKind, recipient: Recipient, run: (headers: Record<string, string>, quiet: () => void) => Promise<T>): Promise<T> {
      if (!isGranted(deps.consent(), kind, recipient)) throw new NoConsentError(kind, recipient);
      const id = `${kind}-${++seq}`;
      let stayed = false;
      deps.signal?.begin(id, kind, recipient.names);
      try {
        return await run({ [CONSENT_HEADER]: consentKey(kind, recipient) }, () => { stayed = true; });
      } finally {
        deps.signal?.end(id, stayed ? { cancel: true } : undefined);
      }
    },
  };
}
