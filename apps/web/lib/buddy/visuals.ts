// OK Filow visuals beyond pen marks (docs/OKFILOW-GAUNTLET.md row 16, HeyClicky 1.1.1 "draws in 2D
// and 3D"): explanation cards with a real photo, and 3D models of real things the user can turn
// and click. The model writes them as tags; everything here validates what it wrote.

/** An explanation card placed next to a spot on screen (0-1000 grid). */
export type BuddyCard = { x: number; y: number; title: string; text: string; photo: string; screen: number; svg?: string };

export const MODEL_SHAPES = ["box", "sphere", "cylinder", "cone", "torus", "capsule"] as const;
export type ModelShape = (typeof MODEL_SHAPES)[number];

/** One part of a 3D model, in model units (the whole model fits roughly in a 4 x 4 x 4 space). */
export type ModelPart = {
  name: string;
  shape: ModelShape;
  size: [number, number, number];
  pos: [number, number, number];
  rot: [number, number, number];
  color: string;
};
export type BuddyModel = { title: string; parts: ModelPart[] };

export const MAX_MODEL_PARTS = 40;

/** A flat drawing on a fixed 400 x 300 canvas, rendered by us as SVG from validated shapes only. */
export const DRAWING_W = 400;
export const DRAWING_H = 300;
export const MAX_DRAWING_SHAPES = 60;
type Paint = { fill: string; stroke: string; width: number };
export type DrawingShape = Paint &
  (
    | { kind: "rect"; x: number; y: number; w: number; h: number; rx: number }
    | { kind: "circle"; cx: number; cy: number; r: number }
    | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number }
    | { kind: "line"; x1: number; y1: number; x2: number; y2: number }
    | { kind: "polyline" | "polygon"; points: [number, number][] }
    | { kind: "path"; d: string }
    | { kind: "text"; x: number; y: number; text: string; size: number }
  );
export type BuddyDrawing = { title: string; shapes: DrawingShape[] };

const MODEL_EXAMPLE = '{"title":"Water molecule","parts":[{"name":"Oxygen atom","shape":"sphere","size":[1.2],"pos":[0,0,0],"rot":[0,0,0],"color":"#e5484d"},{"name":"Hydrogen atom 1","shape":"sphere","size":[0.7],"pos":[1,0.7,0],"rot":[0,0,0],"color":"#f4f4f5"},{"name":"O-H bond 1","shape":"cylinder","size":[0.15,1.1,0.15],"pos":[0.5,0.35,0],"rot":[0,0,-55],"color":"#a0a8b4"}]}';
const DRAWING_EXAMPLE = '{"title":"Sun","shapes":[{"type":"rect","x":0,"y":0,"w":400,"h":300,"fill":"#bfe3ff"},{"type":"circle","cx":200,"cy":150,"r":60,"fill":"#ffcc33","stroke":"#e0a000","width":4},{"type":"line","x1":200,"y1":60,"x2":200,"y2":20,"stroke":"#e0a000","width":4},{"type":"path","d":"M 170 170 Q 200 195 230 170","fill":"none","stroke":"#7a4b00","width":4}]}';
const MODEL_RULES = "shapes: box (size = width,height,depth), sphere (size[0] = diameter), cylinder and cone (size = diameter,height,diameter), torus (size = outer diameter, tube thickness, 0), capsule (diameter,height,diameter). pos is the centre, rot is in degrees. That example only shows the format: build the real thing the user asked about, with 8 to 25 parts in their true places and proportions, clear names and distinct colours. Keep it within -2..2 on every axis, and say one spoken sentence about it.";
const DRAWING_RULES = "The canvas is 400 wide and 300 high, y grows downward. types: rect (x,y,w,h, optional rx), circle (cx,cy,r), ellipse (cx,cy,rx,ry), line (x1,y1,x2,y2), polyline and polygon (points: [[x,y],...]), path (d with only M, L, C, Q, Z), text (x,y,text,size) for short labels. fill and stroke are #rrggbb or none, width is the stroke width. That example only shows the format: draw the real thing asked, with 6 to 40 shapes from back to front, and say one spoken sentence about it. A 3D request gets model3d instead.";

/**
 * How to draw: a 3D model or a flat drawing, as a block at the end of the answer. It needs no
 * screenshot, so every prompt carries it, also the one for a model that does not see the screen.
 */
export const DRAW_PROMPT = [
  "You can draw. You do it by writing a block at the very end of your answer, and the app turns the block into a picture the user sees. Never say that you cannot draw, and never describe a drawing in words instead of making it.",
  "When the answer is about a real physical thing (an engine, a molecule, a building, an organ, a machine), build a 3D model the user can turn and click: add, at the very end of your answer, a block",
  "```model3d",
  MODEL_EXAMPLE,
  "```",
  "When the user asks you to draw something flat (a 2D drawing, sketch, diagram, logo, icon), add at the very end of your answer a block. Always draw it, even when it has nothing to do with the screen: never refuse because of what is on the screen.",
  "```drawing2d",
  DRAWING_EXAMPLE,
  "```",
  DRAWING_RULES,
  MODEL_RULES,
].join("\n");

export const VISUALS_PROMPT = [
  "",
  "When a picture explains better than words, you can also show:",
  "[CARD:x,y:Title|one or two sentences|photo subject] a small card next to x,y with a real photo of the photo subject (an English Wikipedia title like Piston or Mitochondrion; leave it empty for no photo). At most two cards.",
  DRAW_PROMPT,
].join("\n");

/**
 * The whole prompt for a question that plainly asks for a drawing or a 3D model (wantsDrawing): only
 * the one format it needs and nothing about the screen, which small local models otherwise act on
 * instead of drawing (measured: G:/FILOW/tmp/okf-stop/REPRO.md). `again`: the first reply had no
 * usable picture.
 */
export function drawOnlyPrompt(kind: DrawKind, languageName: string, again = false): string {
  const flat = kind === "2d";
  return [
    "You are OK Filow, a friendly helper that lives next to the user's mouse pointer.",
    `The user asked you for ${flat ? "a drawing" : "a 3D model"}. You can draw: you write a block, and the app turns the block into ${flat ? "a picture" : "a 3D model"} the user sees. Never say that you cannot draw, never ask whether to start, and never describe the picture in words instead of making it.`,
    `Reply with exactly two things: first one short spoken sentence in ${languageName} about what you drew (no markdown, no tags in square brackets), then the block. Nothing after the block.`,
    flat ? "```drawing2d" : "```model3d",
    flat ? DRAWING_EXAMPLE : MODEL_EXAMPLE,
    "```",
    flat ? DRAWING_RULES.replace(" A 3D request gets model3d instead.", "") : MODEL_RULES,
    `The ${flat ? "Sun" : "water molecule"} above is only there to show the format. Do not copy it: every shape, size and colour must be your own, for the thing the user asked for.`,
    ...(again ? ["Your last reply had no usable picture in it. This time write the block, complete and valid JSON, closed with ```."] : []),
  ].join("\n");
}

export type DrawKind = "2d" | "3d";

// Word edges that also hold for letters outside ASCII (Romanian, Russian): \b does not.
const START = String.raw`(?<![\p{L}\p{N}])`;
const END = String.raw`(?![\p{L}\p{N}])`;
/** Whole words, word beginnings (a stem and whatever ending follows) and, for Japanese, plain pieces. */
const words = (whole: string[], stems: string[], pieces: string[] = []) =>
  new RegExp([...(whole.length ? [`${START}(?:${whole.join("|")})${END}`] : []), ...(stems.length ? [`${START}(?:${stems.join("|")})`] : []), ...pieces].join("|"), "iu");

const DRAW_VERB = words(
  ["draw", "sketch", "doodle", "illustrate", "(?:a|the|quick|simple|little) (?:drawing|sketch|diagram|doodle|illustration) of"],
  ["disegn", "schizz", "desen", "schi[tț]", "ilustreaz", "нарису", "рисуй", "рисуе", "начерти", "изобрази", "набросай"],
  ["描い", "描け", "描く", "絵を", "イラスト", "スケッチ", "図を"],
);
// "3D" also right after Japanese text ("車の3Dモデル"), so its edge is checked against Latin letters and digits only.
const THREE_D = words([], ["тр[её]хмерн", "tridimension"], ["(?<![A-Za-z0-9])3[\\s-]?[dд](?![A-Za-z0-9])", "三次元", "立体", "3次元"]);
const MODEL_OR_MAKE = words(
  ["make", "build", "show", "create", "render", "fammi", "fai", "fare", "costruisci", "f[ăa]", "arat[ăa]", "creeaz[ăa]", "construie[sș]te"],
  ["model", "crea", "mostra", "модел", "сделай", "покажи", "построй", "создай"],
  ["モデル", "作って", "作成", "見せて", "表示"],
);
/** The user means a mark on what is on the screen (a circle around a button), not a picture of a thing. */
const ON_SCREEN = words(
  ["circle", "underline", "arrow", "highlight", "point (?:at|to)", "mark", "around", "on (?:my|the|this) screen", "this", "here", "button", "schermo", "qui", "quest[oaie]", "pulsante", "aici", "aceast[ăa]", "acest", "здесь", "тут", "эт(?:о|от|у|а|им|ом)"],
  ["cerchi", "sottoline", "frecci", "evidenzi", "indica", "[îi]ncercui", "sublinia", "s[ăa]geat", "eviden[tț]i", "ecran", "buton", "обвед", "подчеркн", "стрелк", "выдел", "экран", "кнопк"],
  ["丸で囲", "下線", "矢印", "ハイライト", "画面", "ここ", "この", "ボタン"],
);

/**
 * Whether the question plainly asks for a picture of a thing, and which kind: "draw a car" (2d),
 * "a 3D model of a car" (3d), in the five languages. Null for everything else, also for a mark on the
 * screen ("draw a circle around the Save button"), which the normal answer does with its tags.
 */
export function wantsDrawing(question: string): DrawKind | null {
  const q = question.normalize("NFKC");
  if (THREE_D.test(q) && (DRAW_VERB.test(q) || MODEL_OR_MAKE.test(q))) return "3d";
  if (DRAW_VERB.test(q) && !ON_SCREEN.test(q)) return "2d";
  return null;
}

/** The model wrote back the prompt's own example (the Sun, the water molecule) instead of the thing asked: measured with small local models. */
export function isExampleCopy(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as { shapes?: unknown; parts?: unknown };
  const same = (mine: unknown, example: unknown) => mine !== undefined && JSON.stringify(mine) === JSON.stringify(example);
  return same(r.shapes, (JSON.parse(DRAWING_EXAMPLE) as { shapes: unknown }).shapes) || same(r.parts, (JSON.parse(MODEL_EXAMPLE) as { parts: unknown }).parts);
}

const CARD_RE = /\[CARD:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*:([^\]|]*)\|([^\]|]*)(?:\|([^\]|:]*))?(?::\s*screen\s*(\d+))?\s*\]/gi;

const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const vec = (v: unknown, lo: number, hi: number, fill?: number): [number, number, number] | null => {
  if (!Array.isArray(v)) return fill === undefined ? null : [fill, fill, fill];
  const a = [v[0], v[1] ?? fill ?? v[0], v[2] ?? fill ?? v[0]].map((x) => num(x, lo, hi));
  return a.every((x) => x !== null) ? (a as [number, number, number]) : null;
};

const paintColor = (v: unknown, fallback: string): string => (v === "none" ? "none" : /^#[0-9a-f]{6}$/i.test(String(v)) ? String(v) : fallback);
const PATH_TOKEN = /[MLCQZ]|-?\d+(?:\.\d+)?/gi;

/** Validates a 2D drawing the AI wrote; drops bad shapes, null when nothing usable is left. */
export function validateDrawing(raw: unknown): BuddyDrawing | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { title?: unknown; shapes?: unknown };
  const shapes: DrawingShape[] = [];
  const c = (v: unknown) => num(v, -DRAWING_W, DRAWING_W * 2);
  for (const p of Array.isArray(r.shapes) ? r.shapes : []) {
    if (!p || typeof p !== "object" || shapes.length >= MAX_DRAWING_SHAPES) continue;
    const q = p as Record<string, unknown>;
    const kind = String(q.type ?? q.kind ?? "").toLowerCase();
    const open = kind === "line" || kind === "polyline";
    const paint: Paint = { fill: open ? "none" : paintColor(q.fill, "#b8c0cc"), stroke: paintColor(q.stroke, open ? "#333333" : "none"), width: num(q.width, 0, 20) ?? 2 };
    const n = (...keys: string[]) => {
      const v = keys.map((k) => c(q[k]));
      return v.every((x) => x !== null) ? (v as number[]) : null;
    };
    if (kind === "rect") {
      const v = n("x", "y", "w", "h");
      if (v && v[2] > 0 && v[3] > 0) shapes.push({ kind, x: v[0], y: v[1], w: v[2], h: v[3], rx: num(q.rx, 0, 200) ?? 0, ...paint });
    } else if (kind === "circle") {
      const v = n("cx", "cy", "r");
      if (v && v[2] > 0) shapes.push({ kind, cx: v[0], cy: v[1], r: v[2], ...paint });
    } else if (kind === "ellipse") {
      const v = n("cx", "cy", "rx", "ry");
      if (v && v[2] > 0 && v[3] > 0) shapes.push({ kind, cx: v[0], cy: v[1], rx: v[2], ry: v[3], ...paint });
    } else if (kind === "line") {
      const v = n("x1", "y1", "x2", "y2");
      if (v) shapes.push({ kind, x1: v[0], y1: v[1], x2: v[2], y2: v[3], ...paint });
    } else if (kind === "polyline" || kind === "polygon") {
      const pts = (Array.isArray(q.points) ? q.points : []).slice(0, 200).map((pt: unknown) => (Array.isArray(pt) ? [c(pt[0]), c(pt[1])] : [null, null]));
      if (pts.length >= 2 && pts.every((pt) => pt[0] !== null && pt[1] !== null)) shapes.push({ kind, points: pts as [number, number][], ...paint });
    } else if (kind === "text" && typeof q.text === "string" && q.text.trim()) {
      const v = n("x", "y");
      // Labels default to dark ink: the model often gives a text a fill meant for a shape.
      if (v) shapes.push({ kind, x: v[0], y: v[1], text: q.text.trim().slice(0, 60), size: num(q.size, 6, 48) ?? 14, ...paint, fill: paintColor(q.fill ?? q.color, "#222222"), stroke: "none" });
    } else if (kind === "path" && typeof q.d === "string" && q.d.length <= 4000) {
      // Only M/L/C/Q/Z and numbers: the path is rebuilt from its tokens, so nothing else reaches the SVG.
      if (q.d.replace(PATH_TOKEN, "").replace(/[\s,]/g, "") !== "") continue;
      const tokens = q.d.match(PATH_TOKEN) ?? [];
      if (!/^m$/i.test(tokens[0] ?? "") || tokens.some((t) => !/[a-z]/i.test(t) && c(Number(t)) === null)) continue;
      shapes.push({ kind, d: tokens.join(" "), ...paint });
    }
  }
  if (!shapes.length) return null;
  return { title: String(r.title || "Drawing").trim().slice(0, 80) || "Drawing", shapes };
}

const escapeXml = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The drawing as an SVG document, built only from validated numbers and colours (never model SVG). */
export function drawingSvg(d: BuddyDrawing): string {
  const body = d.shapes
    .map((s) => {
      const paint = `fill="${s.fill}" stroke="${s.stroke}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round"`;
      switch (s.kind) {
        case "rect": return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.rx}" ${paint}/>`;
        case "circle": return `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" ${paint}/>`;
        case "ellipse": return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" ${paint}/>`;
        case "line": return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" ${paint}/>`;
        case "path": return `<path d="${s.d}" ${paint}/>`;
        case "text": return `<text x="${s.x}" y="${s.y}" font-size="${s.size}" font-family="Segoe UI, Arial, sans-serif" text-anchor="middle" fill="${s.fill === "none" ? "#222222" : s.fill}">${escapeXml(s.text)}</text>`;
        default: return `<${s.kind} points="${s.points.map((p) => p.join(",")).join(" ")}" ${paint}/>`;
      }
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${DRAWING_W} ${DRAWING_H}"><rect width="${DRAWING_W}" height="${DRAWING_H}" fill="#ffffff"/>${body}</svg>`;
}

/** Takes one fenced JSON block (model3d, drawing2d) out of the answer; an unfinished one is cut off. */
function takeBlock<T>(body: string, name: string, validate: (raw: unknown) => T | null): { body: string; value: T | null } {
  const fence = body.search(new RegExp("```\\s*" + name, "i"));
  if (fence < 0) return { body, value: null };
  const m = new RegExp("```\\s*" + name + "\\s*([\\s\\S]*?)```", "i").exec(body.slice(fence));
  if (!m) return { body: body.slice(0, fence), value: null }; // still streaming
  let value: T | null;
  try {
    const parsed: unknown = JSON.parse(m[1].trim());
    // The prompt's own example written back is not the thing the user asked for: never shown.
    value = isExampleCopy(parsed) ? null : validate(parsed);
  } catch { value = null; }
  return { body: body.slice(0, fence) + body.slice(fence + m.index + m[0].length), value };
}

/** Validates a model the AI wrote; drops bad parts, null when nothing usable is left. */
export function validateModel(raw: unknown): BuddyModel | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { title?: unknown; parts?: unknown };
  const parts: ModelPart[] = [];
  for (const p of Array.isArray(r.parts) ? r.parts : []) {
    if (!p || typeof p !== "object" || parts.length >= MAX_MODEL_PARTS) continue;
    const q = p as Record<string, unknown>;
    const shape = String(q.shape || "").toLowerCase() as ModelShape;
    if (!MODEL_SHAPES.includes(shape)) continue;
    const size = vec(q.size, 0, 6, 0);
    const pos = vec(q.pos, -6, 6, 0) ?? [0, 0, 0];
    const rot = vec(q.rot, -360, 360, 0) ?? [0, 0, 0];
    if (!size || size[0] <= 0) continue;
    const color = /^#[0-9a-f]{6}$/i.test(String(q.color)) ? String(q.color) : "#b8c0cc";
    const name = String(q.name || "").trim().slice(0, 60) || shape;
    parts.push({ name, shape, size, pos, rot, color });
  }
  if (!parts.length) return null;
  return { title: String(r.title || "Model").trim().slice(0, 80) || "Model", parts };
}

/**
 * Takes cards, a 3D model and a 2D drawing out of an answer. An unfinished block at the end of a
 * streamed answer is held back so its JSON never shows in the bubble.
 */
export function extractVisuals(raw: string, validScreen: (n: number) => boolean, defaultScreen = 1): { body: string; cards: BuddyCard[]; model: BuddyModel | null; drawing: BuddyDrawing | null } {
  const m3 = takeBlock(raw, "model3d", validateModel);
  const d2 = takeBlock(m3.body, "drawing2d", validateDrawing);
  // A fence that has only just started ("``", "```mod", "```draw") is held back too.
  let body = d2.body.replace(/`{1,3}\s*([a-z0-9]*)\s*$/i, (t, w: string) => ("model3d".startsWith(w.toLowerCase()) || "drawing2d".startsWith(w.toLowerCase()) ? "" : t));
  const cards: BuddyCard[] = [];
  body = body.replace(CARD_RE, (_m, x: string, y: string, title: string, text: string, photo: string | undefined, screen: string | undefined) => {
    const px = Number(x);
    const py = Number(y);
    const index = screen ? Number(screen) : defaultScreen;
    if (cards.length < 2 && px >= 0 && py >= 0 && px <= 1000 && py <= 1000 && validScreen(index) && (title.trim() || text.trim())) {
      cards.push({ x: px, y: py, title: title.trim().slice(0, 60), text: text.trim().slice(0, 240), photo: (photo ?? "").trim().slice(0, 80), screen: index });
    }
    return "";
  });
  return { body, cards, model: m3.value, drawing: d2.value };
}
