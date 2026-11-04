import { expect, it } from "vitest";
import { applyLayout, layoutForTheme } from "./layout";
import { applyUiPreferences } from "./applyUiPreferences";
import { vi } from "vitest";
it("switches the same root with explicit and resolved system themes", () => {
  const doc = { documentElement: { dataset: {}, toggleAttribute() {}, style: {removeProperty() {}} } } as unknown as Document;
  expect(layoutForTheme("dark")).toBe("rail"); expect(layoutForTheme("light")).toBe("sidebar");
  applyLayout(doc, "dark"); expect(doc.documentElement.dataset.layout).toBe("rail");
  vi.stubGlobal("document", doc);
  for (const theme of ["light", "dark", "light"] as const) {
    applyUiPreferences({resolvedTheme:theme,resolvedLang:"en",accentColor:null});
    expect(doc.documentElement.dataset.layout).toBe(layoutForTheme(theme));
  }
  vi.unstubAllGlobals();
});
