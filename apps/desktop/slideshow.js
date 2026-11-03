// Live slide-show following (README "Presenting with PowerPoint"). The PowerPoint JavaScript API
// cannot see a running show, but the desktop automation interfaces can: COM on Windows (the same
// channel Presenter View uses), AppleScript on macOS. A small helper process polls the current
// slide every 400 ms and prints one JSON line per change; main.js forwards it to the engine page
// as a slideChanged command. Nothing is written anywhere.
const { spawn } = require("node:child_process");

const WINDOWS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$last = ''
while ($true) {
  $line = '{"running":false}'
  try {
    $app = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application')
    if ($app -and $app.SlideShowWindows.Count -ge 1) {
      $win = $app.SlideShowWindows.Item(1)
      $s = $win.View.Slide
      $total = $win.Presentation.Slides.Count
      $title = ''
      try { if ($s.Shapes.HasTitle) { $title = $s.Shapes.Title.TextFrame.TextRange.Text } } catch {}
      $line = '{"running":true,"index":' + ($s.SlideIndex - 1) + ',"total":' + $total + ',"title":' + (ConvertTo-Json ([string]$title) -Compress) + '}'
    }
  } catch { $line = '{"running":false}' }
  if ($line -ne $last) { Write-Output $line; $last = $line }
  Start-Sleep -Milliseconds 400
}
`;

const MAC_SCRIPT = `
on esc(x)
  set o to ""
  repeat with c in (characters of x)
    set c to c as text
    if c is "\\\\" then
      set o to o & "\\\\\\\\"
    else if c is "\\"" then
      set o to o & "\\\\\\""
    else if c is return or c is linefeed or c is (ASCII character 11) then
      set o to o & " "
    else
      set o to o & c
    end if
  end repeat
  return o
end esc
tell application "System Events"
  if not (exists process "Microsoft PowerPoint") then return "{\\"running\\":false}"
end tell
tell application "Microsoft PowerPoint"
  try
    if (count of slide show windows) is 0 then return "{\\"running\\":false}"
    set v to slide show view of slide show window 1
    set s to slide of v
    set idx to (slide index of s) - 1
    set total to count of slides of active presentation
    set t to ""
    try
      set t to content of text range of text frame of (title shape of s)
    end try
    return "{\\"running\\":true,\\"index\\":" & idx & ",\\"total\\":" & total & ",\\"title\\":\\"" & my esc(t) & "\\"}"
  on error
    return "{\\"running\\":false}"
  end try
end tell
`;

/**
 * Start polling. `onChange({running, index, total, title})` fires on every change.
 * Returns a stop function. No-op on Linux (no PowerPoint).
 */
function watchSlideShow(onChange) {
  let last = "";
  const emit = (line) => {
    const text = String(line).trim();
    if (!text || text === last) return;
    last = text;
    try {
      onChange(JSON.parse(text));
    } catch {
      /* partial line */
    }
  };

  if (process.platform === "win32") {
    // Windows PowerShell 5.1 (not pwsh): GetActiveObject needs the .NET Framework runtime.
    const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_SCRIPT], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    let buf = "";
    p.stdout.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const l of lines) emit(l);
    });
    p.on("error", () => undefined);
    return () => {
      try {
        p.kill();
      } catch {
        /* gone */
      }
    };
  }

  if (process.platform === "darwin") {
    let stopped = false;
    const tick = () => {
      if (stopped) return;
      const p = spawn("osascript", ["-e", MAC_SCRIPT], { stdio: ["ignore", "pipe", "ignore"] });
      let out = "";
      p.stdout.on("data", (d) => (out += d.toString()));
      p.on("close", () => {
        emit(out);
        if (!stopped) setTimeout(tick, 500);
      });
      p.on("error", () => {
        if (!stopped) setTimeout(tick, 2000);
      });
    };
    tick();
    return () => {
      stopped = true;
    };
  }

  return () => undefined;
}

module.exports = { watchSlideShow };
