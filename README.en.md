# easyeda-bridge — Codex Plugin

[中文说明](./README.md) · **English**

Drive **EasyEDA Pro (嘉立创EDA专业版)** from Codex: the official Run API Gateway extension + Bridge Server + MCP stdio tools + the complete official API reference.

> Unofficial community packaging. Not affiliated with JLCEDA / EasyEDA. See [NOTICE.md](./NOTICE.md) for attribution and licenses.

## Install (from GitHub)

```powershell
# 1. Clone into the Codex personal plugin directory (the personal marketplace expects ~/plugins/<name>)
git clone https://github.com/ailiasdesu/easyeda-bridge-codex-plugin.git $env:USERPROFILE\plugins\easyeda-bridge

# 2. One-time setup: generates .mcp.json with absolute paths
#    (-Register also registers the personal marketplace and installs the plugin)
powershell -ExecutionPolicy Bypass -File $env:USERPROFILE\plugins\easyeda-bridge\scripts\install.ps1 -Register

# 3. If you used -Register, run the command it prints:
codex plugin add easyeda-bridge@local-plugins

# 4. Health check
node $env:USERPROFILE\plugins\easyeda-bridge\scripts\check.mjs
```

**Requirements:** Node.js 18+ (developed and verified on Node 24), EasyEDA Pro desktop client, and the official **Run API Gateway** extension installed inside EasyEDA with **Allow External Interaction** enabled.

> Why `install.ps1` is needed: MCP clients do **not** expand relative paths in `command`/`args`, so the server script must be referenced by an absolute path. The script locates your `node.exe` and generates `.mcp.json` accordingly.

## Architecture

```
Codex ──MCP stdio──▶ easyeda-bridge-mcp.mjs ──HTTP/WS──▶ Bridge Server :49620-49629 ──WS──▶ EasyEDA extension
        (4 tools)                              (bundled)                      (Run API Gateway)
```

## Components

| Component | Path | Notes |
|---|---|---|
| MCP adapter | `scripts/easyeda-bridge-mcp.mjs` | MCP **stdio** server exposing 4 tools; zero dependencies; auto-starts the Bridge in the background when missing (disable with `EASYEDA_BRIDGE_NO_AUTOSTART=1`) |
| Bridge Server | `scripts/bridge-server.mjs` | Official bridge (HTTP/WS, ports 49620-49629, handshake id `easyeda-bridge`) |
| Installer | `scripts/install.ps1` | Generates `.mcp.json` with absolute paths (`-Register` also wires up the marketplace) |
| Bridge control | `scripts/start-bridge.ps1` | `-Stop` / `-Restart` for the Bridge process |
| Health check | `scripts/check.mjs` | Three-state check: PASS / PARTIAL / FAIL (exit codes 0/1/2) |
| API skill | `skills/easyeda-api/` | Official API reference: 130 classes / 62 enums / 70 interfaces + document-source format specs (450 files) |
| Runtime dependency | `node_modules/ws` | Required by `bridge-server.mjs`; committed so the plugin works without `npm install` |

## Quick start

1. **EasyEDA side** — in the Extension Manager, make sure **Run API Gateway** is enabled and **Allow External Interaction** is checked (without it the extension's WebSocket registration throws).
2. **Codex side** — restart Codex; the plugin contributes 4 MCP tools and the `easyeda-api` skill.
3. If EasyEDA is not connected yet, click the top menu **API Gateway → Reconnect** (the extension gives up after 5 failed scans).

## MCP tools

| Tool | Purpose |
|---|---|
| `easyeda_bridge_status` | Connection state (port / connected windows / active window) — first stop when debugging |
| `easyeda_list_windows` | List connected EasyEDA windows |
| `easyeda_select_window` | Pick the default target window when several are open |
| `easyeda_execute` | Run JS inside the EasyEDA runtime (async function body, `eda` parameter, **must** `return`) |

## Verified capabilities (v1.1.0 test record)

Project `Board1 = schematic1 + PCB1`, EasyEDA 3.2.149 / extension v1.0.5:

| Domain | Result |
|---|---|
| Schematic (read) | `openDocument(pageUuid)` → page info, `sch_Net` nets, `sch_Netlist.getNetlist()`, `sch_PrimitiveComponent` parts + 30 property names |
| Schematic (write) | `sch_PrimitiveText.create(100,80,'…')` → `get` read-back → `delete([id])` → read-back `undefined` (cleanly reverted) |
| PCB (read) | Copper-layer count, 260 enumerable layers, nets, DRC rules (6 sets), real-time DRC state, canvas origin |
| PCB (write) | `pcb_PrimitiveLine.create('',1,7000,7000,7500,7000,10)` → `get` → `delete` → `pcb_Document.save()`; primitive count 0→1→0 |
| Library | `lib_LibrariesList.getAllLibrariesList()`, system/project library UUIDs, `lib_Device.getByLcscIds()` |
| Full sweep | 220 zero-arg getters: 135 OK / 81 need arguments or an active document / 4 blocking / 45 skipped |

## Usage patterns (important)

1. **Probe before calling** — the runtime occasionally differs from the docs. Inspect real method names first, then pass arguments per their signatures:
   ```js
   return Object.keys(eda.dmt_Xxx);
   ```
   Avoid zero-argument calls: most getters require parameters.
2. **Open the document first** — before touching `sch_*` / `pcb_*`, open the corresponding document, otherwise you get `Cannot read properties of null (reading 'map')` or `指定的主题消息在对应的画布内没有相关订阅`.
   ```js
   const p = await eda.dmt_Project.getCurrentProjectInfo();
   await eda.dmt_EditorControl.openDocument(p.data[0].pcb.uuid);   // or .schematic.uuid
   ```
3. **Close the write loop** — create → `get` to verify → `delete` to revert when needed → `save()`.

## Known limitations

| Limitation | Details |
|---|---|
| 4 blocking methods | `sys_FileSystem.getDocumentsPath` / `getLibrariesPaths` / `getProjectsPaths` / `listFilesOfFileSystem` never return (verified: still pending after 26s). Use a short timeout or avoid them. `getEdaPath()` is fine. |
| Version drift | Docs list 130 classes vs 94 modules at runtime; 5 modules (`lib_SimulationModel`, `pcb_ImageTool`, `sys_ExternalApi`, `sys_Help`, `sys_Math`) and 28 methods do not exist in EasyEDA 3.2.149 |
| Private-deployment only | `pcb_ManufactureData.getManufactureData` returns "only available in private deployments" |
| Port exclusivity | 49620-49629 is the shared official range; do not run other MCP servers that bind it (e.g. the third-party `easyeda-mcp-pro`) |
| Absolute paths | `.mcp.json` is machine-specific (generated by `install.ps1`); re-run it after moving the plugin |
| Platform | The installer is PowerShell (Windows). On macOS/Linux, edit `.mcp.json` manually to use absolute paths |

## Troubleshooting

```powershell
cd $env:USERPROFILE\plugins\easyeda-bridge
node scripts\check.mjs                            # three-state health check
powershell -File scripts\start-bridge.ps1           # start the Bridge manually
powershell -File scripts\start-bridge.ps1 -Stop     # stop every Bridge process
Get-Content $env:TEMP\easyeda-bridge.err.log        # Bridge error log
```

## Maintenance

- Codex runs a **cached copy** of the plugin. After editing the source directory, reinstall:
  `codex plugin add easyeda-bridge@local-plugins` (bump `plugin.json.version` so a new cache directory is created).
- The bundled API docs come from [easyeda/easyeda-api-skill](https://github.com/easyeda/easyeda-api-skill); re-clone it to refresh `skills/easyeda-api/` and `scripts/bridge-server.mjs`.

## License

Original code in this repository: MIT (see [LICENSE](./LICENSE)). Bundled upstream components and docs: see [NOTICE.md](./NOTICE.md).
