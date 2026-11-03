import { ACCENT_VARIABLES, accentPalette, type UiSnapshot } from "@filow/core";

/** Shared by the local Welcome bundle and the React root; never sends IPC. */
export function applyUiPreferences(state: Pick<UiSnapshot, "resolvedLang" | "resolvedTheme" | "accentColor">, glass: boolean) {
  const root = document.documentElement;
  root.lang = state.resolvedLang;
  root.dataset.theme = state.resolvedTheme;
  root.toggleAttribute("data-glass", glass);
  root.toggleAttribute("data-system-accent", !!state.accentColor);
  const palette = accentPalette(state.accentColor, state.resolvedTheme);
  for (const key of ACCENT_VARIABLES) {
    if (palette[key]) root.style.setProperty(key, palette[key]);
    else root.style.removeProperty(key);
  }
}
