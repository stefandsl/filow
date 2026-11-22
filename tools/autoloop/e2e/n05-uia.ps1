# Run against one visible, isolated Filow QA process. Steps and the receipt are private files.
[CmdletBinding(DefaultParameterSetName='Steps')]
param(
  [Parameter(Mandatory)][int]$ProcessId,
  [Parameter(Mandatory)][string]$ExpectedExe,
  [Parameter(Mandatory, ParameterSetName='Foreground')][long]$ExpectedHwnd,
  [Parameter(Mandatory, ParameterSetName='Steps')][string]$Steps,
  [Parameter(Mandatory, ParameterSetName='Steps')][string]$Receipt
)
$ErrorActionPreference = 'Stop'
$app = Get-Process -Id $ProcessId
if ($app.Path -ne (Resolve-Path -LiteralPath $ExpectedExe).Path -or $app.MainWindowHandle -eq [IntPtr]::Zero) { throw 'Window identity mismatch' }
if ($PSCmdlet.ParameterSetName -eq 'Foreground') {
  Add-Type -Namespace DailyReplay -Name NativeWindow -MemberDefinition @'
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern void SwitchToThisWindow(IntPtr hwnd, bool altTab);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hwnd);
'@
  $hwnd = $app.MainWindowHandle
  [uint32]$owner = 0
  [void][DailyReplay.NativeWindow]::GetWindowThreadProcessId($hwnd, [ref]$owner)
  if ($hwnd.ToInt64() -ne $ExpectedHwnd -or $owner -ne $ProcessId -or ![DailyReplay.NativeWindow]::IsWindowVisible($hwnd)) {
    throw 'Expected the visible main window of the isolated launch'
  }
  if ([DailyReplay.NativeWindow]::GetForegroundWindow() -ne $hwnd) {
    [DailyReplay.NativeWindow]::SwitchToThisWindow($hwnd, $true)
  }
  $timer = [Diagnostics.Stopwatch]::StartNew()
  do {
    $foreground = [DailyReplay.NativeWindow]::GetForegroundWindow()
    if ($foreground -eq $hwnd) { break }
    Start-Sleep -Milliseconds 50
  } while ($timer.Elapsed.TotalSeconds -lt 3)
  [uint32]$foregroundPid = 0
  [void][DailyReplay.NativeWindow]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
  [ordered]@{ foregroundHwnd = [string]$foreground.ToInt64(); foregroundPid = $foregroundPid } | ConvertTo-Json -Compress
  return
}
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
if (Test-Path -LiteralPath $Receipt) { throw 'A new receipt is required' }
if ([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($Receipt)) -ne 'G:\') { throw 'Use the private evidence volume' }
$root = [Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
$observations = @()
$record = [ordered]@{ pid = $ProcessId; hwnd = $app.MainWindowHandle.ToInt64(); start = (Get-Date).ToUniversalTime().ToString('o'); narrator = 'HOLD'; verdict = 'HOLD' }
try {
  $plan = Get-Content -LiteralPath $Steps -Raw -Encoding UTF8 | ConvertFrom-Json
  if (!$plan.steps.Count) { throw 'Missing UI Automation steps' }
  foreach ($step in $plan.steps) {
    $timer = [Diagnostics.Stopwatch]::StartNew()
    do {
      $matchesForStep = @($root.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition) | Where-Object {
        $_.Current.Name -ceq $step.name -and $_.Current.ControlType.ProgrammaticName -eq ('ControlType.' + $step.role) -and !$_.Current.IsOffscreen
      })
      if ($matchesForStep.Count -eq 1) { break }
      Start-Sleep -Milliseconds 100
    } while ($timer.Elapsed.TotalSeconds -lt 10)
    if ($matchesForStep.Count -ne 1) { throw 'Expected a unique visible named control' }
    $el = $matchesForStep[0]
    switch ($step.action) {
      'read' {}
      'invoke' { $el.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke() }
      'toggle' { $el.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern).Toggle() }
      'expand' { $el.GetCurrentPattern([Windows.Automation.ExpandCollapsePattern]::Pattern).Expand() }
      'set' { $el.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue([string]$step.value) }
      'focus' {
        $el.SetFocus()
        if (!$el.Current.HasKeyboardFocus) { throw 'Control did not receive keyboard focus' }
      }
      default { throw 'Unknown UI Automation action' }
    }
    $observations += [ordered]@{ action = $step.action; name = $step.name; role = $step.role; at = (Get-Date).ToUniversalTime().ToString('o') }
  }
  $record.verdict = 'PASS'
} finally {
  $record.end = (Get-Date).ToUniversalTime().ToString('o')
  $record.observations = $observations
  $stream = [IO.File]::Open($Receipt, [IO.FileMode]::CreateNew)
  $writer = New-Object IO.StreamWriter($stream)
  try { $writer.Write(($record | ConvertTo-Json -Depth 6)) } finally { $writer.Dispose() }
}
