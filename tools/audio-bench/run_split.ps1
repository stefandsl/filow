# Enhances one split with every engine named, then runs Filow's recognizer over each arm.
# At most 4 threads at a time: the onnxruntime engines run 4 single-thread processes side by side,
# then the external ones, then the recognizer runs one arm at a time (2 processes x 2 threads).
# Usage: run_split.ps1 -Split dev -Engines gtcrn,dtln,dpdfnet2,dpdfnet2_48k,rnnoise,dfn3,dfn3_ll [-Use questions] [-SkipRaw]
param([string]$Split = 'dev', [string[]]$Engines = @(), [string]$Use = 'questions', [switch]$SkipRaw, [switch]$SkipEnhance)
$work = 'G:\FILOW\tmp\mic-cleanup'
$py = "$work\venv\Scripts\python.exe"
$env:TEMP = "$work\cache\tmp"; $env:TMP = "$work\cache\tmp"; $env:PYTHONIOENCODING = 'utf-8'
$Engines = @($Engines | ForEach-Object { $_ -split ',' } | Where-Object { $_ })  # -File passes a,b,c as one string
Set-Location $PSScriptRoot
$log = "$work\logs\run-$Split-$Use.log"
function Say($m) { Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) -Encoding UTF8 }
Say "start split=$Split engines=$($Engines -join ',') cpu=$((Get-CimInstance Win32_Processor).LoadPercentage)% freeGB=$([math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB,1))"
if (-not $SkipEnhance) {
  $onnx = $Engines | Where-Object { $_ -in 'gtcrn', 'dtln', 'dpdfnet2', 'dpdfnet2_48k' }
  $ext = $Engines | Where-Object { $_ -in 'rnnoise', 'dfn3', 'dfn3_ll' }
  foreach ($group in @(, $onnx) + @(, $ext)) {
    if (-not $group) { continue }
    $group = @($group | Where-Object { -not (Test-Path "$work\results\enh-$_-$Split.csv") })  # finished engines are kept
    if (-not $group) { continue }
    $procs = foreach ($e in $group) {
      $script = if ($e -in 'rnnoise', 'dfn3', 'dfn3_ll') { 'external.py' } else { 'enhance.py' }
      Start-Process -FilePath $py -ArgumentList @('-I', $script, 'run', $e, $Split) -NoNewWindow -PassThru -RedirectStandardOutput "$work\logs\enh-$e-$Split.out" -RedirectStandardError "$work\logs\enh-$e-$Split.err"
    }
    $procs | Wait-Process
    foreach ($e in $group) { Say ("enh $e : " + (Get-Content "$work\logs\enh-$e-$Split.out" -Tail 1)) }
  }
}
$arms = @(); if (-not $SkipRaw) { $arms += 'raw' }; $arms += $Engines
foreach ($a in $arms) {
  # other agents share this PC: wait while free memory is under 6 GB (at most 15 minutes)
  for ($i = 0; $i -lt 15 -and (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB -lt 6; $i++) { Say 'waiting for memory'; Start-Sleep -Seconds 60 }
  $t = Get-Date
  $o = & $py -I run_asr.py $a $Split $Use 2 2 2>&1 | Select-Object -Last 1
  Say ("asr $a : $o ({0:N0} s, cpu {1}%)" -f ((Get-Date) - $t).TotalSeconds, (Get-CimInstance Win32_Processor).LoadPercentage)
}
Say 'finished'
