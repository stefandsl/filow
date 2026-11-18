# Repository successor of tmp/orchestrator/release.ps1.
# Preflight BEFORE pushing the tag. Draft AFTER CI. Smoke the draft on a clean runner. Publish LAST.
param([Parameter(Mandatory)][string]$Version,
      [Parameter(Mandatory)][ValidateSet('verify-main','preflight','tag','draft','publish')][string]$Stage,
      [Parameter(Mandatory)][string]$Work,
      [string]$Notes)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$verify = Join-Path $PSScriptRoot 'release-verify.mjs'
if ($Version -notmatch '\A(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\z') { throw 'Expected a stable version' }
$Work = [IO.Path]::GetFullPath($Work)
if ($Work.StartsWith('C:', [StringComparison]::OrdinalIgnoreCase)) { throw 'Release data must not be on C:' }
New-Item -ItemType Directory -Force $Work | Out-Null
$env:TEMP = Join-Path $Work 'temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force $env:TEMP | Out-Null
$state = Join-Path $Work 'preflight.json'
$verified = Join-Path $Work 'verified.json'
$assets = Join-Path $Work 'assets'
Set-Location $root
# Bound every external command, including uploads; kill only its process tree on timeout.
function Invoke-Bounded([string]$Exe, [string[]]$Arguments, [int]$Seconds = 300) {
  $out = Join-Path $Work ('command-' + [guid]::NewGuid() + '.out')
  $err = "$out.err"
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $Exe
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  # PowerShell 7 is required, for safe native argument handling.
  foreach ($arg in $Arguments) { $psi.ArgumentList.Add($arg) }
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $p = [Diagnostics.Process]::Start($psi)
  $stdout = $p.StandardOutput.ReadToEndAsync()
  $stderr = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit($Seconds * 1000)) { $p.Kill($true); $p.WaitForExit(); throw "Timeout: $Exe" }
  [IO.File]::WriteAllText($out, $stdout.Result)
  [IO.File]::WriteAllText($err, $stderr.Result)
  if ($p.ExitCode -ne 0) { throw "$Exe failed: $($stderr.Result) $($stdout.Result)" }
  return $stdout.Result
}
function Read-Evidence([string]$Path) {
  $evidence = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
  if ($evidence.version -isnot [string] -or $evidence.version -cne $Version) { throw 'Release evidence version mismatch' }
  if ($evidence.tagSha -isnot [string] -or $evidence.tagSha -cnotmatch '\A[0-9a-f]{40}\z') { throw 'Invalid release evidence SHA' }
  return $evidence
}
function Get-CleanCommit {
  $changes = git status --porcelain=v1 --untracked-files=all
  if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect working tree' }
  if ($changes) { throw 'Release verification requires a clean working tree' }
  $sha = git rev-parse --verify 'HEAD^{commit}'
  if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve release commit' }
  if ($sha -isnot [string] -or $sha -cnotmatch '\A[0-9a-f]{40}\z') { throw 'Invalid release commit SHA' }
  return $sha
}
if ($Stage -eq 'verify-main') {
  $sha = Get-CleanCommit
  $pkg = Get-Content -LiteralPath 'apps/desktop/package.json' -Raw | ConvertFrom-Json
  if ($pkg.version -cne $Version) { throw 'Commit the requested version bump before verification' }

  npx vitest run
  if ($LASTEXITCODE -ne 0) { throw 'Vitest failed' }
  npm run typecheck
  if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed' }
  npm run lint
  if ($LASTEXITCODE -ne 0) { throw 'Lint failed' }
  if ((Get-CleanCommit) -cne $sha) { throw 'HEAD changed during verification' }

  $record = @{ version = $Version; tagSha = $sha } | ConvertTo-Json
  New-Item -Path $verified -ItemType File -Value $record | Out-Null
  git push --no-follow-tags origin "${sha}:refs/heads/main"
  if ($LASTEXITCODE -ne 0) { throw 'Main push failed' }
  exit 0
}
if ($Stage -eq 'tag') {
  $saved = Read-Evidence $state
  $local = Read-Evidence $verified
  if ($saved.tagSha -cne $local.tagSha) { throw 'Preflight differs from the locally verified commit' }
  git push --no-follow-tags origin "$($saved.tagSha):refs/tags/v$Version"
  if ($LASTEXITCODE -ne 0) { throw 'Tag push failed' }
  exit 0
}
if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'Use PowerShell 7 (pwsh)' }
# Force the owner's stored gh login; do not accept a CI/token override accidentally.
if ($env:GH_TOKEN -or $env:GITHUB_TOKEN) { throw 'Unset GH_TOKEN/GITHUB_TOKEN; use the owner gh login' }
$login = (Invoke-Bounded 'gh' @('api','user','--jq','.login')).Trim()
if ($login -ne 'stefandsl') { throw "Expected owner gh login stefandsl, got $login" }
if ($Stage -eq 'preflight') {
  $local = Read-Evidence $verified
  Invoke-Bounded 'node' @($verify,'preflight','--version',$Version,'--commit',$local.tagSha,'--state',$state)
  exit 0
}
$saved = Read-Evidence $state
if ($Stage -eq 'draft') {
  if (-not $Notes -or -not (Test-Path $Notes)) { throw 'Provide the reviewed release notes' }
  if (Test-Path $assets) { throw 'Assets directory already exists; use a fresh work directory with saved preflight' }
  New-Item -ItemType Directory $assets | Out-Null
  Invoke-Bounded 'gh' @('release','download',"v$Version",'-R','stefandsl/filow','-D',$assets) 1200
  # Verification requires smoke evidence only at publication. The draft remains private until then.
  Invoke-Bounded 'node' @($verify,'verify','--version',$Version,'--state',$state,'--dir',$assets,'--work',(Join-Path $Work 'extract-draft'),'--phase','draft') 600
  $files = Get-ChildItem $assets -File | Where-Object { $_.Name -ne 'builder-debug.yml' -and $_.Name -ne 'smoke-result.json' } | ForEach-Object FullName
  Invoke-Bounded 'gh' (@('release','create',"v$Version",'-R','stefandsl/filow-releases','--draft','--latest=false','--title',"Filow $Version",'--notes-file',$Notes) + $files) 1200
  exit 0
}
# Download the actual drafted bytes into a new directory. No reuse of the source download.
$draft = Invoke-Bounded 'gh' @('release','view',"v$Version",'-R','stefandsl/filow-releases','--json','isDraft') | ConvertFrom-Json
if (-not $draft.isDraft) { throw 'Feed release must still be a draft' }
$publish = Join-Path $Work ('publish-' + [guid]::NewGuid())
New-Item -ItemType Directory $publish | Out-Null
Invoke-Bounded 'gh' @('release','download',"v$Version",'-R','stefandsl/filow-releases','-D',$publish) 1200
# Download smoke evidence from the source repo, produced by the default-token clean runner job.
Invoke-Bounded 'gh' @('release','download',"v$Version",'-R','stefandsl/filow','--pattern','smoke-result.json','-D',$publish) 300
Invoke-Bounded 'node' @($verify,'verify','--version',$Version,'--state',$state,'--dir',$publish,'--work',(Join-Path $publish 'extracted')) 600
# Last remote tag read immediately before changing feed visibility.
$now = (Invoke-Bounded 'gh' @('api',"repos/stefandsl/filow/commits/v$Version",'--jq','.sha')).Trim()
if ($now -ne $saved.tagSha) { throw 'Moved tag immediately before publish' }
Invoke-Bounded 'gh' @('release','edit',"v$Version",'-R','stefandsl/filow-releases','--draft=false','--latest=false')
Invoke-Bounded 'gh' @('release','edit',"v$Version",'-R','stefandsl/filow-releases','--latest')
$url = 'https://github.com/stefandsl/filow-releases/releases/latest/download/latest.yml'
$readback = Join-Path $Work 'feed-latest.yml'
Invoke-WebRequest -Uri $url -OutFile $readback -TimeoutSec 60
if ((Get-FileHash $readback -Algorithm SHA512).Hash -ne (Get-FileHash (Join-Path $publish 'latest.yml') -Algorithm SHA512).Hash) {
  throw 'LIVE FEED readback mismatch: follow the recall steps immediately'
}
'Published and read back the verified feed manifest'
