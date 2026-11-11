"use client";

import { useId, useState } from "react";
import { advancedDiskNeedGb, CLEANUP_MODEL, missingModels, resolveSetup, SCRIPT_MODEL_MIN_RAM_GB, scriptModel, SETUP_PREFERENCES, type I18nKey, type MachineInfo, type SetupModel, type SetupPreference, type SetupProfileId } from "@filow/core";
import { useT } from "@filow/ui";
import { StopButton } from "@/components/ModelControls";

export type SetupPickerProps = {
  hardware: MachineInfo;
  gpuName: string;
  preference: SetupPreference;
  onChange: (p: SetupPreference) => void;
  installed: { ollama: string[]; sherpa: boolean };
  /** starts the one-time downloads; undefined while one runs */
  onGet?: (models: SetupModel[]) => void;
  busy?: boolean;
  /**
   * S1-mini by Superwhisper as the desktop app reports it (dictation status, cleanupState): runtime in this
   * build, file on this computer, a download running. Absent in the browser: the line is not shown.
   */
  cleanup?: { runtime: boolean; model: boolean; downloading: boolean; pct: number } | null;
  /** Stops the download of S1-mini by Superwhisper (the desktop app deletes the part); the Stop button shows only with it. */
  onStopCleanup?: () => void;
};

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * "Setup for this computer": one choice that sets speech, point checking and OK Filow's local
 * answers together (packages/core/src/profile.ts). Native radio buttons in a fieldset, so arrow keys
 * move between the options and a screen reader reads the group name, each option and its text.
 */
export function SetupPicker({ hardware, gpuName, preference, onChange, installed, onGet, busy, cleanup, onStopCleanup }: SetupPickerProps) {
  const t = useT();
  const id = useId();
  // The cleanup model's line is ticked unless the user unticks it: every setup gets it, whatever the tier.
  const [cleanupTicked, setCleanupTicked] = useState(true);
  const cleanupMissing = Boolean(cleanup && cleanup.runtime && !cleanup.model);
  const cleanupSize = `${Math.round(CLEANUP_MODEL.bytes / 1024 / 1024)} MB`;
  const setup = resolveSetup(preference, hardware);
  const name = (p: SetupProfileId) => t(`setup.${p}`);
  const desc = (p: SetupProfileId) => {
    if (p === "lite" && resolveSetup("lite", hardware).choices.screenHelper.mode === "none") return t("setup.lite.descNone");
    // a card under 12 GB: picture answers wait while the larger AI is loaded (measured, D26)
    if (p === "advanced" && resolveSetup("advanced", hardware).choices.screenHelper.waitsForDecisions) return t("setup.advanced.descShared");
    return t(`setup.${p}.desc` as I18nKey);
  };
  const why = t(`setup.why.${setup.reason}` as I18nKey, { ram: hardware.ramGb, cores: hardware.cores, vram: hardware.gpu.vramGb ?? 0, disk: hardware.freeDiskGb ?? 0, need: advancedDiskNeedGb(hardware) });
  // OK Filow has no local answers with this setup here: say why (Lite's own text already names memory)
  const helper = setup.choices.screenHelper;
  const noScreen = helper.mode !== "none" ? null : helper.lacking === "disk" ? t("setup.screen.noDisk") : setup.active !== "lite" ? t("setup.screen.none") : null;
  const gpu = hardware.gpu.kind === "none" || !gpuName ? t("setup.noGpu") : hardware.gpu.kind === "discrete" && hardware.gpu.vramGb ? `${gpuName} (${hardware.gpu.vramGb} GB)` : gpuName;
  // every setup also gets the model that writes and translates scripts on this PC, when the machine holds it
  const script = scriptModel({ ...hardware, installed: installed.ollama });
  const scriptMissing = script && !installed.ollama.some((n) => n === script.name || n === `${script.name}:latest`) ? [script] : [];
  const missing = [...missingModels(setup.choices, installed), ...scriptMissing];
  const list = (ms: SetupModel[]) => ms.map((m) => t(`setup.model.${m.name}` as I18nKey)).join(", ");
  const gb = (ms: SetupModel[]) => round(ms.reduce((s, m) => s + m.downloadGb, 0));
  const forTake = missing.filter((m) => m.use === "take");
  const forScreen = missing.filter((m) => m.use === "screen");
  // one button fetches everything still missing, the ticked cleanup model included (the app downloads that one itself)
  const toGet = cleanupMissing && cleanupTicked && !cleanup?.downloading ? [...missing, CLEANUP_MODEL] : missing;

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
      {noScreen && <div className="hint">{noScreen}</div>}
      {/* A modest PC: FreeLLMAPI and OpenRouter are named as the way to more, never switched on here. */}
      {setup.active === "lite" && (
        <div className="hint" data-lite-cloud>
          {t("setup.lite.cloud")} <a href="#freellm">{t("setup.lite.cloudLink")}</a>
        </div>
      )}
      <div className="row" aria-live="polite">
        {forTake.length === 0 && <span className="chip live">{t("setup.ready")}</span>}
        {forTake.length > 0 && <span className="hint">{t("setup.needs", { list: list(forTake), gb: gb(forTake) })}</span>}
        {forScreen.length > 0 && <span className="hint">{t("setup.screenNeeds", { list: list(forScreen), gb: gb(forScreen) })}</span>}
        {scriptMissing.length > 0 && <span className="hint" data-script-model={scriptMissing[0].name}>{t("setup.scriptNeeds", { list: list(scriptMissing), gb: gb(scriptMissing) })}</span>}
        {!script && <span className="hint" data-script-model="none">{t(hardware.ramGb < SCRIPT_MODEL_MIN_RAM_GB ? "setup.scriptNoMemory" : "setup.scriptNoDisk", { ram: SCRIPT_MODEL_MIN_RAM_GB })}</span>}
        {cleanupMissing && (cleanup?.downloading ? (
          <>
            <span className="hint" data-cleanup-model="downloading">{t("setup.cleanupGetting", { pct: cleanup.pct })}</span>
            {onStopCleanup && <StopButton small name="S1-mini by Superwhisper" onStop={onStopCleanup} />}
          </>
        ) : (
          <label className="hint setup-cleanup" data-cleanup-model="offered">
            <input type="checkbox" checked={cleanupTicked} onChange={(e) => setCleanupTicked(e.target.checked)} /> {t("setup.cleanup", { size: cleanupSize })}
          </label>
        ))}
        {toGet.length > 0 && onGet && (
          <button type="button" className="btn primary" disabled={busy} onClick={() => onGet(toGet)}>
            {busy ? t("setup.getting") : t("setup.get")}
          </button>
        )}
      </div>
    </section>
  );
}
