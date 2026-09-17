$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 5190
$dataDir = Join-Path $projectRoot "data"
$serverLog = Join-Path $dataDir "launcher-server.log"
$serverErrorLog = Join-Path $dataDir "launcher-server-error.log"
$launcherErrorLog = Join-Path $dataDir "launcher-error.log"

try {
  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $listener) {
    $node = (Get-Command node -ErrorAction Stop).Source
    $env:LAN_READONLY = "1"
    Start-Process -FilePath $node -ArgumentList "server.mjs" -WorkingDirectory $projectRoot -RedirectStandardOutput $serverLog -RedirectStandardError $serverErrorLog -WindowStyle Hidden
    for ($i = 0; $i -lt 24; $i++) {
      Start-Sleep -Milliseconds 250
      $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($listener) { break }
    }
  }

  if (-not $listener) {
    Add-Content -LiteralPath $launcherErrorLog -Value "$(Get-Date -Format s) 服务未能在 6 秒内监听端口 $port"
  }
} catch {
  Add-Content -LiteralPath $launcherErrorLog -Value "$(Get-Date -Format s) $($_.Exception.Message)"
}
