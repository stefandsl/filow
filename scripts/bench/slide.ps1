# Test slides for scripts/bench/okfilow-local.mts: a 1024 x 576 "quarter results" slide with a bar
# chart, in N variants that differ only in a footer (a new screenshot each run).
#   powershell -File scripts/bench/slide.ps1 -Out <dir> [-Count 6]
param([Parameter(Mandatory = $true)][string]$Out, [int]$Count = 6)
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force $Out | Out-Null
$title = New-Object System.Drawing.Font("Segoe UI", 54, [System.Drawing.FontStyle]::Bold)
$body = New-Object System.Drawing.Font("Segoe UI", 34)
$small = New-Object System.Drawing.Font("Segoe UI", 22)
$foot = New-Object System.Drawing.Font("Segoe UI", 12)
$ink = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(30, 30, 40))
$accent = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(40, 110, 200))
for ($n = 0; $n -lt $Count; $n++) {
  $big = New-Object System.Drawing.Bitmap 1920, 1080
  $g = [System.Drawing.Graphics]::FromImage($big)
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::FromArgb(250, 250, 247))
  $g.DrawString("Quarter results Q3", $title, $ink, 120, 90)
  $g.DrawString("Support costs fell 30% this quarter", $body, $ink, 140, 260)
  $g.DrawString("Churn dropped to 4%", $body, $ink, 140, 340)
  $g.DrawString("Net promoter score: 62 (was 55)", $body, $ink, 140, 420)
  $g.DrawString("We hired 3 engineers", $body, $ink, 140, 500)
  $vals = @(42, 38, 31, 29)
  for ($i = 0; $i -lt 4; $i++) {
    $h = $vals[$i] * 9
    $g.FillRectangle($accent, 1180 + $i * 150, 900 - $h, 100, $h)
    $g.DrawString("Q$($i + 1)", $small, $ink, 1205 + $i * 150, 910)
  }
  $g.DrawString("Support cost per ticket (EUR)", $small, $ink, 1180, 520)
  $b = New-Object System.Drawing.Bitmap 1024, 576
  $g2 = [System.Drawing.Graphics]::FromImage($b)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.DrawImage($big, 0, 0, 1024, 576)
  $g2.DrawString("slide $($n + 1) / 12   10:4$n", $foot, [System.Drawing.Brushes]::Gray, 20, 545)
  $b.Save((Join-Path $Out "slide-$n.jpg"), [System.Drawing.Imaging.ImageFormat]::Jpeg)
  $g.Dispose(); $g2.Dispose(); $big.Dispose(); $b.Dispose()
}
"saved $Count slides in $Out"
