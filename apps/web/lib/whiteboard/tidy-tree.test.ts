import { describe, expect, it } from "vitest";
import { tidyTree, TreeNode } from "./tidy-tree";

/** A small seeded generator, so a failing tree can be rebuilt from its seed. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

function randomTree(seed: number): { root: TreeNode; all: TreeNode[] } {
  const r = rng(seed);
  const all: TreeNode[] = [];
  const make = (depth: number, y: number): TreeNode => {
    const h = 20 + Math.floor(r() * 40);
    const kids = depth < 4 ? Array.from({ length: Math.floor(r() * (depth ? 3 : 5)) }, () => make(depth + 1, y + h + 30)) : [];
    const node = new TreeNode(40 + Math.floor(r() * 120), h, y, kids, all.length);
    all.push(node);
    return node;
  };
  return { root: make(0, 0), all };
}

describe("tidy tree (from Plait)", () => {
  it("never lets two boxes overlap, and sets each parent over its children (300 random trees)", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { root, all } = randomTree(seed);
      tidyTree(root);
      for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j];
        const apart = a.x + a.width <= b.x + 1e-6 || b.x + b.width <= a.x + 1e-6 || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(apart, `seed ${seed}: boxes ${a.index} and ${b.index} overlap`).toBe(true);
      }
      for (const t of all) if (t.children.length) {
        const first = t.children[0], last = t.children[t.children.length - 1];
        expect(Math.abs(t.x + t.width / 2 - (first.x + last.x + last.width) / 2)).toBeLessThan(1e-6);
      }
    }
  });

  it("keeps the children in their order", () => {
    const kids = [0, 1, 2].map((i) => new TreeNode(50, 20, 50, [], i + 1));
    const root = new TreeNode(60, 20, 0, kids, 0);
    tidyTree(root);
    expect(kids[0].x).toBeLessThan(kids[1].x);
    expect(kids[1].x).toBeLessThan(kids[2].x);
  });
});

