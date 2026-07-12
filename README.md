# staicli (hbcli)

> HotelByte CLI — search hotels, manage bookings, run your travel business from the terminal. Built with Bun + TypeScript, distributed as self-contained native binaries (Claude Code style).

**Brand:** staicli  ·  **Command:** `hbcli`

## What

A single CLI binary that wraps the HotelByte HTTP API with a flat, business-oriented command tree:

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

```bash
curl -fsSL https://github.com/hotelbyte-com/docs/releases/latest/download/install.sh | bash
```

Pre-compiled native binary — **no Python, Node, or Bun runtime required**.

### Verify

```bash
hbcli version
hbcli --help
```

### Update / Uninstall

```bash
hbcli update

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
~/.staicli/
├── versions/0.0.1/hbcli            # native binary
├── current → versions/0.0.1         # symlink
└── credentials.json                 # credential store (0600)

~/.local/bin/hbcli → ~/.staicli/versions/0.0.1/hbcli
```

## Tests

```bash
bun install
bun test    # 23 tests
```

## License

MIT