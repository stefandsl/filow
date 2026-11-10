"use client";

import { useId } from "react";
import { missingModels, resolveSetup, SETUP_PREFERENCES, type I18nKey, type MachineInfo, type SetupModel, type SetupPreference, type SetupProfileId } from "@filow/core";
import { useT } from "@filow/ui";

export type SetupPickerProps = {
  hardware: MachineInfo;
  gpuName: string;
  preference: SetupPreference;
  onChange: (p: SetupPreference) => void;
  installed: { ollama: string[]; sherpa: boolean };
  /** starts the one-time downloads; undefined while one runs */
  onGet?: (models: SetupModel[]) => void;
  busy?: boolean;
};

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * "Setup for this computer": one choice that sets speech, point checking and OK Filow's local
 * answers together (packages/core/src/profile.ts). Native radio buttons in a fieldset, so arrow keys
 * move between the options and a screen reader reads the group name, each option and its text.
 */
export function SetupPicker({ hardware, gpuName, preference, onChange, installed, onGet, busy }: SetupPickerProps) {
  const t = useT();
  const id = useId();
  const setup = resolveSetup(preference, hardware);
  const name = (p: SetupProfileId) => t(`setup.${p}`);
  const desc = (p: SetupProfileId) => {
    if (p === "lite" && resolveSetup("lite", hardware).choices.screenHelper.mode === "none") return t("setup.lite.descNone");
    // a card under 12 GB: picture answers wait while the larger AI is loaded (measured, D26)
    if (p === "advanced" && resolveSetup("advanced", hardware).choices.screenHelper.waitsForDecisions) return t("setup.advanced.descShared");
    return t(`setup.${p}.desc` as I18nKey);
  };
  const why = t(`setup.why.${setup.reason}` as I18nKey, { ram: hardware.ramGb, cores: hardware.cores, vram: hardware.gpu.vramGb ?? 0, disk: hardware.freeDiskGb ?? 0 });
  const gpu = hardware.gpu.kind === "none" || !gpuName ? t("setup.noGpu") : hardware.gpu.kind === "discrete" && hardware.gpu.vramGb ? `${gpuName} (${hardware.gpu.vramGb} GB)` : gpuName;
  const missing = missingModels(setup.choices, installed);
  const list = (ms: SetupModel[]) => ms.map((m) => t(`setup.model.${m.name}` as I18nKey)).join(", ");
  const gb = (ms: SetupModel[]) => round(ms.reduce((s, m) => s + m.downloadGb, 0));
  const forTake = missing.filter((m) => m.use === "take");
  const forScreen = missing.filter((m) => m.use === "screen");

  return (
    <section className="strip setup" id="setup" aria-labelledby={`${id}-title`}>
      <div className="label" id={`${id}-title`}>
        {t("setup.label")}
      </div>
      <div className="hint">{t("setup.machine", { ram: hardware.ramGb, cores: hardware.cores, gpu })}</div>
      <fieldset className="setup-options">
        <legend className="sr-only">{t("setup.groupLabel")}</legend>
        {SETUP_PREFERENCES.map((p) => {
          const shown: SetupProfileId = p === "auto" ? setup.recommended : p;
          const checked = preference === p;
          return (
            <label key={p} className={`setup-option ${checked ? "on" : ""}`}>
              <input type="radio" name={`${id}-setup`} value={p} checked={checked} onChange={() => onChange(p)} aria-describedby={`${id}-${p}-desc`} />
              <span className="setup-text">
                <strong>{p === "auto" ? t("setup.autoIs", { name: name(shown) }) : name(p)}</strong>
                <span className="hint" id={`${id}-${p}-desc`}>
                  {p === "auto" ? why : desc(p)}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <div className="hint" aria-live="polite">
        {preference === "auto" ? desc(setup.active) : t(setup.heavierThanRecommended ? "setup.heavier" : "setup.pinned", { name: name(setup.recommended) })}
      </div>
      <div className="row" aria-live="polite">
        {forTake.length === 0 && <span className="chip live">{t("setup.ready")}</span>}
        {forTake.length > 0 && <span className="hint">{t("setup.needs", { list: list(forTake), gb: gb(forTake) })}</span>}
        {forScreen.length > 0 && <span className="hint">{t("setup.screenNeeds", { list: list(forScreen), gb: gb(forScreen) })}</span>}
        {missing.length > 0 && onGet && (
          <button type="button" className="btn primary" disabled={busy} onClick={() => onGet(missing)}>
            {busy ? t("setup.getting") : t("setup.get")}
          </button>
        )}
      </div>
    </section>
  );
}
