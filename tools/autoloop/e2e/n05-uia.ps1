# Run against one visible, isolated Filow QA process. Steps and the receipt are private files.
param(
  [Parameter(Mandatory)][int]$ProcessId,
  [Parameter(Mandatory)][string]$ExpectedExe,
  [Parameter(Mandatory)][string]$Steps,
  [Parameter(Mandatory)][string]$Receipt
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$app = Get-Process -Id $ProcessId
if ($app.Path -ne (Resolve-Path -LiteralPath $ExpectedExe).Path -or !$app.MainWindowHandle) { throw 'Window identity mismatch' }
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
