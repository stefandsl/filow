import { describe, expect, it } from "vitest";
import { itemsAsDiagram, newDiagramState, readDiagram, diagramText, type DiagramItem } from "./diagram";
import { generateCloud } from "./generate";
import { collectDiagram, layoutDiagram, loopOrder, mentions, treeParents, diagramBounds } from "./diagram-layout";
import { contextOf, lessonContextText, lessonMarkdown, outlineSchema, validateLesson, validateOutline, type Lesson } from "./lesson";
import { boardPage, layoutBoard, layoutProblems, type BoardShape } from "./layout";
import { sceneFromLayout } from "./scene";
import { checkScene, countProblems } from "./check";

const read = (src: string, st = newDiagramState()) => readDiagram(src, st);

describe("reading a diagram the model wrote", () => {
  it("reads a flowchart: shapes, labels, chained arrows, both label styles and groups", () => {
    const d = read('flowchart LR\n A[Bill introduced] --> B{Committee approves?}\n B -->|yes| C(["Floor vote"]) --> D((Law))\n B -- no --> E[Bill dies]\n F & G --> A');
    expect(d?.type).toBe("flowchart");
    expect(d?.dir).toBe("LR");
    expect(d?.nodes.map((n) => [n.id, n.text, n.shape])).toEqual([
      ["a", "Bill introduced", "box"], ["b", "Committee approves?", "diamond"], ["c", "Floor vote", "round"], ["d", "Law", "circle"], ["e", "Bill dies", "box"], ["f", "F", "box"], ["g", "G", "box"],
    ]);
    expect(d?.links.map((l) => `${l.from}>${l.to}:${l.text}`)).toEqual(["a>b:", "b>c:yes", "c>d:", "b>e:no", "f>a:", "g>a:"]);
  });

  it("reads ids glued to their arrows and dotted arrows", () => {
    const d = read("graph TD\nA-->B\nB-.->C\nC---D");
    expect(d?.links.map((l) => `${l.from}>${l.to}${l.dashed ? "~" : ""}`)).toEqual(["a>b", "b>c~", "c>d"]);
  });

  it("keeps only data: styles, classes, click handlers, init directives and HTML are dropped", () => {
    const d = read('%%{init: {"securityLevel":"loose"}}%%\nflowchart TD\n A["<b>Start</b><img src=x onerror=alert(1)>"] --> B[End]\n click A "javascript:alert(1)"\n style A fill:#f00\n classDef x fill:#000\n class A x');
    expect(d?.nodes.map((n) => n.text)).toEqual(["Start", "End"]);
    expect(JSON.stringify(d)).not.toMatch(/javascript|onerror|<|fill/);
  });

  it("reads a mind map by indentation, and a later step hangs under a branch it names again", () => {
    const st = newDiagramState();
    const a = readDiagram("mindmap\n  root((Biology))\n    Zoology\n      Insects\n    Botany", st);
    expect(a?.nodes.map((n) => `${n.text}<${n.parent ?? ""}`)).toEqual(["Biology<", "Zoology<root", "Insects<zoology", "Botany<root"]);
    const b = readDiagram("    Botany\n      Trees\n    Ecology", st);
    expect(b?.nodes.map((n) => `${n.text}<${n.parent ?? ""}`)).toEqual(["Trees<botany", "Ecology<root"]);
  });

  it("reads a sequence: participants, messages in order, replies dashed, control lines ignored", () => {
    const d = read("sequenceDiagram\n participant U as User\n participant G as Google\n autonumber\n U->>G: Sign in\n loop retry\n G-->>U: Code\n end\n U->>U: Store code");
    expect(d?.nodes.map((n) => n.text)).toEqual(["User", "Google"]);
    expect(d?.links.map((l) => `${l.from}>${l.to}:${l.text}${l.dashed ? "~" : ""}`)).toEqual(["u>g:Sign in", "g>u:Code~", "u>u:Store code"]);
  });

  it("reads participants whose names have spaces, as Mermaid does (a real lesson wrote them so)", () => {
    const d = read("sequenceDiagram\nCliente->>POS: Carta e PIN\nPOS->>Banca negozio: Richiesta\nBanca negozio->>Circuito: Inoltra\nCircuito-->>Banca negozio : Approvato\nBanca negozio-->>+POS: Esito\nparticipant Banca cliente\nBanca cliente->>Banca negozio");
    expect(d?.nodes.map((n) => `${n.id}:${n.text}`)).toEqual(["cliente:Cliente", "pos:POS", "banca_negozio:Banca negozio", "circuito:Circuito", "banca_cliente:Banca cliente"]);
    expect(d?.links.map((l) => `${l.from}>${l.to}:${l.text}${l.dashed ? "~" : ""}`)).toEqual([
      "cliente>pos:Carta e PIN", "pos>banca_negozio:Richiesta", "banca_negozio>circuito:Inoltra", "circuito>banca_negozio:Approvato~", "banca_negozio>pos:Esito~", "banca_cliente>banca_negozio:",
    ]);
  });

  it("reads names written in Russian or Japanese: each name is one box, the same name the same box", () => {
    const st = newDiagramState();
    const m = readDiagram("mindmap\n  Фотосинтез\n    Свет\n    Вода", st);
    expect(m?.nodes.map((n) => n.text)).toEqual(["Фотосинтез", "Свет", "Вода"]);
    expect(m?.links.length).toBe(2);
    const later = readDiagram("    Свет\n      Хлорофилл", st);
    expect(later?.nodes.map((n) => `${n.text}<${n.parent === m?.nodes[1].id ? "Свет" : n.parent}`)).toEqual(["Хлорофилл<Свет"]);
    const s = read("sequenceDiagram\n  顧客->>銀行: 依頼\n  銀行-->>顧客: 承認");
    expect(s?.nodes.map((n) => n.text)).toEqual(["顧客", "銀行"]);
    expect(s?.links.map((l) => `${l.from === s.nodes[0].id ? "顧客" : "銀行"}>${l.to === s.nodes[0].id ? "顧客" : "銀行"}:${l.text}`)).toEqual(["顧客>銀行:依頼", "銀行>顧客:承認"]);
    const f = read("flowchart TD\n  Старт --> Шаг_1 --> Этап_1");
    expect(f?.nodes.map((n) => n.text)).toEqual(["Старт", "Шаг 1", "Этап 1"]);
    expect(new Set(f?.nodes.map((n) => n.id)).size).toBe(3);
    expect(f?.links.length).toBe(2);
    expect(f?.nodes.every((n) => /^[a-z0-9_]+$/.test(n.id))).toBe(true);
    // the id comes from the name: the same in a fresh lesson, different for names that share a first letter
    const ids = (src: string) => read(src)?.nodes.map((n) => n.id);
    expect(ids("flowchart TD\n  Свет --> Сила")).toEqual(ids("flowchart TD\n  Свет --> Сила"));
    expect(ids("flowchart TD\n  Сила --> Свет")?.reverse()).toEqual(ids("flowchart TD\n  Свет --> Сила"));
    expect(new Set(ids("flowchart TD\n  Свет --> Сила")).size).toBe(2);
    // spaces, "_" and "-" are one separator, as slug treats them
    const v = read("sequenceDiagram\n  Банк клиента->>Шаг_1: a\n  Банк  клиента->>Шаг 1: b\n  Банк_клиента->>Шаг 1: c");
    expect(v?.nodes.length).toBe(2);
    expect(v?.links.length).toBe(3);
    expect(read("flowchart TD\n  Шаг-1 --> Старт\n  Шаг_1 --> Конец")?.nodes.length).toBe(3);
  });

  it("reads a Mermaid 11 participant with metadata as the name alone", () => {
    const d = read('sequenceDiagram\n  participant API@{ "type" : "database" }\n  participant U as User\n  U->>API: query');
    expect(d?.nodes.map((n) => `${n.id}:${n.text}`)).toEqual(["api:API", "u:User"]);
    expect(d?.links.map((l) => `${l.from}>${l.to}`)).toEqual(["u>api"]);
  });

  it("reads a table: the separator line is skipped, extra columns and rows are cut", () => {
    const st = newDiagramState();
    const d = readDiagram("| | Mitosis | Meiosis | x | y |\n|---|:---:|---|---|---|\n| Cells made | 2 | 4 | 0 | 0 |", st);
    expect(d?.rows).toEqual([["", "Mitosis", "Meiosis", "x"], ["Cells made", "2", "4", "0"]]);
    for (let i = 0; i < 12; i++) readDiagram(`| r${i} | a | b | c |`, st);
    expect(st.rows).toBe(8);
  });

  it("locks the lesson to one diagram type", () => {
    const st = newDiagramState();
    expect(readDiagram("flowchart TD\nA-->B", st)).not.toBeNull();
    expect(readDiagram("sequenceDiagram\nA->>B: hi", st)).toBeNull();
    expect(readDiagram("B-->C", st)?.links).toHaveLength(1);
    expect(readDiagram("just words", newDiagramState())).toBeNull();
  });

  it("caps a diagram at its limits", () => {
    const st = newDiagramState();
    readDiagram(`flowchart TD\n${Array.from({ length: 30 }, (_, i) => `N${i} --> N${i + 1}`).join("\n")}`, st);
    expect(st.nodes.size).toBe(16);
  });
});

const lessonWith = (steps: Array<{ say: string; items: unknown[] }>, title = "T") => validateLesson({ title, scene: "flow", steps }, { maxSteps: 7 })!;

describe("a lesson with a diagram", () => {
  const lesson = lessonWith([
    { say: "A bill starts in Congress.", items: [{ kind: "diagram", mermaid: "flowchart TD\nA[Bill] --> B{Passes House?}" }] },
    { say: "If it passes, the Senate votes.", items: [{ kind: "diagram", mermaid: "B -->|yes| C[Senate]\nB -->|no| D[Dies]" }, { kind: "mark", target: "b" }] },
  ]);

  it("validates step by step, marks may target diagram boxes", () => {
    expect(lesson.steps[0].items[0]).toMatchObject({ kind: "diagram", type: "flowchart" });
    expect(lesson.steps[1].items.map((i) => i.kind)).toEqual(["diagram", "mark"]);
  });

  it("collects the whole diagram, each part with its step", () => {
    const d = collectDiagram(lesson)!;
    expect(d.nodes.map((n) => `${n.id}@${n.step}`)).toEqual(["a@0", "b@0", "c@1", "d@1"]);
    expect(d.links.map((l) => `${l.from}>${l.to}@${l.step}`)).toEqual(["a>b@0", "b>c@1", "b>d@1"]);
  });

  it("continues in a follow-up and is sent back as Mermaid", () => {
    expect(lessonContextText(lesson)).toContain("flowchart TD");
    const more = validateLesson({ title: "T", steps: [{ say: "Then the President signs.", items: [{ kind: "diagram", mermaid: "C --> E[President]" }] }] }, { continues: lesson })!;
    expect(more.steps[0].items[0]).toMatchObject({ kind: "diagram", nodes: [{ id: "e" }], links: [{ from: "c", to: "e" }] });
    expect(contextOf(lesson).diagram?.nodes.size).toBe(4);
  });

  it("is exported as Markdown without markup from the model", () => {
    const md = lessonMarkdown(lesson);
    expect(md).toContain("Passes House?");
    expect(md).toContain("Passes House? -> Senate: yes");
  });

  it("stays on one board, and the board shows only the steps so far", () => {
    expect(boardPage(lesson, 1)).toMatchObject({ number: 1, start: 0 });
    expect(layoutBoard(lesson, 0, "wide").diagram?.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    expect(layoutBoard(lesson, 1, "wide").diagram?.nodes.map((n) => n.id)).toEqual(["a", "b", "c", "d"]);
    // what is drawn does not move when the next step is added
    expect(layoutBoard(lesson, 0, "wide").diagram?.nodes[0].box).toEqual(layoutBoard(lesson, 1, "wide").diagram?.nodes[0].box);
  });

  it("draws only Filow's own element types, the step of each part on it", () => {
    const scene = sceneFromLayout(layoutBoard(lesson, 1, "wide"));
    const types = new Set(scene.elements.map((e) => e.type));
    for (const t of types) expect(["rectangle", "diamond", "ellipse", "text", "arrow", "line"]).toContain(t);
    const senate = scene.elements.find((e) => e.id === "d-c");
    expect(senate?.customData?.wb?.step).toBe(1);
    expect(scene.elements.find((e) => e.id === "d-b")?.type).toBe("diamond");
  });
});

describe("structure", () => {
  it("finds a loop and a tree", () => {
    const cyc = { nodes: ["egg", "larva", "pupa", "adult"].map((id) => ({ id, text: id, shape: "box" as const, step: 0 })), links: [["egg", "larva"], ["larva", "pupa"], ["pupa", "adult"], ["adult", "egg"]].map(([from, to]) => ({ from, to, text: "", step: 0 })) };
    expect(loopOrder(cyc)).toEqual(["egg", "larva", "pupa", "adult"]);
    expect(treeParents(cyc)).toBeNull();
    const tree = { nodes: cyc.nodes, links: [["egg", "larva"], ["egg", "pupa"], ["pupa", "adult"]].map(([from, to]) => ({ from, to, text: "", step: 0 })) };
    expect(treeParents(tree)?.get("adult")).toBe("pupa");
    expect(loopOrder(tree)).toBeNull();
  });
});

/** A small seeded generator, so a failing board can be rebuilt from its seed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const WORDS = ["Light", "Carbon dioxide", "Chloroplast", "Glucose", "Mitochondrion", "Fotosintesi clorofilliana", "Equilibrium price", "Base case", "ATP", "Il Presidente firma la legge", "Server di autorizzazione", "Cell membrane"];

function randomDiagram(seed: number): Lesson {
  const r = rng(seed);
  const pick = <T>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const kind = pick(["flow", "tree", "cycle", "mind", "seq", "table"] as const);
  const n = 3 + Math.floor(r() * 10);
  const lines: string[] = [];
  if (kind === "flow") {
    lines.push(`flowchart ${r() < 0.5 ? "TD" : "LR"}`);
    for (let i = 1; i < n; i++) lines.push(`N${Math.floor(r() * i)}[${pick(WORDS)}] -->${r() < 0.4 ? `|${pick(["yes", "no", "sends", "causes"])}|` : ""} N${i}${r() < 0.2 ? `{${pick(WORDS)}?}` : `[${pick(WORDS)}]`}`);
    if (r() < 0.4) lines.push(`N${n - 1} --> N${Math.floor(r() * n)}`);
  } else if (kind === "tree") {
    lines.push("flowchart TD");
    for (let i = 1; i < n; i++) lines.push(`N${Math.floor(r() * i)}[${pick(WORDS)}] --> N${i}[${pick(WORDS)}]`);
  } else if (kind === "cycle") {
    lines.push("flowchart LR");
    const k = Math.min(n, 3 + Math.floor(r() * 5));
    for (let i = 0; i < k; i++) lines.push(`C${i}[${pick(WORDS)}] -->|${pick(["", "becomes", "feeds"])}| C${(i + 1) % k}`);
    if (r() < 0.5) lines.push(`X[${pick(WORDS)}] --> C0`);
  } else if (kind === "mind") {
    lines.push("mindmap", "  root((Biology))");
    for (let i = 1; i < n; i++) lines.push(`${" ".repeat(r() < 0.6 ? 4 : 6)}${pick(WORDS)} ${i}`);
  } else if (kind === "seq") {
    lines.push("sequenceDiagram");
    const parts = ["User", "Browser", "Server", "Bank", "Shop"].slice(0, 2 + Math.floor(r() * 4));
    for (let i = 0; i < Math.min(n, 10); i++) lines.push(`${pick(parts)}${r() < 0.3 ? "-->>" : "->>"}${pick(parts)}: ${pick(WORDS)}`);
  } else {
    const cols = 2 + Math.floor(r() * 3);
    for (let i = 0; i < Math.min(n, 7); i++) lines.push(`| ${Array.from({ length: cols }, () => pick(WORDS)).join(" | ")} |`);
  }
  // the lines shared out over 2 to 5 steps, with a note or a formula now and then
  const steps = 2 + Math.floor(r() * 4);
  const head = kind === "table" ? 0 : 1;
  const per = Math.ceil((lines.length - head) / steps);
  return lessonWith(Array.from({ length: steps }, (_, s) => ({
    say: `Step ${s + 1} explains ${pick(WORDS)}.`,
    items: [{ kind: "diagram", mermaid: [...(s === 0 ? lines.slice(0, head) : []), ...lines.slice(head + s * per, head + (s + 1) * per)].join("\n") }, ...(r() < 0.3 ? [{ kind: "note", text: pick(WORDS) }] : [])],
  })).filter((s) => s.items.length), kind);
}

describe("layout of generated diagrams", () => {
  it("never overlaps, never leaves the board and keeps every label inside its box (600 lessons, both board shapes)", () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 600; seed++) {
      const lesson = randomDiagram(seed);
      if (!lesson) continue;
      for (const shape of ["wide", "tall"] as BoardShape[]) {
        for (let k = 0; k < lesson.steps.length; k++) {
          const layout = layoutBoard(lesson, k, shape);
          const problems = layoutProblems(layout).filter((p) => p.includes("diagram") || p.includes("off the board"));
          if (problems.length) bad.push(`seed ${seed} ${lesson.title} ${shape} step ${k + 1}: ${problems.slice(0, 2).join("; ")}`);          const scene = countProblems(checkScene(sceneFromLayout(layout)));
          if (scene.overlap) bad.push(`seed ${seed} ${shape} step ${k + 1}: ${scene.overlap} overlaps in the scene`);
        }
      }
    }
    const tally: Record<string, number> = {}; for (const b of bad) { const k = b.split(" ").slice(2, 4).join(" "); tally[k] = (tally[k] ?? 0) + 1; }
    const first = Object.keys(tally).map((k) => bad.find((b) => b.split(" ").slice(2, 4).join(" ") === k));
    expect({ tally, first }).toEqual({ tally: {}, first: [] });
  });

  it("fills its room: a small diagram is set large, a big one smaller but readable", () => {
    const area = { x: 0, y: 0, w: 760, h: 600 };
    const small = collectDiagram(lessonWith([{ say: "s", items: [{ kind: "diagram", mermaid: "flowchart TD\nA[One]-->B[Two]" }] }]))!;
    const big = collectDiagram(randomDiagram(7))!;
    expect(layoutDiagram(small, area, "wide").font).toBe(22);
    const placed = layoutDiagram(big, area, "wide");
    expect(placed.font).toBeGreaterThanOrEqual(13);
    const b = diagramBounds(placed);
    expect(b.x >= 0 && b.y >= 0 && b.x + b.w <= 760 && b.y + b.h <= 600).toBe(true);
  });

  it("writes the diagram back as text Filow reads again the same way", () => {
    const lesson = randomDiagram(11);
    const items = lesson.steps.flatMap((s) => s.items.filter((i): i is DiagramItem => i.kind === "diagram"));
    const again = readDiagram(diagramText(items), newDiagramState());
    expect(again?.nodes.map((n) => n.text)).toEqual(items.flatMap((i) => i.nodes.map((n) => n.text)));
  });
});

describe("each part appears with its sentence", () => {
  it("a diagram written whole in the first step is shown box by box as the sentences name them", () => {
    const lesson = lessonWith([
      { say: "Every bill starts as a draft.", items: [{ kind: "diagram", mermaid: "flowchart TD\nA[Draft bill] --> B[Committee]\nB --> C[Floor vote]\nC --> D[President]" }] },
      { say: "A committee studies it first.", items: [{ kind: "note", text: "Most bills die here" }] },
      { say: "Then the whole chamber holds a floor vote.", items: [] },
      { say: "Finally the President signs or vetoes it.", items: [] },
    ]);
    const d = collectDiagram(lesson)!;
    expect(d.nodes.map((n) => `${n.id}@${n.step}`)).toEqual(["a@0", "b@1", "c@2", "d@3"]);
    expect(layoutBoard(lesson, 1, "wide").diagram?.links.map((l) => `${l.from}>${l.to}`)).toEqual(["a>b"]);
  });

  it("keeps the model's own order when it spread the diagram over its steps", () => {
    const lesson = lessonWith([
      { say: "The President signs at the end.", items: [{ kind: "diagram", mermaid: "flowchart TD\nA[Draft] --> B[Committee]" }] },
      { say: "Then the President.", items: [{ kind: "diagram", mermaid: "B --> C[President]" }] },
    ]);
    expect(collectDiagram(lesson)!.nodes.map((n) => n.step)).toEqual([0, 0, 1]);
  });

  it("shows messages and rows in order, never earlier than the one before", () => {
    const seq = lessonWith([
      { say: "The user signs in.", items: [{ kind: "diagram", mermaid: "sequenceDiagram\nU->>A: Sign in\nA->>G: Redirect\nG-->>A: Token" }] },
      { say: "Google gives the app a token.", items: [] },
      { say: "The app is redirected.", items: [] },
    ]);
    expect(collectDiagram(seq)!.links.map((l) => l.step)).toEqual([0, 2, 2]);
    const table = lessonWith([
      { say: "Compare mitosis and meiosis.", items: [{ kind: "diagram", mermaid: "| | Mitosis | Meiosis |\n| Divisions | 1 | 2 |\n| Daughter cells | 2 | 4 |" }] },
      { say: "Count the daughter cells.", items: [] },
    ]);
    expect(collectDiagram(table)!.rows.map((r) => r.step)).toEqual([0, 0, 1]);
  });

  it("matches words by their stem, in any language", () => {
    expect(mentions("La crisalide si apre", "Crisalidi")).toBe(true);
    expect(mentions("The leaf makes sugar", "Calvin cycle")).toBe(false);
  });
});

describe("the prompts teach the diagram step", () => {
  it("the online lesson: the system prompt names it, and a lesson that uses it arrives as diagram steps", async () => {
    let system = "";
    const answer = { topic: "How a bill becomes a law", title: "How a bill becomes a law", scene: "flow", steps: [
      { say: "A bill is written and introduced.", items: [{ kind: "diagram", mermaid: "flowchart TD\nA[Bill introduced] --> B{Committee approves?}" }] },
      { say: "If the committee approves, both chambers vote.", items: [{ kind: "diagram", mermaid: "B -->|yes| C[Both chambers vote]\nB -->|no| D[Bill dies]" }] },
    ] };
    const events: Array<{ type: string; step?: { items: Array<{ kind: string }> } }> = [];
    await generateCloud(async (call) => { system ||= call.system; return JSON.stringify(answer); }, { question: "How does a bill become a law?", lang: "en", maxSteps: 7 }, (e) => events.push(e as never));
    expect(system).toContain('"kind":"diagram"');
    expect(system).toContain("sequenceDiagram");
    const steps = events.filter((e) => e.type === "step");
    expect(steps.map((e) => e.step!.items.map((i) => i.kind).join(","))).toEqual(["diagram", "diagram"]);
  });

  it("the local lesson: the outline may choose a diagram, and the checked boxes and arrows are drawn as it", () => {
    expect(outlineSchema(5).properties.diagram.enum).toContain("mindmap");
    expect(validateOutline({ title: "T", diagram: "mindmap", steps: ["a"] })?.diagram).toBe("mindmap");
    expect(validateOutline({ title: "T", diagram: "pie", steps: ["a"] })?.diagram).toBeUndefined();
    const st = newDiagramState();
    const items = itemsAsDiagram([{ kind: "node", id: "cell", text: "Cell" }, { kind: "node", id: "nucleus", text: "Nucleus" }, { kind: "edge", from: "cell", to: "nucleus", text: "contains" }, { kind: "note", text: "n" }], "mindmap", st);
    expect(items[0]).toMatchObject({ kind: "diagram", type: "mindmap", nodes: [{ id: "cell" }, { id: "nucleus", parent: "cell" }], links: [{ from: "cell", to: "nucleus" }] });
    expect(items.map((i) => i.kind)).toEqual(["diagram", "note"]);
    // a later step of the same lesson adds to it; another type is left as it was
    expect(itemsAsDiagram([{ kind: "node", id: "x", text: "X" }], "sequence", st)[0].kind).toBe("node");
  });
});

describe("a diagram read back", () => {
  it("survives validation again (a follow-up, a saved board) and is checked like model output", () => {
    const lesson = lessonWith([
      { say: "Parts of a cell.", items: [{ kind: "diagram", mermaid: "mindmap\n  root((Cell))\n    Nucleus\n    Membrane" }] },
      { say: "The nucleus holds DNA.", items: [{ kind: "diagram", mermaid: "    Nucleus\n      DNA" }] },
    ]);
    const again = validateLesson(JSON.parse(JSON.stringify(lesson)), { maxSteps: 7 })!;
    expect(again.steps.map((s) => s.items)).toEqual(lesson.steps.map((s) => s.items));
    const forged = validateLesson({ title: "T", steps: [{ say: "x", items: [{ kind: "diagram", type: "flowchart", nodes: [{ id: "a", text: "<script>A</script>", shape: "star" }, { id: "b", text: "B" }], links: [{ from: "a", to: "zzz" }, { from: "a", to: "b", text: "ok" }] }] }] })!;
    expect(forged.steps[0].items[0]).toEqual({ kind: "diagram", type: "flowchart", dir: "TD", nodes: [{ id: "a", text: "A", shape: "box" }, { id: "b", text: "B", shape: "box" }], links: [{ from: "a", to: "b", text: "ok" }], rows: [] });
  });
});
