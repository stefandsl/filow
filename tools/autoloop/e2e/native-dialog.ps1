# Native message boxes (Electron dialog.showMessageBox) are not reachable over CDP. This helper finds the
# visible dialog windows of one process, prints them as JSON (title, texts, buttons, rect), optionally saves
# a PNG of the dialog and optionally presses one of its buttons through UI Automation.
#
# Usage: powershell -NoProfile -File native-dialog.ps1 -ProcessId <pid> [-Shot <png>] [-Press <button index>] [-List]
# -List prints every top-level window of the process instead (diagnostics when the app seems stuck).
param([int]$ProcessId, [string]$Shot = "", [int]$Press = -1, [switch]$List)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
$top = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
if ($List) {
  foreach ($w in $top) { $r = $w.Current.BoundingRectangle; "$($w.Current.ClassName) '$($w.Current.Name)' offscreen=$($w.Current.IsOffscreen) $([int]$r.X),$([int]$r.Y) $([int]$r.Width)x$([int]$r.Height)" }
  exit 0
}
# A dialog with a parent window is listed under that window in UI Automation, not under the desktop.
$isDialog = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "#32770")
$wins = @()
foreach ($w in $top) {
  if ($w.Current.ClassName -eq "#32770") { $wins += $w } else { foreach ($c in $w.FindAll([System.Windows.Automation.TreeScope]::Children, $isDialog)) { $wins += $c } }
}
$out = @()
foreach ($w in $wins) {
  $texts = @(); $buttons = @()
  $all = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($e in $all) {
    $type = $e.Current.ControlType.ProgrammaticName
    if ($type -eq "ControlType.Text" -and $e.Current.Name) { $texts += $e.Current.Name }
    # Task dialogs (Electron on Windows) expose their buttons as panes of class CCPushButton.
    if (($type -eq "ControlType.Button" -or $e.Current.ClassName -match "^CC(PushButton|CommandLink)") -and $e.Current.Name) { $buttons += $e }
  }
  $r = $w.Current.BoundingRectangle
  if ($Shot) {
    $bmp = New-Object System.Drawing.Bitmap([int]$r.Width, [int]$r.Height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen([int]$r.X, [int]$r.Y, 0, 0, $bmp.Size)
    $bmp.Save($Shot, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
  }
  $out += [pscustomobject]@{ title = $w.Current.Name; texts = $texts; buttons = @($buttons | ForEach-Object { $_.Current.Name }); rect = @([int]$r.X, [int]$r.Y, [int]$r.Width, [int]$r.Height) }
  if ($Press -ge 0 -and $Press -lt $buttons.Count) {
    # TDM_CLICK_BUTTON (WM_USER + 102) to the task dialog: Electron numbers its buttons from 100
    # (message_box_win.cc kIDStart). Needs no focus, so a splash on top cannot swallow the press.
    Add-Type -Namespace T3 -Name User32 -MemberDefinition '[DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr h, uint m, System.IntPtr w, System.IntPtr l);'
    # A box opened with no buttons shows the common OK button instead (IDOK = 1).
    $id = if ($buttons.Count -eq 1) { 1 } else { 100 + $Press }
    [void][T3.User32]::PostMessage([System.IntPtr]$w.Current.NativeWindowHandle, 0x466, [System.IntPtr]$id, [System.IntPtr]::Zero)
  }
  break
}
if ($out.Count -eq 0) { "[]" } else { ConvertTo-Json -InputObject @($out) -Depth 4 -Compress }
