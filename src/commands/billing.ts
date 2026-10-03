/**
 * commands/billing.ts — cost analytics, settlement and promo codes (issue #34,
 * L1 curated billing surface).
 *
 * billing cost analytics          Cost analytics for one day / window
 * billing cost trend              Daily cost trend across a window
 * billing cost monthly-bill       One seller's monthly bill
 * billing cost pricing-rule       Effective pricing rule
 * billing settlement overview     Monthly gross/fee/net settlement overview
 * billing settlement entries      Settlement entries (paged, filterable)
 * billing settlement payables     Per-tenant per-currency unpaid balances
 * billing settlement payouts      Tenant payout list (paged)
 * billing payouts create          Create a tenant payout (write — requires --confirm)
 * billing payouts cancel          Cancel a payout (write — requires --confirm)
 * billing promo list              List promo codes
 * billing promo get               Get one promo code by ID or code
 *
 * Three services, three prefixes — all verified against the live catalog
 * (getApiPaths) and hotel-be source:
 *   cost       → @path overrides /api/bi/cost/{analytics,trend,monthlyBill,pricingRule}
 *                (CostService.Name()=="cost", payment/billing/cost_service_api_cron.go)
 *   settlement → /api/settlement/{getSettlementOverview,listSettlementEntries,
 *                listTenantPayables,listTenantPayouts,createTenantPayout,cancelTenantPayout}
 *                (Service.Name()=="settlement", payment/service/settlement/)
 *   promoAdmin → /api/promoAdmin/{listPromoCodes,getPromoCode}
 *                (PaymentPromoAdminService.Name()=="promoAdmin",
 *                api/service/payment_promo_admin.go)
 * Request shapes follow the payment protocols: cost windows are YYYY-MM-DD
 * strings, months are YYYY-MM, settlement lists paginate with flat
 * pageNum/pageSize (pagehelper.PageReq), promo list uses offset/limit.
 *
 * Write confirmation follows the catalogs guardrail (commands/catalogs.ts):
 * known writes refuse to execute without an explicit --confirm.
 */

import { Command, Option } from "commander";
import { run, type Ctx } from "./helpers.ts";
import { error } from "../utils/output.ts";

/** Write guard shared by payouts create / cancel (catalogs habit). */
function requireConfirm(ctx: Ctx, label: string, confirmed: boolean): void {
  if (confirmed) return;
  error(`${label} is a WRITE operation. Re-run with --confirm to execute.`, ctx.jsonMode());
  process.exit(1);
}

export function createBillingCommand(ctx: Ctx): Command {
  const billing = new Command("billing").description("Billing: cost analytics, settlement and promo codes");

  // ── cost ─────────────────────────────────────────────────────────────

  const cost = new Command("cost").description("Cost analytics for OpenAPI usage (portal /bi/cost)");

  cost
    .command("analytics")
    .description("Cost analytics for one day or a date window")
    .option("--stat-date <date>", "Stat date YYYY-MM-DD (defaults to today server-side)")
    .option("--start-date <date>", "Window start YYYY-MM-DD")
    .option("--end-date <date>", "Window end YYYY-MM-DD")
    .option("--seller-id <id>", "Filter by seller entity ID")
    .option("--user-id <id>", "Filter by user ID")
    .option("--api-path <path>", "Filter by API path")
    .action(async (opts) => {
      const body: any = {};
      if (opts.statDate) body.statDate = opts.statDate;
      if (opts.startDate) body.startDate = opts.startDate;
      if (opts.endDate) body.endDate = opts.endDate;
      if (opts.sellerId) body.sellerId = opts.sellerId;
      if (opts.userId) body.userId = opts.userId;
      if (opts.apiPath) body.apiPath = opts.apiPath;
      await run(ctx, "/api/bi/cost/analytics", body);
    });

  cost
    .command("trend")
    .description("Daily cost trend across a date window")
    .option("--start-date <date>", "Window start YYYY-MM-DD")
    .option("--end-date <date>", "Window end YYYY-MM-DD")
    .option("--seller-id <id>", "Filter by seller entity ID")
    .action(async (opts) => {
      const body: any = {};
      if (opts.startDate) body.startDate = opts.startDate;
      if (opts.endDate) body.endDate = opts.endDate;
      if (opts.sellerId) body.sellerId = opts.sellerId;
      await run(ctx, "/api/bi/cost/trend", body);
    });

  cost
    .command("monthly-bill")
    .description("One seller's finalized monthly bill")
    .requiredOption("--bill-month <month>", "Billing month YYYY-MM")
    .requiredOption("--seller-id <id>", "Seller entity ID")
    .action(async (opts) => {
      await run(ctx, "/api/bi/cost/monthlyBill", { billMonth: opts.billMonth, sellerId: opts.sellerId });
    });

  cost
    .command("pricing-rule")
    .description("Effective pricing rule (request / traffic / mixed)")
    .addOption(new Option("--rule-type <type>", "Rule type").choices(["request", "traffic", "mixed"]).makeOptionMandatory())
    .option("--tenant-id <id>", "Filter by tenant entity ID")
    .action(async (opts) => {
      const body: any = { ruleType: opts.ruleType };
      if (opts.tenantId) body.tenantId = opts.tenantId;
      await run(ctx, "/api/bi/cost/pricingRule", body);
    });

  billing.addCommand(cost);

  // ── settlement ───────────────────────────────────────────────────────

  const settlement = new Command("settlement").description("Settlement ledger: overview, entries, payables, payouts");

  settlement
    .command("overview")
    .description("Monthly gross/fee/net overview by money flow, channel and currency")
    .option("--from-month <month>", "Window start YYYY-MM")
    .option("--to-month <month>", "Window end YYYY-MM")
    .option("--tenant-entity-id <id>", "Filter by tenant entity ID")
    .action(async (opts) => {
      const body: any = {};
      if (opts.fromMonth) body.fromMonth = opts.fromMonth;
      if (opts.toMonth) body.toMonth = opts.toMonth;
      if (opts.tenantEntityId) body.tenantEntityId = opts.tenantEntityId;
      await run(ctx, "/api/settlement/getSettlementOverview", body);
    });

  settlement
    .command("entries")
    .description("List settlement entries (paged, filterable)")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .option("--flow <flow>", "Money flow filter")
    .option("--channel <channel>", "Payment channel filter")
    .option("--currency <code>", "Currency filter")
    .option("--from-month <month>", "Window start YYYY-MM")
    .option("--to-month <month>", "Window end YYYY-MM")
    .option("--tenant-entity-id <id>", "Filter by tenant entity ID")
    .option("--payout-id <id>", "Filter by payout ID")
    .option("--unsettled-only", "Only entries not yet assigned to a payout", false)
    .action(async (opts) => {
      const body: any = { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) };
      if (opts.flow) body.flow = opts.flow;
      if (opts.channel) body.channel = opts.channel;
      if (opts.currency) body.currency = opts.currency;
      if (opts.fromMonth) body.fromMonth = opts.fromMonth;
      if (opts.toMonth) body.toMonth = opts.toMonth;
      if (opts.tenantEntityId) body.tenantEntityId = opts.tenantEntityId;
      if (opts.payoutId) body.payoutId = opts.payoutId;
      if (opts.unsettledOnly) body.unsettledOnly = true;
      await run(ctx, "/api/settlement/listSettlementEntries", body);
    });

  settlement
    .command("payables")
    .description("Per-tenant per-currency balances available for payout")
    .option("--tenant-entity-id <id>", "Filter by tenant entity ID")
    .action(async (opts) => {
      const body: any = {};
      if (opts.tenantEntityId) body.tenantEntityId = opts.tenantEntityId;
      await run(ctx, "/api/settlement/listTenantPayables", body);
    });

  settlement
    .command("payouts")
    .description("List tenant payouts (paged)")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .option("--tenant-entity-id <id>", "Filter by tenant entity ID")
    .option("--status <status>", "Payout status filter")
    .action(async (opts) => {
      const body: any = { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) };
      if (opts.tenantEntityId) body.tenantEntityId = opts.tenantEntityId;
      if (opts.status) body.status = opts.status;
      await run(ctx, "/api/settlement/listTenantPayouts", body);
    });

  billing.addCommand(settlement);

  // ── payouts (writes) ─────────────────────────────────────────────────

  const payouts = new Command("payouts").description("Tenant payout operations (writes need --confirm)");

  payouts
    .command("create")
    .description("Create a tenant payout from settled payable balance (write operation — requires --confirm)")
    .requiredOption("--tenant-entity-id <id>", "Tenant entity ID")
    .requiredOption("--currency <code>", "Payout currency")
    .option("--beneficiary-id <id>", "Beneficiary profile ID (omit for the tenant default)")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "billing payouts create", opts.confirm);
      const body: any = { tenantEntityId: opts.tenantEntityId, currency: opts.currency };
      if (opts.beneficiaryId) body.beneficiaryId = opts.beneficiaryId;
      await run(ctx, "/api/settlement/createTenantPayout", body);
    });

  payouts
    .command("cancel")
    .description("Cancel a pending payout (write operation — requires --confirm)")
    .requiredOption("--payout-id <id>", "Payout ID")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "billing payouts cancel", opts.confirm);
      await run(ctx, "/api/settlement/cancelTenantPayout", { payoutId: opts.payoutId });
    });

  billing.addCommand(payouts);

  // ── promo ────────────────────────────────────────────────────────────

  const promo = new Command("promo").description("Promo codes: subscription discounts (portal promoAdmin)");

  promo
    .command("list")
    .description("List promo codes (paged by offset/limit)")
    .option("--status <status>", "Status filter (active, inactive)")
    .option("--offset <n>", "Offset", "0")
    .option("--limit <n>", "Page size (max 100, default 20)", "20")
    .action(async (opts) => {
      const body: any = { offset: parseInt(opts.offset, 10), limit: parseInt(opts.limit, 10) };
      if (opts.status) body.status = opts.status;
      await run(ctx, "/api/promoAdmin/listPromoCodes", body);
    });

  promo
    .command("get")
    .description("Get one promo code by ID or code")
    .option("--id <id>", "Promo code ID")
    .option("--code <code>", "Promo code string")
    .action(async (opts) => {
      if (!opts.id && !opts.code) {
        console.error("✗ --id or --code is required");
        process.exit(1);
      }
      const body: any = {};
      if (opts.id) body.id = opts.id;
      if (opts.code) body.code = opts.code;
      await run(ctx, "/api/promoAdmin/getPromoCode", body);
    });

  billing.addCommand(promo);

  return billing;
}
