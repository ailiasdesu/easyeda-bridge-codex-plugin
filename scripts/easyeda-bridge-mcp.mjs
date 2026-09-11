#!/usr/bin/env node
/**
 * easyeda-bridge-mcp.mjs — EasyEDA Run API Gateway 的 MCP(stdio) 适配层
 *
 * 链路：Codex(MCP stdio) → 本适配器 → HTTP/WS Bridge Server(49620-49629) → EasyEDA 扩展
 * 特性：零依赖(Node 18+)；换行分隔 JSON-RPC（兼容 Content-Length 分帧）；
 *       Bridge 未运行时自动后台拉起同目录的 bridge-server.mjs。
 * 关闭自动拉起：环境变量 EASYEDA_BRIDGE_NO_AUTOSTART=1
 */
import { stdin, stdout, stderr } from 'node:process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const BRIDGE_SCRIPT = join(HERE, 'bridge-server.mjs');
const SERVER_NAME = 'easyeda-bridge-mcp';
const SERVER_VERSION = '1.1.0';
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const DEFAULT_PROTOCOL = '2024-11-05';
const PORT_START = 49620;
const PORT_END = 49629;
const SERVICE_ID = 'easyeda-bridge';

const log = (...a) => stderr.write('[easyeda-bridge-mcp] ' + a.join(' ') + '\n');

let cachedPort = null;
let autoStartTried = false;

async function probe(port) {
  const r = await fetch('http://127.0.0.1:' + port + '/health', { signal: AbortSignal.timeout(700) });
  const j = await r.json();
  return j && j.service === SERVICE_ID ? j : null;
}

async function scan() {
  for (let p = PORT_START; p <= PORT_END; p++) {
    try { if (await probe(p)) return p; } catch { /* 试下一个端口 */ }
  }
  return null;
}

/** Bridge 没在跑 → 后台拉起同目录的 bridge-server.mjs */
async function autoStartBridge() {
  if (process.env.EASYEDA_BRIDGE_NO_AUTOSTART === '1' || autoStartTried) return null;
  autoStartTried = true;
  try {
    const out = openSync(join(tmpdir(), 'easyeda-bridge.log'), 'a');
    const err = openSync(join(tmpdir(), 'easyeda-bridge.err.log'), 'a');
    const cp = spawn(process.execPath, [BRIDGE_SCRIPT], { detached: true, stdio: ['ignore', out, err], windowsHide: true, cwd: HERE });
    cp.unref();
    log('bridge not running — auto-started pid ' + cp.pid);
  } catch (e) {
    log('auto-start failed: ' + e.message);
  }
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const p = await scan();
    if (p) return p;
  }
  return null;
}

async function findBridgePort(force = false) {
  if (cachedPort && !force) return cachedPort;
  let p = await scan();
  if (!p) p = await autoStartBridge();
  if (!p) throw new Error('未找到 EasyEDA Bridge Server (' + PORT_START + '-' + PORT_END + ')，自动拉起也失败。请手动运行 scripts/bridge-server.mjs。');
  cachedPort = p;
  log('bridge on port ' + p);
  return p;
}

async function req(path, init, timeoutMs = 60000) {
  const run = async (p) => {
    const r = await fetch('http://127.0.0.1:' + p + path, Object.assign({ signal: AbortSignal.timeout(timeoutMs) }, init || {}));
    return await r.json();
  };
  let port = await findBridgePort();
  try { return { port, data: await run(port) }; }
  catch { port = await findBridgePort(true); return { port, data: await run(port) }; }
}

const TOOLS = [
  {
    name: 'easyeda_bridge_status',
    description: '检查 EasyEDA Bridge Server 与 EDA 客户端连接状态（端口、已连接窗口数、活动窗口）。所有 EasyEDA 工具异常时先调它。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'easyeda_list_windows',
    description: '列出已连接到 Bridge 的所有 EasyEDA 窗口（windowId / 是否活动）。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'easyeda_select_window',
    description: '选择后续 easyeda_execute 默认作用的 EasyEDA 窗口。',
    inputSchema: {
      type: 'object',
      properties: { windowId: { type: 'string', description: '来自 easyeda_list_windows 的 windowId' } },
      required: ['windowId'], additionalProperties: false,
    },
  },
  {
    name: 'easyeda_execute',
    description: '在运行中的 EasyEDA 专业版里执行一段 JS（async 函数体，形参 eda）并取回返回值。'
      + '必须用 return 返回结果（console.log 不被捕获）；调用 API 一律 await；代码里不要写注释。'
      + '示例：return await eda.dmt_Workspace.getCurrentWorkspaceInfo();'
      + ' 或 return Object.keys(eda).filter(k=>k.startsWith("sch_"));',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'async 函数体，形如：return await eda.xxx.yyy();' },
        windowId: { type: 'string', description: '可选：指定 EDA 窗口' },
        timeoutMs: { type: 'number', description: '可选：超时毫秒，默认 60000' },
      },
      required: ['code'], additionalProperties: false,
    },
  },
];

async function callTool(name, args = {}) {
  switch (name) {
    case 'easyeda_bridge_status': {
      const { port, data } = await req('/health');
      return Object.assign({ bridgePort: port }, data);
    }
    case 'easyeda_list_windows':
      return (await req('/eda-windows')).data;
    case 'easyeda_select_window':
      return (await req('/eda-windows/select', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ windowId: args.windowId }),
      })).data;
    case 'easyeda_execute': {
      if (typeof args.code !== 'string' || !args.code.trim()) throw new Error('code 必须是非空字符串');
      const body = { code: args.code };
      if (args.windowId) body.windowId = args.windowId;
      const { data } = await req('/execute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }, args.timeoutMs || 60000);
      if (data && data.success === false) throw new Error(data.error || 'EDA 执行失败');
      return data;
    }
    default:
      throw new Error('未知工具: ' + name);
  }
}

function write(msg) { stdout.write(JSON.stringify(msg) + '\n'); }
const ok = (id, result) => write({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;
  try {
    switch (method) {
      case 'initialize': {
        const want = params && params.protocolVersion;
        return ok(id, {
          protocolVersion: SUPPORTED_PROTOCOLS.includes(want) ? want : DEFAULT_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions: 'EasyEDA 专业版 MCP 适配层。执行 EDA 代码用 easyeda_execute（async 函数体 + return）。'
            + '排障先调 easyeda_bridge_status；EDA 侧需安装并启用官方 Run API Gateway 扩展并勾选「允许外部交互」。',
        });
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
      case 'initialized':
        return;
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, { tools: TOOLS });
      case 'tools/call': {
        const name = params && params.name;
        const args = (params && params.arguments) || {};
        try {
          const data = await callTool(name, args);
          return ok(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data, isError: false });
        } catch (e) {
          return ok(id, { content: [{ type: 'text', text: 'ERROR: ' + e.message }], isError: true });
        }
      }
      case 'resources/list':
        return ok(id, { resources: [] });
      case 'prompts/list':
        return ok(id, { prompts: [] });
      default:
        if (!isNotification) return fail(id, -32601, 'Method not found: ' + method);
    }
  } catch (e) {
    if (!isNotification) fail(id, -32603, String(e && e.message ? e.message : e));
  }
}

let buf = '';
stdin.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  for (;;) {
    if (/^Content-Length:/i.test(buf)) {
      const sep = buf.indexOf('\r\n\r\n');
      if (sep === -1) return;
      const m = /Content-Length:\s*(\d+)/i.exec(buf.slice(0, sep));
      const len = m ? parseInt(m[1], 10) : 0;
      if (buf.length < sep + 4 + len) return;
      const body = buf.slice(sep + 4, sep + 4 + len);
      buf = buf.slice(sep + 4 + len);
      try { void handle(JSON.parse(body)); } catch (e) { log('parse error: ' + e.message); }
      continue;
    }
    const nl = buf.indexOf('\n');
    if (nl === -1) return;
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    try { void handle(JSON.parse(line)); } catch (e) { log('parse error: ' + e.message); }
  }
});
stdin.on('end', () => process.exit(0));
log('ready (stdio) ports ' + PORT_START + '-' + PORT_END + ' autostart=' + (process.env.EASYEDA_BRIDGE_NO_AUTOSTART === '1' ? 'off' : 'on'));
