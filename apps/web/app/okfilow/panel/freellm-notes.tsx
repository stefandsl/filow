"use client";

// OK Filow panel, under "Answers from": what FreeLLMAPI sends where, and on a modest PC (the Lite
// setup) a pointer to the two ways of getting answers without a strong computer. Suggested, never
// chosen for the user: the select stays where it is until they change it.

import { useEffect, useState } from "react";
import { resolveSetup, type MachineInfo } from "@filow/core";
import { getSetupPreference } from "@/lib/prefs";
import type { OkfKey } from "@/lib/buddy/text";

/** True when the setup for this PC is Lite (from the same rule Settings uses). Null while unknown. */
function useLiteSetup(): boolean | null {
  const [lite, setLite] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/local/status")
      .then((r) => (r.ok ? (r.json() as Promise<{ hardware?: MachineInfo }>) : null))
      .then((s) => { if (live && s?.hardware) setLite(resolveSetup(getSetupPreference(), s.hardware).active === "lite"); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  return lite;
}

export function FreeLlmPanelNotes({ provider, t }: { provider: string; t: (k: OkfKey) => string }) {
  const lite = useLiteSetup();
  return (
    <>
      {provider === "freellm" && (
        <p className="okf-note">
          {t("freeNote")} <a href="/settings/local#freellm" target="_blank" rel="noreferrer">{t("freeSetup")}</a>
        </p>
      )}
      {provider === "local" && lite && (
        <p className="okf-note okf-lite-hint">
          {t("liteHint")} <a href="/settings/local#freellm" target="_blank" rel="noreferrer">{t("freeSetup")}</a>
        </p>
      )}
    </>
  );
}
