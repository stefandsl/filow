import { isLang, langFromLocale, type Lang } from "./i18n";

export type UiLanguage = "" | Lang;
export type UiTheme = "system" | "light" | "dark";
export type UiPatch = Partial<{ lang: UiLanguage; theme: UiTheme; followSystemAccent: boolean; runAtStartup: boolean }>;
export type UiSnapshot = {
  revision: number; lang: UiLanguage; resolvedLang: Lang; theme: UiTheme;
  resolvedTheme: "light" | "dark"; followSystemAccent: boolean; accentColor: string | null;
  startup: { supported: boolean; requested: boolean; enabled: boolean;
    status: "enabled" | "disabled" | "blocked" | "requires-approval" | "unsupported" };
  accentSupported: boolean;
};
export type UiResult = { ok: true; state: UiSnapshot } | { ok: false; code: "ui.saveError" | "ui.startupError"; state: UiSnapshot };
export type UiBridge = {
  glass?: boolean;
  getPreferences: () => Promise<UiSnapshot>;
  updatePreferences: (patch: UiPatch) => Promise<UiResult>;
  onPreferencesChanged: (fn: (state: UiSnapshot) => void) => () => void;
};

export function normalizeUiPreferences(value: unknown) {
  const p = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    lang: (isLang(p.lang) ? p.lang : "") as UiLanguage,
    theme: (p.theme === "light" || p.theme === "dark" ? p.theme : "system") as UiTheme,
    followSystemAccent: p.followSystemAccent === true,
    welcomeCompleted: p.welcomeCompleted === true,
    ...(typeof p.runAtStartup === "boolean" ? { runAtStartup: p.runAtStartup } : {}),
  };
}
export function resolveUiLanguage(lang: UiLanguage, locale: string): Lang { return lang || langFromLocale(locale); }
export function shouldShowWelcome(settings: unknown): boolean { return !normalizeUiPreferences(settings).welcomeCompleted; }
export function themeFollowing(on: boolean, resolved: "light" | "dark"): UiTheme { return on ? "system" : resolved; }
export function validUiPatch(value: unknown): value is UiPatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, v]) => {
    if (key === "lang") return v === "" || isLang(v);
    if (key === "theme") return v === "system" || v === "light" || v === "dark";
    return (key === "followSystemAccent" || key === "runAtStartup") && typeof v === "boolean";
  });
}
export function parseSystemAccent(value: unknown): string | null {
  return typeof value === "string" && /^[\da-f]{8}$/i.test(value) && value.slice(6) !== "00" ? `#${value.slice(0, 6).toLowerCase()}` : null;
}
export function rgb(color: string): number[] { return [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16)); }
export function luminance(color: string): number {
  return rgb(color).map(v => v / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
export function contrast(a: string, b: string): number {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function mixColor(a: string, b: string, amount: number): string {
  const end = rgb(b);
  return "#" + rgb(a).map((v, i) => Math.round(v + (end[i] - v) * amount).toString(16).padStart(2, "0")).join("");
}
/** Smallest 1/255 blend toward the contrasting pole meeting all opaque/glass surfaces. */
export function readableAccent(source: string, surfaces: string[], dark: boolean, target: number): string {
  for (let step = 0; step <= 255; step++) {
    const candidate = mixColor(source, dark ? "#ffffff" : "#000000", step / 255);
    if (surfaces.every(surface => contrast(candidate, surface) >= target)) return candidate;
  }
  return dark ? "#ffffff" : "#000000";
}
export const ACCENT_VARIABLES = ["--system-accent", "--action-background", "--action-foreground", "--accent", "--accent-2", "--accent-ring", "--glow-a", "--glow-b"] as const;
export function accentPalette(color: string | null, theme: "light" | "dark"): Record<string, string> {
  if (!color || !/^#[\da-f]{6}$/i.test(color)) return {};
  const dark = theme === "dark";
  // The shared glass base is 92% opaque, bounding arbitrary desktop backdrops.
  const base = dark ? "#08090b" : "#f7f7f5";
  const surfaces = [base, dark ? "#1b1e26" : "#eef0f4", mixColor(dark ? "#13151a" : "#ffffff", dark ? "#ffffff" : "#000000", .08)];
  surfaces.push(...surfaces.map(surface => mixColor(surface, color, .1)));
  const actionForeground = contrast(color, "#000000") >= contrast(color, "#ffffff") ? "#000000" : "#ffffff";
  return {
    "--system-accent": color,
    "--action-background": readableAccent(color, [actionForeground], actionForeground === "#000000", 7),
    "--action-foreground": actionForeground,
    "--accent": readableAccent(color, surfaces, dark, 4.5),
    "--accent-2": readableAccent(color, surfaces, dark, 4.5),
    "--accent-ring": readableAccent(color, surfaces, dark, 3),
    "--glow-a": `rgba(${rgb(color).join(",")},0.10)`,
    "--glow-b": `rgba(${rgb(color).join(",")},0.07)`,
  };
}
export function acceptUiSnapshot(current: UiSnapshot | null, next: UiSnapshot): UiSnapshot {
  return current && current.revision >= next.revision ? current : next;
}
