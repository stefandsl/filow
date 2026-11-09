import { describe, expect, it } from "vitest";
import { parseBuddyAnswer } from "./prompt";
import { drawingSvg, MAX_DRAWING_SHAPES, MAX_MODEL_PARTS, validateDrawing, validateModel } from "./visuals";

const screens = [
  { index: 1, width: 1280, height: 720, cursor: true },
  { index: 2, width: 1280, height: 1024 },
];
const engine = '{"title":"Engine","parts":[{"name":"Block","shape":"box","size":[2,2,1],"pos":[0,0,0],"color":"#999999"},{"name":"Piston","shape":"cylinder","size":[0.6,0.5,0.6],"pos":[0,0.5,0]},{"name":"Bad","shape":"teapot","size":[1,1,1]}]}';

describe("cards and 3D models", () => {
  it("takes a card out of the spoken text with its photo subject", () => {
    const out = parseBuddyAnswer("A piston moves up and down [CARD:600,300:Piston|It turns pressure into motion.|Piston].", screens);
    expect(out.text).toBe("A piston moves up and down.");
    expect(out.cards).toEqual([{ x: 600, y: 300, title: "Piston", text: "It turns pressure into motion.", photo: "Piston", screen: 1 }]);
  });

  it("takes a 3D model block out of the answer, keeps valid parts and fills defaults", () => {
    const out = parseBuddyAnswer("Here is an engine.\n```model3d\n" + engine + "\n```", screens);
    expect(out.text).toBe("Here is an engine.");
    expect(out.model?.title).toBe("Engine");
    expect(out.model?.parts.map((p) => p.name)).toEqual(["Block", "Piston"]);
    expect(out.model?.parts[1]).toMatchObject({ rot: [0, 0, 0], color: "#b8c0cc" });
  });

  it("holds back a model block that is still streaming, and ignores broken JSON", () => {
    expect(parseBuddyAnswer('Here it is.\n```model3d\n{"title":"En', screens).text).toBe("Here it is.");
    expect(parseBuddyAnswer("Here it is.\n``", screens).text).toBe("Here it is.");
    const broken = parseBuddyAnswer("Here.\n```model3d\n{nope}\n```", screens);
    expect(broken.model).toBeNull();
    expect(broken.text).toBe("Here.");
  });

  it("rejects models with no usable parts and caps the number of parts", () => {
    expect(validateModel({ parts: [{ shape: "box", size: [0, 1, 1] }] })).toBeNull();
    const many = { parts: Array.from({ length: 80 }, () => ({ shape: "sphere", size: [1] })) };
    expect(validateModel(many)?.parts.length).toBe(MAX_MODEL_PARTS);
  });

  it("tells the model how to draw cards and 3D models", async () => {
    const { buddySystemPrompt } = await import("./prompt");
    const p = buddySystemPrompt(screens, "auto");
    expect(p).toContain("[CARD:x,y:Title|");
    expect(p).toContain("```model3d");
    expect(p).toContain("the language the user speaks");
  });
});

describe("tag text never leaks into the bubble", () => {
  it("keeps labels that contain colons", () => {
    const out = parseBuddyAnswer("Here. [CIRCLE:420,500,15:Photosynthesis: Light-dependent reactions] [POINT:10,20:Step 1: light]", screens);
    expect(out.text).toBe("Here.");
    expect(out.marks[0]).toMatchObject({ kind: "circle", label: "Photosynthesis: Light-dependent reactions" });
    expect(out.points[0]).toMatchObject({ label: "Step 1: light" });
    expect(parseBuddyAnswer("A [POINT:10,20:Start:screen2]", screens).points[0]).toMatchObject({ label: "Start", screen: 2 });
  });

  it("drops an unclosed or malformed tag in the middle of the answer", () => {
    const leaked = "Light first. [CIRCLE:400,300,15:Photosynthesis: Light Reactions: Sunlight hits chloroplasts. [ARROW:300,250,400,250:sunlight] Then sugar. [BOX:1,2:bad]";
    const out = parseBuddyAnswer(leaked, screens);
    expect(out.text).not.toMatch(/\[|CIRCLE|ARROW|BOX/);
    expect(out.text).toContain("Then sugar.");
    expect(out.marks.map((m) => m.kind)).toEqual(["arrow"]);
  });
});

describe("2D drawings", () => {
  const car = {"title":"Car","shapes":[
    {"type":"rect","x":60,"y":150,"w":280,"h":70,"rx":12,"fill":"#d33a2c"},
    {"type":"circle","cx":120,"cy":225,"r":28,"fill":"#222222"},
    {"type":"ellipse","cx":200,"cy":140,"rx":80,"ry":40,"fill":"#e85c4f","stroke":"#000000","width":3},
    {"type":"line","x1":0,"y1":255,"x2":400,"y2":255},
    {"type":"polygon","points":[[130,150],[160,110],[240,110],[270,150]],"fill":"#a8d8ff"},
    {"type":"path","d":"M 60 180 Q 50 190 60 200 Z","fill":"none","stroke":"#ffcc00","width":2},
    {"type":"teapot"}]};

  it("takes a drawing block out of the answer and keeps the valid shapes", () => {
    const out = parseBuddyAnswer("Here is a car.\n```drawing2d\n" + JSON.stringify(car) + "\n```", screens);
    expect(out.text).toBe("Here is a car.");
    expect(out.drawing?.title).toBe("Car");
    expect(out.drawing?.shapes.map((s) => s.kind)).toEqual(["rect", "circle", "ellipse", "line", "polygon", "path"]);
    expect(out.drawing?.shapes[3]).toMatchObject({ fill: "none", stroke: "#333333" });
  });

  it("holds back a drawing block that is still streaming", () => {
    expect(parseBuddyAnswer('Here.\n```drawing2d\n{"title":"Ca', screens).text).toBe("Here.");
    expect(parseBuddyAnswer("Here.\n```dra", screens).text).toBe("Here.");
  });

  it("rejects unsafe paths, colours and out-of-range numbers", () => {
    const bad = validateDrawing({ shapes: [
      { type: "path", d: "M 0 0 A 10 10 0 0 1 20 20" },
      { type: "path", d: "M 0 0 L 10 10\"/><script>alert(1)</script>" },
      { type: "path", d: "L 10 10" },
      { type: "circle", cx: 1e9, cy: 0, r: 5 },
      { type: "rect", x: 0, y: 0, w: 10, h: 10, fill: "red\" onload=\"x" },
    ] });
    expect(bad?.shapes).toEqual([{ kind: "rect", x: 0, y: 0, w: 10, h: 10, rx: 0, fill: "#b8c0cc", stroke: "none", width: 2 }]);
    expect(validateDrawing({ shapes: [{ type: "circle", cx: 0, cy: 0, r: 0 }] })).toBeNull();
    const many = { shapes: Array.from({ length: 90 }, () => ({ type: "circle", cx: 1, cy: 1, r: 1 })) };
    expect(validateDrawing(many)?.shapes.length).toBe(MAX_DRAWING_SHAPES);
  });

  it("renders only SVG elements built from the validated shapes", () => {
    const svg = drawingSvg(validateDrawing(car)!);
    expect(svg.startsWith("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 400 300\">")).toBe(true);
    expect(svg).toContain("<polygon points=\"130,150 160,110 240,110 270,150\"");
    expect(svg).toContain("<path d=\"M 60 180 Q 50 190 60 200 Z\"");
    expect(svg).not.toMatch(/script|on[a-z]+=/i);
  });

  it("keeps short text labels, escaped, in dark ink by default", () => {
    const d = validateDrawing({ shapes: [{ type: "text", x: 200, y: 150, text: "CO2 <in> & \"out\"", fill: "none" }, { type: "text", x: 1e9, y: 0, text: "far" }, { type: "text", x: 1, y: 1, text: " " }] })!;
    expect(d.shapes).toHaveLength(1);
    const svg = drawingSvg(d);
    expect(svg).toContain('<text x="200" y="150" font-size="14"');
    expect(svg).toContain(">CO2 &#60;in&#62; &#38; &#34;out&#34;</text>");
    expect(svg).toContain('fill="#222222"');
  });

  it("tells the model how to draw in 2D", async () => {
    const { buddySystemPrompt } = await import("./prompt");
    expect(buddySystemPrompt(screens, "auto")).toContain("```drawing2d");
  });
});
