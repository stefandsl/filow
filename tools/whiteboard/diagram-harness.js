/* global window, FileReader */
// The page of tools/whiteboard/diagram-shots.mjs: a saved lesson drawn by Filow's own layout, scene
// and Excalidraw export (what the whiteboard page shows and what "Save PNG" writes), with the
// machine checks of each board. Bundled by that tool; never shipped.
import { boardPage, layoutBoard } from "@/lib/whiteboard/layout";
import { boardLesson, sceneFromLayout } from "@/lib/whiteboard/scene";
import { prepareScene, scenePng } from "@/lib/whiteboard/excalidraw";
import { checkScene, countProblems, pathPoints } from "@/lib/whiteboard/check";
import { excalidrawFile, parseExcalidrawFile } from "@/lib/whiteboard/doc";

const toB64 = (blob) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(",")[1]); r.readAsDataURL(blob); });

function cross(p, q, r, s) {
  const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d;
  const u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
  return t > 0 && t < 1 && u > 0 && u < 1 ? { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) } : null;
}
/** Pairs of arrows whose strokes cross away from the boxes they share. */
export function edgeCrossings(els) {
  const arrows = els.filter((e) => e.type === "arrow" && !e.isDeleted && e.customData?.wb?.role !== "pointer").map((e) => pathPoints(e));
  let n = 0;
  const near = (pt, path) => Math.hypot(pt.x - path[0].x, pt.y - path[0].y) < 10 || Math.hypot(pt.x - path[path.length - 1].x, pt.y - path[path.length - 1].y) < 10;
  for (let i = 0; i < arrows.length; i++) for (let j = i + 1; j < arrows.length; j++) {
    let hit = false;
    for (let a = 1; a < arrows[i].length && !hit; a++) for (let b = 1; b < arrows[j].length && !hit; b++) {
      const pt = cross(arrows[i][a - 1], arrows[i][a], arrows[j][b - 1], arrows[j][b]);
      if (pt && !near(pt, arrows[i]) && !near(pt, arrows[j])) hit = true;
    }
    if (hit) n++;
  }
  return n;
}

window.renderLesson = async (lesson) => {
  const shown = boardLesson(lesson);
  const last = new Map();
  for (let k = 0; k < shown.steps.length; k++) last.set(boardPage(shown, k).number, k);
  const pages = [];
  for (const [number, k] of last) {
    const prepared = await prepareScene(sceneFromLayout(layoutBoard(shown, k, "wide")));
    const found = checkScene(prepared);
    const counts = countProblems(found);
    const reopened = parseExcalidrawFile(excalidrawFile(prepared));
    const kept = prepared.elements.filter((e) => e.id !== "wb-frame").length;
    pages.push({
      number, step: k,
      overlaps: counts.overlap, arrowThroughBox: counts.crossing, overflow: counts.overflow, offscreen: counts.offscreen,
      edgeCrossings: edgeCrossings(prepared.elements),
      reopen: Boolean(reopened && reopened.elements.length === kept),
      elements: prepared.elements.length,
      problems: found.filter((p) => ["overflow", "overlap", "crossing", "offscreen"].includes(p.kind)).map((p) => p.message).slice(0, 8),
      light: await toB64(await scenePng(prepared.elements, prepared.files, { dark: false })),
      dark: await toB64(await scenePng(prepared.elements, prepared.files, { dark: true })),
    });
  }
  return JSON.stringify(pages);
};
window.harnessReady = true;
