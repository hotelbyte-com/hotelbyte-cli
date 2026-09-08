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
# Login
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

### Agent-friendly

```bash
hbcli --json search destinations --country-code US | jq '.[] | .name'
hbcli trade book --guests @guests.json --holder @holder.json --rate-pkg-id "rate-456"
```

## Command Tree

```
hbcli
├── auth              set-credentials, login, logout, whoami
├── search            hotel-list, hotel-rates, destinations, check-avail, hotel-detail, hotels-metadata
├── trade             book, cancel, query-orders, update-order
├── orders            list, detail, dashboard, label, cancel, create-offline-booking, rebooking-pending
├── team              list, list-roles, invite, batch-invite, get, update
├── account           entity, subscriptions, suppliers, retail
├── view              homepage, retail-homepage
├── version           Show version and install path
└── update            Self-update to latest release
```

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
bun test    # 23 tests
```

## License

MIT