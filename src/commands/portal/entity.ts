/**
 * commands/portal/entity.ts — entity, customers, subscriptions, suppliers, retail.
 */

import { Command } from "commander";
import { runPortal, type Ctx } from "./helpers.ts";
import { parseJsonInput } from "../../utils/output.ts";

// ── entity ─────────────────────────────────────────────────────────────

function createEntityGroup(ctx: Ctx): Command {
  const entity = new Command("entity").description("Tenant entity management (brands, groups, distribution config)");

  entity.command("list").description("List entities accessible to the current user")
    .action(async () => { await runPortal(ctx, "/api/user/tenant/listEntity", {}); });

  entity.command("get").description("Get a single entity")
    .option("--entity-id <id>", "Entity ID (omit for current)")
    .action(async (opts) => {
      const body: any = {};
      if (opts.entityId) body.entityId = opts.entityId;
      await runPortal(ctx, "/api/user/tenant/getEntity", body);
    });

  entity.command("update").description("Update an entity's configuration")
    .requiredOption("--entity-data <json>", "JSON entity update data, or @file.json")
    .action(async (opts) => {
      await runPortal(ctx, "/api/user/tenant/updateEntity", parseJsonInput(opts.entityData));
    });

  entity.command("distribution-config").description("Get effective distribution config for an entity")
    .option("--entity-id <id>", "Entity ID")
    .action(async (opts) => {
      const body: any = {};
      if (opts.entityId) body.entityId = opts.entityId;
      await runPortal(ctx, "/api/user/tenant/getEffectiveDistributionConfig", body);
    });

  entity.command("policy-status").description("Get entity policy status")
    .option("--entity-id <id>", "Entity ID")
    .action(async (opts) => {
      const body: any = {};
      if (opts.entityId) body.entityId = opts.entityId;
      await runPortal(ctx, "/api/user/tenant/getEntityPolicyStatus", body);
    });

  return entity;
}

// ── customers ──────────────────────────────────────────────────────────

function createCustomersGroup(ctx: Ctx): Command {
  const customers = new Command("customers").description("Customer lifecycle management");

  customers.command("activate").description("Activate a customer")
    .requiredOption("--customer-id <id>", "Customer ID")
    .action(async (opts) => { await runPortal(ctx, "/api/user/tenant/activateCustomer", { customerId: opts.customerId }); });

  customers.command("inactivate").description("Inactivate a customer")
    .requiredOption("--customer-id <id>", "Customer ID")
    .action(async (opts) => { await runPortal(ctx, "/api/user/tenant/inactivateCustomer", { customerId: opts.customerId }); });

  customers.command("delete").description("Delete a customer")
    .requiredOption("--customer-id <id>", "Customer ID")
    .action(async (opts) => { await runPortal(ctx, "/api/user/tenant/deleteCustomer", { customerId: opts.customerId }); });

  return customers;
}

// ── subscriptions ───────────────────────────────────────────────────────

function createSubscriptionsGroup(ctx: Ctx): Command {
  const subs = new Command("subscriptions").description("Subscription and billing management");

  subs.command("get").description("Get current subscription")
    .action(async () => { await runPortal(ctx, "/api/user/tenant/getSubscription", {}); });

  subs.command("catalog").description("List subscription catalog")
    .action(async () => { await runPortal(ctx, "/api/user/tenant/getSubscriptionCatalog", {}); });

  subs.command("start").description("Start a subscription")
    .requiredOption("--plan-id <id>", "Plan ID")
    .action(async (opts) => { await runPortal(ctx, "/api/user/tenant/startSubscription", { planId: opts.planId }); });

  subs.command("change-plan").description("Change subscription plan")
    .requiredOption("--plan-id <id>", "Plan ID")
    .action(async (opts) => { await runPortal(ctx, "/api/user/tenant/changeSubscriptionPlan", { planId: opts.planId }); });

  subs.command("cancel").description("Cancel subscription")
    .action(async () => { await runPortal(ctx, "/api/user/tenant/cancelSubscription", {}); });

  subs.command("billing-portal").description("Get billing portal URL")
    .action(async () => { await runPortal(ctx, "/api/user/tenant/getBillingPortal", {}); });

  subs.command("payment-methods").description("List subscription payment methods")
    .action(async () => { await runPortal(ctx, "/api/user/tenant/listSubscriptionPaymentMethods", {}); });

  subs.command("invoices").description("List subscription invoices")
    .action(async () => { await runPortal(ctx, "/api/user/tenant/listSubscriptionInvoices", {}); });

  return subs;
}

// ── suppliers ───────────────────────────────────────────────────────────

function createSuppliersGroup(ctx: Ctx): Command {
  const suppliers = new Command("suppliers").description("Supplier connection and credentials");

  suppliers.command("accessible").description("List accessible supplier credentials")
    .action(async () => { await runPortal(ctx, "/api/user/tenant/getAccessibleCredentials", {}); });

  suppliers.command("connect").description("Connect a supplier")
    .requiredOption("--supplier-id <id>", "Supplier ID")
    .option("--credentials <json>", "JSON credentials, or @file.json")
    .action(async (opts) => {
      const body: any = { supplierId: opts.supplierId };
      if (opts.credentials) body.credentials = parseJsonInput(opts.credentials);
      await runPortal(ctx, "/api/user/tenant/connectSupplier", body);
    });

  return suppliers;
}

// ── retail ──────────────────────────────────────────────────────────────

function createRetailGroup(ctx: Ctx): Command {
  const retail = new Command("retail").description("Retail onboarding status");
  retail.command("status").description("Get retail onboarding status")
    .action(async () => { await runPortal(ctx, "/api/user/tenant/getRetailOnboardingStatus", {}); });
  return retail;
}

// ── export all ──────────────────────────────────────────────────────────

export {
  createEntityGroup,
  createCustomersGroup,
  createSubscriptionsGroup,
  createSuppliersGroup,
  createRetailGroup,
};