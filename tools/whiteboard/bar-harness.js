/* global window, document */
// The "bar" of the whiteboard comparison: a scene drawn exactly as the official excalidraw-mcp App
// (github.com/excalidraw/excalidraw-mcp, MIT) draws the elements a model passes to create_view:
// convertRawElements (labels to bound text, every text in Excalifont), cameraUpdate as the
// viewport fixed to 4:3, exportToSvg with fonts not inlined (the page has them) and morphdom into
// the page. The helpers below are copied from its src/mcp-app.tsx (MIT, see THIRD_PARTY_NOTICES)
// and trimmed to the final render. Bundled by tools/whiteboard/excalidraw-round.mjs; never shipped.
import { convertToExcalidrawElements, exportToSvg, exportToCanvas, FONT_FAMILY } from "@excalidraw/excalidraw";
import morphdom from "morphdom";

const EXPORT_PADDING = 20;
function convertRawElements(els) {
  const pseudoTypes = new Set(["cameraUpdate", "delete", "restoreCheckpoint"]);
  const pseudos = els.filter((el) => pseudoTypes.has(el.type));
  const real = els.filter((el) => !pseudoTypes.has(el.type));
  const withDefaults = real.map((el) => (el.label ? { ...el, label: { textAlign: "center", verticalAlign: "middle", ...el.label } } : el));
  const converted = convertToExcalidrawElements(withDefaults, { regenerateIds: false }).map((el) => (el.type === "text" ? { ...el, fontFamily: FONT_FAMILY.Excalifont ?? 1 } : el));
  return [...converted, ...pseudos];
}
function extractViewportAndElements(elements) {
  let viewport = null;
  const deleteIds = new Set();
  const drawElements = [];
  for (const el of elements) {
    if (el.type === "cameraUpdate") viewport = { x: el.x, y: el.y, width: el.width, height: el.height };
    else if (el.type === "delete") for (const id of String(el.ids ?? el.id).split(",")) deleteIds.add(id.trim());
    else if (el.type !== "restoreCheckpoint") drawElements.push(el);
  }
  const processed = deleteIds.size ? drawElements.map((el) => (deleteIds.has(el.id) || deleteIds.has(el.containerId) ? { ...el, opacity: 1 } : el)) : drawElements;
  return { viewport, drawElements: processed };
}
function computeSceneBounds(elements) {
  let minX = Infinity;
  let minY = Infinity;
  for (const el of elements) {
    if (el.x != null) {
      minX = Math.min(minX, el.x);
      minY = Math.min(minY, el.y);
      if (Array.isArray(el.points)) for (const pt of el.points) { minX = Math.min(minX, el.x + pt[0]); minY = Math.min(minY, el.y + pt[1]); }
    }
  }
  return { minX: isFinite(minX) ? minX : 0, minY: isFinite(minY) ? minY : 0 };
}
function fixViewBox4x3(svg) {
  const vb = svg.getAttribute("viewBox")?.split(" ").map(Number);
  if (!vb || vb.length !== 4) return;
  const [vx, vy, vw, vh] = vb;
  const r = vw / vh;
  if (Math.abs(r - 4 / 3) < 0.01) return;
  if (r > 4 / 3) { const h2 = Math.round((vw * 3) / 4); svg.setAttribute("viewBox", `${vx} ${vy - Math.round((h2 - vh) / 2)} ${vw} ${h2}`); }
  else { const w2 = Math.round((vh * 4) / 3); svg.setAttribute("viewBox", `${vx - Math.round((w2 - vw) / 2)} ${vy} ${w2} ${vh}`); }
}

window.renderBar = async (raw) => {
  await document.fonts.load("20px Excalifont");
  const { viewport, drawElements } = extractViewportAndElements(raw);
  const els = convertRawElements(drawElements);
  // Excalidraw registers and loads its fonts when it draws (the App loads them from esm.sh; here from this disk)
  await exportToCanvas({ elements: els, files: null, appState: { exportBackground: false }, getDimensions: () => ({ width: 64, height: 64, scale: 0.05 }) });
  window.lastEls = els;
  const bounds = computeSceneBounds(els);
  const svg = await exportToSvg({ elements: els, appState: { viewBackgroundColor: "transparent", exportBackground: false }, files: null, exportPadding: EXPORT_PADDING, skipInliningFonts: true });
  const host = document.getElementById("host");
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  const existing = host.querySelector("svg");
  if (existing) morphdom(existing, svg, { childrenOnly: false });
  else host.appendChild(svg);
  const shown = host.querySelector("svg");
  fixViewBox4x3(shown);
  if (viewport) {
    // the last camera, at 4:3, in the SVG's space (sceneToSvgViewBox of the App)
    const r = viewport.width / viewport.height;
    const vp = Math.abs(r - 4 / 3) < 0.01 ? viewport : r > 4 / 3 ? { ...viewport, height: Math.round((viewport.width * 3) / 4) } : { ...viewport, width: Math.round((viewport.height * 4) / 3) };
    shown.setAttribute("viewBox", `${vp.x - bounds.minX + EXPORT_PADDING} ${vp.y - bounds.minY + EXPORT_PADDING} ${vp.width} ${vp.height}`);
  }
  return { elements: els.length, viewBox: shown.getAttribute("viewBox") };
};
window.barReady = true;
