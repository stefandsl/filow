// OK Filow: the text selected in the focused app (docs/OKFILOW-GAUNTLET.md row 8), read through
// Windows UI Automation (TextPattern). No synthetic Ctrl+C: that would interrupt a terminal and
// overwrite the clipboard. Apps without a text pattern simply give nothing.
const { execFile } = require("node:child_process");

const SCRIPT = [
  "$ErrorActionPreference='Stop'",
  "[Console]::OutputEncoding=[Text.Encoding]::UTF8",
  "Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes",
  "$e=[System.Windows.Automation.AutomationElement]::FocusedElement",
  "$p=$null",
  "if($e -and $e.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern,[ref]$p)){",
  "  $r=$p.GetSelection()",
  "  if($r.Length -gt 0){ [Console]::Out.Write($r[0].GetText(4000)) }",
  "}",
].join("\n");

/** Cleans what UI Automation returned: trimmed, capped, empty when it is only whitespace. */
function cleanSelection(raw, max = 2000) {
  const t = String(raw || "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Resolves the focused app's selected text, or "" (not Windows, no pattern, timeout). */
function readSelection(timeoutMs = 1500) {
  if (process.platform !== "win32") return Promise.resolve("");
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT],
      { windowsHide: true, timeout: timeoutMs, maxBuffer: 1 << 20, encoding: "utf8" },
      (err, stdout) => resolve(err ? "" : cleanSelection(stdout)),
    );
  });
}

module.exports = { readSelection, cleanSelection };
