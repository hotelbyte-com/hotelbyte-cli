# Portal 全功能 CLI/MCP 化 — 架构决策

> 目标 issue: [hotelbyte-com/hotelbyte-cli#27](https://github.com/hotelbyte-com/hotelbyte-cli/issues/27)
> 状态: 已采纳 · 2026-10-03 · 线上实探测得的事实均已标注

## 1. 目标与"全部功能"的定义

Issue #27 要求把 Portal 的全部功能 CLI 化 / MCP 化。先把这个口号钉成可验收的定义:

- **CLI 化**: 任一 Portal 端点,都能在终端用 `hbcli` 完成鉴权调用、发现(它叫什么/要什么参数)、并拿到结构化 JSON。
- **MCP 化**: 任一 MCP 客户端(Claude Code / Cursor / …)接入后,能发现并调用同样的功能面。

**不等于**为每个端点手写一个带 flag 的子命令(见 §3 D1)。

## 2. 事实底座(2026-10-03 UAT 实测)

| 事实 | 数值 | 来源 |
|---|---|---|
| Portal 端点总量 | **1912 个方法 / 72 个服务**(含 `user/tenant`、`trade/customer` 等受众包装) | `POST /api/view/getApiPaths` live 探测 |
| 路由形态 | 统一反射分发: `POST /api/:domain/:service/:method`,`@path` 注释可覆盖末段 | hotel-be `common/httpdispatcher` |
| 端点目录元数据 | `serviceName/methodName/path/authMethod/permissions/paramNames/apidoc/operationType`,**path 已服务端解析成完整路径** | `MethodMeta`(build/api/asthelper) |
| 目录端点 | `view/getApiPaths` 接受 `type`(服务名子串过滤)+`limit`(0=全量),demo 票据即可调用 | live 验证 code=0 |
| CLI 现状 | ~50 个子命令(auth/search/trade/orders/team/account/fx/view/mcp),三档身份自动探测 | src/commands/* |
| MCP 现状 | `hbcli mcp serve` 是**纯桥接**(JSON-RPC 逐行转发到托管 `/mcp`),工具 schema 单一权威在服务端;托管网关现有 6 个契约工具(hotel.list/rates/check_avail + order.query/book/cancel) | src/core/mcp_bridge.ts、hotel-be mcp/gateway |

## 3. 架构决策

### D1 通用透传层(L0)承担"全部"二字,精选层承担"好用"

1912 个端点逐一手写命令不可维护(受众包装下大量方法同构)。分层:

- **L0 通用透传**: `hbcli api call <path> --data @req.json` 一条命令覆盖 100% JSON 端点。配 `api catalog` / `api describe` 做目录发现。
- **L1 精选模块**: 按运营高频域(products/connectors/lookout/billing/…)补人体工学子命令,沿用 orders/team 既有模式。**渐进、按需**,不追求全集。

### D2 目录驱动发现,getApiPaths 是唯一权威

- `api catalog [--filter substr] [--service name] [--refresh] [--json]`: 拉 `view/getApiPaths`(limit=0)并缓存到 `$STAICLI_HOME/api-catalog-<env>.json`(24h 新鲜度;离线时退回缓存)。
- `api describe <path|service/method>`: 打印单端点元数据(apidoc/paramNames/validations/permissions)。
- CLI **不复算**路径规则——服务端返回的 `path` 就是完整路径;`api call` 接受 `/api/a/b/c` 或 `a/b/c` 并归一化。

### D3 鉴权与权限永远在服务端

CLI/MCP 不复制 RBAC 模型。通用透传只是"带票据的 POST":服务器的 JWT/RBAC/受众隔离(user/platform vs user/tenant …)原样生效。调用者自己选路径,即自己选受众面。

### D4 MCP 双面

- **本地通用面(本次落地)**: `hbcli mcp serve --local` 在本机跑一个 stdio MCP 工具服务,暴露 3 个通用工具:
  - `portal.catalog` — 搜索端点目录(参数: filter/service/limit)
  - `portal.describe` — 单端点元数据
  - `portal.call` — 透传调用(参数: path/data/confirm)
  凭据沿用本机三档 profile,服务端 RBAC 不变。**零后端部署即达成 MCP 全功能覆盖**。
- **托管精选面(后续,hotel-be 侧)**: 托管网关按域扩展 `ContractTool`(ReadOnly/ConfirmParam 契约),面向 B2B 集成者的稳定契约。两面不重复: 托管网关不放大而精,本地面不求精而全。
- 不违背"schema 单一权威在服务端"的既有哲学: 本地面不硬编码任何**领域**工具 schema,只有 3 个稳定的**通用**工具;领域 schema 仍由托管网关目录单源渲染。
- **例外注记(issue #45)**: 本地面在三个通用工具之外有且仅有一个领域工具 `presales.chat`(落页 AI 顾问)。理由: 该面**公开无认证**(`/api/public/presales/*` 不走三档身份、不需要票据),本就不在托管网关的 ContractTool 契约清单内——托管面面向 B2B 集成者的授权调用,公共访客面无从纳入;本地聚合其 SSE(A2UI v0.9)事件文本返回,与托管面零重复。后续公共 agent 若增多,再评估独立的 public 工具面,不在 D4 例外上继续累加。

### D5 写操作护栏(与托管网关 ConfirmParam 同哲学)

- 判定: 目录 `operationType=="write"` → 写;`operationType` 缺失时按方法名前缀启发(get/list/search/query/count/detail/find/stat/read/dashboard/page/metadata → 读;其余未知视为写)。
- CLI: 非读操作必须 `--confirm` 才执行;MCP `portal.call`: 非读操作必须 `confirm:true`(schema 声明,缺失即拒绝)。
- 环境护栏沿用现状: 默认 uat,prod 需显式 `--env prod`。

### D6 明确的范围排除

- multipart 上传(品牌资产/酒店图片/附件)与二进制下载(导出/凭证文档)不是 JSON 透传能覆盖的,归 L1 专用命令后续 issue。
- `internal/*`、webhook、`/uploads` 静态资源不在 `api call` 目标面内(`api call` 只接受 `/api/` 前缀)。

## 4. 里程碑与 issue 映射

| 层 | 内容 | 状态 |
|---|---|---|
| L0 | `hbcli api catalog/describe/call` + 缓存 + 护栏 + 测试 | 本期 |
| L2a | `hbcli mcp serve --local`(portal.catalog/describe/call) + 测试 | 本期 |
| L1-P1 | products(酒店 CRUD/目录) 与 connectors(供应商凭据) 精选模块 | 本期 |
| L1-P2 | lookout、billing 精选模块 | 后续 issue |
| L2b | hotel-be 托管网关按域契约工具 | 后续 issue(hotel-be) |

## 5. 验收口径(实测)

1. `bun test` 全绿(测试不依赖 live 环境;stub server 模式沿用 tests/mcp.test.ts)。
2. UAT live smoke(demo 票据,隔离 STAICLI_HOME):
   - `api catalog --filter lookout` 返回非空目录;
   - `api call view/getApiPaths --data '{"type":"","limit":3}'` code=0;
   - `api call` 一个写端点在不带 `--confirm` 时被拒绝、带后到达服务端;
   - `mcp serve --local` 完成 initialize → tools/list → `portal.catalog` → `portal.call` 全链 JSON-RPC;
   - 证据(命令+输出)归档 `docs/evidence/`,回写 issue #27。
