// Loading Excalidraw in the page, offline: the library is imported only on the whiteboard, its
// fonts come from this app (scripts/copy-excalidraw-fonts.js puts them in /excalidraw/fonts), and
// any request the library would make to a CDN (it falls back to esm.sh for fonts) is refused here,
// so nothing leaves the PC for the board. Browser only.
import type { BinaryFile, ExEl, Scene } from "./scene";

type ExcalidrawModule = typeof import("@excalidraw/excalidraw");
let loading: Promise<ExcalidrawModule> | null = null;

/** Hosts the whiteboard never loads anything from, whatever the library asks. */
export const CDN_HOSTS = /^https?:\/\/(?:esm\.sh|unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.(?:googleapis|gstatic)\.com)(?:[/:]|$)/i;

type GuardedFetch = typeof fetch & { wbGuard?: true };
/** Refuses fetches to the CDNs above (installed once, in this window). */
export function guardCdn(win: { fetch: typeof fetch } = window): void {
  const before = win.fetch as GuardedFetch;
  if (before.wbGuard) return;
  const guarded: GuardedFetch = Object.assign((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (CDN_HOSTS.test(url)) return Promise.reject(new TypeError("The whiteboard loads nothing from the internet."));
    return before.call(win, input, init);
  }, { wbGuard: true as const });
  win.fetch = guarded;
}

export function loadExcalidraw(): Promise<ExcalidrawModule> {
  if (!loading) {
    (window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = `${window.location.origin}/excalidraw/`;
    guardCdn();
    loading = import("@excalidraw/excalidraw");
    loading.catch(() => { loading = null; });
  }
  return loading;
}

type Files = Parameters<ExcalidrawModule["exportToSvg"]>[0]["files"];
const asFiles = (files: Record<string, BinaryFile>) => files as unknown as Files;
type Elements = Parameters<ExcalidrawModule["exportToSvg"]>[0]["elements"];
const asElements = (els: ExEl[]) => els as unknown as Elements;

/**
 * The scene measured by Excalidraw itself: its fonts loaded for exactly the letters on the board
 * (Japanese included), then every text sized and every label re-wrapped and centred in its box
 * with the real font. What the code check then counts is what the board shows.
 */
export async function prepareScene(scene: Scene): Promise<Scene> {
  const ex = await loadExcalidraw();
  // drawing once loads the fonts of every letter used (Excalidraw registers its font faces then)
  await ex.exportToCanvas({ elements: asElements(scene.elements), files: asFiles(scene.files), appState: { exportBackground: false }, getDimensions: () => ({ width: 64, height: 64, scale: 0.05 }) });
  const restored = ex.restoreElements(asElements(scene.elements) as never, null, { refreshDimensions: true, repairBindings: false }) as unknown as ExEl[];
  // restore keeps our ids and notes; it only measures
  return { elements: restored, files: scene.files };
}

export type SvgOptions = { dark: boolean; inlineFonts?: boolean };
export async function sceneSvg(els: ExEl[], files: Record<string, BinaryFile>, o: SvgOptions): Promise<SVGSVGElement> {
  const ex = await loadExcalidraw();
  return ex.exportToSvg({
    elements: asElements(els),
    files: asFiles(files),
    appState: { exportBackground: false, exportWithDarkMode: o.dark, viewBackgroundColor: "transparent" },
    exportPadding: 0,
    skipInliningFonts: !o.inlineFonts,
  });
}

/** The board's fonts as CSS with the font files inlined (only the letters used): a copy of the board drawn as a picture needs them. */
export async function fontCss(els: ExEl[], files: Record<string, BinaryFile>): Promise<string> {
  const svg = await sceneSvg(els, files, { dark: false, inlineFonts: true });
  return svg.querySelector("style.style-fonts")?.textContent ?? "";
}

/** The board as a PNG: what the vision check looks at and what "Save PNG" writes. */
export async function scenePng(els: ExEl[], files: Record<string, BinaryFile>, o: { dark: boolean; maxSide?: number }): Promise<Blob> {
  const ex = await loadExcalidraw();
  return ex.exportToBlob({
    elements: asElements(els),
    files: asFiles(files),
    // the dark board is the light one inverted by Excalidraw (white becomes its dark grey)
    appState: { exportBackground: true, exportWithDarkMode: o.dark, viewBackgroundColor: "#ffffff" },
    exportPadding: 16,
    mimeType: "image/png",
    ...(o.maxSide ? { maxWidthOrHeight: o.maxSide } : {}),
  });
}
