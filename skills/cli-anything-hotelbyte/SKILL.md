> ⚠️ **RETIRED (2026-10-03)** — superseded by `hbcli skill install`
> (source: hotelbyte.com/skills/hotelbyte/SKILL.md). Kept for historical
> reference (CLI-direct era, gotry #5); no longer maintained.

---
name: cli-anything-hotelbyte
description: HotelByte CLI (hbcli) — agent-native command line for hotel search, rates, two-phase booking, orders, team/subscription management, and a local MCP gateway for AI agents. Use when the user asks to search or book hotels, manage tenant portal operations, or connect an AI agent to HotelByte.
version: 0.3.0
---

# cli-anything-hotelbyte

## Overview

The HotelByte CLI turns the HotelByte hotel-distribution platform into an
agent-native tool. One `hbcli` binary with a **flat, business-oriented command
tree**; auth is auto-detected (stored appKey/appSecret → ticket for
integrators, stored portal login for admins). Every command supports `--json`
for structured agent consumption; complex args accept `@file.json` injection.

Install (self-contained binary, no runtime deps):

```bash
curl -fsSL https://github.com/hotelbyte-com/docs/releases/latest/download/install.sh | bash
```

## Quick start

```bash
hbcli auth set-credentials --app-key YOUR_KEY --app-secret YOUR_SECRET   # integrator
# or: hbcli auth login --username admin@example.com                     # admin

hbcli search hotel-list --check-in 2026-12-15 --check-out 2026-12-18 \
  --destination-name Dubai --room-occupancies '[{"adultCount":2}]'
hbcli search hotel-rates --hotel-id 900000001 --check-in 2026-12-15 --check-out 2026-12-18 \
  --room-occupancies '[{"adultCount":2}]'
hbcli trade book --rate-pkg-id rate-456 \
  --holder @holder.json --guests @guests.json
hbcli orders list --status-list confirmed
```

## MCP gateway for AI agents

```bash
hbcli mcp serve    # local stdio MCP gateway → hosted /mcp (zero secrets in agent config)
hbcli mcp token    # static long-idle token for hosted platforms / CI
```

Agent config: `{ "mcpServers": { "hotelbyte": { "command": "hbcli", "args": ["mcp", "serve"] } } }`
See the platform-side skill (`hotelbyte-travel-supply`, rendered from the
server contract) for the two-phase booking playbook with confirmation rules.

## Command tree

| Group | Commands |
|-------|----------|
| `auth` | `set-credentials`, `login`, `logout`, `whoami` |
| `search` | `hotel-list`, `hotel-rates`, `destinations`, `check-avail`, `hotel-detail`, `hotels-metadata` |
| `trade` | `book`, `cancel`, `query-orders`, `update-order` |
| `orders` | `list`, `detail`, `dashboard`, `label`, `cancel`, `create-offline-booking`, `rebooking-pending` |
| `team` | `list`, `list-roles`, `invite`, `batch-invite`, `get`, `update` |
| `account` | `entity` (list/get/update/distribution), `subscriptions` (get/catalog/start/change-plan/cancel/invoices), `suppliers` (accessible/connect), `retail status` |
| `view` | `homepage`, `retail-homepage` |
| `fx` | `rates` (daily FX reference, read-only) |
| `mcp` | `serve`, `token` |
| `version` / `update` | version info / self-update |

## Global flags

```bash
hbcli --json ...            # structured JSON output
hbcli --env uat|prod|dev ... # environment (default uat)
hbcli --repl                # interactive mode
```

## Booking semantics

- Two-phase: `search check-avail` the rate package before `trade book`.
- Duplicate submissions answer 409 DUPLICATE_WARNING — re-run book with the
  confirm-duplicate flag and a reason.
- Keep the session id from `hotel-list` through rates → check-avail → book.

## Error handling

- Auth failures: re-run `auth login` / `auth set-credentials`.
- Rates are live quotes; re-check before booking and confirm with the user.
- Use `--json` and inspect `code`/`msg` for structured errors.
