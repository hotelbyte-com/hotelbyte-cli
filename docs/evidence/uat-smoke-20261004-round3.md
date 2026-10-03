# UAT Smoke Evidence — Round 3: accounts / impersonation / presales (2026-10-04)

Branch `feat/portal-accounts-agents` (stacked on `origin/feat/portal-modules`, PR #42)
live smoke against UAT. Public presales endpoints called for real (no auth); the
demo identity's impersonation attempts are recorded verbatim as RBAC-denied —
server envelopes shown as returned, nothing retried or masked. Offline
`accounts` round-trip runs fully isolated in a throwaway `STAICLI_HOME` with
fake credentials only.

## Environment

| Item | Value |
|------|-------|
| Repo | hotelbyte-com/hotelbyte-cli |
| Branch | `feat/portal-accounts-agents` (worktree `.cli-lane-27`) |
| HEAD SHA | `e4a026f3d18d4e113b4ab91074124cfa4a3941bd` |
| Commits under test | `4790989` feat(auth accounts, #43) · `092b9fe` feat(auth mock family, #44) · `e4a026f` feat(presales, #45) |
| Stacked on | `origin/feat/portal-modules` @ `816e4e16611c8e5154ae969895fbe058db5e7791` (PR #42) |
| Runtime | Bun 1.4.2, `bun run src/cli.ts` (no dist involved) |
| Credential store | isolated `STAICLI_HOME=$(mktemp -d)` per scenario (0600 credentials.json; fake/demo values only) |
| Credentials | presales: none (public surface) · impersonation probe: `hotelbyte_api_demo` / `hotelbyte_api_demo` (public demo key) · accounts round-trip: fake `smoke-*` values |
| Target | `--env uat` → `https://api-test.hotelbyte.com` (UAT only; no prod calls) |
| Test gate | `bun test` → **246 pass / 0 fail** (973 expect() calls, 14 files) before smoke; re-run after evidence commit |
| Date (UTC) | 2026-10-03T23:2x–23:3xZ |

Global flags (`--json`, `--env`) placed before the subcommand in every
invocation below, per the `src/cli.ts` prescan contract (cli.ts:133-139).

## 1. presales chat — live SSE, `--json` mode

```
$ bun run src/cli.ts --json presales chat 'what is hotelbyte' --locale en
exit=0 · stdout = 184 JSONL lines (one per SSE `data:` event), stderr empty
line 1:  {"version":"v0.9","createSurface":{"surfaceId":"presales-chat","catalogId":"https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",...}}
line 2:  {"version":"v0.9","updateComponents":{"surfaceId":"presales-chat","components":[{"id":"root",...},{"id":"stream-text","component":"Text",...}]}}
line 3:  {"version":"v0.9","updateDataModel":{"surfaceId":"presales-chat","path":"/streamingText","value":"Great"}}
last:    {"version":"v0.9","updateDataModel":{"surfaceId":"presales-chat","path":"/streamingText","value":"?"}}
event mix: 1 createSurface + 1 updateComponents + 182 updateDataModel
```

SSE events arrived in real time and were printed per event; the streamed
answer (reconstructed from `/streamingText` deltas) begins: *"Great question!
**HotelByte** is an AI-native technology platform built for hotel distribution
businesses — agencies, wholesalers, and OTAs that connect hotels with
buyers…"* — server-side content confirms a real round-trip, not a stub.

## 2. presales chat — human-readable mode (no `--json`)

```
$ bun run src/cli.ts presales chat 'what is hotelbyte' --locale en
exit=0 · each A2UI event pretty-printed as it arrives (JSON.stringify(parsed, null, 2))
head: { "version": "v0.9", "createSurface": { "surfaceId": "presales-chat", ... } }
tail: { "version": "v0.9", "updateDataModel": { ..., "value": "🚀" } }
```

Same live stream, human-format rendering; `commands/presales.ts:61-69` defines
the two render modes (raw JSONL vs pretty) — both exercised.

## 3. presales feedback — live, lead capture

```
$ bun run src/cli.ts presales feedback --email presales-probe@example.com \
    --message-type lead --message 'cli connectivity smoke'
{
  "success": true,
  "message": "感谢您的关注！我们的团队将在 24 小时内与您联系。"
}
exit=0
```

Probe address `presales-probe@example.com` — a connectivity marker only; the
UAT inbox owner should disregard (documented here as the sender).

## 4. accounts offline round-trip — isolated `STAICLI_HOME`, fake credentials

Every step below ran with `STAICLI_HOME=$(mktemp -d)`; no live call is involved
(the two `saveProfile` seeding steps use the repo's own config API exactly like
`tests/auth_accounts.test.ts:62-69`, to simulate an already-logged-in store
without touching a live endpoint).

```
$ hbcli --json auth set-credentials --app-key smoke-key-1234 --app-secret smoke-secret-5678
{"status":"saved","env":"uat","mode":"api-key"}

$ seed openapi+portal slots with fake tickets (smoke-openapi-ticket-AAA / smoke-portal-ticket-BBB, smoke@corp.com)
seeded

$ hbcli --json auth accounts save work
{"status":"saved","account":"work","env":"uat","identities":["openapi","portal"],"savedAt":"2026-10-03T23:29:10.517Z"}

$ overwrite the slots with ANOTHER account (other-key-9999 / other@corp.com / other-ticket-CCC)
{"status":"saved","env":"uat","mode":"api-key"}  ·  overwritten

$ hbcli --json auth whoami                       ← BEFORE restore
{"env":"uat","account":"anonymous","impersonating":null,"api_key":{"configured":true,"has_ticket":false},"portal":{"configured":true,"username":"other@corp.com","has_ticket":true},"customer":{"configured":false},"base_url":"https://api-test.hotelbyte.com"}

$ hbcli --json auth accounts use work
⚠ accounts use "work" (env uat) — overwriting slots: openapi, portal     ← stderr warning
{"status":"restored","account":"work","env":"uat","restored":["openapi","portal"],"cleared":[]}

$ hbcli --json auth whoami                       ← AFTER restore
{"env":"uat","account":"work","impersonating":null,"api_key":{"configured":true,"has_ticket":true},"portal":{"configured":true,"username":"smoke@corp.com","has_ticket":true},"customer":{"configured":false},"base_url":"https://api-test.hotelbyte.com"}

$ hbcli --json auth accounts list
{"env":"uat","account_count":1,"current":"work","accounts":[{"name":"work","savedAt":"2026-10-03T23:29:10.517Z","current":true,"openapi":{"app_key":"smok****34","has_ticket":true},"portal":{"username":"smoke@corp.com","has_ticket":true},"customer":null}]}

$ ls -l $STAICLI_HOME/credentials.json
-rw-------@ 1 bytedance  staff  639 ... credentials.json     ← 0600 preserved
```

Verified: save → switch away → restore recovers the original identities
(`smoke@corp.com` back, ticket present, `account: work`); overwrite warning on
stderr; key masking `smok****34` (first 4 + last 2); `current: true` live-snapshot
marking; store stays 0600.

## 5. impersonation — demo credentials, live UAT (expected RBAC denial)

```
$ hbcli --json auth set-credentials --app-key hotelbyte_api_demo --app-secret hotelbyte_api_demo
{"status":"saved","env":"uat","mode":"api-key"}

$ hbcli --json auth mockable --customer-id 1
{"error":"[403] /api/auth/listMockableUsers: {\"code\":100000403,\"msg\":\"customer users cannot impersonate\"}"}
exit=1

$ hbcli --json auth impersonate --target-user-id 1
{"error":"[403] /api/auth/mockStart: {\"code\":100000403,\"msg\":\"no permission to perform impersonation\"}"}
exit=1

$ hbcli --json auth whoami                       ← post-state
{"env":"uat","account":"anonymous","impersonating":null,"api_key":{"configured":true,"has_ticket":true},...}
```

Both calls blocked by the server exactly as the documented permission model
predicts (`README.md:158-160`: customer users can never mock). Server errors are
surfaced verbatim with exit 1; no mock slot was written (`impersonating: null`),
so no `mock-exit` was needed — nothing to undo, nothing leaked. The success path
(mockStart → mock slot → commands run as target → mock-exit) is covered by
`tests/auth_mock.test.ts` against a local Bun.serve stub, not by this live probe;
this probe establishes the real server RBAC response for an unauthorized identity.

## Conclusions

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | `presales chat --json` live SSE | ✅ PASS | 184 events, exit 0, real answer text (§1) |
| 2 | `presales chat` human-readable | ✅ PASS | pretty per-event output, exit 0 (§2) |
| 3 | `presales feedback` live | ✅ PASS | `{success:true}`, exit 0 (§3) |
| 4 | `accounts` offline round-trip | ✅ PASS | save/overwrite/use/whoami/list/masking/0600 all correct (§4) |
| 5 | `auth mockable` demo identity | ✅ BLOCKED (expected) | server 403 `customer users cannot impersonate`, exit 1 (§5) |
| 6 | `auth impersonate` demo identity | ✅ BLOCKED (expected) | server 403 `no permission to perform impersonation`, no local residue (§5) |
| 7 | Global `--json` before subcommand | ✅ PASS | used in every invocation above (prescan contract) |
| 8 | `bun test` (no live deps) | ✅ PASS | 246 pass / 0 fail, 14 files (§ Environment; re-run post-commit) |

Not exercised live (by design): a *successful* impersonation (requires a
tenant-admin/platform identity — demo chain is customer-scoped, server denies)
and `mock-status`/`mock-exit` against live UAT for the same reason. Their
behavior is pinned by `tests/auth_mock.test.ts` (fetch-stub core + Bun.serve
CLI e2e). No production endpoints, no real business data, no tickets echoed.
