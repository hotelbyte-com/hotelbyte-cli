---
name: cli-anything-hotelbyte
description: HotelByte CLI — agent-native command-line interface for the OpenAPI and Tenant Portal scenarios. Use for searching hotels, managing bookings, listing users, managing subscriptions, and interacting with the HotelByte platform via structured CLI commands.
version: 0.2.0
---

# cli-anything-hotelbyte

## Overview

The HotelByte CLI turns the HotelByte hotel-booking platform into an agent-native tool. A single native binary (`hotelbyte-cli`) routes to two command profiles:

- **`openapi`** — public OpenAPI surface (search + trade). Authenticates via appKey/appSecret → JWT ticket.
- **`portal`** — tenant-portal BFF (users, orders, entity, subscriptions, suppliers, settings). Authenticates via username/password → JWT ticket.

Built with **Bun + TypeScript**, compiled to self-contained native binaries. No runtime dependencies required on the target machine.

Every command supports `--json` for structured agent consumption.

## Installation

```bash
curl -fsSL https://github.com/hotelbyte-com/hotelbyte-cli/releases/latest/download/install.sh | bash
```

## Quick Start

### OpenAPI Profile

```bash
# Set credentials (saved to ~/.hotelbyte-cli/credentials.json)
hotelbyte-cli openapi auth set-credentials --app-key YOUR_KEY --app-secret YOUR_SECRET

# Search destinations
hotelbyte-cli openapi search destinations --country-code US

# Search hotels
hotelbyte-cli openapi search hotel-list \
  --check-in 2026-08-01 --check-out 2026-08-03 \
  --country-code US --nationality-code US --residency-code US \
  --destination-id "city:123" \
  --room-occupancies '[{"adults":2,"children":[]}]'

# Get hotel rates
hotelbyte-cli openapi search hotel-rates \
  --hotel-id "hotel-123" \
  --check-in 2026-08-01 --check-out 2026-08-03 \
  --country-code US --nationality-code US --residency-code US

# Book a hotel
hotelbyte-cli openapi trade book \
  --rate-pkg-id "rate-456" \
  --holder '{"name":"John","email":"john@example.com","phone":"+1234567890"}' \
  --guests '[{"firstName":"John","lastName":"Doe","type":"adult"}]'

# Query orders
hotelbyte-cli openapi trade query-orders --customer-reference-nos "REF001,REF002"

# Cancel a booking
hotelbyte-cli openapi trade cancel \
  --customer-reference-no "REF001" \
  --supplier-reference-no "SUP001"
```

### Portal Profile

```bash
# Login (credentials saved to ~/.hotelbyte-cli/credentials.json)
hotelbyte-cli portal auth login --username admin@example.com

# Portal homepage (navigation, permissions)
hotelbyte-cli portal view paas-homepage

# List tenant orders
hotelbyte-cli portal orders list --status-list confirmed,pending

# Order detail
hotelbyte-cli portal orders detail --order-id "order-123"

# List users
hotelbyte-cli portal users list --page-num 1 --page-size 20

# Invite a user
hotelbyte-cli portal users invite --email newuser@example.com --role-id role-1

# List roles
hotelbyte-cli portal users list-roles

# Entity management
hotelbyte-cli portal entity list
hotelbyte-cli portal entity get
hotelbyte-cli portal entity distribution-config

# Subscriptions
hotelbyte-cli portal subscriptions get
hotelbyte-cli portal subscriptions catalog
hotelbyte-cli portal subscriptions invoices

# Suppliers
hotelbyte-cli portal suppliers accessible

# Retail onboarding
hotelbyte-cli portal retail status
```

### Global Flags

```bash
hotelbyte-cli --json openapi search destinations --country-code US  # JSON output
hotelbyte-cli --env prod openapi search destinations --country-code US  # Select environment
hotelbyte-cli --repl  # Interactive REPL mode
hotelbyte-cli version  # Show version + install path
hotelbyte-cli update  # Self-update to latest release
```

## Command Groups

### OpenAPI Commands

| Group | Commands |
|-------|----------|
| `openapi auth` | `set-credentials`, `ticket` |
| `openapi search` | `check-avail`, `destinations`, `hotel-list`, `hotel-rates`, `hotel-static-detail`, `hotels-metadata` |
| `openapi trade` | `book`, `cancel`, `query-orders`, `update-order` |

### Portal Commands

| Group | Commands |
|-------|----------|
| `portal auth` | `login`, `logout`, `whoami` |
| `portal search` | `check-avail`, `hotel-list`, `hotel-rates` |
| `portal orders` | `list`, `detail`, `home`, `label`, `cancel`, `create-offline-booking`, `rebooking-pending` |
| `portal users` | `list`, `get`, `invite`, `batch-invite`, `update`, `list-roles`, `list-team-members` |
| `portal entity` | `list`, `get`, `update`, `distribution-config`, `policy-status` |
| `portal customers` | `activate`, `inactivate`, `delete` |
| `portal subscriptions` | `get`, `catalog`, `start`, `change-plan`, `cancel`, `billing-portal`, `payment-methods`, `invoices` |
| `portal suppliers` | `accessible`, `connect` |
| `portal retail` | `status` |
| `portal view` | `paas-homepage`, `retail-homepage` |

## Agent Guidance

- Use `--json` on every command for structured output suitable for parsing.
- JSON file inputs: prefix with `@` to read from a file (e.g. `--guests @guests.json`).
- Credentials are cached in `~/.hotelbyte-cli/credentials.json` (mode 0600). Set `HOTELBYTE_HOME` to override.
- Environment: `--env dev|uat|prod` (default: `uat`). Or set `HOTELBYTE_ENV`.
- Env var fallbacks: `HOTELBYTE_APP_KEY`, `HOTELBYTE_APP_SECRET`, `HOTELBYTE_USERNAME`, `HOTELBYTE_PASSWORD`, `HOTELBYTE_BASE_URL`.
- The ticket is auto-refreshed; if it expires, the next command re-authenticates.
- Error handling: non-2xx responses print `✗ [status] /path: body` (human) or `{"error": "…"}` (JSON mode).
- Self-update: `hotelbyte-cli update` downloads the latest native binary from GitHub Releases.

## Architecture

```
hotelbyte-cli (single native binary, Bun-compiled)
├── openapi profile (appKey/appSecret → JWT)
│   ├── auth     → /api/auth/ticket
│   ├── search   → /api/search/*
│   └── trade    → /api/trade/*
└── portal profile (username/password → JWT)
    ├── auth     → /api/auth/login
    ├── search   → /api/search/* (same endpoints, portal JWT)
    ├── orders   → /api/trade/tenant/*
    ├── users    → /api/user/tenant/*
    ├── entity   → /api/user/tenant/*Entity
    ├── customers → /api/user/tenant/*Customer
    ├── subscriptions → /api/user/tenant/*Subscription
    ├── suppliers → /api/user/tenant/connectSupplier, getAccessibleCredentials
    ├── retail   → /api/user/tenant/getRetailOnboardingStatus
    └── view     → /api/view/paasHomepage, retailHomepage
```