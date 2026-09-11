<#
  install.ps1 — 克隆后的一次性安装脚本

  作用：
    1. 定位本机 node.exe，把 .mcp.json 的 command/args 改写为绝对路径
       （Codex 启动 MCP 服务器时不会展开相对路径，必须绝对）
    2. 可选：把插件登记到 Codex 个人 marketplace 并安装

  用法：
    powershell -ExecutionPolicy Bypass -File scripts\install.ps1
    powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -Register   # 顺带登记 marketplace + 安装插件
#>
param(
  [string]$PluginDir = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)),
  [switch]$Register,
  [string]$MarketplaceName = 'local-plugins'
)

$ErrorActionPreference = 'Stop'
$PluginDir = (Resolve-Path $PluginDir).Path
$server = Join-Path $PluginDir 'scripts\easyeda-bridge-mcp.mjs'
if (-not (Test-Path $server)) { throw "找不到 $server，请在插件根目录运行本脚本。" }

# 1) 定位 node
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  foreach ($p in @('C:\Program Files\nodejs\node.exe', 'C:\Program Files (x86)\nodejs\node.exe')) {
    if (Test-Path $p) { $node = $p; break }
  }
}
if (-not $node) { throw '未找到 node.exe，请先安装 Node.js 18+ 并加入 PATH。' }
Write-Host "node: $node"

# 2) 写 .mcp.json（绝对路径）
$mcp = Join-Path $PluginDir '.mcp.json'
$json = [ordered]@{
  mcpServers = [ordered]@{
    easyeda_bridge = [ordered]@{
      command = $node
      args    = @($server)
    }
  }
}
$json | ConvertTo-Json -Depth 6 | Set-Content -Path $mcp -Encoding UTF8
Write-Host "已写入 $mcp"

# 3) 可选：登记 marketplace + 安装
if ($Register) {
  $home2 = $env:USERPROFILE
  $mk = Join-Path $home2 '.agents\plugins\marketplace.json'
  $parent = Split-Path -Parent $PluginDir
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $mk) | Out-Null

  if (Test-Path $mk) { $payload = Get-Content $mk -Raw | ConvertFrom-Json } else {
    $payload = [pscustomobject]@{ name = $MarketplaceName; interface = [pscustomobject]@{ displayName = 'Local Plugins' }; plugins = @() }
  }
  if (-not $payload.plugins) { $payload | Add-Member -NotePropertyName plugins -NotePropertyValue @() -Force }

  $entry = [pscustomobject]@{
    name   = 'easyeda-bridge'
    source = [pscustomobject]@{ source = 'local'; path = './plugins/easyeda-bridge' }
    policy = [pscustomobject]@{ installation = 'AVAILABLE'; authentication = 'ON_INSTALL' }
    category = 'Developer Tools'
  }
  $existing = @($payload.plugins | Where-Object { $_.name -ne 'easyeda-bridge' })
  $payload.plugins = @($existing + $entry)
  $payload | ConvertTo-Json -Depth 8 | Set-Content -Path $mk -Encoding UTF8
  Write-Host "已更新 marketplace: $mk"

  $expected = Join-Path $home2 'plugins\easyeda-bridge'
  if ($PluginDir -ne $expected) {
    Write-Warning "插件不在 $expected，marketplace 条目默认指向该位置；请把插件移到那里，或手动修改 marketplace.json 的 path。"
  }
  Write-Host '接着执行： codex plugin add easyeda-bridge@' + $MarketplaceName
}

Write-Host ''
Write-Host '完成。下一步：'
Write-Host '  1. 确认 EasyEDA 专业版已启用官方扩展 Run API Gateway 并勾选“允许外部交互”'
Write-Host '  2. 重启 Codex，插件会带来 4 个 MCP 工具与 easyeda-api 技能'
Write-Host '  3. 体检： node scripts/check.mjs'
