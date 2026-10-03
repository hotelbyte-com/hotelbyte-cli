# staicli (hbcli)

> HotelByte CLI — search hotels, manage bookings, run your travel business from the terminal. Distributed two ways: a pure-JS npm package (needs Node ≥ 20) and self-contained native binaries (no runtime required).

**Brand:** staicli  ·  **Command:** `hbcli`

## What

A single CLI that wraps the HotelByte HTTP API with a flat, business-oriented command tree:

```
hbcli search hotel-list ...       # Search hotels
hbcli search hotel-rates ...      # Check rates
hbcli trade book ...              # Book a hotel
hbcli orders list ...             # List orders
hbcli team invite ...             # Invite a team member
hbcli account subscriptions get   # Check subscription
```

Auth is **auto-detected** — no profile switching:
- Stored API key → ticket flow (for integrators)
- Stored portal login → session flow (for admins)
- Stored customer session → customer email-code flow (C 端, advisor 的客户)

Every command supports `--json` for structured agent consumption.

## Install

Two delivery tracks:

```bash
# A. npm(纯 JS,需 Node ≥ 20)
npm install -g staicli

# B. 原生二进制(无 Node/Bun 运行时依赖)
curl -fsSL https://github.com/hotelbyte-com/docs/releases/latest/download/install.sh | bash
```

### Verify

```bash
hbcli version
hbcli --help
```

### Update / Uninstall

```bash
hbcli update
npm update -g staicli   # npm track

curl -fsSL https://github.com/hotelbyte-com/docs/releases/latest/download/uninstall.sh | bash
# With --purge to remove credentials:
curl -fsSL https://github.com/hotelbyte-com/docs/releases/latest/download/uninstall.sh | bash -s -- --purge
```

## Quick Start

### As an integrator (API key mode)

```bash
# Store your API credentials
hbcli auth set-credentials --app-key YOUR_KEY --app-secret YOUR_SECRET

# Search hotels
hbcli search hotel-list \
  --check-in 2026-08-01 --check-out 2026-08-03 \
  --country-code US --nationality-code US --residency-code US \
  --hotel-ids "461850557" \
  --room-occupancies '[{"adultCount":2,"childrenAges":[]}]'

# Check rates for a hotel
hbcli search hotel-rates --hotel-id "900000001" \
  --check-in 2026-08-01 --check-out 2026-08-03 \
  --room-occupancies '[{"adultCount":2,"childrenAges":[]}]'

# Book
hbcli trade book \
  --rate-pkg-id "rate-456" \
  --holder '{"name":"John","email":"john@example.com"}' \
  --guests '[{"firstName":"John","lastName":"Doe","type":"adult"}]'
```

### As an admin (portal mode)

```bash
# Register a new tenant (email + OTP code; auto-login on success)
hbcli auth check-domain --email you@corp.com          # optional pre-flight
hbcli auth send-code --email you@corp.com             # step 1: OTP to your inbox
hbcli auth register --email you@corp.com \
  --password 'AtLeast8Chars' --tenant-name "My Travel" --otp-code 123456
# ^ step 2: register + auto-login (ticket saved as the portal profile)

# ...or login with an existing account
hbcli auth login --username admin@example.com

# List orders
hbcli orders list --status-list confirmed

# Manage team
hbcli team list
hbcli team invite --email newuser@example.com --role-id role-1

# Subscriptions
hbcli account subscriptions get
hbcli account subscriptions catalog
```

### As a customer (C 端, advisor 的客户)

```bash
# Email + code login; a NEW email is auto-registered (no password needed)
hbcli auth customer-send-code --email guest@mail.com
hbcli auth customer-login --email guest@mail.com --code 123456

# With advisor attribution (binds you to the advisor's client book)
hbcli auth customer-login --email guest@mail.com --code 123456 --attribution-token 'v2.u...'

# Then search/book with the customer session (lowest auth precedence:
# it applies only when no portal/API-key credentials are stored)
hbcli --json search destinations --country-code US
```

### Multiple local accounts (snapshot / restore)

Named snapshots of the ticketed default slots (openapi/portal/customer), stored
in the same credential store — switching never touches the slot keys:

```bash
hbcli auth accounts save work       # snapshot current ticketed slots as "work"
hbcli auth accounts list            # all accounts, per-identity status; keys masked
                                    # (first 4 + last 2), live snapshot marked
hbcli auth accounts use home        # restore "home" into the default slots
                                    # (overwrites the live slots — warned on stderr)
hbcli auth accounts remove work     # delete a snapshot
```

`auth whoami` shows `account: <name>` when the default slots still match a
snapshot, `anonymous` otherwise. Global flags (`--json`, `--env`) go before the
subcommand: `hbcli --json auth accounts list`.

### Agent-friendly

```bash
hbcli --json search destinations --country-code US | jq '.[] | .name'
hbcli trade book --guests @guests.json --holder @holder.json --rate-pkg-id "rate-456"

# FX reference rates (daily table with provenance: date/base/rates/fetchedAt)
hbcli --json fx rates --base USD --currency CNY --currency EUR
```

### MCP gateway (AI agents)

`hbcli mcp serve` runs a local stdio MCP gateway that forwards JSON-RPC
verbatim to the hosted `/mcp` endpoint. One binary = CLI + local MCP gateway.
`hbcli mcp serve --local` switches the same command to the local tool face —
three generic tools (`portal.catalog` / `portal.describe` / `portal.call`) served
in-process over the stored credentials (zero backend deploy, writes need
`confirm: true`); wire it with `hbcli mcp setup <client> --local`.

```bash
hbcli mcp serve                  # stored credentials, current --env
hbcli mcp serve --env uat        # sandbox
hbcli mcp serve --url https://... --token ...   # CI / override
```

Agent config (Claude Code `.mcp.json`, Cursor, Codex):

```json
{ "mcpServers": { "hotelbyte": { "command": "hbcli", "args": ["mcp", "serve"] } } }
```

- Zero secrets in agent config — the ticket stays in the CLI credential store (chmod 600); agent config holds only the command line.
- Transport-only bridge: tool schemas always come from the remote `tools/list`; the gateway never hardcodes them (no drift).
- Diagnostics go to stderr; stdout is the protocol channel.

### Static agent tokens (hosted platforms)

For agents that run where you cannot install binaries (Claude web connectors,
ChatGPT plugins, cloud functions, CI), issue a static token and put it in the
config:

```bash
hbcli mcp token                       # 30-day idle window by default
hbcli mcp token --idle-seconds 3600   # custom idle window
```

- The token is a long-idle API ticket: it dies only after the idle window
  passes with zero calls; absolute lifetime is server-capped at 365 days.
- It is also stored in the CLI credential store, so `hbcli mcp serve` rides
  the same token.
- Requires API credentials (`hbcli auth set-credentials`); portal accounts
  are rejected by the ticket endpoint on purpose.
- Revoke: freeze or delete the API user in the portal. Treat the token like
  a password.

## Command Tree

```
hbcli
├── auth              set-credentials, login, logout, whoami,
│                     accounts save/list/use/remove (named multi-account snapshots),
│                     send-code, check-domain, register (B 端 tenant self-registration),
│                     customer-send-code, customer-login (C 端 email-code login/register)
├── search            hotel-list, hotel-rates, destinations, check-avail, hotel-detail, hotels-metadata
├── trade             book, cancel, query-orders, update-order
├── orders            list, detail, dashboard, label, cancel, create-offline-booking, rebooking-pending
├── team              list, list-roles, invite, batch-invite, get, update
├── account           entity, subscriptions, suppliers, retail
├── products          list, get (portal /products inventory reads)
├── catalogs          list, get, create, hotels, add-hotels, remove-hotels (writes need --confirm)
├── connectors        suppliers, accessible (alias of account suppliers accessible; connect stays in account)
├── lookout           jobs list/get/pause/resume, runs list/get/rows/trigger/cancel,
│                     reports list/get, insights price-trends/coverage-trends (writes need --confirm)
├── billing           cost analytics/trend/monthly-bill/pricing-rule,
│                     settlement overview/entries/payables/payouts, payouts create/cancel,
│                     promo list/get (writes need --confirm)
├── view              homepage, retail-homepage
├── fx                rates (daily FX reference table, read-only)
├── api               catalog, describe, call (L0 passthrough to any /api/ JSON endpoint),
│                     download (streaming file responses → --out), upload (multipart)
├── mcp               serve (local stdio gateway), token (static agent token)
├── version           Show version and install path
└── update            Self-update to latest release
```

Any portal endpoint via the L0 passthrough: `hbcli api catalog --filter lookout` → `hbcli api describe <path|service/method>` → `hbcli api call a/b/c --data '{"k":1}'` (write operations require `--confirm`; catalog cached 24h).
Non-JSON channels: `hbcli api download trade/customer/exportOrders --out orders.csv --data '{"pageNum":1,"pageSize":100}' --confirm` saves raw file responses verbatim (JSON envelopes are unpacked like `api call`); `hbcli api upload whitelabel/uploadBrandAsset --file logo.png --data '{"assetType":"logo"}' --confirm` posts multipart form data (uploads are write-classified — `--confirm` required).

## Environments

| Flag | Env var | URL |
|------|---------|-----|
| `--env dev` | `HOTELBYTE_ENV=dev` | `http://localhost:8888` |
| `--env uat` | `HOTELBYTE_ENV=uat` (default) | `https://api-test.hotelbyte.com` |
| `--env prod` | `HOTELBYTE_ENV=prod` | `https://api.hotelbyte.com` |

## Installation Layout

```
# npm track:npm 全局安装,由 npm 管理(在 PATH 的 npm prefix bin)
npm root -g   # → node_modules/staicli/dist/cli.js

# native track:install.sh 安装的版本化布局
~/.staicli/
├── versions/0.0.1/hbcli            # native binary
├── current → versions/0.0.1         # symlink
└── credentials.json                 # credential store (0600)

~/.local/bin/hbcli → ~/.staicli/versions/0.0.1/hbcli
```

两条轨共用同一个 credential store(`~/.staicli/credentials.json`),切换安装方式不影响已存凭证。

## Tests

```bash
bun install
bun test
```

## License

MIT