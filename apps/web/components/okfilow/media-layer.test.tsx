// The overlay's pictures: what the hidden driver (tools/media/qa-media.mjs) measures on the real page is
// wired as it is here: a video never plays sound, Stop and Clear take everything away, and the overlay
// tells main where the pictures are (and that they are gone).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layer = readFileSync(new URL("./media-layer.tsx", import.meta.url), "utf8");
const overlay = readFileSync(new URL("../../app/okfilow/overlay/page.tsx", import.meta.url), "utf8");

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
    expect(overlay).toContain("b.onMedia?.((m) => setMedia(cleanShow(m)))");
    expect(layer).toContain("b?.overlayRects?.(els.map(rectOf));");
    expect(layer).toContain("useEffect(() => () => okFilowBridge()?.overlayRects?.([]), []);");
  });
});
