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
  $app = Start-Process -FilePath (Join-Path $install 'Filow.exe') -PassThru -WindowStyle Hidden
  $deadline = [DateTime]::UtcNow.AddSeconds(90)
  do {
    Start-Sleep -Seconds 2
    $app.Refresh()
    if ($app.HasExited) { throw "App exited before startup: $($app.ExitCode)" }
    $log = Join-Path $profile 'startup.log'
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
} finally {
  foreach ($p in @($app, $setup)) {
    if ($null -ne $p -and -not $p.HasExited) { & taskkill /PID $p.Id /T /F | Out-Null }
  }
  # Also catch a renderer orphaned by an early main-process exit, scoped to this random install directory.
  Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith("$install\", [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $report | ConvertTo-Json | Set-Content -LiteralPath $Result -Encoding utf8
}
