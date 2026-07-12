/**
 * commands/account.ts — entity, subscriptions, suppliers, retail (admin-facing).
 *
 * account entity list             List entities (brands/groups)
 * account entity get              Get entity details
 * account entity distribution     Distribution config
 * account subscriptions get       Get current subscription
 * account subscriptions catalog   List available plans
 * account subscriptions invoices  List invoices
 * account suppliers accessible    List accessible supplier credentials
 * account retail status           Retail onboarding status
 */

import { Command } from "commander";
import { run, parseJsonInput, type Ctx } from "./helpers.ts";

export function createAccountCommand(ctx: Ctx): Command {
  const account = new Command("account").description("Account, entity, subscriptions, and suppliers");

  // ── entity ───────────────────────────────────────────────────────────

  const entity = new Command("entity").description("Entity management (brands, groups)");
  entity.command("list").description("List entities")
    .action(async () => { await run(ctx, "/api/user/tenant/listEntity", {}); });
  entity.command("get").description("Get entity details")
    .option("--entity-id <id>", "Entity ID (omit for current)")
    .action(async (opts) => {
      const body: any = {};
      if (opts.entityId) body.entityId = opts.entityId;
      await run(ctx, "/api/user/tenant/getEntity", body);
    });
  entity.command("update").description("Update entity configuration")
    .requiredOption("--data <json>", "JSON entity data, or @file.json")
    .action(async (opts) => { await run(ctx, "/api/user/tenant/updateEntity", parseJsonInput(opts.data)); });
  entity.command("distribution").description("Get effective distribution config")
    .option("--entity-id <id>", "Entity ID")
    .action(async (opts) => {
      const body: any = {};
      if (opts.entityId) body.entityId = opts.entityId;
      await run(ctx, "/api/user/tenant/getEffectiveDistributionConfig", body);
    });
  account.addCommand(entity);

  // ── subscriptions ─────────────────────────────────────────────────────

  const subs = new Command("subscriptions").description("Subscription and billing");
  subs.command("get").description("Get current subscription")
    .action(async () => { await run(ctx, "/api/user/tenant/getSubscription", {}); });
  subs.command("catalog").description("List available plans")
    .action(async () => { await run(ctx, "/api/user/tenant/getSubscriptionCatalog", {}); });
  subs.command("start").description("Start a subscription")
    .requiredOption("--plan-id <id>", "Plan ID")
    .action(async (opts) => { await run(ctx, "/api/user/tenant/startSubscription", { planId: opts.planId }); });
  subs.command("change-plan").description("Change subscription plan")
    .requiredOption("--plan-id <id>", "Plan ID")
    .action(async (opts) => { await run(ctx, "/api/user/tenant/changeSubscriptionPlan", { planId: opts.planId }); });
  subs.command("cancel").description("Cancel subscription")
    .action(async () => { await run(ctx, "/api/user/tenant/cancelSubscription", {}); });
  subs.command("invoices").description("List invoices")
    .action(async () => { await run(ctx, "/api/user/tenant/listSubscriptionInvoices", {}); });
  account.addCommand(subs);

  // ── suppliers ──────────────────────────────────────────────────────────

  const suppliers = new Command("suppliers").description("Supplier connections");
  suppliers.command("accessible").description("List accessible supplier credentials")
    .action(async () => { await run(ctx, "/api/user/tenant/getAccessibleCredentials", {}); });
  suppliers.command("connect").description("Connect a supplier")
    .requiredOption("--supplier-id <id>", "Supplier ID")
    .option("--credentials <json>", "JSON credentials, or @file.json")
    .action(async (opts) => {
      const body: any = { supplierId: opts.supplierId };
      if (opts.credentials) body.credentials = parseJsonInput(opts.credentials);
      await run(ctx, "/api/user/tenant/connectSupplier", body);
    });
  account.addCommand(suppliers);

  // ── retail ────────────────────────────────────────────────────────────

  const retail = new Command("retail").description("Retail onboarding");
  retail.command("status").description("Get retail onboarding status")
    .action(async () => { await run(ctx, "/api/user/tenant/getRetailOnboardingStatus", {}); });
  account.addCommand(retail);

  return account;
}
