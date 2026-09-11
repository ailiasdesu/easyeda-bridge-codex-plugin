#!/usr/bin/env node
/**
 * check.mjs — EasyEDA Bridge 链路三态体检（PASS / PARTIAL / FAIL）
 * 用法: node check.mjs
 * 退出码: 0=PASS 1=PARTIAL 2=FAIL
 */
const PORTS = Array.from({ length: 10 }, (_, i) => 49620 + i);
async function getJson(url, opt) {
  try {
    const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(6000) }, opt || {}));
    const t = await r.text();
    try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, text: t.slice(0, 300) }; }
  } catch (e) { return { error: e.name + ': ' + e.message }; }
}
async function main() {
  const out = { bridge: null, health: null, windows: null, execute: null, verdict: '', exitCode: 2 };
  for (const p of PORTS) {
    const h = await getJson('http://127.0.0.1:' + p + '/health');
    if (h.json && h.json.service === 'easyeda-bridge') { out.bridge = { port: p }; break; }
  }
  if (!out.bridge) {
    out.verdict = 'FAIL — 49620-49629 没有 Bridge Server。运行 scripts/start-bridge.ps1 或直接 node scripts/bridge-server.mjs';
    return out;
  }
  const port = out.bridge.port;
  out.health = (await getJson('http://127.0.0.1:' + port + '/health')).json;
  out.windows = (await getJson('http://127.0.0.1:' + port + '/eda-windows')).json;
  const count = (out.windows && out.windows.count) || 0;
  if (!count) {
    out.verdict = 'PARTIAL — Bridge 正常(port ' + port + ')，但没有 EasyEDA 窗口连上。'
      + '请在 EasyEDA 扩展管理器确认 Run API Gateway「已启用 + 允许外部交互」，再点顶部菜单 API Gateway → Reconnect。';
    out.exitCode = 1;
    return out;
  }
  out.execute = (await getJson('http://127.0.0.1:' + port + '/execute', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'return await eda.dmt_Workspace.getCurrentWorkspaceInfo();' }),
  })).json;
  const okRun = !!(out.execute && out.execute.success);
  out.verdict = okRun
    ? 'PASS — 链路完全打通：Codex → Bridge(port ' + port + ') → EasyEDA 已能执行 API。'
    : 'PARTIAL — 扩展已连上，但 /execute 未成功，见 execute 字段。';
  out.exitCode = okRun ? 0 : 1;
  return out;
}
main().then((r) => { console.log(JSON.stringify(r, null, 2)); process.exitCode = r.exitCode; })
  .catch((e) => { console.log(JSON.stringify({ error: String(e) }, null, 2)); process.exitCode = 2; });
