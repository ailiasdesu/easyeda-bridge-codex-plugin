# easyeda-bridge — Codex 插件

[**中文**](./README.md) · [English](./README.en.md)

把 **嘉立创EDA 专业版 (EasyEDA Pro)** 接进 Codex 的完整链路插件：官方 Run API Gateway 扩展 + Bridge Server + MCP stdio 工具 + 官方 API 参考。

> 非官方社区打包，与 JLCEDA / EasyEDA 无隶属关系；署名与许可见 [NOTICE.md](./NOTICE.md)。

## 安装（从 GitHub）

```powershell
# 1. 克隆到本机插件目录（Codex 个人 marketplace 默认指向 ~/plugins/<name>）
git clone https://github.com/<you>/easyeda-bridge-codex-plugin.git $env:USERPROFILE\plugins\easyeda-bridge

# 2. 一次性安装：把 .mcp.json 改写为绝对路径（可选 -Register 顺带登记 marketplace 并安装）
powershell -ExecutionPolicy Bypass -File $env:USERPROFILE\plugins\easyeda-bridge\scripts\install.ps1 -Register

# 3. 若用了 -Register，按提示执行：
codex plugin add easyeda-bridge@local-plugins

# 4. 体检
node $env:USERPROFILE\plugins\easyeda-bridge\scripts\check.mjs
```

前置条件：**Node.js 18+**（本插件在 Node 24 上开发验证）、**嘉立创EDA 专业版**，并在 EDA 的扩展管理器里安装官方扩展 **Run API Gateway** 且勾选 **允许外部交互**。

> 为什么需要 install.ps1：MCP 客户端的 `command`/`args` 不会展开相对路径，必须写成克隆后的绝对路径；脚本会定位本机 node.exe 并重写 `.mcp.json`。

## 架构

```
Codex ──MCP stdio──▶ easyeda-bridge-mcp.mjs ──HTTP/WS──▶ Bridge Server :49620-49629 ──WS──▶ EasyEDA 扩展
        (4 个工具)                              (内置)                        (Run API Gateway)
```

## 组件

| 组件 | 路径 | 说明 |
|---|---|---|
| MCP 适配层 | `scripts/easyeda-bridge-mcp.mjs` | MCP **stdio** 服务，暴露 4 个工具；零依赖；Bridge 不在时自动后台拉起（`EASYEDA_BRIDGE_NO_AUTOSTART=1` 可关） |
| Bridge Server | `scripts/bridge-server.mjs` | 官方桥（HTTP/WS，端口 49620-49629，握手标识 `easyeda-bridge`） |
| 安装脚本 | `scripts/install.ps1` | 改写绝对路径（`-Register` 顺带登记 marketplace + 安装） |
| 启动脚本 | `scripts/start-bridge.ps1` | `-Stop` / `-Restart` 管理 Bridge 进程 |
| 体检脚本 | `scripts/check.mjs` | 三态体检：PASS / PARTIAL / FAIL（退出码 0/1/2） |
| API 技能 | `skills/easyeda-api/` | 官方 API 参考：130 类 / 62 枚举 / 70 接口 + 文档源格式规范（450 篇） |
| 运行时依赖 | `node_modules/ws` | `bridge-server.mjs` 需要；已随仓库提交以便开箱即用 |

## 快速开始

1. **EDA 侧**：扩展管理器确认 **Run API Gateway** 已启用，并勾选 **允许外部交互**（不开则扩展的 WebSocket 注册会抛异常）。
2. **Codex 侧**：重启 Codex，插件自动带来 4 个 MCP 工具与 `easyeda-api` 技能。
3. 若 EDA 尚未连上，点顶部菜单 **API Gateway → Reconnect**（扩展最多重试 5 次后停止扫描）。

## MCP 工具

| 工具 | 用途 |
|---|---|
| `easyeda_bridge_status` | 连接状态（端口 / 已连窗口数 / 活动窗口）——排障第一步 |
| `easyeda_list_windows` | 列出已连接的 EDA 窗口 |
| `easyeda_select_window` | 切换默认作用窗口（多开时） |
| `easyeda_execute` | 在 EDA 运行时执行 JS（async 函数体，形参 `eda`，必须 `return`） |

## 实测能力（v1.1.0 验证记录）

工程 Board1 = schematic1 + PCB1，EDA 3.2.149 / 扩展 v1.0.5：

| 域 | 实测结果 |
|---|---|
| 原理图 | `openDocument(pageUuid)` → 页信息、`sch_Net` 网络、`sch_Netlist.getNetlist()` 网表对象、`sch_PrimitiveComponent` 元器件与 30 条属性名 |
| 原理图写入 | `sch_PrimitiveText.create(100,80,'…')` → `get` 读回 → `delete([id])` → 读回 `undefined`（已复原） |
| PCB | 铜层数 / 260 个图层可枚举、网络表、DRC 规则（6 套）、实时 DRC 状态、画布原点 |
| PCB 写入 | `pcb_PrimitiveLine.create('',1,7000,7000,7500,7000,10)` → `get` → `delete` → `pcb_Document.save()`；图元计数 0→1→0 |
| 库 | `lib_LibrariesList.getAllLibrariesList()`、系统库/工程库 UUID、`lib_Device.getByLcscIds()` |
| 全量扫描 | 220 个零参 getter：135 成功 / 81 需参数或活动文档 / 4 阻塞 / 45 主动跳过 |

## 使用范式（重要）

1. **先探再调**：运行时 API 与文档偶有差异，调用前先 `return Object.keys(eda.dmt_Xxx)` 看真实方法名，再按签名传参；不要零参盲调（多数 getter 需要入参）。
2. **先开文档**：访问 `sch_*` / `pcb_*` 前必须先打开对应文档，否则报 `Cannot read properties of null (reading 'map')` 或 `指定的主题消息在对应的画布内没有相关订阅`。
   ```js
   const p = await eda.dmt_Project.getCurrentProjectInfo();
   await eda.dmt_EditorControl.openDocument(p.data[0].pcb.uuid);   // 或 .schematic.uuid
   ```
3. **写操作要闭环**：create → get 复核 → 必要时 delete 复原 → `save()`。

## 已知限制

| 限制 | 说明 |
|---|---|
| `sys_FileSystem` 4 个方法会阻塞 | `getDocumentsPath` / `getLibrariesPaths` / `getProjectsPaths` / `listFilesOfFileSystem` 实测 26s 不返回；调用需短超时或避开。`getEdaPath()` 正常。 |
| 版本差异 | 文档 130 类 vs 本机运行时 94 模块；5 个模块（`lib_SimulationModel`、`pcb_ImageTool`、`sys_ExternalApi`、`sys_Help`、`sys_Math`）与 28 个方法在 EDA 3.2.149 不存在 |
| 私有化限定 | `pcb_ManufactureData.getManufactureData` 返回“仅私有化部署版本有效” |
| 端口独占 | 49620-49629 为官方约定共享区间，不要同时启用其它占用该区间的 MCP（如第三方 `easyeda-mcp-pro`） |
| 绝对路径 | `.mcp.json` 内为本机绝对路径，移动目录后重新运行 `scripts/install.ps1` |
| 平台 | 安装脚本为 PowerShell（Windows）；macOS/Linux 请手动把 `.mcp.json` 的 command/args 改为绝对路径 |

## 排障

```powershell
cd $env:USERPROFILE\plugins\easyeda-bridge
node scripts\check.mjs                            # 链路三态
powershell -File scripts\start-bridge.ps1           # 手动拉起 Bridge
powershell -File scripts\start-bridge.ps1 -Stop     # 停掉所有 Bridge
Get-Content $env:TEMP\easyeda-bridge.err.log        # Bridge 错误日志
```

## 维护

- 修改插件源目录后，Codex 运行的是缓存副本，需要重新安装：
  `codex plugin add easyeda-bridge@local-plugins`（**版本号变化会生成新缓存目录**，稳妥做法是先升 `plugin.json.version`）。
- API 文档随插件分发，升级上游可重新克隆 [easyeda/easyeda-api-skill](https://github.com/easyeda/easyeda-api-skill) 覆盖 `skills/easyeda-api/` 与 `scripts/bridge-server.mjs`。

## 许可

本仓库自行编写的部分：MIT（见 [LICENSE](./LICENSE)）。内置的上游组件与文档署名见 [NOTICE.md](./NOTICE.md)。
