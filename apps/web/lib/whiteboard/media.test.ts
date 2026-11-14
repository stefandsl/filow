import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyEdits, applyOps, excalidrawFile, noEdits, parseExcalidrawFile } from "./doc";
import { boardFileOk, cleanBoardMedia, filesOf, MEDIA_FILE_CAP, mediaElement, posterSvg } from "./media";
import type { Scene } from "./scene";

const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
const WEBM = "data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYEC";
const empty: Scene = { elements: [], files: {} };

describe("the board page shows them where Excalidraw drew them", () => {
  const board = readFileSync(new URL("../../components/whiteboard/ExcalidrawBoard.tsx", import.meta.url), "utf8");
  it("the view box is moved back by the corner Excalidraw draws from (a file with no frame at 0,0 lines up)", () => {
    expect(board).toMatch(/const drawn = boundsOf\(visible\);\s*origin\.current = drawn \? \{ x: drawn\.x, y: drawn\.y \}/);
    expect(board).toContain("`${a.x - origin.current.x} ${a.y - origin.current.y} ${a.w} ${a.h}`");
  });
  it("a GIF and a video are shown over their element, from the board's own files only", () => {
    expect(board).toMatch(/className="wb-gif" src=\{f\.dataURL\}/);
    expect(board).toMatch(/<video ref=\{v\} src=\{src\} muted loop autoPlay playsInline/);
  });
});

describe("GIF and video on the board", () => {
  it("a GIF is an image element whose file is the GIF; a video an image of our poster plus its own file", () => {
    const g = mediaElement({ kind: "gif", src: GIF, caption: "Heart beating", source: "Wikimedia Commons · A · CC0" }, { x: 10, y: 20, w: 320 }, 2)!;
    expect(g.element.type).toBe("image");
    expect(g.element.customData?.wb?.step).toBe(2);
    expect(g.files[g.element.fileId!].dataURL).toBe(GIF);
    expect(g.element.height).toBe(240);
    // its caption and source go under it as board text, with the same step
    expect(g.label).toMatchObject({ type: "text", text: "Heart beating · Wikimedia Commons · A · CC0", y: 20 + 240 + 8 });
    expect(g.label?.customData?.wb?.step).toBe(2);
    expect(mediaElement({ kind: "gif", src: GIF, caption: "", source: "" }, { x: 0, y: 0, w: 100 })?.label).toBeNull();
    const v = mediaElement({ kind: "video", src: WEBM, caption: "Eclipse", source: "Your file" }, { x: 0, y: 0, w: 400, ratio: 16 / 9 })!;
    const m = cleanBoardMedia(v.element.customData?.media)!;
    expect(m.kind).toBe("video");
    expect(v.files[v.element.fileId!].mimeType).toBe("image/svg+xml");
    expect(v.files[m.video!].dataURL).toBe(WEBM);
    expect(filesOf(v.element).sort()).toEqual(Object.keys(v.files).sort());
  });
  it("refuses what is not a GIF or video data URL within its cap", () => {
    expect(mediaElement({ kind: "gif", src: WEBM, caption: "", source: "" }, { x: 0, y: 0, w: 100 })).toBeNull();
    expect(mediaElement({ kind: "video", src: "https://x/y.webm", caption: "", source: "" }, { x: 0, y: 0, w: 100 })).toBeNull();
    expect(boardFileOk(`data:video/webm;base64,${"A".repeat(Math.ceil(MEDIA_FILE_CAP.video / 3) * 4 + 100)}`)).toBe(false);
    expect(boardFileOk(`data:image/gif;base64,${"A".repeat(Math.ceil(MEDIA_FILE_CAP.gif / 3) * 4 + 100)}`)).toBe(false);
    expect(boardFileOk("data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
  });
  it("the poster is our own SVG: a caption cannot become markup", () => {
    expect(posterSvg('<script>alert(1)</script>"', 320, 240)).not.toMatch(/<script/);
  });
  it("an agent places it with applyOps; it survives save and reopen with both files", () => {
    const g = mediaElement({ kind: "gif", src: GIF, caption: "Heart", source: "s" }, { x: 0, y: 0, w: 300 })!;
    const v = mediaElement({ kind: "video", src: WEBM, caption: "Eclipse", source: "s" }, { x: 400, y: 0, w: 300 }, 1, "v")!;
    const { edits } = applyOps(empty, noEdits(), [{ op: "add", element: g.element, files: g.files }, { op: "add", element: v.element, files: { ...v.files, extra: { id: "extra", mimeType: "image/gif", dataURL: GIF, created: 1 } } }]);
    const scene = applyEdits(empty, edits);
    expect(Object.keys(scene.files)).not.toContain("extra");
    const reopened = parseExcalidrawFile(excalidrawFile(scene))!;
    expect(reopened.elements.map((e) => cleanBoardMedia(e.customData?.media)?.kind)).toEqual(["gif", "video"]);
    expect(reopened.elements[1].customData?.wb?.step).toBe(1);
    expect(Object.keys(reopened.files).sort()).toEqual([...filesOf(g.element), ...filesOf(v.element)].sort());
    expect(reopened.files[cleanBoardMedia(reopened.elements[1].customData?.media)!.video!].dataURL).toBe(WEBM);
  });
  it("a file read from disk cannot open the board to HTML, links or scripts", () => {
    const g = mediaElement({ kind: "gif", src: GIF, caption: "Heart", source: "s" }, { x: 0, y: 0, w: 300 })!;
    const file = JSON.stringify({
      type: "excalidraw",
      elements: [
        { ...g.element, link: "javascript:alert(1)", customData: { ...g.element.customData, media: { kind: "gif", caption: "<img onerror=x>", source: "s" } } },
        { ...g.element, id: "emb", type: "embeddable", link: "https://evil.example" },
        { ...g.element, id: "rect", type: "rectangle", customData: { media: { kind: "video", video: "v" } } },
        { ...g.element, id: "badvideo", customData: { media: { kind: "video" } } },
      ],
      files: { ...g.files, h: { id: "h", mimeType: "text/html", dataURL: "data:text/html;base64,PHNjcmlwdD4=" } },
    });
    const s = parseExcalidrawFile(file)!;
    expect(s.elements.map((e) => e.id)).toEqual([g.element.id, "rect", "badvideo"]);
    expect(s.elements[0].link).toBeNull();
    expect(cleanBoardMedia(s.elements[0].customData?.media)?.caption).toBe("img onerror=x");
    expect(s.elements[1].customData?.media).toBeUndefined();
    expect(s.elements[2].customData?.media).toBeUndefined();
    expect(Object.keys(s.files)).toEqual(Object.keys(g.files));
  });
});
