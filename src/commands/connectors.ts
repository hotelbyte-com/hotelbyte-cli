/**
 * commands/connectors.ts — portal /connectors supplier-connection reads (issue #32).
 *
 * connectors suppliers    List supplier connection options (search/getSuppliers)
 * connectors accessible   Alias of `account suppliers accessible`
 *
 * `connectors suppliers` reads POST /api/search/suppliers — the search service
 * GetSuppliers method (search/service/suppliers.go, @path: /suppliers per
 * SmartResolveApiPath). `connectors accessible` reads the same
 * /api/user/tenant/getAccessibleCredentials surface as `account suppliers
 * accessible` and is a discoverability alias, not a second implementation.
 *
 * Connecting a supplier (with credential material) stays where it already
 * lives: `hbcli account suppliers connect`. It is deliberately NOT duplicated
 * here — credential values are secrets and there is exactly one entry point.
 *
 * Secret hygiene: neither subcommand accepts or echoes credential material;
 * the accessible-credentials response is sanitized server-side
 * (user/service/accessible_credentials.go never serializes credential
 * metadata in supplier view).
 */

import { Command } from "commander";
import { run, type Ctx } from "./helpers.ts";

export function createConnectorsCommand(ctx: Ctx): Command {
  const connectors = new Command("connectors").description(
    "Supplier connectors: connection options and accessible credentials (connect via `account suppliers connect`)",
  );

  connectors
    .command("suppliers")
    .description("List supplier connection options (search getSuppliers; filter flags are optional)")
    .option("--only-active", "Only return active suppliers", false)
    .option("--with-credit", "Include credit information", false)
    .option("--include-unconnected", "Include suppliers available for self-service connection before credentials exist", false)
    .option("--include-mode-mismatched", "Also return credentials whose environment mode mismatches, flagged via modeMatched", false)
    .action(async (opts) => {
      const body: any = {};
      // Pointer-optional fields on the backend (*bool omitempty): send only
      // the flags the caller explicitly set, so `false` still means "absent".
      if (opts.onlyActive) body.onlyActive = true;
      if (opts.withCredit) body.withCredit = true;
      if (opts.includeUnconnected) body.includeUnconnected = true;
      if (opts.includeModeMismatched) body.includeModeMismatched = true;
      await run(ctx, "/api/search/suppliers", body);
    });

  connectors
    .command("accessible")
    .description("List accessible supplier credentials (alias of `account suppliers accessible` — same endpoint, sanitized server-side)")
    .action(async () => {
      await run(ctx, "/api/user/tenant/getAccessibleCredentials", {});
    });

  return connectors;
}
