# HOTELBYTE.md — Architecture SOP for the HotelByte CLI

> Derived from the CLI-Anything HARNESS.md methodology. This document is
> the single source of truth for the HotelByte CLI harness design.

## 1. What This CLI Wraps

The HotelByte platform is a Go monolith (`hotel-be`) built on go-zero. It
serves a public OpenAPI surface and a multi-audience tenant portal BFF from
one binary. Route registration is reflection-based: service methods carry
comment annotations (`@path`, `@auth`, `@permission`) that the
`ServiceDispatcher` maps to `/api/<service>/<method>` routes.

The CLI wraps the **HTTP API**, not the Go binary. It is a Bun + TypeScript
application compiled to a **self-contained native binary** via
`bun build --compile`. No Python/Node/Bun runtime is required on the
target machine — the binary embeds the entire runtime.

## 2. Technology Stack

- **Language**: TypeScript (strict mode)
- **Runtime/Compiler**: Bun (`bun build --compile` → native Mach-O / ELF binary)
- **CLI Framework**: Commander.js (`commander`)
- **HTTP**: Native `fetch` (built into Bun runtime)
- **Testing**: `bun test`
- **Distribution**: GitHub Releases with pre-compiled platform binaries

## 3. Two Profiles, One Binary

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

## 4. Authentic Software Integration

Per HARNESS.md "Authentic Software Integration" principle: the CLI calls the
**real HotelByte backend**. No mock servers, no in-process Go calls, no
fallback renderers. If the backend is unreachable, the CLI fails with a
network error — it does not fabricate responses.

## 5. Closed-Source Distribution (Claude Code style)

The CLI is distributed as **pre-compiled native binaries** via GitHub Releases:

```
Release v0.2.0 assets:
  hotelbyte-cli-darwin-arm64    # Apple Silicon (M1/M2/M3)
  hotelbyte-cli-darwin-x64      # Intel Mac
  hotelbyte-cli-linux-arm64     # ARM Linux servers
  hotelbyte-cli-linux-x64       # Intel Linux servers
  install.sh                    # One-click installer
  uninstall.sh                  # Uninstaller
```

- **No source tarball** is attached to releases (closed-source).
- The `bun build --compile` output is a native binary that cannot be
  decompiled back to source — the TypeScript is embedded in the Bun
  runtime's binary format.
- Users install via `curl | bash` and need no runtime dependencies.

### Installation Layout (Claude Code pattern)

```
~/.hotelbyte-cli/
├── versions/
│   └── 0.2.0/              # native binary for this version
│       └── hotelbyte-cli
├── current -> versions/0.2.0  # symlink to active version
└── credentials.json      # credential store (mode 0600)

~/.local/bin/hotelbyte-cli -> ~/.hotelbyte-cli/versions/0.2.0/hotelbyte-cli
```

### Self-Update

`hotelbyte-cli update` checks the GitHub API for the latest release,
downloads the platform-appropriate binary, writes it to a new version
directory, and repoints the `current` symlink — identical to how
Claude Code self-updates.

## 6. Dual Interaction Modes

### Subcommand Mode (scripting/pipelines)
```bash
hotelbyte-cli --json openapi search destinations --country-code US | jq '.[]'
```

### REPL Mode (interactive sessions)
```bash
hotelbyte-cli --repl
hotelbyte(uat)> openapi search destinations --country-code US
hotelbyte(uat)> portal orders list
```

The REPL maintains session state (active profile, last response, request
history) and supports `help`, `state`, `undo`, `exit`.

## 7. Agent-Native Design

- `--json` flag on every command → structured JSON to stdout.
- Error mode: `{"error": "message"}` to stderr (JSON), `✗ message` (human).
- `@file.json` prefix for file-based JSON inputs (large request bodies).
- Credential store at `~/.hotelbyte-cli/credentials.json` (mode 0600).
- Environment profiles: `dev`, `uat`, `prod` via `--env` or `HOTELBYTE_ENV`.

## 8. URL Path Mapping

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

## 9. Package Structure

```
hotelbyte-cli/
├── package.json                        # Bun project (commander dependency)
├── tsconfig.json                       # TypeScript strict config
├── HOTELBYTE.md                        # This file (architecture SOP)
├── README.md                           # User-facing documentation
├── .github/workflows/
│   └── release.yml                     # Tag-triggered cross-platform build + Release
├── scripts/
│   ├── install.sh                      # One-click curl|bash installer
│   ├── uninstall.sh                    # Uninstaller
│   └── build-all.ts                    # Cross-platform binary builder
├── skills/
│   └── cli-anything-hotelbyte/
│       └── SKILL.md                    # Agent-discoverable skill
├── src/
│   ├── cli.ts                          # Top-level entry point (commander + REPL + update)
│   ├── core/
│   │   ├── config.ts                   # Profile, credential store, environments
│   │   ├── http.ts                     # HttpClient, HotelByteError (fetch wrapper)
│   │   ├── auth.ts                     # authenticateOpenapi/portal
│   │   └── state.ts                    # SessionState (REPL)
│   ├── utils/
│   │   ├── repl.ts                     # Banner, prompt, REPL loop
│   │   └── output.ts                    # emit()/error()/parseJsonInput() (--json support)
│   └── commands/
│       ├── openapi/
│       │   ├── group.ts                # createOpenapiGroup()
│       │   ├── auth.ts                 # set-credentials, ticket
│       │   ├── search.ts              # check-avail, destinations, hotel-list, hotel-rates, hotel-static-detail, hotels-metadata
│       │   └── trade.ts               # book, cancel, query-orders, update-order
│       └── portal/
│           ├── group.ts                # createPortalGroup()
│           ├── auth.ts                 # login, logout, whoami
│           ├── helpers.ts              # makePortalClient() + runPortal() shared
│           ├── search.ts              # check-avail, hotel-list, hotel-rates
│           ├── orders.ts              # list, detail, home, label, cancel, create-offline-booking, rebooking-pending
│           ├── users.ts               # list, get, invite, batch-invite, update, list-roles, list-team-members
│           ├── entity.ts              # entity, customers, subscriptions, suppliers, retail
│           └── view.ts                # paas-homepage, retail-homepage
└── tests/
    ├── config.test.ts                 # Credential store, env var fallback
    ├── auth.test.ts                   # Ticket extraction, auth flows
    └── cli.test.ts                    # CLI smoke tests (--help, subcommand routing)
```

## 10. Constraints

- Bun >= 1.1.0 for development (compile step).
- **Zero runtime dependencies** on target machine — the compiled binary is self-contained.
- `commander` is the only npm dependency, bundled into the binary at compile time.
- Credential file is mode 0600; tokens are cached per-environment.
- The CLI does not compute money, currencies, or prices — it passes
  through backend responses verbatim.