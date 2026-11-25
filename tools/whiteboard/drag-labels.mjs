// With TCP fixture 3 paused on the reply in a disposable, light 1280x720 whiteboard,
// run node tools/whiteboard/drag-labels.mjs <browser debugging port>. This edits that board.
import assert from "node:assert/strict";
import path from "node:path";
import { buildSync } from "esbuild";
import { ROOT, connect, sleep, waitFor } from "./qa-dev.mjs";

async function exportScene(page) {
  return page.evaluate(`(async () => {
    const link = HTMLAnchorElement.prototype.click;
    const makeUrl = URL.createObjectURL;
    const blobs = new Map();
    let download;
    URL.createObjectURL = blob => {
      const url = makeUrl.call(URL, blob);
      blobs.set(url, blob);
      return url;
    };
    HTMLAnchorElement.prototype.click = function () { download = blobs.get(this.href)?.text(); };
    try {
      document.querySelector('[data-action="save-excalidraw"]').click();
      for (let i = 0; !download && i < 100; i++) await new Promise(r => setTimeout(r, 30));
      if (!download) throw new Error("Missing Excalidraw export");
      return JSON.parse(await download);
    } finally { HTMLAnchorElement.prototype.click = link; URL.createObjectURL = makeUrl; }
  })()`);
}

async function verifyCanvasDrag(page) {
  const before = await exportScene(page);
  const original = new Map(before.elements.map(e => [e.id, e]));
  const client = original.get("n-client");
  assert.ok(client, "TCP Client must be visible");
  await page.evaluate(`document.querySelector(".wb-stage").scrollIntoView(); document.querySelector('[data-action="edit"]').click()`);
  assert.ok(await waitFor(() => page.evaluate('!!document.querySelector("canvas.excalidraw__canvas.static")'), 15000));
  await sleep(600); // The editor fits the scene after mounting.
  // Locate the blue Client border on the left of the fitted canvas.
  const border = await page.evaluate(`(() => {
    const c = document.querySelector("canvas.excalidraw__canvas.static");
    const rect = c.getBoundingClientRect(), scale = rect.width / c.width;
    const pixels = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let left = Infinity, right = -Infinity, top = Infinity;
    for (let y = Math.floor(c.height * 0.15); y < c.height * 0.88; y++) {
      for (let x = 0; x < c.width * 0.38; x++) {
        const i = 4 * (y * c.width + x);
        if (pixels[i+3] < 120 || pixels[i+2] < 140 || pixels[i+2] - pixels[i] < 70 || pixels[i+1] < 70) continue;
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y);
      }
    }
    return { x: rect.left + (left + right) * scale / 2, y: rect.top + top * scale + 1, width: (right - left) * scale };
  })()`);
  assert.ok(border.width > 0, "Client border must be visible");
  const mouse = (type, x, y, buttons) => page.call("Input.dispatchMouseEvent", {
    type, x, y, button: "left", buttons, clickCount: 1,
  });
  const scale = border.width / client.width;
  await mouse("mousePressed", border.x, border.y, 1);
  for (let i = 1; i <= 12; i++) {
    const fraction = i / 12;
    await mouse("mouseMoved", border.x + 12 * scale * fraction, border.y + 100 * scale * fraction, 1);
    await sleep(20);
  }
  await mouse("mouseReleased", border.x + 12 * scale, border.y + 100 * scale, 0);
  await page.evaluate(`document.querySelector('[data-action="edit-done"]').click()`);
  assert.ok(await waitFor(() => page.evaluate('!!document.querySelector("svg.wb-board")'), 15000));
  const after = await exportScene(page);
  const moved = new Map(after.elements.map(e => [e.id, e]));
  const box = moved.get(client.id);
  assert.ok(Math.abs(box.y - client.y - 100) < 5, "The mouse must drag Client by 100 scene units");

  // Sample the same rounded paths as the board's geometry checker.
  const bundle = buildSync({ entryPoints: [path.join(ROOT, "apps/web/lib/whiteboard/check.ts")], bundle: true,
    platform: "node", format: "esm", write: false });
  const { pathPoints } = await import("data:text/javascript;base64," + Buffer.from(bundle.outputFiles[0].contents).toString("base64"));
  const distance = (pt, rect) => Math.hypot(Math.max(rect.x - pt.x, pt.x - rect.x - rect.width, 0),
    Math.max(rect.y - pt.y, pt.y - rect.y - rect.height, 0));
  for (const id of ["a-client-server", "a-server-client"]) {
    const edge = moved.get(id), label = moved.get(id + "-t"), old = original.get(label.id);
    const pts = pathPoints(edge, 200);
    const end = edge.startBinding?.elementId === client.id ? pts[0] : pts.at(-1);
    assert.ok(distance(end, box) <= 12, id + " must attach to the moved Client");
    assert.ok(Math.hypot(old.x - label.x, old.y - label.y) > 5, label.id + " must follow its arrow");
    const clearance = Math.min(...pts.map(pt => distance(pt, label)));
    assert.ok(clearance > 1 && clearance < 40, label.id + " must sit beside its own stroke");
    for (const other of moved.values()) {
      if (other.id === label.id || other.id === "wb-frame" || !["text","rectangle","diamond","ellipse"].includes(other.type)) continue;
      assert.ok(label.x + label.width <= other.x || label.x >= other.x + other.width ||
        label.y + label.height <= other.y || label.y >= other.y + other.height, label.id + " overlaps " + other.id);
    }
  }
}

const port = Number(process.argv[2]);
assert.ok(Number.isInteger(port) && port > 0 && port <= 65535, "Supply the disposable browser debugging port");
const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const targets = tabs.filter(t => t.type === "page" && new URL(t.url).pathname === "/okfilow/whiteboard");
assert.equal(targets.length, 1, "Expected one QA whiteboard");
const page = await connect(targets[0]);
try {
  assert.equal(await page.evaluate('document.querySelector(".wb-ex")?.dataset.step'), "1", "Pause on the reply first");
  await verifyCanvasDrag(page);
  console.log("Both labels followed the real Client drag and cleared the drawing.");
} finally { page.close(); }
