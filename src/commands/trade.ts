/**
 * commands/trade.ts — booking commands (integrator-facing).
 *
 * trade book           Create a hotel booking
 * trade cancel         Cancel a booking
 * trade query-orders   Query orders
 * trade update-order   Update an order
 */

import { Command } from "commander";
import { run, parseJsonInput, type Ctx } from "./helpers.ts";

export function createTradeCommand(ctx: Ctx): Command {
  const trade = new Command("trade").description("Bookings and order management");

  trade
    .command("book")
    .description("Create a hotel booking")
    .requiredOption("--rate-pkg-id <id>", "Rate package ID from hotel-rates")
    .requiredOption("--holder <json>", 'Holder contact JSON, or @file.json')
    .requiredOption("--guests <json>", "Guests JSON array, or @file.json")
    .option("--customer-reference-no <ref>", "Optional customer reference number")
    .option("--callback-url <url>", "Optional webhook URL for order status")
    .action(async (opts) => {
      const body: any = {
        ratePkgId: opts.ratePkgId,
        holder: parseJsonInput(opts.holder),
        guests: parseJsonInput(opts.guests),
      };
      if (opts.customerReferenceNo) body.customerReferenceNo = opts.customerReferenceNo;
      if (opts.callbackUrl) body.callbackUrl = opts.callbackUrl;
      await run(ctx, "/api/trade/book", body);
    });

  trade
    .command("cancel")
    .description("Cancel a booking")
    .requiredOption("--customer-reference-no <ref>", "Customer reference number")
    .requiredOption("--supplier-reference-no <ref>", "Supplier reference number")
    .option("--reason <text>", "Cancellation reason")
    .action(async (opts) => {
      const body: any = {
        customerReferenceNo: opts.customerReferenceNo,
        supplierReferenceNo: opts.supplierReferenceNo,
      };
      if (opts.reason) body.reason = opts.reason;
      await run(ctx, "/api/trade/cancel", body);
    });

  trade
    .command("query-orders")
    .description("Query orders with optional filters")
    .option("--customer-reference-nos <refs>", "Comma-separated customer reference numbers")
    .option("--supplier-reference-nos <refs>", "Comma-separated supplier reference numbers")
    .option("--status-list <statuses>", "Comma-separated status filters")
    .option("--guest-name <name>", "Guest name filter")
    .option("--room-count <n>", "Filter by room count", parseInt)
    .option("--sort-by <field>", "Sort field")
    .option("--sort-order <order>", "Sort direction: asc|desc")
    .action(async (opts) => {
      const body: any = {};
      if (opts.customerReferenceNos) body.customerReferenceNos = opts.customerReferenceNos.split(",");
      if (opts.supplierReferenceNos) body.supplierReferenceNos = opts.supplierReferenceNos.split(",");
      if (opts.statusList) body.statusList = opts.statusList.split(",");
      if (opts.guestName) body.guestName = opts.guestName;
      if (opts.roomCount !== undefined) body.roomCount = opts.roomCount;
      if (opts.sortBy) body.sortBy = opts.sortBy;
      if (opts.sortOrder) body.sortOrder = opts.sortOrder;
      await run(ctx, "/api/trade/queryOrders", body);
    });

  trade
    .command("update-order")
    .description("Update an existing order")
    .requiredOption("--target-order-id <id>", "Order ID to update")
    .requiredOption("--actions <json>", "Actions JSON array, or @file.json")
    .action(async (opts) => {
      await run(ctx, "/api/trade/updateOrder", {
        targetOrderId: opts.targetOrderId,
        actions: parseJsonInput(opts.actions),
      });
    });

  return trade;
}
