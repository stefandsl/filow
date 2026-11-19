# Run ONLY on a disposable GitHub Windows runner. Never use a developer's installed app.
param([Parameter(Mandatory)][string]$Installer, [Parameter(Mandatory)][string]$SourceSha,
      [Parameter(Mandatory)][string]$Result)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') { throw 'Smoke requires a disposable GitHub Windows runner' }
$base = Join-Path $env:RUNNER_TEMP ('filow-smoke-' + [guid]::NewGuid())
$install = Join-Path $base 'install'
$profile = Join-Path $base 'profile'
New-Item -ItemType Directory -Force $profile | Out-Null
$env:FILOW_USER_DATA_DIR = $profile
$env:FILOW_PORT = '14747'
$env:FILOW_SESSION_PORT = '14748'
$env:FILOW_HTTPS_PORT = '14749'
$env:OLLAMA_URL = 'http://127.0.0.1:11435'
$log = Join-Path $profile 'startup.log'
$electronLog = Join-Path $base 'electron.log'
$report = @{ installed = $false; started = $false; exitCode = 1; sourceSha = $SourceSha;
  installerSha512 = [Convert]::ToBase64String([Security.Cryptography.SHA512]::HashData([IO.File]::ReadAllBytes($Installer))) }
$setup = $null
$app = $null
try {
  $setup = Start-Process -FilePath $Installer -ArgumentList @('/S', '/currentuser', "/D=$install") -PassThru -WindowStyle Hidden
  if (-not $setup.WaitForExit(180000)) { throw 'Installer timeout' }
  if ($setup.ExitCode -ne 0) { throw "Installer exit $($setup.ExitCode)" }
  $report.installed = Test-Path (Join-Path $install 'Filow.exe')
  if (-not $report.installed) { throw 'Installed Filow.exe missing' }
  $env:ELECTRON_ENABLE_LOGGING = '1'
  $env:ELECTRON_LOG_FILE = $electronLog
  $app = Start-Process -FilePath (Join-Path $install 'Filow.exe') -PassThru -WindowStyle Hidden
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  do {
    Start-Sleep -Seconds 2
    $app.Refresh()
    if ($app.HasExited) { throw "App exited before startup: $($app.ExitCode)" }
    # The welcome marker is emitted only after its renderer hydrates. A splash/error dialog alone is not a pass.
    $text = if (Test-Path $log) { Get-Content $log -Raw } else { '' }
    if ($text -match 'startup failed') { throw 'Startup failure in the installed app log' }
    $report.started = ($app.MainWindowHandle -ne 0) -and ($text -match 'welcome: window shown|first page loaded')
  } until ($report.started -or [DateTime]::UtcNow -gt $deadline)
  if (-not $report.started) { throw 'No startup window or loaded page before timeout' }
  Start-Sleep -Seconds 5
  $app.Refresh()
  if ($app.HasExited) { $report.started = $false; throw 'App exited immediately after its first window' }
  if ((Get-Content $log -Raw) -match 'startup failed') { $report.started = $false; throw 'Startup failed after its first window' }
  $report.exitCode = 0
} catch {
  # Report only fixed milestones and error categories. Raw logs can include URLs and credentials.
  $text = if (Test-Path $log) { Get-Content -LiteralPath $log -Raw }
  $milestones = [regex]::Matches([string]$text,
    'welcome: (?:loading|window shown)|startup: (?:loading servers|waiting for servers|servers answering|loading first page|first page loaded)|startup failed|CRASH (?:main|renderer|child)') |
    ForEach-Object Value | Select-Object -Last 12
  $native = if (Test-Path $electronLog) { Get-Content -LiteralPath $electronLog -Tail 100 }
  $errors = [regex]::Matches(($native -join "`n"), 'MODULE_NOT_FOUND|ERR_[A-Z_]{1,40}|GPU process exited unexpectedly|Uncaught (?:Error|TypeError|ReferenceError)') |
    ForEach-Object Value | Select-Object -Unique -First 8
  Write-Host "Smoke installed=$($report.installed) exited=$($app.HasExited) hwnd=$($app.MainWindowHandle) startupLog=$(Test-Path $log) electronLog=$(Test-Path $electronLog) crashpad=$(Test-Path (Join-Path $profile 'Crashpad'))"
  Write-Host "Startup milestones=[$($milestones -join ', ')] Electron errors=[$($errors -join ', ')]"
  throw
} finally {
  foreach ($p in @($app, $setup)) {
    if ($null -ne $p -and -not $p.HasExited) { & taskkill /PID $p.Id /T /F | Out-Null }
  }
  # Also catch a renderer orphaned by an early main-process exit, scoped to this random install directory.
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith("$install\", [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $report | ConvertTo-Json | Set-Content -LiteralPath $Result -Encoding utf8
}
