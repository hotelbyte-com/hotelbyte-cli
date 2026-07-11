# TEST.md — HotelByte CLI Test Plan and Results

## Test Structure

| File | Scope | Backend Required |
|------|-------|-----------------|
| `test_config.py` | Profile, credential store, env var fallback | No |
| `test_http.py` | HttpClient auth injection, error handling | No (mocked) |
| `test_auth.py` | Ticket extraction, OpenAPI + portal auth flows | No (mocked) |
| `test_cli.py` | CLI smoke tests: --help, subcommand routing, --json | No |
| `test_e2e.py` | Live API calls (ticket, destinations, portal login) | Yes (env-gated) |

## Unit Test Results

Run with:
```bash
cd hotelbyte-cli
pip install -e ".[dev]"
python3 -m pytest cli_anything/hotelbyte/tests/ -v
```

### Latest Run (2026-07-12)

| Suite | Tests | Status |
|-------|-------|--------|
| test_config | 5 | ✅ Pass |
| test_http | 3 | ✅ Pass |
| test_auth | 5 | ✅ Pass |
| test_cli | 9 | ✅ Pass |
| test_e2e | 3 | ⏭️ Skipped (no HOTELBYTE_E2E_URL) |

## E2E Test Plan

E2E tests run against a live backend. Set these env vars:
- `HOTELBYTE_E2E_URL` — base URL (e.g. `https://api-test.hotelbyte.com`)
- `HOTELBYTE_APP_KEY` / `HOTELBYTE_APP_SECRET` — OpenAPI credentials
- `HOTELBYTE_USERNAME` / `HOTELBYTE_PASSWORD` — Portal credentials

### OpenAPI E2E Matrix
1. `auth ticket` → obtain JWT
2. `search destinations` → list US destinations
3. `search hotel-list` → search hotels with occupancies
4. `search hotel-rates` → get rates for a specific hotel
5. `search hotel-static-detail` → get static hotel info
6. `search hotels-metadata` → list hotel metadata
7. `trade query-orders` → query orders (may be empty in test env)
8. `trade book` → create a booking (requires valid ratePkgId)
9. `trade cancel` → cancel the booking

### Portal E2E Matrix
1. `auth login` → obtain JWT ticket
2. `view paas-homepage` → fetch portal navigation
3. `orders list` → list tenant orders
4. `users list` → list tenant users
5. `entity list` → list entities
6. `subscriptions get` → get subscription status
7. `suppliers accessible` → list accessible supplier credentials
8. `retail status` → get retail onboarding status

## Verification Notes

- All unit tests use `unittest.mock` to avoid network calls.
- `--json` output is validated to be parseable JSON.
- Credential store uses a temp directory in tests to avoid clobbering real credentials.
- E2E tests are env-gated and skip gracefully when no backend is available.