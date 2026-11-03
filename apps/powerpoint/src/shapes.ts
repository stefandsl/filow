// Reading text from shapes without tripping Office.js: loading `textFrame` on a shape that has
// none (pictures, groups, media) throws InvalidArgument on desktop PowerPoint. So: load the
// shape types first, then text frames only for shapes that can have one.
/* global PowerPoint */

export type ShapeText = { name: string; type: string; text: string; alt: string };

const TEXTLESS = new Set(["Image", "Group", "Media", "Graphic", "Line", "Unsupported", "Table", "Chart", "Ole", "Model3D", "SmartArt", "ContentApp"]);

/** Text, name, type and alt text of every shape on every slide, slide by slide. */
export async function readAllSlideShapes(ctx: PowerPoint.RequestContext): Promise<ShapeText[][]> {
  const all = ctx.presentation.slides;
  all.load("items");
  await ctx.sync();
  const perSlide = all.items.map((slide) => {
    const shapes = slide.shapes;
    shapes.load("items/name,items/type,items/altTextDescription");
    return shapes;
  });
  await ctx.sync();
  // Second pass: text frames only where allowed.
  const frames: Array<Array<{ sh: PowerPoint.Shape; tf: PowerPoint.TextFrame | null }>> = perSlide.map((shapes) =>
    shapes.items.map((sh) => {
      const type = String((sh as { type?: string }).type ?? "");
      if (TEXTLESS.has(type)) return { sh, tf: null };
      try {
        const tf = sh.textFrame;
        tf.load("hasText");
        return { sh, tf };
      } catch {
        return { sh, tf: null };
      }
    }),
  );
  await ctx.sync();
  const ranges: Array<Array<{ sh: PowerPoint.Shape; tr: PowerPoint.TextRange | null }>> = frames.map((list) =>
    list.map(({ sh, tf }) => {
      let has = false;
      try {
        has = Boolean(tf && tf.hasText);
      } catch {
        has = false;
      }
      if (!has || !tf) return { sh, tr: null };
      const tr = tf.textRange;
      tr.load("text");
      return { sh, tr };
    }),
  );
  await ctx.sync();
  return ranges.map((list) =>
    list.map(({ sh, tr }) => {
      let text = "";
      try {
        text = tr ? tr.text : "";
      } catch {
        text = "";
      }
      return {
        name: String(sh.name ?? ""),
        type: String((sh as { type?: string }).type ?? ""),
        text,
        alt: String((sh as { altTextDescription?: string }).altTextDescription ?? "").trim(),
      };
    }),
  );
}

/** Same for a notes slide collection (PowerPointApi 1.8); returns "" where unsupported. */
export async function readNotesTexts(ctx: PowerPoint.RequestContext): Promise<string[]> {
  const all = ctx.presentation.slides;
  all.load("items");
  await ctx.sync();
  const cols = all.items.map((slide) => {
    const any = slide as unknown as { notesSlide?: { shapes: PowerPoint.ShapeCollection } };
    try {
      if (!any.notesSlide) return null;
      const shapes = any.notesSlide.shapes;
      shapes.load("items/name,items/type");
      return shapes;
    } catch {
      return null;
    }
  });
  await ctx.sync();
  const frames = cols.map((shapes) =>
    shapes
      ? shapes.items
          .filter((sh) => {
            const name = (sh.name ?? "").toLowerCase();
            const type = String((sh as { type?: string }).type ?? "");
            return !TEXTLESS.has(type) && name.includes("notes");
          })
          .map((sh) => {
            try {
              const tf = sh.textFrame;
              tf.load("hasText");
              return tf;
            } catch {
              return null;
            }
          })
      : [],
  );
  await ctx.sync();
  const ranges = frames.map((list) =>
    list.map((tf) => {
      try {
        if (!tf || !tf.hasText) return null;
        const tr = tf.textRange;
        tr.load("text");
        return tr;
      } catch {
        return null;
      }
    }),
  );
  await ctx.sync();
  return ranges.map((list) =>
    list
      .map((tr) => {
        try {
          return tr ? tr.text : "";
        } catch {
          return "";
        }
      })
      .filter(Boolean)
      .join("\n"),
  );
}
