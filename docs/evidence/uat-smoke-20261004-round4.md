# UAT Smoke Evidence — Round 4（2026-10-04）

分支 `feat/portal-full-surface` 全域能力面（16 组命令）live 抽样。

## 环境

| 项 | 值 |
|----|----|
| UAT base URL | `https://api-test.hotelbyte.com` |
| CLI | hbcli (staicli) v0.0.4，`bun src/cli.ts` 直跑 |
| 分支 HEAD（smoke 时） | `2006b3f`（feat 树基线 `af6a868` + coverage dashboard 提交） |
| 凭据 | demo 共享凭据 `hotelbyte_api_demo`（`auth set-credentials --app-key … --app-secret …`） |
| 隔离 | `STAICLI_HOME=$(mktemp -d)`，全程无宿主态污染；`auth whoami` 证实 `api_key.configured=true, has_ticket=true` |
| 全局旗标 | `--json --env uat` 统一置于子命令前 |
| 测试 | `bun test` → **392 pass / 0 fail**（27 files, 1610 expect，4.8s），无 live 环境依赖（fetch stub） |

## 抽样命令与输出

主样本 5 条（跨域命名样例），扩展探测 6 条补足跨组覆盖。

### ✅ 可达（7 条）

| # | 命令 | 服务端点 | 输出摘要（截取） |
|---|------|----------|------------------|
| 1 | `hbcli --json --env uat notify templates list` | `/api/notify/listTemplates` | `{"templates":[…15 条…]}`——真实模板数据（id/channel/scenario/subject/content，如 `news_source_disabled`「资讯源自动禁用通知」） |
| 2 | `hbcli --json --env uat growth dashboard` | `/api/growth/tenant/getDashboard` | `{"totalProspects":0,…,"scheduledSocialPosts":1,"funnelStats":{…7 段…}}`——零态租户的完整 dashboard 信封 |
| 3 | `hbcli --json --env uat rules families` | `/api/rule/getRuleFamilies` | 8 个规则族：`markup / block / distribution / occupancy / tax / cancellation / duplicate / supplier_payment` |
| 4 | `hbcli --json --env uat crm workspace` | `/api/crm/tenant/getWorkspaceSummary` | `{"openTripCount":0,…,"recentActivities":[3 条真实活动，id=77779471809205547…]}` |
| 5 | `hbcli --json --env uat roommap usage` | `/api/roomMapping/getMappingUsage` | `{"tenantEntityId":"","feature":"room_mapping"}` |
| 6 | `hbcli --json --env uat agents skills list` | `/api/bi/agent/listAgentSkills` | `{"skills":[…111 条 market 技能…]}`——含 `agent-reach`、`agent-workflow-governance` 等 |
| 7 | `hbcli --json --env uat notify in-app list` | `/api/notify/getInAppNotifications` | `{"rows":null,"unreadCount":0}`——空收件箱合法零态 |

### ⛔ RBAC 403（blocked，服务端信封原样记录）

| # | 命令 | 服务端点 | 服务端信封（出站证据） |
|---|------|----------|------------------------|
| B1 | `hbcli --json --env uat whitelabel get` | `/api/whitelabel/getWhiteLabelConfig` | `{"error":"[403] /api/whitelabel/getWhiteLabelConfig: {\"code\":100000403,\"msg\":\"permission denied\"}"}` |
| B2 | `hbcli --json --env uat storefront news list` | `/api/content/newsOps/listArticles` | `{"error":"[403] /api/content/newsOps/listArticles: {\"code\":100000403,\"msg\":\"permission denied\"}"}` |
| B3 | `hbcli --json --env uat reviews list --hotel-id 8558610` | `/api/evaluation/listHotelReviews` | `{"error":"[403] /api/evaluation/listHotelReviews: {\"code\":100000403,\"msg\":\"permission denied\"}"}` |

### ⚠️ 业务 400（非 RBAC，身份形态不符）

| # | 命令 | 服务端点 | 服务端信封 |
|---|------|----------|-----------|
| W1 | `hbcli --json --env uat identity preferences get` | `/api/user/tenant/getMyPreferences` | `{"error":"[400] /api/user/tenant/getMyPreferences: {\"code\":100000400,\"msg\":\"self settings requires a tenant (advisor) user\"}"}` |

W1 不是权限拒绝：demo 票据是 **integrator（API key）身份**，而 self-settings 语义要求 advisor 门户用户。
路由、鉴权、参数解析均通过（服务端业务层受理并拒绝），属预期行为，如实记录不粉饰。

## 结论表

| 域 | 组 | 结果 |
|----|----|------|
| notify | `notify` | ✅ 2/2 可达（templates list、in-app list） |
| growth | `growth` | ✅ dashboard 可达（零态信封完整） |
| rules | `rules` | ✅ families 可达（8 族全量） |
| crm | `crm` | ✅ workspace 可达（真实活动流） |
| roommap | `roommap` | ✅ usage 可达 |
| agents | `agents` | ✅ skills list 可达（111 market 技能） |
| whitelabel | `whitelabel` | ⛔ RBAC 403（demo 凭据无白标权限，服务端信封在案） |
| storefront | `storefront` | ⛔ RBAC 403（newsOps 为运营面权限） |
| reviews | `reviews` | ⛔ RBAC 403（evaluation 读写需租户角色） |
| identity | `identity` | ⚠️ 业务 400（integrator 身份无 advisor self-settings，预期内） |

**总体**：11 条只读抽样，7 可达 / 3 RBAC 403（blocked，信封齐全）/ 1 预期业务 400。
403 三条覆盖的正是服务端 `internal`/运营/租户角色权限面——CLI 侧行为正确：请求按 curated 路径发出、
票据上送、权限决策完全交给服务端 RBAC，错误信封原样透出（不吞错、不伪造成功）。
这与 coverage 看板（`coverage-20261004.md`）的 145/145 目录命中共同构成本分支的能力面证据。

## 复现

```bash
cd /Users/bytedance/work/hotel-be/.cli-lane-int
export STAICLI_HOME=$(mktemp -d)
HB=/Users/bytedance/.bun/bin/bun
$HB src/cli.ts auth set-credentials --app-key hotelbyte_api_demo --app-secret hotelbyte_api_demo --env uat
$HB src/cli.ts --json --env uat notify templates list
$HB src/cli.ts --json --env uat growth dashboard
$HB src/cli.ts --json --env uat whitelabel get          # 预期 403 信封
$HB src/cli.ts --json --env uat storefront news list    # 预期 403 信封
$HB src/cli.ts --json --env uat reviews list --hotel-id 8558610  # 预期 403 信封
```
