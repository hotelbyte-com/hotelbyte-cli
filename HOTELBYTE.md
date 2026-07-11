# HOTELBYTE.md — Architecture SOP for the HotelByte CLI

> Derived from the CLI-Anything HARNESS.md methodology. This document is
> the single source of truth for the HotelByte CLI harness design.

## 1. What This CLI Wraps

The HotelByte platform is a Go monolith (`hotel-be`) built on go-zero. It
serves a public OpenAPI surface and a multi-audience tenant portal BFF from
one binary. Route registration is reflection-based: service methods carry
comment annotations (`@path`, `@auth`, `@permission`) that the
`ServiceDispatcher` maps to `/api/<service>/<method>` routes.

The CLI wraps the **HTTP API**, not the Go binary. It is a Python Click
application that calls the real backend over HTTPS — no mock servers, no
in-process stubs.

## 2. Two Profiles, One Binary

### Design Decision: Profile Routing (not separate CLIs)

**Rationale:**
- Both profiles share the same backend, base URL, JWT auth mechanism, and
  HTTP client infrastructure.
- Portal auth (login → JWT) is a superset of OpenAPI auth (ticket → JWT).
- A single binary with `openapi` / `portal` subcommand groups keeps shared
  code DRY while presenting distinct command surfaces per audience.
- Agents can discover both surfaces from `hotelbyte-cli --help`.

**Alternative considered:** Two separate CLIs (`hotelbyte-openapi-cli` and
`hotelbyte-portal-cli`). **Rejected** because it duplicates the HTTP client,
config store, auth flow, and REPL infrastructure for no architectural gain.

### Profile Comparison

| Aspect | OpenAPI | Portal |
|--------|---------|--------|
| Auth | appKey/appSecret → ticket | username/password → login |
| Token endpoint | `POST /api/auth/ticket` | `POST /api/auth/login` |
| Search | `/api/search/*` | `/api/search/*` (same, portal JWT) |
| Trade | `/api/trade/book`, `cancel`, `queryOrders`, `updateOrder` | `/api/trade/tenant/*` (tenant-scoped) |
| Users | — | `/api/user/tenant/*` |
| Entity | — | `/api/user/tenant/*Entity` |
| Subscriptions | — | `/api/user/tenant/*Subscription` |
| View/Menu | — | `/api/view/paasHomepage`, `retailHomepage` |

## 3. Authentic Software Integration

Per HARNESS.md "Authentic Software Integration" principle: the CLI calls the
**real HotelByte backend**. No mock servers, no in-process Go calls, no
fallback renderers. If the backend is unreachable, the CLI fails with a
network error — it does not fabricate responses.

## 4. Dual Interaction Modes

### Subcommand Mode (scripting/pipelines)
```bash
hotelbyte-cli openapi search destinations --country-code US --json | jq '.[]'
```

### REPL Mode (interactive sessions)
```bash
hotelbyte-cli --repl
hotelbyte(uat)> openapi search destinations --country-code US
hotelbyte(uat)> portal orders list
```

The REPL maintains session state (active profile, last response, request
history) and supports `help`, `state`, `undo`, `exit`.

## 5. Agent-Native Design

- `--json` flag on every command → structured JSON to stdout.
- Error mode: `{"error": "message"}` to stderr (JSON), `✗ message` (human).
- `@file.json` prefix for file-based JSON inputs (large request bodies).
- Credential store at `~/.hotelbyte-cli/credentials.json` (mode 0600).
- Environment profiles: `dev`, `uat`, `prod` via `--env` or `HOTELBYTE_ENV`.

## 6. URL Path Mapping

The HotelByte backend uses a reflection-based dispatcher:
`/api/<serviceName>/<methodPath>`.

The CLI maps profile commands to backend paths:

| CLI command | Backend path |
|------------|-------------|
| `openapi auth ticket` | `POST /api/auth/ticket` |
| `openapi search check-avail` | `POST /api/search/checkAvail` |
| `openapi search destinations` | `POST /api/search/destinations` |
| `openapi search hotel-list` | `POST /api/search/hotelList` |
| `openapi search hotel-rates` | `POST /api/search/hotelRates` |
| `openapi search hotel-static-detail` | `POST /api/search/hotelStaticDetail` |
| `openapi search hotels-metadata` | `POST /api/search/hotelsMetadata` |
| `openapi trade book` | `POST /api/trade/book` |
| `openapi trade cancel` | `POST /api/trade/cancel` |
| `openapi trade query-orders` | `POST /api/trade/queryOrders` |
| `openapi trade update-order` | `POST /api/trade/updateOrder` |
| `portal auth login` | `POST /api/auth/login` |
| `portal orders list` | `POST /api/trade/tenant/listOrder` |
| `portal orders detail` | `POST /api/trade/tenant/detailOrder` |
| `portal orders home` | `POST /api/trade/tenant/orderHomeFunction` |
| `portal users list` | `POST /api/user/tenant/listUser` |
| `portal users invite` | `POST /api/user/tenant/inviteUser` |
| `portal entity list` | `POST /api/user/tenant/listEntity` |
| `portal entity get` | `POST /api/user/tenant/getEntity` |
| `portal subscriptions get` | `POST /api/user/tenant/getSubscription` |
| `portal suppliers accessible` | `POST /api/user/tenant/getAccessibleCredentials` |
| `portal view paas-homepage` | `POST /api/view/paasHomepage` |

## 7. Package Structure

```
hotelbyte-cli/
├── setup.py                              # pip install -e . → hotelbyte-cli entry point
├── pytest.ini
├── HOTELBYTE.md                          # This file (architecture SOP)
├── skills/
│   └── cli-anything-hotelbyte/
│       └── SKILL.md                      # Agent-discoverable skill
└── cli_anything/
    └── hotelbyte/
        ├── __init__.py
        ├── cli.py                        # Top-level Click group + REPL
        ├── core/
        │   ├── config.py                  # Profile, credential store, environments
        │   ├── http.py                    # HttpClient, HotelByteError
        │   ├── auth.py                   # authenticate_openapi/portal
        │   └── state.py                   # SessionState (REPL)
        ├── utils/
        │   ├── repl_skin.py               # Banner, prompt, REPL loop
        │   └── output.py                  # emit()/error() (--json support)
        ├── commands/
        │   ├── openapi/
        │   │   ├── group.py               # register_openapi()
        │   │   ├── auth.py                # set-credentials, ticket
        │   │   ├── search.py              # check-avail, destinations, hotel-list, hotel-rates, hotel-static-detail, hotels-metadata
        │   │   └── trade.py              # book, cancel, query-orders, update-order
        │   └── portal/
        │       ├── group.py               # register_portal()
        │       ├── auth.py                # login, logout, whoami
        │       ├── search.py              # check-avail, hotel-list, hotel-rates
        │       ├── orders.py              # list, detail, home, label, cancel, create-offline-booking, rebooking-pending
        │       ├── users.py               # list, get, invite, batch-invite, update, list-roles, list-team-members
        │       ├── entity.py              # entity, customers, subscriptions, suppliers, retail
        │       └── view.py               # paas-homepage, retail-homepage
        └── tests/
            ├── test_config.py
            ├── test_http.py
            ├── test_auth.py
            ├── test_cli.py
            ├── test_e2e.py
            └── TEST.md
```

## 8. Constraints

- Python >= 3.9, Click >= 8.1, requests >= 2.28.
- No runtime dependency on the HotelBE Go binary — pure HTTP client.
- Credential file is mode 0600; tokens are cached per-environment.
- The CLI does not compute money, currencies, or prices — it passes
  through backend responses verbatim.