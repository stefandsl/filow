export type PrompterLayout = "rail" | "sidebar";
export function layoutForTheme(theme: "dark" | "light"): PrompterLayout { return theme === "dark" ? "rail" : "sidebar"; }
export function applyLayout(doc: Document, theme: "dark" | "light") { doc.documentElement.dataset.layout = layoutForTheme(theme); }
