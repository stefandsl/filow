# Builds rnnoise_cli.exe from the pinned xiph/rnnoise tree (70f1d25) with the MSVC 2019 Build Tools
# already on this PC. The weights (src/rnnoise_data.c) come from the pinned model tarball. The build
# uses /arch:AVX2 for the whole library (no run-time CPU dispatch): fine for a measurement on this
# PC, a shipped build would need the dispatch files in src/x86 or an SSE baseline.
# Nothing is written outside G:\FILOW\tmp\mic-cleanup\build\rnnoise.
$ErrorActionPreference = 'Continue'
$work = 'G:\FILOW\tmp\mic-cleanup'
$src = "$work\models\src\rnnoise"
$data = "$work\models\rnnoise\unpacked\src"
$out = "$work\build\rnnoise"
New-Item -ItemType Directory -Force $out | Out-Null
$vcvars = 'C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
$files = @('denoise.c', 'rnn.c', 'pitch.c', 'kiss_fft.c', 'celt_lpc.c', 'nnet.c', 'nnet_default.c', 'parse_lpcnet_weights.c', 'rnnoise_tables.c') |
  ForEach-Object { "`"$src\src\$_`"" }
$cli = Join-Path $PSScriptRoot 'rnnoise_cli.c'
$cmd = "call `"$vcvars`" >nul && set TMP=$work\cache\tmp&& set TEMP=$work\cache\tmp&& cd /d `"$out`" && cl /nologo /O2 /arch:AVX2 /fp:fast /W0 /DRNNOISE_BUILD /D_CRT_SECURE_NO_WARNINGS /I`"$src\include`" /I`"$src\src`" /I`"$data`" $($files -join ' ') `"$data\rnnoise_data.c`" `"$cli`" /Fe:rnnoise_cli.exe > build.log 2>&1"
cmd /c $cmd
"exit code $LASTEXITCODE"
Get-Content "$out\build.log" -Tail 12
if (Test-Path "$out\rnnoise_cli.exe") { "{0} bytes, sha256 {1}" -f (Get-Item "$out\rnnoise_cli.exe").Length, (Get-FileHash "$out\rnnoise_cli.exe" -Algorithm SHA256).Hash.ToLower() }
