/**
 * commands/whitelabel.ts — tenant white-label branding configuration.
 *
 * whitelabel get            Get the current tenant's white-label config
 * whitelabel update         Update the white-label config (write — requires --confirm)
 * whitelabel domains add    Add a custom domain (write — requires --confirm)
 * whitelabel domains remove Remove a custom domain (write — requires --confirm)
 *
 * All endpoints are whitelabel-service methods verified against the live
 * method registry (`/api/view/getApiPaths type=whitelabel`) and the source
 * contracts in user/service/whitelabel_service.go +
 * user/protocol/whitelabel.go: getWhiteLabelConfig, updateWhiteLabelConfig
 * (payload wraps the config as {whiteLabelConfig}), addCustomDomain /
 * removeCustomDomain (both {domain}).
 *
 * Brand asset upload/delete is covered by `api upload` / `api call`
 * (whitelabel/uploadBrandAsset, whitelabel/deleteBrandAsset) and is not
 * duplicated here.
 *
 * Write confirmation follows the `catalogs` guardrail model: known writes
 * refuse to execute without an explicit --confirm.
 */

import { Command } from "commander";
import { run, parseJsonInput, type Ctx } from "./helpers.ts";
import { error } from "../utils/output.ts";

/** Write guard shared by update / domains add / domains remove (catalogs.ts habit). */
function requireConfirm(ctx: Ctx, label: string, confirmed: boolean): void {
  if (confirmed) return;
  error(`${label} is a WRITE operation. Re-run with --confirm to execute.`, ctx.jsonMode());
  process.exit(1);
}

export function createWhitelabelCommand(ctx: Ctx): Command {
  const whitelabel = new Command("whitelabel").description("Tenant white-label branding: config and custom domains");

  whitelabel
    .command("get")
    .description("Get the current tenant's white-label config")
    .action(async () => {
      await run(ctx, "/api/whitelabel/getWhiteLabelConfig", {});
    });

  whitelabel
    .command("update")
    .description("Update the white-label config (write operation — requires --confirm)")
    .requiredOption("--data <json>", "WhiteLabelConfig JSON, or @file.json")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "whitelabel update", opts.confirm);
      await run(ctx, "/api/whitelabel/updateWhiteLabelConfig", { whiteLabelConfig: parseJsonInput(opts.data) });
    });

  const domains = new Command("domains").description("Custom domain management");

  domains
    .command("add")
    .description("Add a custom domain (starts in pending SSL state; write operation — requires --confirm)")
    .requiredOption("--domain <host>", "Custom domain host")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "whitelabel domains add", opts.confirm);
      await run(ctx, "/api/whitelabel/addCustomDomain", { domain: opts.domain });
    });

  domains
    .command("remove")
    .description("Remove a custom domain (also cleans the edge config; write operation — requires --confirm)")
    .requiredOption("--domain <host>", "Custom domain host")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "whitelabel domains remove", opts.confirm);
      await run(ctx, "/api/whitelabel/removeCustomDomain", { domain: opts.domain });
    });

  whitelabel.addCommand(domains);

  return whitelabel;
}
