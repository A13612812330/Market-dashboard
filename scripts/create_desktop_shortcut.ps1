$ErrorActionPreference = "Stop"
$project = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$icon = Join-Path $project "assets\komo-market-icon.ico"

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies @("System.Drawing") -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
public static class KomoIcon {
  public static byte[] Png(int size) {
    using (var b = new Bitmap(size, size, PixelFormat.Format32bppArgb))
    using (var g = Graphics.FromImage(b))
    using (var ms = new MemoryStream()) {
      g.SmoothingMode = SmoothingMode.AntiAlias;
      g.Clear(Color.FromArgb(8,16,23));
      using (var border = new Pen(Color.FromArgb(36,55,70), Math.Max(2, size / 64f))) g.DrawRectangle(border, size*.047f, size*.047f, size*.906f, size*.906f);
      using (var grid = new Pen(Color.FromArgb(24,42,53), Math.Max(1, size / 86f))) for (int i=1;i<4;i++) g.DrawLine(grid, size*.12f, size*(.29f*i), size*.88f, size*(.29f*i));
      var pts = new PointF[] { new PointF(size*.12f,size*.70f), new PointF(size*.28f,size*.60f), new PointF(size*.40f,size*.64f), new PointF(size*.52f,size*.44f), new PointF(size*.64f,size*.49f), new PointF(size*.78f,size*.30f), new PointF(size*.88f,size*.36f) };
      using (var line = new Pen(Color.FromArgb(242,184,75), Math.Max(3, size/28f))) { line.StartCap=LineCap.Round; line.EndCap=LineCap.Round; line.LineJoin=LineJoin.Round; g.DrawLines(line, pts); using (var dot = new SolidBrush(Color.FromArgb(242,184,75))) g.FillEllipse(dot, size*.85f, size*.33f, size*.06f, size*.06f); }
      if (size >= 48) using (var font = new Font("Arial", size*.11f, FontStyle.Bold, GraphicsUnit.Pixel)) using (var brush = new SolidBrush(Color.FromArgb(233,240,242))) { var sf = new StringFormat { Alignment=StringAlignment.Center }; g.DrawString("KM", font, brush, new RectangleF(0,size*.82f,size,size*.14f), sf); }
      b.Save(ms, ImageFormat.Png); return ms.ToArray();
    }
  }
}
'@

$sizes = @(256, 128, 48, 32, 16)
$images = @($sizes | ForEach-Object { ,([KomoIcon]::Png($_)) })
$bytes = New-Object System.Collections.Generic.List[byte]
$bytes.AddRange([byte[]](0,0,1,0))
$bytes.AddRange([BitConverter]::GetBytes([uint16]$sizes.Count))
$offset = 6 + (16 * $sizes.Count)
$entries = New-Object System.Collections.Generic.List[byte]
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $size = $sizes[$i]
  $data = $images[$i]
  $entries.Add([byte]$(if ($size -ge 256) { 0 } else { $size }))
  $entries.Add([byte]$(if ($size -ge 256) { 0 } else { $size }))
  $entries.AddRange([byte[]](0,0,1,0,32,0))
  $entries.AddRange([BitConverter]::GetBytes([uint32]$data.Length))
  $entries.AddRange([BitConverter]::GetBytes([uint32]$offset))
  $offset += $data.Length
}
$bytes.AddRange($entries)
foreach ($data in $images) { $bytes.AddRange($data) }
[IO.File]::WriteAllBytes($icon, $bytes.ToArray())

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Komo Market Dashboard.lnk"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR "System32\wscript.exe"
$shortcut.Arguments = "`"$project\start-dashboard.vbs`""
$shortcut.WorkingDirectory = $project
$shortcut.IconLocation = "$icon,0"
$shortcut.Description = "静默启动 Komo Market Dashboard"
$shortcut.Save()

Write-Output "Shortcut: $shortcutPath"
Write-Output "Icon: $icon"
