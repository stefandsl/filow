// Non-layered tidy tree layout (A. van der Ploeg, "Drawing non-layered tidy trees in linear time"),
// copied from Plait (packages/layouts/src/algorithms/non-layerd-tidy-tree-layout.ts and
// interfaces/layout-tree-node.ts, https://github.com/worktile/plait, commit e0d76b0), the layout
// library of Drawnix's mind maps. MIT License, Copyright (c) 2018 - 2023 Worktile Inc.; the full
// notice is in scripts/third-party-notices.mjs (THIRD_PARTY_NOTICES.md). Changes: typed for strict
// TypeScript, the Plait origin node replaced by an index, comments shortened.
//
// Input: every node's breadth (`width`, gap included), depth extent (`height`) and depth position
// (`y`). Output: `x` of each node such that no two subtrees overlap and parents sit over their children.

export class TreeNode {
  x = 0;
  preliminary = 0;
  modifier = 0;
  shift = 0;
  change = 0;
  tl: TreeNode | null = null;
  tr: TreeNode | null = null;
  el: TreeNode | null = null;
  er: TreeNode | null = null;
  msel = 0;
  mser = 0;
  readonly childrenCount: number;
  constructor(public width: number, public height: number, public y: number, public children: TreeNode[], public index: number) {
    this.childrenCount = children.length;
  }
}

function setExtremes(tree: TreeNode) {
  if (tree.childrenCount === 0) {
    tree.el = tree;
    tree.er = tree;
    tree.msel = tree.mser = 0;
  } else {
    tree.el = tree.children[0].el;
    tree.msel = tree.children[0].msel;
    tree.er = tree.children[tree.childrenCount - 1].er;
    tree.mser = tree.children[tree.childrenCount - 1].mser;
  }
}

const bottom = (tree: TreeNode) => tree.y + tree.height;

/** A linked list of the indexes of left siblings and their lowest vertical coordinate. */
class IYL {
  constructor(public lowY: number, public index: number, public next: IYL | null) {}
}

function updateIYL(minY: number, i: number, ih: IYL | null) {
  // remove siblings that are hidden by the new subtree
  while (ih !== null && minY >= ih.lowY) ih = ih.next;
  return new IYL(minY, i, ih);
}

function distributeExtra(tree: TreeNode, i: number, si: number, distance: number) {
  if (si !== i - 1) {
    const nr = i - si;
    tree.children[si + 1].shift += distance / nr;
    tree.children[i].shift -= distance / nr;
    tree.children[i].change -= distance - distance / nr;
  }
}

function moveSubtree(tree: TreeNode, i: number, si: number, distance: number) {
  tree.children[i].modifier += distance;
  tree.children[i].msel += distance;
  tree.children[i].mser += distance;
  distributeExtra(tree, i, si, distance);
}

const nextLeftContour = (tree: TreeNode) => (tree.childrenCount === 0 ? tree.tl : tree.children[0]);
const nextRightContour = (tree: TreeNode) => (tree.childrenCount === 0 ? tree.tr : tree.children[tree.childrenCount - 1]);

function setLeftThread(tree: TreeNode, i: number, cl: TreeNode, modsumcl: number) {
  const li = tree.children[0].el as TreeNode;
  li.tl = cl;
  const diff = modsumcl - cl.modifier - tree.children[0].msel;
  li.modifier += diff;
  li.preliminary -= diff;
  tree.children[0].el = tree.children[i].el;
  tree.children[0].msel = tree.children[i].msel;
}

function setRightThread(tree: TreeNode, i: number, sr: TreeNode, modsumsr: number) {
  const ri = tree.children[i].er as TreeNode;
  ri.tr = sr;
  const diff = modsumsr - sr.modifier - tree.children[i].mser;
  ri.modifier += diff;
  ri.preliminary -= diff;
  tree.children[i].er = tree.children[i - 1].er;
  tree.children[i].mser = tree.children[i - 1].mser;
}

function separate(tree: TreeNode, i: number, ih: IYL) {
  let sr: TreeNode | null = tree.children[i - 1];
  let mssr = sr.modifier;
  let cl: TreeNode | null = tree.children[i];
  let mscl = cl.modifier;
  while (sr !== null && cl !== null) {
    if (bottom(sr) > ih.lowY) ih = ih.next as IYL;
    const distance = mssr + sr.preliminary + sr.width - (mscl + cl.preliminary);
    if (distance > 0) {
      mscl += distance;
      moveSubtree(tree, i, ih.index, distance);
    }
    const sy = bottom(sr);
    const cy = bottom(cl);
    if (sy <= cy) {
      sr = nextRightContour(sr);
      if (sr !== null) mssr += sr.modifier;
    }
    if (sy >= cy) {
      cl = nextLeftContour(cl);
      if (cl !== null) mscl += cl.modifier;
    }
  }
  if (sr === null && cl !== null) setLeftThread(tree, i, cl, mscl);
  else if (sr !== null && cl === null) setRightThread(tree, i, sr, mssr);
}

function positionRoot(tree: TreeNode) {
  const first = tree.children[0];
  const last = tree.children[tree.childrenCount - 1];
  tree.preliminary = (first.preliminary + first.modifier + last.modifier + last.preliminary + last.width) / 2 - tree.width / 2;
}

function firstWalk(tree: TreeNode) {
  if (tree.childrenCount === 0) {
    setExtremes(tree);
    return;
  }
  firstWalk(tree.children[0]);
  let ih = updateIYL(bottom(tree.children[0].el as TreeNode), 0, null);
  for (let i = 1; i < tree.childrenCount; i++) {
    firstWalk(tree.children[i]);
    const minY = bottom(tree.children[i].er as TreeNode);
    separate(tree, i, ih);
    ih = updateIYL(minY, i, ih);
  }
  positionRoot(tree);
  setExtremes(tree);
}

function addChildSpacing(tree: TreeNode) {
  let d = 0;
  let modsumdelta = 0;
  for (let i = 0; i < tree.childrenCount; i++) {
    d += tree.children[i].shift;
    modsumdelta += d + tree.children[i].change;
    tree.children[i].modifier += modsumdelta;
  }
}

function secondWalk(tree: TreeNode, modsum: number) {
  modsum += tree.modifier;
  tree.x = tree.preliminary + modsum;
  addChildSpacing(tree);
  for (let i = 0; i < tree.childrenCount; i++) secondWalk(tree.children[i], modsum);
}

/** Sets `x` on every node of the tree. */
export function tidyTree(tree: TreeNode): void {
  firstWalk(tree);
  secondWalk(tree, 0);
}
