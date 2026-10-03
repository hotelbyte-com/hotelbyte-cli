/**
 * commands/inventory.ts — extranet inventory: stop-sale rules, release periods,
 * calendar matrices, and inventory-domain reports.
 *
 * inventory stop-sale list             List Stop-Sale rules
 * inventory stop-sale create           Create a Stop-Sale rule (write — requires --confirm)
 * inventory stop-sale lift             Lift one Stop-Sale rule (write — requires --confirm)
 * inventory stop-sale bulk             Bulk lift/delete Stop-Sale rules (write — requires --confirm)
 * inventory release-periods list       List release periods
 * inventory release-periods create     Create a release period (write — requires --confirm)
 * inventory release-periods delete     Delete a release period (write — requires --confirm)
 * inventory calendar inventory-matrix  Read the inventory calendar grid
 * inventory calendar rate-matrix       Read the rate calendar grid
 * inventory calendar bulk-update       Batch-edit inventory calendar cells (write — requires --confirm)
 * inventory reports commission         Commission report (per hotel×room)
 * inventory reports sales              Sales report (per hotel×room×date)
 * inventory reports inventory          Inventory report (per hotel×room×date)
 *
 * All endpoints are inventory-service methods (reflection routing under
 * /api/inventory/, verified live via /api/view/getApiPaths type=inventory):
 * listStopSales / getStopSale / createStopSale / liftStopSale /
 * bulkLiftStopSales / bulkDeleteStopSales (stop_sale.go, stop_sale_bulk_ops.go),
 * listReleasePeriods / createReleasePeriod / deleteReleasePeriod
 * (release_period.go), getInventoryMatrix / bulkUpdateInventory
 * (inventory_item.go), getRateMatrix (rate_calendar.go), getCommissionReport /
 * getSalesReport / getInventoryReport (report.go).
 *
 * Write confirmation follows the `catalogs` guardrail model: known writes
 * refuse to execute without an explicit --confirm.
 * IDs travel as strings (types.ID accepts both), page/version/count fields are
 * coerced to numbers (plain Go ints reject JSON strings), and date fields pass
 * through verbatim (types.DateInt accepts "20250101" / "2025-01-01" / now()).
 */

import { Command, Option } from "commander";
import { run, parseJsonInput, type Ctx } from "./helpers.ts";
import { error } from "../utils/output.ts";

/** Write guard shared by every mutating subcommand (catalogs.ts habit). */
function requireConfirm(ctx: Ctx, label: string, confirmed: boolean): void {
  if (confirmed) return;
  error(`${label} is a WRITE operation. Re-run with --confirm to execute.`, ctx.jsonMode());
  process.exit(1);
}

/** Exit with a client-side validation message (no HTTP call). */
function fail(ctx: Ctx, msg: string): never {
  error(msg, ctx.jsonMode());
  process.exit(1);
}

/** Comma-separated CLI flag → trimmed string array (catalogs.ts habit). */
function splitList(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

export function createInventoryCommand(ctx: Ctx): Command {
  const inventory = new Command("inventory").description(
    "Extranet inventory: stop-sale rules, release periods, calendars, reports",
  );

  // ── stop-sale ─────────────────────────────────────────────────────────

  const stopSale = new Command("stop-sale").description("Stop-Sale rules (extranet_manual origin)");

  stopSale
    .command("list")
    .description("List Stop-Sale rules (paged, filterable)")
    .option("--hotel-id <id>", "Filter by hotel ID")
    .option("--room-type-code <code>", "Filter by room type code")
    .option("--status <status>", "Filter by status")
    .option("--origin <origin>", "Filter by rule origin")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) };
      if (opts.hotelId) body.hotelId = opts.hotelId;
      if (opts.roomTypeCode) body.roomTypeCode = opts.roomTypeCode;
      if (opts.status) body.status = opts.status;
      if (opts.origin) body.origin = opts.origin;
      await run(ctx, "/api/inventory/listStopSales", body);
    });

  stopSale
    .command("create")
    .description("Create a Stop-Sale rule (write operation — requires --confirm)")
    .requiredOption("--hotel-id <id>", "Hotel ID")
    .requiredOption("--date-from <date>", "Start date (20250101 or 2025-01-01)")
    .requiredOption("--date-to <date>", "End date (inclusive)")
    .option("--room-type-code <code>", "Room type code (omit = whole hotel)")
    .option("--source-markets <list>", "Comma-separated source markets (omit = all markets)")
    .option("--reason <text>", "Free-text reason")
    .option("--precedence <n>", "Rule precedence", parseInt)
    .option("--rate-lock-mode <mode>", "Rate lock mode")
    .option("--cm-ref <ref>", "Channel-manager reference")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "inventory stop-sale create", opts.confirm);
      const stopSaleBody: any = { hotelId: opts.hotelId, dateFrom: opts.dateFrom, dateTo: opts.dateTo };
      if (opts.roomTypeCode) stopSaleBody.roomTypeCode = opts.roomTypeCode;
      if (opts.sourceMarkets) stopSaleBody.sourceMarkets = splitList(opts.sourceMarkets);
      if (opts.reason) stopSaleBody.reason = opts.reason;
      if (opts.precedence !== undefined) stopSaleBody.precedence = opts.precedence;
      if (opts.rateLockMode) stopSaleBody.rateLockMode = opts.rateLockMode;
      if (opts.cmRef) stopSaleBody.cmRef = opts.cmRef;
      await run(ctx, "/api/inventory/createStopSale", { stopSale: stopSaleBody });
    });

  stopSale
    .command("lift")
    .description("Lift (deactivate) one Stop-Sale rule (write operation — requires --confirm)")
    .requiredOption("--id <id>", "Stop-Sale rule ID")
    .requiredOption("--version <n>", "Current version (optimistic lock)")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "inventory stop-sale lift", opts.confirm);
      await run(ctx, "/api/inventory/liftStopSale", { id: opts.id, version: parseInt(opts.version, 10) });
    });

  stopSale
    .command("bulk")
    .description("Bulk lift or delete Stop-Sale rules (write operation — requires --confirm)")
    .addOption(new Option("--op <op>", "Bulk operation").choices(["lift", "delete"]))
    .requiredOption("--items <json>", 'Items JSON array of {id, version}, or @file.json')
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "inventory stop-sale bulk", opts.confirm);
      const raw = parseJsonInput(opts.items);
      if (!Array.isArray(raw) || raw.length === 0) {
        fail(ctx, "--items must be a non-empty JSON array of {id, version}");
      }
      const items = raw.map((it: any) => ({ id: String(it?.id ?? ""), version: Number(it?.version) }));
      if (items.some((it) => !it.id || !Number.isInteger(it.version))) {
        fail(ctx, "every item needs a non-empty id and an integer version");
      }
      const path = opts.op === "lift" ? "/api/inventory/bulkLiftStopSales" : "/api/inventory/bulkDeleteStopSales";
      await run(ctx, path, { items });
    });

  inventory.addCommand(stopSale);

  // ── release-periods ───────────────────────────────────────────────────

  const releasePeriods = new Command("release-periods").description("Release periods (contract release windows)");

  releasePeriods
    .command("list")
    .description("List release periods (paged, filterable)")
    .option("--hotel-id <id>", "Filter by hotel ID")
    .option("--room-type-code <code>", "Filter by room type code")
    .option("--contract-id <id>", "Filter by contract ID")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) };
      if (opts.hotelId) body.hotelId = opts.hotelId;
      if (opts.roomTypeCode) body.roomTypeCode = opts.roomTypeCode;
      if (opts.contractId) body.contractId = opts.contractId;
      await run(ctx, "/api/inventory/listReleasePeriods", body);
    });

  releasePeriods
    .command("create")
    .description("Create a release period (write operation — requires --confirm)")
    .requiredOption("--hotel-id <id>", "Hotel ID")
    .option("--room-type-code <code>", "Room type code")
    .option("--contract-id <id>", "Contract ID")
    .option("--effective-from <date>", "Effective from (20250101 or 2025-01-01)")
    .option("--effective-to <date>", "Effective to")
    .option("--days-before-checkin <n>", "Release N days before check-in", parseInt)
    .option("--cutoff-time <time>", "Cutoff time (e.g. 18:00)")
    .option("--fixed-release-date <date>", "Fixed release date")
    .option("--timezone <tz>", "IANA timezone (e.g. Asia/Shanghai)")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "inventory release-periods create", opts.confirm);
      const period: any = { hotelId: opts.hotelId };
      if (opts.roomTypeCode) period.roomTypeCode = opts.roomTypeCode;
      if (opts.contractId) period.contractId = opts.contractId;
      if (opts.effectiveFrom) period.effectiveFrom = opts.effectiveFrom;
      if (opts.effectiveTo) period.effectiveTo = opts.effectiveTo;
      if (opts.daysBeforeCheckin !== undefined) period.daysBeforeCheckin = opts.daysBeforeCheckin;
      if (opts.cutoffTime) period.cutoffTime = opts.cutoffTime;
      if (opts.fixedReleaseDate) period.fixedReleaseDate = opts.fixedReleaseDate;
      if (opts.timezone) period.timezone = opts.timezone;
      await run(ctx, "/api/inventory/createReleasePeriod", { releasePeriod: period });
    });

  releasePeriods
    .command("delete")
    .description("Soft-delete a release period (write operation — requires --confirm)")
    .requiredOption("--id <id>", "Release period ID")
    .requiredOption("--version <n>", "Current version (optimistic lock)")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "inventory release-periods delete", opts.confirm);
      await run(ctx, "/api/inventory/deleteReleasePeriod", { id: opts.id, version: parseInt(opts.version, 10) });
    });

  inventory.addCommand(releasePeriods);

  // ── calendar ──────────────────────────────────────────────────────────

  const calendar = new Command("calendar").description("Per-day inventory and rate calendars");

  const matrixOptions = (cmd: Command): Command =>
    cmd
      .requiredOption("--hotel-id <id>", "Hotel ID")
      .requiredOption("--date-from <date>", "Range start (20250101 or 2025-01-01)")
      .requiredOption("--date-to <date>", "Range end (inclusive)")
      .option("--room-type-code <code>", "Filter by room type (omit = whole hotel)")
      .option("--rate-id <id>", "Filter by rate ID (omit = whole room type)");

  const inventoryMatrix = calendar
    .command("inventory-matrix")
    .description("Read the inventory calendar grid (allotment/sold/available/stop-sale per day)");
  matrixOptions(inventoryMatrix);
  inventoryMatrix.action(async (opts) => {
    const body: any = { hotelId: opts.hotelId, dateFrom: opts.dateFrom, dateTo: opts.dateTo };
    if (opts.roomTypeCode) body.roomTypeCode = opts.roomTypeCode;
    if (opts.rateId) body.rateId = opts.rateId;
    await run(ctx, "/api/inventory/getInventoryMatrix", body);
  });

  const rateMatrix = calendar
    .command("rate-matrix")
    .description("Read the rate calendar grid (net/gross/currency/board per day)");
  matrixOptions(rateMatrix);
  rateMatrix.action(async (opts) => {
    const body: any = { hotelId: opts.hotelId, dateFrom: opts.dateFrom, dateTo: opts.dateTo };
    if (opts.roomTypeCode) body.roomTypeCode = opts.roomTypeCode;
    if (opts.rateId) body.rateId = opts.rateId;
    await run(ctx, "/api/inventory/getRateMatrix", body);
  });

  calendar
    .command("bulk-update")
    .description("Batch-edit inventory calendar cells (write operation — requires --confirm)")
    .requiredOption("--hotel-id <id>", "Hotel ID")
    .requiredOption(
      "--items <json>",
      'Cells JSON array of {roomTypeCode, rateId?, date, allotment?, stopSale?, releaseBlocked?, isFreesale?, cappedAmount?}, or @file.json',
    )
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "inventory calendar bulk-update", opts.confirm);
      const items = parseJsonInput(opts.items);
      if (!Array.isArray(items) || items.length === 0) {
        fail(ctx, "--items must be a non-empty JSON array of calendar cells");
      }
      if (items.some((it: any) => !it?.roomTypeCode || (it?.date === undefined && it?.date === null))) {
        fail(ctx, "every cell needs roomTypeCode and date");
      }
      await run(ctx, "/api/inventory/bulkUpdateInventory", { hotelId: opts.hotelId, items });
    });

  inventory.addCommand(calendar);

  // ── reports ───────────────────────────────────────────────────────────

  const reports = new Command("reports").description("Inventory-domain reports (backend-computed money columns)");

  const reportOptions = (cmd: Command): Command =>
    cmd
      .requiredOption("--hotel-id <id>", "Hotel ID")
      .requiredOption("--date-from <date>", "Range start (20250101 or 2025-01-01)")
      .requiredOption("--date-to <date>", "Range end (inclusive)")
      .option("--room-type-code <code>", "Optional room type filter");

  const reportAction = (path: string) => async (opts: any) => {
    const body: any = { hotelId: opts.hotelId, dateFrom: opts.dateFrom, dateTo: opts.dateTo };
    if (opts.roomTypeCode) body.roomTypeCode = opts.roomTypeCode;
    await run(ctx, path, body);
  };

  const commission = reports.command("commission").description("Commission report (buyer/seller/commission per hotel×room)");
  reportOptions(commission);
  commission.action(reportAction("/api/inventory/getCommissionReport"));

  const sales = reports.command("sales").description("Sales report (orders/room-nights/sales amount per hotel×room×date)");
  reportOptions(sales);
  sales.action(reportAction("/api/inventory/getSalesReport"));

  const inventoryReport = reports.command("inventory").description("Inventory report (allotment/sold/available per hotel×room×date)");
  reportOptions(inventoryReport);
  inventoryReport.action(reportAction("/api/inventory/getInventoryReport"));

  inventory.addCommand(reports);

  return inventory;
}
