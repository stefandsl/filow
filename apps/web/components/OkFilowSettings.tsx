"use client";
// OK Filow's main switches inside Filow Settings (docs/BUDDY-PLAN.md step 5). The full list stays in
// the OK Filow panel; this section reads and writes the same settings through the main window's bridge.
import { useEffect, useState } from "react";
import { okFilowSettingsBridge, type OkFilowStatus } from "@/lib/buddy/bridge";
import { okfText } from "@/lib/buddy/text";

const bridge = okFilowSettingsBridge;

export function OkFilowSettings({ lang }: { lang: string }) {
  const [s, setS] = useState<OkFilowStatus | null>(null);
  const t = okfText(lang);
  useEffect(() => { void bridge()?.status().then(setS); }, []);
  const b = bridge();
  if (!b || !s) return null; // browser, or OK Filow did not start
  const set = async (patch: Partial<OkFilowStatus>) => setS(await b.configure(patch));
  const toggle = (k: "enabled" | "allowScreenshots" | "answerLog") => (
    <label className="row">
      <input type="checkbox" checked={s[k] === true} onChange={(e) => void set({ [k]: e.target.checked })} />
      <span>{t(k)}</span>
    </label>
  );
  return (
    <section className="strip" aria-label="OK Filow">
      <div className="label">OK Filow</div>
      {toggle("enabled")}
      <label className="row">
        <span>{t("brain")}</span>
        <select className="btn" value={s.provider} disabled={s.offline} onChange={(e) => void set({ provider: e.target.value as OkFilowStatus["provider"] })}>
          <option value="local">{t("brainLocal")}</option>
          {!s.offline && <option value="cloud">{t("brainCloud")}</option>}
        </select>
      </label>
      {toggle("allowScreenshots")}
      {toggle("answerLog")}
      <div className="row">
        <button type="button" className="btn" onClick={() => b.openPanel()}>{t("moreSettings")}</button>
      </div>
    </section>
  );
}
