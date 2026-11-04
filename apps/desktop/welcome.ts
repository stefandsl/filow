import { mountIcons } from "../web/components/icons";
import { t, LANG_LABELS, acceptUiSnapshot, themeFollowing, type I18nKey, type UiBridge, type UiPatch, type UiSnapshot, type UiResult } from "../../packages/core/src/index";
import { applyUiPreferences } from "../web/lib/applyUiPreferences";
import "./welcome.css";

declare global { interface Window { filowWelcome: UiBridge & { complete: () => Promise<UiResult> } } }
mountIcons(document);
const bridge = window.filowWelcome;
const language = document.querySelector<HTMLSelectElement>("#language")!;
const theme = document.querySelector<HTMLSelectElement>("#theme")!;
const follow = document.querySelector<HTMLInputElement>("#follow-theme")!;
const accent = document.querySelector<HTMLInputElement>("#accent")!;
const startup = document.querySelector<HTMLInputElement>("#startup")!;
const start = document.querySelector<HTMLButtonElement>("#start")!;
const error = document.querySelector<HTMLElement>("#error")!;
let state: UiSnapshot | null = null;
let errorKey: I18nKey | null = null;

function render(next: UiSnapshot) {
  state = acceptUiSnapshot(state, next);
  applyUiPreferences(state);
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n as I18nKey, state!.resolvedLang); });
  language.options[1].textContent = LANG_LABELS.en;
  language.options[2].textContent = LANG_LABELS.it;
  language.value = state.lang; theme.value = state.resolvedTheme;
  follow.checked = state.theme === "system"; accent.checked = state.followSystemAccent;
  startup.checked = state.startup.enabled || state.startup.status === "requires-approval";
  document.querySelector<HTMLElement>("#startup-row")!.hidden = !state.startup.supported;
  document.querySelector<HTMLElement>("#accent-row")!.hidden = !state.accentSupported;
  document.querySelector<HTMLElement>("#explicit-theme")!.hidden = follow.checked;
  // Platform is presentation-only; support/registration is determined by the main process.
  document.querySelector<HTMLElement>("#startup-label")!.textContent = t(navigator.platform.startsWith("Mac") ? "ui.startupMac" : "ui.startupWindows", state.resolvedLang);
  document.querySelector<HTMLElement>("#startup-status")!.textContent = state.startup.status === "blocked" ? t("ui.startupBlocked", state.resolvedLang) : state.startup.status === "requires-approval" ? t("ui.startupApproval", state.resolvedLang) : "";
  document.querySelector<HTMLElement>("#accent-status")!.textContent = state.followSystemAccent && !state.accentColor ? t("ui.accentUnavailable", state.resolvedLang) : "";
  error.textContent = errorKey ? t(errorKey, state.resolvedLang) : "";
}
async function update(patch: UiPatch) {
  try { const result = await bridge.updatePreferences(patch); errorKey = result.ok ? null : result.code; render(result.state); }
  catch { errorKey = "ui.saveError"; if (state) render(state); }
}
language.addEventListener("change", () => void update({ lang: language.value as UiSnapshot["lang"] }));
theme.addEventListener("change", () => void update({ theme: theme.value as UiSnapshot["theme"] }));
follow.addEventListener("change", () => { if (state) void update({ theme: themeFollowing(follow.checked, state.resolvedTheme) }); });
accent.addEventListener("change", () => void update({ followSystemAccent: accent.checked }));
startup.addEventListener("change", () => void update({ runAtStartup: startup.checked }));
start.addEventListener("click", async () => {
  start.disabled = true;
  try { const result = await bridge.complete(); if (!result.ok) { errorKey = result.code; render(result.state); } }
  catch { errorKey = "ui.saveError"; if (state) render(state); }
  finally { start.disabled = false; }
});
const unsubscribe = bridge.onPreferencesChanged(render);
window.addEventListener("unload", unsubscribe, { once: true });
void bridge.getPreferences().then(next => {
  render(next);
  window.dispatchEvent(new Event("filow:hydrated"));
  language.focus();
});
