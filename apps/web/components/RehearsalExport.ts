// Saving what a take produced: the rehearsal report and the live screen notes share one way out
// (a Markdown file the browser downloads), so both land in the same folder with the same naming.

/** Download `md` as "<prefix>-YYYY-MM-DD-HH-MM-SS.md". */
export function downloadMarkdown(md: string, prefix: string): void {
  const blob = new Blob([md], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${prefix}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Print only the report (the browser's print dialog also offers "Save as PDF"). The class hides
 * everything but the printable copy in print (Rehearsal.css); the open report removes it after the
 * print and also sets it for Ctrl+P (RehearsalReport.tsx), so a print never shows the bare app.
 */
export function printReport(): void {
  document.body.classList.add("printing-report");
  window.print();
}