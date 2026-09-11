# 第三方组件与署名

本仓库是**本地打包的 Codex 插件**，其中包含来自以下上游项目的组件，版权归各自作者所有：

| 组件 | 来源 | 许可 |
|---|---|---|
| `scripts/bridge-server.mjs` | [easyeda/easyeda-api-skill](https://github.com/easyeda/easyeda-api-skill) | MIT |
| `skills/easyeda-api/`（SKILL.md + references/ + format/ + guide/ + user-guide/） | [easyeda/easyeda-api-skill](https://github.com/easyeda/easyeda-api-skill) | MIT |
| API 文档内容 | JLCEDA / EasyEDA（嘉立创EDA） | 版权归 JLCEDA 所有 |
| Run API Gateway 扩展（**未随本仓库分发**，需在 EDA 内安装） | [easyeda/eext-run-api-gateway](https://github.com/easyeda/eext-run-api-gateway) | Apache-2.0 |
| `node_modules/ws` | [websockets/ws](https://github.com/websockets/ws) | MIT |

本仓库自行编写的部分（MCP 适配层 `scripts/easyeda-bridge-mcp.mjs`、`scripts/start-bridge.ps1`、`scripts/check.mjs`、`scripts/install.ps1`、插件 manifest 与文档）以 MIT 许可发布，见 [LICENSE](./LICENSE)。

本插件为**非官方社区打包**，与 JLCEDA / EasyEDA 官方无隶属关系。使用时请遵守上游项目的许可条款。
