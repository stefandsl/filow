import { describe, expect, it } from "vitest";
import { batchRecipient, checkMedia, cleanShow, extractMedia, galleryColumns, galleryLayout, isLoopback, MAX_GALLERY, maxDataUrl, MEDIA_PROMPT, ownHost, ownMedia, placeBlock, showLayout, wikimediaRecipient } from "./media";
import { photoRecipient } from "./outbound";
import { parseBuddyAnswer, buddySystemPrompt } from "./prompt";
import { wordsOnly } from "./phoneAsk";
import type { Rect } from "./marks";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
const WEBM = "data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYEC";
const area = (a: Rect, b: Rect) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const inside = (r: Rect, v: { width: number; height: number }) => r.left >= 0 && r.top >= 0 && r.right <= v.width && r.bottom <= v.height;

describe("tags", () => {
  it("reads 1 to 6 MEDIA tags of the three kinds and takes them out of the words", () => {
    const raw = "Here they are. [MEDIA:photo:Eiffel Tower] [MEDIA:gif:Heart beating] [MEDIA:video:Solar eclipse] [MEDIA:animation:Pendulum]";
    const r = extractMedia(raw);
    expect(r.media).toEqual([{ kind: "photo", subject: "Eiffel Tower" }, { kind: "gif", subject: "Heart beating" }, { kind: "video", subject: "Solar eclipse" }, { kind: "gif", subject: "Pendulum" }]);
    expect(r.body.trim()).toBe("Here they are.");
  });
  it("keeps at most six, drops repeats, unknown kinds and links the model wrote", () => {
    const tags = Array.from({ length: 9 }, (_, i) => `[MEDIA:photo:Thing ${i}]`).join(" ");
    expect(extractMedia(tags).media).toHaveLength(MAX_GALLERY);
    expect(extractMedia("[MEDIA:photo:Cat] [MEDIA:photo:cat]").media).toHaveLength(1);
    expect(extractMedia("[MEDIA:audio:Cat] [MEDIA:gif:https://evil.example/x.gif] [MEDIA:video:www.x.com] [MEDIA:photo:x]").media).toEqual([]);
  });
  it("reads one slide: a title, 2 to 5 points and 0 to 3 pictures", () => {
    const r = extractMedia("[SLIDE:The heart|Pumps blood; Four chambers; Beats 70 times a minute|gif:Heart beating; photo:Human heart; video:Echocardiogram; photo:Extra]");
    expect(r.slide).toEqual({ title: "The heart", points: ["Pumps blood", "Four chambers", "Beats 70 times a minute"], media: [{ kind: "gif", subject: "Heart beating" }, { kind: "photo", subject: "Human heart" }, { kind: "video", subject: "Echocardiogram" }] });
    expect(r.body).toBe("");
    expect(extractMedia("[SLIDE:Only one|A single point]").slide).toBeNull();
    expect(extractMedia("[SLIDE:T|a;b;c;d;e;f;g]").slide?.points).toHaveLength(5);
  });
  it("the answer parser hands them on, never shows a broken or half-written one, and a phone's answer has none", () => {
    const screens = [{ index: 1, width: 1920, height: 1080, cursor: true }];
    const p = parseBuddyAnswer("Look. [MEDIA:gif:Heart] [SLIDE:T|a; b]", screens);
    expect(p.media).toHaveLength(1);
    expect(p.slide?.title).toBe("T");
    expect(p.text).toBe("Look.");
    expect(parseBuddyAnswer("Look. [MEDIA:gif:Hea", screens).text).toBe("Look.");
    expect(parseBuddyAnswer("Look. [SLIDE:only title]", screens).text).toBe("Look.");
    const w = wordsOnly(p);
    expect(w.media).toEqual([]);
    expect(w.slide).toBeNull();
  });
  it("both prompts teach the tags", () => {
    const screens = [{ index: 1, width: 1920, height: 1080, cursor: true }];
    expect(buddySystemPrompt(screens, "en")).toContain(MEDIA_PROMPT);
    expect(buddySystemPrompt(screens, "en", { pictures: false })).toContain(MEDIA_PROMPT);
  });
});

describe("what may be shown", () => {
  it("data URLs of the kind only, within the cap", () => {
    expect(checkMedia("photo", PNG)).toBe(true);
    expect(checkMedia("gif", GIF)).toBe(true);
    expect(checkMedia("video", WEBM)).toBe(true);
    expect(checkMedia("photo", GIF)).toBe(false);
    expect(checkMedia("video", "https://upload.wikimedia.org/x.webm")).toBe(false);
    expect(checkMedia("photo", "data:text/html;base64,PHNjcmlwdD4=")).toBe(false);
    expect(checkMedia("gif", `data:image/gif;base64,${"A".repeat(maxDataUrl("gif"))}`)).toBe(false);
  });
  it("cleanShow drops what may not be shown and clips the words", () => {
    const s = cleanShow({ x: 5, y: 6, gallery: [{ kind: "photo", src: PNG, caption: "A\nb", source: "Wikipedia" }, { kind: "video", src: "javascript:alert(1)" }, { kind: "html", src: PNG }], slide: { title: "T", points: ["one", "two"], media: [{ kind: "gif", src: GIF, caption: "c", source: "s" }] } });
    expect(s?.gallery).toEqual([{ kind: "photo", src: PNG, caption: "A b", source: "Wikipedia" }]);
    expect(s?.slide?.media).toHaveLength(1);
    expect(cleanShow({ gallery: [], slide: { title: "T", points: ["one"] } })).toBeNull();
    expect(cleanShow(null)).toBeNull();
  });
});

describe("the user's own files and links", () => {
  it("finds links and paths to pictures, GIFs and videos on the first line only", () => {
    expect(ownMedia('show this https://example.org/a/cat.gif and "C:\\Users\\me\\My clips\\run.mp4" please\nhttps://x.org/b.png')).toEqual([
      { kind: "gif", subject: "https://example.org/a/cat.gif", own: true },
      { kind: "video", subject: "C:\\Users\\me\\My clips\\run.mp4", own: true },
    ]);
    expect(ownMedia("open https://example.org/page.html")).toEqual([]);
  });
  it("a link to this PC stays here; another site is named", () => {
    expect(ownHost("http://127.0.0.1:5033/x.gif")).toBeNull();
    expect(ownHost("https://Example.org/x.gif")).toBe("example.org");
    expect(ownHost("file:///c:/x.gif")).toBeNull();
    expect(isLoopback("localhost")).toBe(true);
  });
});

describe("who is asked", () => {
  it("photos only: the cards' Wikipedia yes; anything animated: Wikimedia; own files: nobody", () => {
    expect(batchRecipient([{ kind: "photo", subject: "a" }, { kind: "photo", subject: "b" }])).toEqual(photoRecipient());
    expect(batchRecipient([{ kind: "photo", subject: "a" }, { kind: "gif", subject: "b" }])).toEqual(wikimediaRecipient());
    expect(batchRecipient([{ kind: "gif", subject: "C:\\a.gif", own: true }])).toBeNull();
  });
});

describe("layout", () => {
  const view = { width: 1920, height: 1080 };
  it("galleryColumns: one row to three, 2x2 for four, three across for five and six", () => {
    expect([1, 2, 3, 4, 5, 6].map(galleryColumns)).toEqual([1, 2, 3, 2, 3, 3]);
  });
  it("four tiles: no overlap with each other or with the marks, bubble and pill, all on screen", () => {
    const avoid: Rect[] = [{ left: 800, top: 400, right: 1120, bottom: 680 }, { left: 860, top: 8, right: 1060, bottom: 48 }, { left: 1000, top: 560, right: 1380, bottom: 760 }];
    const g = galleryLayout(4, view, avoid, { x: 960, y: 540 });
    expect(g.tiles).toHaveLength(4);
    expect(g.overlap).toBe(0);
    for (const [i, t] of g.tiles.entries()) {
      expect(inside(t, view)).toBe(true);
      for (const a of avoid) expect(area(t, a)).toBe(0);
      for (const u of g.tiles.slice(i + 1)) expect(area(t, u)).toBe(0);
    }
  });
  it("shrinks to fit a crowded screen, and never leaves it (a phone-sized one too)", () => {
    const crowded: Rect[] = [{ left: 0, top: 0, right: 1920, bottom: 700 }, { left: 0, top: 700, right: 1300, bottom: 1080 }];
    const g = galleryLayout(6, view, crowded, { x: 960, y: 540 });
    expect(g.overlap).toBe(0);
    expect(g.scale).toBeLessThan(1);
    const small = { width: 360, height: 640 };
    const s = galleryLayout(6, small, [], { x: 180, y: 320 });
    for (const t of s.tiles) expect(inside(t, small)).toBe(true);
  });
  it("a slide and pictures: one column, same left edge, one gap apart, never touching; a gap from the pill and marks too", () => {
    const pill: Rect = { left: 860, top: 8, right: 1060, bottom: 44 };
    const mark: Rect = { left: 900, top: 340, right: 1060, bottom: 500 };
    const s = showLayout(2, { width: 560, height: 380 }, view, [pill, mark], { x: 960, y: 540 });
    expect(s.slide).not.toBeNull();
    expect(s.tiles[0].left).toBe(s.slide!.left);
    expect(Math.max(...s.tiles.map((t) => t.right))).toBe(s.slide!.right);
    // the slide is never narrower than it was measured at (its words would not fit): the pictures grow instead
    expect(s.slide!.right - s.slide!.left).toBeGreaterThanOrEqual(558);
    // under the toolbar: one margin, or clearly apart (never the margin plus a few pixels)
    const topGap = Math.min(...s.tiles.map((t) => t.top)) - pill.bottom;
    expect(topGap === 12 || topGap >= 12 + 16).toBe(true);
    // three pictures are wider than the slide: the slide takes their width
    const wide = showLayout(3, { width: 560, height: 300 }, view, [], { x: 960, y: 540 });
    expect(wide.slide!.right - wide.slide!.left).toBe(Math.max(...wide.tiles.map((t) => t.right)) - wide.tiles[0].left);
    // right under the toolbar: exactly one margin from it
    const under = galleryLayout(2, view, [pill], { x: 960, y: 0 });
    expect(Math.min(...under.tiles.map((t) => t.top)) - pill.bottom).toBe(12);
    expect(s.slide!.top - Math.max(...s.tiles.map((t) => t.bottom))).toBe(12);
    for (const r of [...s.tiles, s.slide!]) {
      expect(inside(r, view)).toBe(true);
      for (const a of [pill, mark]) expect(area(r, { left: a.left - 11, top: a.top - 11, right: a.right + 11, bottom: a.bottom + 11 })).toBe(0);
    }
    const g = galleryLayout(4, view, [pill, mark], { x: 960, y: 540 });
    for (const t of g.tiles) for (const a of [pill, mark]) expect(area(t, { left: a.left - 11, top: a.top - 11, right: a.right + 11, bottom: a.bottom + 11 })).toBe(0);
  });
  it("placeBlock: off the boxes when there is room, as near the spot as it can", () => {
    const p = placeBlock({ width: 400, height: 300 }, view, [{ left: 760, top: 390, right: 1160, bottom: 690 }], { x: 960, y: 540 });
    expect(p.overlap).toBe(0);
    expect(inside(p.rect, view)).toBe(true);
    const d = Math.hypot(Math.max(p.rect.left - 960, 0, 960 - p.rect.right), Math.max(p.rect.top - 540, 0, 540 - p.rect.bottom));
    expect(d).toBeLessThan(260);
  });
});
