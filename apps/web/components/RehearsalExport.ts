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
 * Print only the report (the browser's print dialog also offers "Save as PDF"): while the dialog is
 * open the page carries a class that hides everything but the printable copy (Rehearsal.css).
 */
export function printReport(): void {
  const body = document.body;
  body.classList.add("printing-report");
  const done = () => {
    body.classList.remove("printing-report");
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
  // Some hosts print synchronously and never fire afterprint.
  setTimeout(done, 1000);
}
