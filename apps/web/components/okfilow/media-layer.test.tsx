// The overlay's pictures: what the hidden driver (tools/media/qa-media.mjs) measures on the real page is
// wired as it is here: a video never plays sound, Stop and Clear take everything away, and the overlay
// tells main where the pictures are (and that they are gone).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layer = readFileSync(new URL("./media-layer.tsx", import.meta.url), "utf8");
const overlay = readFileSync(new URL("../../app/okfilow/overlay/page.tsx", import.meta.url), "utf8");

const css = readFileSync(new URL("../../app/okfilow/okfilow.css", import.meta.url), "utf8");
const board = readFileSync(new URL("../../app/okfilow/whiteboard/whiteboard.css", import.meta.url), "utf8");
const boardPage = readFileSync(new URL("../../app/okfilow/whiteboard/page.tsx", import.meta.url), "utf8");

describe("what the reviewer looked at", () => {
  it("a source line breaks only between its parts, never inside a name or a licence", () => {
    expect(layer).toMatch(/item\.source\.split\(" · "\)\.map\(\(part, i\) => <Fragment key=\{i\}>\{i > 0 && " · "\}<span>\{part\}<\/span><\/Fragment>\)/);
    expect(css).toContain(".okf-media-source span { white-space: nowrap; }");
  });
  it("pictures on a slide fit the way the gallery's do; the pointer paints over them and the overlay lets clicks through to them", () => {
    expect(css).toContain(".okf-slide-media .okf-media-box { flex: none; aspect-ratio: 260 / 172; }");
    expect(css).toContain(".okf-overlay:not(.okf-overlay--catch) { pointer-events: none; }");
    expect(overlay.indexOf("<MediaLayer")).toBeLessThan(overlay.indexOf('<div className={"okf-overlay"'));
  });
  it("a picture on the light board has a hairline; a board from a file is framed to what is on it", () => {
    expect(board).toMatch(/\.wb-ex:not\(\.wb-ex-dark\) :is\(\.wb-gif, \.wb-video\) \{[^}]*box-shadow: 0 0 0 1px rgba\(0, 0, 0, 0\.32\)/);
    expect(boardPage).toMatch(/const openFile = [\s\S]{0,900}setImported\(withFrame\(scene\)\);/);
  });
});

describe("media layer wiring", () => {
  it("a video is muted, loops and has no controls of its own; GIFs and videos get play/pause, every item close", () => {
    expect(layer).toMatch(/<video\s+ref=\{video\}\s+src=\{item\.src\}\s+muted\s+loop\s+autoPlay/);
    expect(layer).toMatch(/item\.kind !== "photo" && \(\s*<button[^>]*data-action="play"/);
    expect(layer).toMatch(/data-action="close" aria-label=\{t\("close"\)\}/);
    expect(layer).toMatch(/e\.currentTarget\.duration > MAX_VIDEO_SECONDS\) onBad\(\)/);
  });
  it("Stop and Clear take the pictures away at once; main is told where they are, and when they are gone", () => {
    expect(overlay).toMatch(/if \(s\.stopped === true\) \{[\s\S]{0,200}setMedia\(null\);/);
    expect(overlay).toMatch(/b\.onClear\(\(\) => \{[\s\S]{0,80}setMedia\(null\);/);
    expect(overlay).toMatch(/b\.onMedia\?\.\(\(m\) => \{\s*const show = cleanShow\(m\);/);
    // next to the bubble (by the pointer), and the pointer flies to the first picture
    expect(overlay).toMatch(/setMedia\(show && c \? \{ \.\.\.show, x: c\.x, y: c\.y \} : show\)/);
    expect(overlay).toContain("<MediaLayer show={media} avoid={mediaAvoid} t={t} onPlaced={showMedia} />");
    expect(layer).toMatch(/onPlaced\?\.\(first, gallery\[0\]\?\.item\.caption/);
    expect(layer).toContain("b?.overlayRects?.(els.map(rectOf));");
    expect(layer).toContain("useEffect(() => () => okFilowBridge()?.overlayRects?.([]), []);");
  });
});
