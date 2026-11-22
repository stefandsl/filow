# Read an already enabled process and Windows Filtering Platform audit for the operator's trial.
# A missing event source, listener or independent audit-coverage receipt leaves the verdict on HOLD.
param([Parameter(Mandatory)][string]$Journey, [Parameter(Mandatory)][string]$Receipt, [string]$Coverage)
$ErrorActionPreference = 'Stop'
if ([IO.Path]::GetPathRoot([IO.Path]::GetFullPath($Receipt)) -ne 'G:\' -or (Test-Path -LiteralPath $Receipt)) { throw 'Use a fresh private receipt on G:' }
$run = Get-Content -LiteralPath $Journey -Raw -Encoding UTF8 | ConvertFrom-Json
if (!$run.launches.Count) { throw 'Missing launch interval' }
function Read-Data($evt) {
  $fields = @{}
  foreach ($data in ([xml]$evt.ToXml()).Event.EventData.Data) { $fields[$data.Name] = [string]$data.'#text' }
  return $fields
}
function As-Pid($value) {
  if ($value -match '^0x') { return [Convert]::ToInt64($value.Substring(2),16) }
  return [int64]$value
}
$record = [ordered]@{ verdict = 'HOLD'; source = 'Windows Security audit'; sha = $run.sha; packageSha512 = $run.packageSha512; launches = @() }
try {
  foreach ($launch in $run.launches) {
    $start = [DateTimeOffset]::Parse($launch.start).LocalDateTime
    $end = [DateTimeOffset]::Parse($launch.end).LocalDateTime
    $events = @(Get-WinEvent -FilterHashtable @{LogName='Security'; Id=4688,4689,5152,5156,5157; StartTime=$start.AddSeconds(-2); EndTime=$end.AddSeconds(3)} -Oldest)
    $tree = @{}
    $pids = @()
    $attempts = @()
    foreach ($evt in $events) {
      $d = Read-Data $evt
      if ($evt.Id -eq 4688) {
        $child = As-Pid $d.NewProcessId
        $parent = As-Pid $d.ProcessId
        if (($child -eq $launch.pid -and [IO.Path]::GetFileName($d.NewProcessName) -ieq 'Filow.exe') -or $tree.ContainsKey($parent)) {
          $tree[$child] = $true
          $pids += [ordered]@{ pid=$child; parent=$parent; image=$d.NewProcessName; started=$evt.TimeCreated.ToUniversalTime().ToString('o') }
        }
        continue
      }
      $owner = As-Pid $d.ProcessID
      if (!$tree.ContainsKey($owner)) { continue }
      if ($evt.Id -eq 4689) { $tree.Remove($owner); continue }
      if ($d.Direction -ne '%%14593') { continue }
      $address = $null
      if (![Net.IPAddress]::TryParse($d.DestAddress,[ref]$address)) { throw 'Missing destination' }
      if ($address.IsIPv4MappedToIPv6) { $address = $address.MapToIPv4() }
      $loopback = [Net.IPAddress]::IsLoopback($address)
      $attempts += [ordered]@{ pid=$owner; event=$evt.Id; destination=$d.DestAddress; port=$d.DestPort; loopback=$loopback; at=$evt.TimeCreated.ToUniversalTime().ToString('o') }
    }
    $record.launches += [ordered]@{ root=$launch.pid; processes=$pids; attempts=$attempts; external=@($attempts | Where-Object { !$_.loopback }).Count; loopback=@($attempts | Where-Object { $_.loopback }).Count }
  }
  $record.reason = 'Independent process and network coverage is required.'
  if ($Coverage) {
    $proof = Get-Content -LiteralPath $Coverage -Encoding UTF8 -Raw | ConvertFrom-Json
    $complete = $proof.journeySha256 -eq (Get-FileHash -LiteralPath $Journey -Algorithm SHA256).Hash -and
      $proof.sourceSha -eq $run.sha -and $proof.packageSha512 -eq $run.packageSha512 -and
      $proof.launches.Count -eq $run.launches.Count
    for ($i = 0; $complete -and $i -lt $run.launches.Count; $i++) {
      $native = $record.launches[$i]
      $independent = $proof.launches[$i]
      $complete = $independent.root -eq $native.root -and
        [DateTimeOffset]::Parse($independent.start) -le [DateTimeOffset]::Parse($run.launches[$i].start) -and
        [DateTimeOffset]::Parse($independent.end) -ge [DateTimeOffset]::Parse($run.launches[$i].end) -and
        $independent.complete -eq $true -and $independent.lostEvents -eq 0 -and
        $independent.externalAttempts -eq 0 -and $independent.loopbackAttempts -gt 0 -and
        $native.external -eq 0 -and $native.loopback -gt 0 -and $native.processes.Count -gt 1 -and
        @((Compare-Object @($native.processes.pid | Sort-Object -Unique) @($independent.pids | Sort-Object -Unique))).Count -eq 0
    }
    if ($complete) { $record.verdict = 'PASS'; $record.reason = 'Independent coverage reconciled with process and filtering events.' }
    $record.coverageSha256 = (Get-FileHash -LiteralPath $Coverage -Algorithm SHA256).Hash
  }
} catch {
  $record.reason = 'Windows audit unavailable or incomplete.'
} finally {
  $stream = [IO.File]::Open($Receipt, [IO.FileMode]::CreateNew)
  $writer = New-Object IO.StreamWriter($stream)
  try { $writer.Write(($record | ConvertTo-Json -Depth 8)) } finally { $writer.Dispose() }
}
if ($record.verdict -ne 'PASS') { exit 1 }
