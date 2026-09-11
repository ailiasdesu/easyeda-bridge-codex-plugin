<#
  start-bridge.ps1 — 启动 / 停止 EasyEDA Bridge Server（官方 Run API Gateway 用）
  用法:
    powershell -ExecutionPolicy Bypass -File .\start-bridge.ps1            # 不存在则后台启动并等待就绪
    powershell -ExecutionPolicy Bypass -File .\start-bridge.ps1 -Restart   # 先停再起
    powershell -ExecutionPolicy Bypass -File .\start-bridge.ps1 -Stop      # 停止所有 Bridge 实例
#>
param([switch]$Stop, [switch]$Restart)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridge = Join-Path $here 'bridge-server.mjs'
$ports = 49620..49629

function Get-BridgePort {
  foreach ($p in $ports) {
    try {
      $r = Invoke-RestMethod "http://127.0.0.1:$p/health" -TimeoutSec 1
      if ($r.service -eq 'easyeda-bridge') { return $p }
    } catch {}
  }
  return $null
}

function Stop-Bridge {
  $found = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'bridge-server\.mjs' }
  if ($found) { $found | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } }
  Start-Sleep -Milliseconds 500
}

if ($Stop) { Stop-Bridge; Write-Output 'Bridge stopped.'; return }
if ($Restart) { Stop-Bridge }
if (-not $Restart) {
  $p = Get-BridgePort
  if ($p) { Write-Output "Bridge already running on port $p"; return }
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
$log = Join-Path $env:TEMP 'easyeda-bridge.log'
$err = Join-Path $env:TEMP 'easyeda-bridge.err.log'
Start-Process -FilePath $node -ArgumentList $bridge -WorkingDirectory $here -WindowStyle Hidden -RedirectStandardOutput $log -RedirectStandardError $err

for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 300
  $p = Get-BridgePort
  if ($p) {
    $h = Invoke-RestMethod "http://127.0.0.1:$p/health" -TimeoutSec 2
    Write-Output "Bridge running on port $p (edaConnected=$($h.edaConnected), windows=$($h.edaWindowCount))"
    return
  }
}
Write-Error 'Bridge did not become ready in 9s. See $env:TEMP\easyeda-bridge.err.log'
