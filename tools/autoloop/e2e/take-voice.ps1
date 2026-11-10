# Writes the spoken take used by tools/autoloop/e2e/take.mjs: an English System.Speech voice saying
# paraphrases (not the script's words) of the 3 points of section 1 of the default script, plus one
# off-topic sentence, as a 16 kHz mono 16-bit PCM WAV. Offline, no network.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File take-voice.ps1 -Out <path.wav> [-Lines <path.json>] [-Voice David] [-Rate -1]
param([Parameter(Mandatory = $true)][string]$Out, [string]$Lines = "", [string]$Voice = "", [int]$Rate = -1)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$english = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like "en-*" }
# (PowerShell names are case-insensitive: $speaker, not $voice, which is the [string] parameter)
# Default David: Nemotron transcribes it almost word for word; Zira came out garbled ("artificial
# intelligence" as "farta fish"), which tests the voice, not Filow.
if (-not $Voice) { $Voice = if ($english | Where-Object { $_.VoiceInfo.Name -like "*David*" }) { "David" } else { "" } }
$speaker = $english | Where-Object { $_.VoiceInfo.Name -like "*$Voice*" } | Select-Object -First 1
if (-not $speaker) { throw "no English System.Speech voice matching '$Voice' installed" }
$synth.SelectVoice($speaker.VoiceInfo.Name)
$synth.Rate = $Rate
$sentences = @(
  "Let me start with something new. This is a different type of artificial intelligence: instead of writing text back to you, it simply gives you a decision.",
  "On a completely different note, I had a great espresso this morning and the weather in Milan was lovely.",
  "You cannot have a conversation with it, it is not able to use any tools, and it has no way to browse the internet.",
  "Now all the other companies are making their own version of it, and that tells you it has to be really good."
)
if ($Lines) { $sentences | ConvertTo-Json | Set-Content -Encoding utf8 -Path $Lines }
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$synth.SetOutputToWaveFile($Out, $fmt)
$pb = New-Object System.Speech.Synthesis.PromptBuilder
# A PromptBuilder picks its own voice by culture unless told; SelectVoice alone does not reach it.
$pb.StartVoice($speaker.VoiceInfo)
$pb.AppendBreak([TimeSpan]::FromMilliseconds(1500))
foreach ($s in $sentences) {
  $pb.AppendText($s)
  $pb.AppendBreak([TimeSpan]::FromMilliseconds(2500))
}
# Long tail of silence so the loop restarts after a clear pause, not mid-sentence.
$pb.AppendBreak([TimeSpan]::FromMilliseconds(4000))
$pb.EndVoice()
$synth.Speak($pb)
$synth.SetOutputToNull()
$synth.Dispose()
Write-Output ("voice=" + $speaker.VoiceInfo.Name)
