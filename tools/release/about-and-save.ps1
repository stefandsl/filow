# Windows PowerShell 5.1, interactive desktop and Node 22. See docs/RELEASE-CHECKLIST.md.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Work,
    [Parameter(Mandatory)][string]$Checkout,
    [Parameter(Mandatory)][string]$PackageDir,
    [Parameter(Mandatory)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{40}$')][string]$SourceSha,
    [ValidateRange(1024,65531)][int]$BasePort = 17443
)
$ErrorActionPreference = 'Stop'
if ((Get-PSDrive -Name C).Free -lt 20GB) { throw 'C: has less than 20 GB free' }

function Get-LocalPath([string]$Value) {
    $full = [IO.Path]::GetFullPath($ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Value))
    if ($full -notmatch '^G:\\') { throw 'Use paths on G: for this acceptance run' }
    return $full
}
$Work = Get-LocalPath $Work
$Checkout = Get-LocalPath $Checkout
$PackageDir = Get-LocalPath $PackageDir
# A junction below G: must not redirect the synthetic home or evidence onto another volume.
for ($dir = [IO.DirectoryInfo]$Work; $null -ne $dir; $dir = $dir.Parent) {
    if ($dir.Exists -and ($dir.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Redirected work directory: $dir" }
}
$exe = Join-Path $PackageDir 'Filow.exe'
$asar = Join-Path $PackageDir 'resources\app.asar'
if (!(Test-Path -LiteralPath $exe -PathType Leaf) -or !(Test-Path -LiteralPath $asar -PathType Leaf) -or
    !(Test-Path -LiteralPath (Join-Path $PackageDir 'resources\app\node_modules\next') -PathType Container)) {
    throw 'Expected unpacked Windows Filow, app.asar and the standalone Next.js server'
}
$head = & git --no-optional-locks -C $Checkout rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $head -cne $SourceSha) { throw 'Checkout HEAD differs from the requested SHA' }

$node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
$run = Join-Path $Work ('about-save-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($run) | Out-Null
Write-Output "Packaged acceptance evidence: $run"
$profileDir = Join-Path $run 'home'
$data = Join-Path $run 'filow'
$roaming = Join-Path $profileDir 'AppData\Roaming'
$local = Join-Path $profileDir 'AppData\Local'
$tempDir = Join-Path $local 'Temp'
foreach ($dir in @($roaming, $tempDir, (Join-Path $profileDir 'Documents'), (Join-Path $profileDir 'Desktop'), $data)) {
    [IO.Directory]::CreateDirectory($dir) | Out-Null
}
$inputs = @{version=$Version; sourceSha=$SourceSha; checkout=$Checkout; packageDir=$PackageDir; basePort=$BasePort}
[IO.File]::WriteAllText((Join-Path $run 'inputs.json'), ($inputs | ConvertTo-Json))
$settings = @{welcomeCompleted=$true; localAiOffered=$true; firewallOffered=$true; pptAsked=$true; remoteShareChosen=$true; remoteShare=$false; okFilow=@{enabled=$false; wakeWord=$false}; lang='en'; theme='light'}
[IO.File]::WriteAllText((Join-Path $data 'settings.json'), ($settings | ConvertTo-Json))
$log = Join-Path $data 'startup.log'
$helper = Join-Path $PSScriptRoot 'acceptance-ui.mjs'
$ports = $BasePort..($BasePort + 4)
if ($ports | Where-Object { $_ -in 4747,4748,11434 }) { throw 'Choose dedicated acceptance ports' }

# Use a separate PowerShell process so a blocked Windows UI Automation provider also has a deadline.
$uiChecks = {
    $ErrorActionPreference = 'Stop'
    $work = (Get-Location).Path
    Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $a = [System.Windows.Automation.AutomationElement]
    $scope = [System.Windows.Automation.TreeScope]
    function Property($key, $value) { New-Object System.Windows.Automation.PropertyCondition($key, $value) }
    function PageAction($action) {
        [IO.File]::WriteAllText((Join-Path $work 'stage.txt'), $action)
        & $env:FILOW_ACCEPTANCE_NODE $env:FILOW_ACCEPTANCE_UI $action $work
        if ($LASTEXITCODE -ne 0) { throw "Packaged page check failed at $action" }
    }
    function BrowserInventory {
        $names = 'chrome','msedge','firefox','brave','opera','vivaldi','browser'
        $ids = @(Get-Process -Name $names -ErrorAction SilentlyContinue | ForEach-Object Id)
        $wins = $root.FindAll($scope::Children, [System.Windows.Automation.Condition]::TrueCondition)
        $tab = Property $a::ControlTypeProperty ([System.Windows.Automation.ControlType]::TabItem)
        foreach ($w in $wins) {
            if ($w.Current.ProcessId -in $ids) {
                # UIA exposes tab counts even in a pre-existing browser. Do not record other people's tab titles.
                '{0}/{1}/{2}' -f $w.Current.ProcessId,$w.Current.NativeWindowHandle,$w.FindAll($scope::Descendants,$tab).Count
            }
        }
    }
    PageAction about
    $before = @(BrowserInventory | Sort-Object)
    [IO.File]::WriteAllLines((Join-Path $work 'browser-before.txt'), [string[]]$before)
    PageAction save
    $owner = Property $a::ProcessIdProperty ([int]$env:FILOW_ACCEPTANCE_PID)
    $class = Property $a::ClassNameProperty '#32770'
    $condition = New-Object System.Windows.Automation.AndCondition($owner,$class)
    $until = [DateTime]::UtcNow.AddSeconds(15)
    do {
        $dialog = $root.FindFirst($scope::Children,$condition)
        if (!$dialog) {
            foreach ($window in $root.FindAll($scope::Children,$owner)) {
                $dialog = $window.FindFirst($scope::Descendants,$condition)
                if ($dialog) { break }
            }
        }
        if (!$dialog) { Start-Sleep -Milliseconds 150 }
    } until ($dialog -or [DateTime]::UtcNow -gt $until)
    if (!$dialog) { throw 'Native report Save dialog missing' }
    $save = $dialog.FindFirst($scope::Descendants, (Property $a::AutomationIdProperty '1'))
    if (!$save -or !$save.Current.NativeWindowHandle) { throw 'Save dialog button missing' }
    # Accept the suggested file in the new profile's Documents directory.
    # Native shell buttons can expose an HWND without the UIA Invoke pattern.
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class SaveDialogInput {
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr param, IntPtr data);
}
"@
    if (![SaveDialogInput]::PostMessage([IntPtr]$save.Current.NativeWindowHandle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'Could not click Save' }
    PageAction saved
    $after = @(BrowserInventory | Sort-Object)
    [IO.File]::WriteAllLines((Join-Path $work 'browser-after.txt'), [string[]]$after)
    if (($before -join ',') -cne ($after -join ',')) { throw 'Browser windows or accessible tabs changed during Save' }
}

$savedEnv = [Environment]::GetEnvironmentVariables()
$result = @{passed=$false; version=$Version; sourceSha=$SourceSha; profile=$profileDir; executable=$exe}
$app = $null
$ui = $null
try {
    # Keep the Windows system environment, omit credentials, launcher overrides and paths to personal data.
    foreach ($key in $savedEnv.Keys) {
        if ($key -notmatch '^(Path|PATHEXT|SystemDrive|SystemRoot|windir|COMPUTERNAME|ComSpec|OS|ProgramFiles(?:\(x86\))?|ProgramW6432|CommonProgramFiles(?:\(x86\))?|PROCESSOR_\w+|NUMBER_OF_PROCESSORS|PSModulePath)$') {
            [Environment]::SetEnvironmentVariable($key,$null)
        }
    }
    $env:USERPROFILE = $profileDir
    $env:HOME = $profileDir
    $env:HOMEDRIVE = [IO.Path]::GetPathRoot($profileDir).TrimEnd('\')
    $env:HOMEPATH = $profileDir.Substring($env:HOMEDRIVE.Length)
    $env:APPDATA = $roaming
    $env:LOCALAPPDATA = $local
    $env:TEMP = $env:TMP = $env:TMPDIR = $tempDir
    $env:PSModuleAnalysisCachePath = Join-Path $local 'PSModuleAnalysisCache'
    $env:XDG_CACHE_HOME = Join-Path $local 'cache'
    $env:FILOW_USER_DATA_DIR = $data
    $env:FILOW_OFFLINE = $env:NEXT_TELEMETRY_DISABLED = '1'
    $env:ELECTRON_LOG_FILE = Join-Path $run 'chromium.log'
    $env:FILOW_PORT = [string]$ports[0]
    $env:FILOW_SESSION_PORT = [string]$ports[1]
    $env:FILOW_HTTPS_PORT = [string]$ports[2]
    $env:OLLAMA_URL = "http://127.0.0.1:$($ports[4])"

    & $node $helper identity $run
    if ($LASTEXITCODE -ne 0) { throw 'Package metadata check failed' }
    $result.asarSha256 = (Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash
    $listeners = [Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    if ($listeners | Where-Object { $_.Port -in $ports }) { throw 'One or more acceptance ports are in use' }
    $app = Start-Process -FilePath $exe -WorkingDirectory $run -PassThru `
        -ArgumentList @('--enable-logging=file', "--remote-debugging-port=$($ports[3])") -RedirectStandardOutput (Join-Path $run 'app.stdout.log') -RedirectStandardError (Join-Path $run 'app.stderr.log')
    $result.pid = $app.Id
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    do {
        Start-Sleep -Milliseconds 300
        $app.Refresh()
        if ($app.HasExited) { throw "Packaged app exited before startup ($($app.ExitCode))" }
        $startup = if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Raw } else { '' }
        if ($startup -match 'startup failed') { throw 'Startup failure in packaged log' }
    } until ($startup -match 'main window shown' -or [DateTime]::UtcNow -gt $deadline)
    if ($startup -notmatch 'main window shown') { throw 'Packaged main window timed out' }
    foreach ($port in @($ports[0], $ports[1], $ports[3])) {
        $owners = @(Get-NetTCPConnection -State Listen -LocalPort $port | Select-Object -ExpandProperty OwningProcess -Unique)
        if ($owners.Count -ne 1 -or $owners[0] -ne $app.Id) { throw "Unexpected listener on $port" }
    }
    $env:FILOW_ACCEPTANCE_NODE = $node
    $env:FILOW_ACCEPTANCE_UI = $helper
    $env:FILOW_ACCEPTANCE_PID = [string]$app.Id
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($uiChecks.ToString()))
    $ui = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -WorkingDirectory $run -PassThru -WindowStyle Hidden `
        -ArgumentList "-NoProfile -NonInteractive -STA -EncodedCommand $encoded" -RedirectStandardOutput (Join-Path $run 'ui.stdout.log') -RedirectStandardError (Join-Path $run 'ui.stderr.log')
    # Retain the process handle before waiting so Windows PowerShell can read ExitCode.
    $null = $ui.Handle
    if (!$ui.WaitForExit(120000)) { throw 'Packaged UI or native dialog timed out' }
    $result.uiExit = $ui.ExitCode
    if ($ui.ExitCode -ne 0) { throw 'About or Save failed. See stage.txt and ui.stderr.log in the evidence directory.' }
    $startup = Get-Content -LiteralPath $log -Raw
    if ($app.HasExited -or $startup -notmatch 'report: saved to a file the user picked' -or $startup -match 'startup failed|report: .*GitHub issue') {
        throw 'Unexpected startup, Save or external browser activity in packaged log'
    }
    $result.savedReport = [IO.File]::ReadAllText((Join-Path $run 'saved-path.txt'))
    $result.savedReportSha256 = (Get-FileHash -LiteralPath $result.savedReport -Algorithm SHA256).Hash
    $result.screenshot = Join-Path $run 'saved.png'
    $result.screenshotSha256 = (Get-FileHash -LiteralPath $result.screenshot -Algorithm SHA256).Hash
    $result.startupLog = $log
    $result.passed = $true
} finally {
    try {
        $cleanupFailed = $false
        foreach ($proc in @($ui,$app)) {
            if ($proc -and !$proc.HasExited) {
                & taskkill.exe /PID $proc.Id /T /F | Out-Null
                if ($LASTEXITCODE -ne 0 -and !$proc.HasExited) { $cleanupFailed = $true }
            }
        }
        # A crashing main process can leave Crashpad or a renderer behind. Match its executable and this unique run.
        if ($app) {
            $orphans = Get-CimInstance Win32_Process -Filter "Name='Filow.exe'" | Where-Object {
                $_.ExecutablePath -eq $exe -and $_.CommandLine -and $_.CommandLine.IndexOf("$run\", [StringComparison]::OrdinalIgnoreCase) -ge 0
            }
            foreach ($orphan in $orphans) {
                $child = Get-Process -Id $orphan.ProcessId -ErrorAction SilentlyContinue
                if ($child -and $child.Path -eq $exe -and [Math]::Abs(($child.StartTime.ToUniversalTime() - $orphan.CreationDate.ToUniversalTime()).TotalMilliseconds) -lt 1) {
                    try { $child.Kill() } catch { if (!$child.HasExited) { throw } }
                    if (!$child.WaitForExit(5000)) { $cleanupFailed = $true }
                }
            }
        }
        if ($cleanupFailed) { throw 'Could not stop all acceptance processes' }
    } catch {
        $result.passed = $false
        throw
    } finally {
        foreach ($key in [Environment]::GetEnvironmentVariables().Keys) {
            if (!$savedEnv.ContainsKey($key)) { [Environment]::SetEnvironmentVariable($key,$null) }
        }
        foreach ($key in $savedEnv.Keys) { [Environment]::SetEnvironmentVariable($key,$savedEnv[$key]) }
        [IO.File]::WriteAllText((Join-Path $run 'result.json'), ($result | ConvertTo-Json))
    }
}
Write-Output "Packaged About and Save passed for $Version ($SourceSha). Evidence: $run"
