# hotelbyte-cli

> Agent-native CLI for the HotelByte platform. Built with Bun + TypeScript, distributed as self-contained native binaries (Claude Code style).

## What

A single CLI binary (`hotelbyte-cli`) that wraps the HotelByte HTTP API with two command profiles:

| Profile | Auth | Surface |
|---------|------|---------|
| `openapi` | appKey/appSecret → JWT ticket | Public search + trade (book, cancel, queryOrders) |
| `portal` | username/password → JWT ticket | Tenant-portal BFF (users, orders, entity, subscriptions, suppliers, settings, retail onboarding) |

Every command supports `--json` for structured agent consumption.

## Install

### One-line install (recommended)

```bash
curl -fsSL https://github.com/hotelbyte-com/hotelbyte-cli/releases/latest/download/install.sh | bash
```

This downloads a pre-compiled native binary — **no Python, Node, or Bun runtime required**. The binary is installed to `~/.hotelbyte-cli/versions/<version>/` with a symlink in `~/.local/bin/`.

### Verify

```bash
hotelbyte-cli version
hotelbyte-cli --help
```

### Update

```bash
hotelbyte-cli update
```

### Uninstall

```bash
curl -fsSL https://github.com/hotelbyte-com/hotelbyte-cli/releases/latest/download/uninstall.sh | bash
# With --purge to remove credentials too:
curl -fsSL https://github.com/hotelbyte-com/hotelbyte-cli/releases/latest/download/uninstall.sh | bash -s -- --purge
```

### From source (development)

```bash
git clone git@github.com:hotelbyte-com/hotelbyte-cli.git
cd hotelbyte-cli
bun install
bun run dev -- --help

# Build native binary for current platform
bun run build

# Build for all platforms
bun run build:all
```

## Quick Start

### OpenAPI

```bash
# Set credentials
hotelbyte-cli openapi auth set-credentials --app-key YOUR_KEY --app-secret YOUR_SECRET

# Search destinations
hotelbyte-cli openapi search destinations --country-code US

# Search hotels
hotelbyte-cli openapi search hotel-list \
  --check-in 2026-08-01 --check-out 2026-08-03 \
  --country-code US --nationality-code US --residency-code US \
  --destination-id "city:123" \
  --room-occupancies '[{"adults":2}]'

# Book
hotelbyte-cli openapi trade book \
  --rate-pkg-id "rate-456" \
  --holder '{"name":"John","email":"j@example.com"}' \
  --guests '[{"firstName":"John","lastName":"Doe","type":"adult"}]'
```

### Tenant Portal

```bash
# Login
hotelbyte-cli portal auth login --username admin@example.com

# Portal navigation
hotelbyte-cli portal view paas-homepage

# List orders
hotelbyte-cli portal orders list --status-list confirmed

# List users
hotelbyte-cli portal users list

# Subscriptions
hotelbyte-cli portal subscriptions get
hotelbyte-cli portal subscriptions catalog
```

### Global Flags

```bash
hotelbyte-cli --json openapi search destinations --country-code US  # structured JSON
hotelbyte-cli --env prod portal orders list                         # production
hotelbyte-cli --repl                                               # interactive REPL
```

## Environments

| Flag | Env var | URL |
|------|---------|-----|
| `--env dev` | `HOTELBYTE_ENV=dev` | `http://localhost:8888` |
| `--env uat` | `HOTELBYTE_ENV=uat` | `https://api-test.hotelbyte.com` |
| `--env prod` | `HOTELBYTE_ENV=prod` | `https://api.hotelbyte.com` |

Credentials are stored in `~/.hotelbyte-cli/credentials.json` (mode 0600).

## Installation Layout (Claude Code style)

```
~/.hotelbyte-cli/
├── versions/
│   └── 0.2.0/              # native binary for this version
│       └── hotelbyte-cli
├── current -> versions/0.2.0  # symlink to active version
└── credentials.json      # credential store (mode 0600)

~/.local/bin/hotelbyte-cli -> ~/.hotelbyte-cli/versions/0.2.0/hotelbyte-cli
```

## Tests

```bash
bun install
bun test
```

## Architecture

See [HOTELBYTE.md](HOTELBYTE.md) for the full architecture SOP.

## License

MIT