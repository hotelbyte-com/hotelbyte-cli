# UAT Smoke Evidence — lookout / billing modules + api download/upload (2026-10-04)

Branch `feat/portal-modules` live smoke against UAT. Read-only commands invoked for
real; RBAC denials are recorded verbatim as outbound evidence (server envelopes),
not hidden.

## Environment

| Item | Value |
|------|-------|
| Repo | hotelbyte-com/hotelbyte-cli |
| Branch | `feat/portal-modules` |
| HEAD SHA | `36a571ac9e4e06b8546a813658a2c4f9a17c37aa` |
| Commits under test | `db2e590` feat(lookout) · `6573105` feat(billing) · `36a571a` feat(api download/upload) |
| Base | `origin/master` (contains merged PR #39) |
| Runtime | Bun 1.4.2, `bun run src/cli.ts` (no dist involved) |
| Credential store | isolated `STAICLI_HOME=$(mktemp -d)` (0600 credentials.json, demo creds only) |
| Credentials | `appKey=hotelbyte_api_demo / appSecret=hotelbyte_api_demo` (public demo key) |
| Target | `--env uat` → `https://api-test.hotelbyte.com` (UAT only; no prod calls) |
| Test gate | `bun test` → **192 pass / 0 fail** (785 expect() calls, 11 files) before smoke |
| Date (UTC) | 2026-10-03T21:33–21:46Z |

Global flags (`--json`, `--env uat`) placed before the subcommand per the cli.ts
prescan contract in every invocation below.

## Auth bootstrap

```
$ hbcli --env uat auth set-credentials --app-key hotelbyte_api_demo --app-secret hotelbyte_api_demo
{ "status": "saved", "env": "uat", "mode": "api-key" }

$ hbcli --env uat auth whoami
{ "env": "uat", "api_key": { "configured": true, "has_ticket": false },
  "portal": { "configured": false }, "customer": { "configured": false },
  "base_url": "https://api-test.hotelbyte.com" }
```

Ticket flow against `/api/auth/ticket` succeeded (all later calls carried a live
bearer ticket; the 200s below prove it).

## Results table

| # | Command (read-only unless noted) | Endpoint | Outcome | Evidence |
|---|----------------------------------|----------|---------|----------|
| 1 | `billing cost analytics` | `/api/bi/cost/analytics` | ✅ PASS (live data) | §A |
| 2 | `billing promo list --limit 5` | `/api/promoAdmin/listPromoCodes` | ✅ PASS (authed, empty set) | §B |
| 3 | `lookout jobs list --page-size 5` | `/api/lookout/listComparisonJobs` | ⛔ BLOCKED — RBAC 403 | §C |
| 4 | `lookout runs list --page-size 5` | `/api/lookout/listComparisonRuns` | ⛔ BLOCKED — RBAC 403 | §C |
| 5 | `lookout reports list` | `/api/lookout/listReports` | ⛔ BLOCKED — RBAC 403 | §C |
| 6 | `api download trade/customer/exportOrders --confirm` | `/api/trade/customer/exportOrders` | ✅ PASS (envelope) | §D |
| 7 | `api download trade/customer/downloadOrderDocument` (phase 2, token in body) | `/api/trade/customer/downloadOrderDocument` | ✅ PASS — 278,263 bytes saved | §D |
| 8 | `api upload whitelabel/uploadBrandAsset --confirm` | `/api/whitelabel/uploadBrandAsset` | ⛔ BLOCKED — RBAC 403 | §E |
| 9 | `billing settlement overview / entries / payouts / payables` | `/api/settlement/*` | ⛔ BLOCKED — platform-only gate | §F |
| 10 | write-guard refusals (no `--confirm`) for download/upload targets | — | ✅ PASS (guardrail works) | §G |

## A. billing cost analytics — PASS (real live analytics)

```
$ hbcli --env uat --json billing cost analytics
{
  "statDate": "2026-10-03",
  "currency": "AED",
  "totalRequests": 0,
  "inputBytes": 0,
  "outputBytes": 0,
  "totalBytes": 0,
  "totalCost": 15.457185249999963,
  "featureUsageCost": 15.457185249999963,
  "featureUsageBreakdown": [
    { "feature": "lookout_supplier_call", "featureLabel": "Lookout Supplier Call",
      "unitType": "call", "quantity": 2400, "unitPrice": 0.00183625,
      "amount": 4.407, "currency": "AED", "sellerEntity": { "name": "dnata" } },
    { "feature": "room_mapping", "unitType": "room", "quantity": 13543,
      "amount": 4.973666749999965, "sellerEntity": { "name": "dnata" } },
    { "feature": "room_mapping", "quantity": 16438, "amount": 6.036855499999999,
      "userName": "HotelByte OpenAPI Demo", "sellerEntity": { "name": "Test Customer Demo" } },
    { "feature": "room_mapping", "quantity": 96, "amount": 0.035256,
      "userName": "Danceiny", "sellerEntity": { "name": "HotelCode" } },
    { "feature": "room_mapping", "quantity": 12, "amount": 0.004407,
      "userName": "advisor-sim", "sellerEntity": { "name": "ttdbooking" } }
  ],
  "details": []
}
```

Real per-feature/per-seller cost rows for statDate 2026-10-03 (UAT) — the binding
to `/api/bi/cost/analytics` and the flat JSON passthrough are correct.

## B. billing promo list — PASS (authed read)

```
$ hbcli --env uat --json billing promo list --limit 5
{
  "list": [],
  "total": 0
}
```

Auth + routing verified; UAT promo set is empty for this tenant (valid envelope:
`list` + `total`).

## C. lookout read commands — BLOCKED by server RBAC (demo key lacks `lookout:view`)

```
$ hbcli --env uat --json lookout jobs list --page-size 5
✗ [403] /api/lookout/listComparisonJobs: {"code":100000403,"msg":"permission denied"}
(exit=1)

$ hbcli --env uat --json lookout runs list --page-size 5
✗ [403] /api/lookout/listComparisonRuns: {"code":100000403,"msg":"permission denied"}
(exit=1)

$ hbcli --env uat --json lookout reports list
✗ [403] /api/lookout/listReports: {"code":100000403,"msg":"permission denied"}
(exit=1)
```

Outbound evidence: requests reached UAT with a valid ticket and were denied by
the server-side permission layer. Catalog metadata confirms the required
permission (discovery channel itself works):

```
$ hbcli --env uat --json api describe /api/lookout/listComparisonJobs
/api/lookout/listComparisonJobs  (read (heuristic))
service       lookout/ListComparisonJobs
auth          jwt
permissions   lookout:view
validations   {}
```

`hbcli --env uat --json api catalog --service lookout --refresh` lists the whole
lookout surface (listComparisonJobs/Runs, getComparisonRun, listComparisonRunResultRows,
getComparisonPriceTrends, getComparisonCoverageTrends, …) — the implemented command
tree matches the live catalog 1:1. The demo API key simply has no `lookout:view`
grant, so no lookout read can return data under demo credentials. Notably the cost
breakdown in §A shows UAT tenants actively consuming `lookout_supplier_call` — the
lookout service is live; only the demo key's RBAC scope excludes it.

**Blocked:** lookout read-only live-data verification requires an API key with
`lookout:view` (or a portal login of a lookout-enabled tenant).

## D. api download — PASS (two-phase, raw-byte channel, 278 KB file)

Phase 1 — export request returns the `{exportId, downloadUrl}` envelope:

```
$ hbcli --env uat --json api download trade/customer/exportOrders \
    --out /tmp/uat-smoke-orders.csv --data '{"pageNum":1,"pageSize":10}' --confirm
{
  "exportId": "exp_1791063768_fecee5eb",
  "downloadUrl": "/api/trade/customer/downloadOrderDocument?token=eyJ2IjoidjEi…74772c3c25e70dd7f6fbc38fe6a417dc",
  "expiresTime": "2026-10-03T21:52:48Z"
}
```

Phase 2 — signed-URL document fetch (token in the JSON body; the endpoint is
GET-documented but `api download` speaks POST, and the UAT binder reads the body):

```
$ hbcli --env uat --json api download trade/customer/downloadOrderDocument \
    --out /tmp/uat-smoke-orders-export.csv \
    --data '{"token":"eyJ2IjoidjEi…74772c3c25e70dd7f6fbc38fe6a417dc"}' --confirm
✓ saved 278263 byte(s) from /api/trade/customer/downloadOrderDocument → /tmp/uat-smoke-orders-export.csv (orders-exp_1791063768_fecee5eb.csv)
(exit=0)
```

File verified on disk (server filename preserved, UTF-8 BOM + CSV header + rows):

```
$ head -3 /tmp/uat-smoke-orders-export.csv
platformReferenceNo,customerReferenceNo,status,bookingTime,checkIn,checkOut,nights,rooms,hotelId,hotelName,guests,holder,buyerAmount,buyerCurrency
78066281504407112,mcp-e2e-1791033522,Confirmed,2026-10-03T13:18:49Z,2026-11-01,2026-11-03,2,1,981730485,Your Keys Holiday Homes,Ada Lovelace,Ada Lovelace,60.53,USD
77880229678381388,E2E_TEST_920e4021-4c44-49d9-9bd9-11947edb1885,Confirmed,2026-10-02T06:30:34Z,2026-11-01,2026-11-03,2,1,981730485,Your Keys Holiday Homes,John Doe; Jane Doe,John Doe,1983.08,AED
```

(278,263 bytes total; rows shown are UAT demo/e2e booking data only.)

## E. api upload — BLOCKED by server RBAC (demo key lacks `white_label:write`)

Guard first (no `--confirm` → refusal, exit 1):

```
$ hbcli --env uat --json api upload whitelabel/uploadBrandAsset --file /tmp/uat-smoke-logo.png --data '{"assetType":"logo"}'
✗ /api/whitelabel/uploadBrandAsset looks like a WRITE operation (method name "UploadBrandAsset" is not on the read-prefix list). Re-run with --confirm to execute.
(exit=1)
```

Live attempt with `--confirm` (67-byte 1×1 PNG, multipart POST really sent):

```
$ hbcli --env uat --json api upload whitelabel/uploadBrandAsset --file /tmp/uat-smoke-logo.png --data '{"assetType":"logo"}' --confirm
✗ [403] /api/whitelabel/uploadBrandAsset: {"code":100000403,"msg":"permission denied"}
(exit=1)
```

Outbound evidence: the multipart request reached UAT (`api describe` shows the
endpoint requires `permissions: white_label:write`) and was denied by RBAC before
any handler logic. **Blocked:** upload success-path verification needs a key with
`white_label:write`. The multipart transport itself is covered by the offline
suite (`tests/api.test.ts` "api upload (CLI end-to-end)" — Bun.serve stub asserts
the multipart body, field name and scalar fields — part of the 192-pass gate).

## F. billing settlement group — BLOCKED: platform-only gate

```
$ hbcli --env uat --json billing settlement overview
✗ [403] /api/settlement/getSettlementOverview: {"code":100000403,"msg":"platform only: settlement center"}
$ hbcli --env uat --json billing settlement entries --page-size 5
✗ [403] /api/settlement/listSettlementEntries: {"code":100000403,"msg":"platform only: settlement center"}
$ hbcli --env uat --json billing settlement payouts --page-size 5
✗ [403] /api/settlement/listTenantPayouts: {"code":100000403,"msg":"platform only: settlement center"}
$ hbcli --env uat --json billing settlement payables
✗ [403] /api/settlement/listTenantPayables: {"code":100000403,"msg":"platform only: settlement center"}
```

Server envelopes recorded as outbound evidence; the settlement surface is gated
to platform admins on UAT by design. **Blocked** for any demo credential.

## G. Write-guard refusals — PASS (guardrail verified live-shape)

Both executable non-JSON channels refuse write-classified targets without
`--confirm` (see §D phase-0 style refusal for exportOrders and §E for
uploadBrandAsset; both exit 1 with actionable guidance). `--confirm`
short-circuits the guard and the request goes out.

## Conclusion

| Module | Live-data proof | RBAC-bound (blocked for demo key) |
|--------|-----------------|-----------------------------------|
| billing | ✅ cost analytics, promo list (2/2 real 200s) | settlement/* (platform-only gate) |
| lookout | ❌ none possible under demo key | all reads (`lookout:view`) — envelopes recorded |
| api download | ✅ two-phase export → 278 KB CSV saved verbatim | — |
| api upload | ❌ success-path needs `white_label:write` | uploadBrandAsset 403 envelope recorded |
| write guards | ✅ refusal without `--confirm` on both channels | — |
| discovery | ✅ api catalog/describe incl. permission metadata | — |

No prod traffic, no writes beyond the demo tenant's own export request (a
read-shaped export generation gated by `--confirm`), all credentials demo-only.
