# hotelbyte-cli

> Agent-native CLI for the HotelByte platform. Built on the [CLI-Anything](https://github.com/HKUDS/CLI-Anything) harness pattern.

## What

A single CLI binary (`hotelbyte-cli`) that wraps the HotelByte HTTP API with two command profiles:

| Profile | Auth | Surface |
|---------|------|---------|
| `openapi` | appKey/appSecret → JWT ticket | Public search + trade (book, cancel, queryOrders) |
| `portal` | username/password → JWT ticket | Tenant-portal BFF (users, orders, entity, subscriptions, suppliers, settings, retail onboarding) |

Every command supports `--json` for structured agent consumption.

## Install

```bash
git clone git@github.com:hotelbyte-com/hotelbyte-cli.git
cd hotelbyte-cli
pip install -e .
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

## Tests

```bash
pip install -e ".[dev]"
python3 -m pytest cli_anything/hotelbyte/tests/ -v
```

E2E tests (requires live backend):
```bash
HOTELBYTE_E2E_URL=https://api-test.hotelbyte.com \
HOTELBYTE_APP_KEY=... HOTELBYTE_APP_SECRET=... \
python3 -m pytest cli_anything/hotelbyte/tests/test_e2e.py -v
```

## Architecture

See [HOTELBYTE.md](HOTELBYTE.md) for the full architecture SOP.

## License

MIT