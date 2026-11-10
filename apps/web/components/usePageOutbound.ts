"use client";
// The take page's side of "nothing leaves without a yes, and every send is shown": one controller
// for the whole page (lib/buddy/outboundPage.ts), wired to where the choices are kept and to the
// server route that names the recipients.
import { useEffect, useSyncExternalStore } from "react";
import type { OkFilowPatch, OkFilowStatus } from "@/lib/buddy/bridge";
import { applyConsentChanges, type BuddyRecipients, type ConsentMap } from "@/lib/buddy/outbound";
import { createPageOutbound, type ConsentStore, type PageOutbound } from "@/lib/buddy/outboundPage";
import { engineHeaders, ensureEngineToken } from "./useSession";

type SettingsBridge = {
  status(): Promise<OkFilowStatus | null>;
  configure(patch: OkFilowPatch): Promise<OkFilowStatus | null>;
};
const bridge = () => (globalThis as { filow?: { okFilow?: SettingsBridge } }).filow?.okFilow ?? null;

const STORAGE_KEY = "filow.outbound.consent";
const fromStorage = (): ConsentMap => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as ConsentMap) : {};
  } catch {
    return {};
  }
};
const toStorage = (next: ConsentMap): boolean => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
};

/**
 * On the desktop the choices live in OK Filow's settings, so they are listed in its panel and can
 * be withdrawn there. In a plain browser (no desktop bridge) they live in this browser's storage.
 */
const store: ConsentStore = {
  async read() {
    const b = bridge();
    if (b) {
      const status = await b.status().catch(() => null);
      if (status) return status.consent ?? {};
    }
    return fromStorage();
  },
  async write(changes, also) {
    const b = bridge();
    if (b) {
      const status = await b.status().catch(() => null);
      // Main merges the changes into what is stored now (another window may have changed it).
      if (status) return (await b.configure({ consentChanges: changes, ...also }).catch(() => null))?.consent ?? null;
    }
    const merged = applyConsentChanges(fromStorage(), changes);
    return toStorage(merged) ? merged : null;
  },
};

async function fetchRecipients(): Promise<BuddyRecipients | null> {
  await ensureEngineToken();
  const res = await fetch("/api/buddy/recipients", { headers: engineHeaders(), cache: "no-store" });
  return res.ok ? ((await res.json()) as BuddyRecipients) : null;
}

let page: PageOutbound | null = null;
/** The page's controller. One per page load: the signal and the notice are shared by every sender. */
export function pageOutbound(): PageOutbound {
  page ??= createPageOutbound({ store, fetchRecipients });
  return page;
}

/** The controller plus its state (notice on screen, signal, stored choices) for rendering. */
export function usePageOutbound() {
  const out = pageOutbound();
  const state = useSyncExternalStore(out.subscribe, out.getState, out.getState);
  useEffect(() => { void out.load(); }, [out]);
  return { out, state };
}
