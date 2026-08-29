# HotelByte CLI agent guidance

This repository owns the Bun/TypeScript `hbcli` command surface, API client,
credential storage, native builds, installers, and agent-facing JSON output.

## Work here

- Read `README.md`, `package.json`, and the affected command/core module before editing.
- Preserve CLI flags, exit codes, stdout JSON schemas, stderr diagnostics, environment selection, and credential file permissions as public contracts.
- UAT is the documented default, but tests must not depend on a live environment. Production calls, bookings, cancellations, invites, or credential changes require an explicit target and authorization.
- Keep installers idempotent and preserve existing versions/credentials unless `--purge` is explicitly requested.
- Do not hand-edit `dist/` binaries; build them from `src/` and `scripts/`.

## Verification

- Run `bun test` for behavior changes.
- Run `bun run src/cli.ts --help` for command-tree or flag changes.
- Run `bun run build` only when native packaging or install behavior changes.

## Code Review Rules

- Flag breaking JSON output, secrets in logs/tests, implicit production routing,
  live writes in default tests, swallowed API errors, insecure credential modes,
  and installer/update paths that can overwrite or delete unrelated files.
