/**
 * commands/openapi/trade.ts — booking endpoints.
 */

import { Command } from "commander";
import { loadProfile } from "../../core/config.ts";
import { HttpClient, HotelByteError } from "../../core/http.ts";
import { authenticateOpenapi } from "../../core/auth.ts";
import { emit, error, parseJsonInput } from "../../utils/output.ts";

type Ctx = { jsonMode: () => boolean; env: () => string; appKey: () => string | undefined; appSecret: () => string | undefined };

async function makeClient(ctx: Ctx): Promise<HttpClient> {
  const profile = loadProfile("openapi", ctx.env());
  if (ctx.appKey()) profile.appKey = ctx.appKey();
  if (ctx.appSecret()) profile.appSecret = ctx.appSecret();
  await authenticateOpenapi(profile);
  return new HttpClient(profile);
}

export function createOpenapiTradeCommand(ctx: Ctx): Command {
  const trade = new Command("trade").description("Booking and order management endpoints");

  // book
  trade
    .command("book")
    .description("Create a hotel booking")
    .requiredOption("--rate-pkg-id <id>", "RatePkg ID from hotelRates/hotelStaticDetail")
    .requiredOption("--holder <json>", "Holder contact JSON, or @file.json")
    .requiredOption("--guests <json>", "Guests JSON array, or @file.json")
    .option("--customer-reference-no <ref>", "Optional customer reference number")
    .option("--callback-url <url>", "Optional webhook URL for order status notifications")
    .action(async (opts) => {
      const body: any = {
        ratePkgId: opts.ratePkgId,
        holder: parseJsonInput(opts.holder),
        guests: parseJsonInput(opts.guests),
      };
      if (opts.customerReferenceNo) body.customerReferenceNo = opts.customerReferenceNo;
      if (opts.callbackUrl) body.callbackUrl = opts.callbackUrl;
      try {
        const client = await makeClient(ctx);
        const resp = await client.post("/api/trade/book", body);
        emit(resp, ctx.jsonMode());
      } catch (e: any) {
        if (e instanceof HotelByteError) { error(e.message, ctx.jsonMode()); process.exit(1); }
        throw e;
      }
    });

  // cancel
  trade
    .command("cancel")
    .description("Cancel an existing booking")
    .requiredOption("--customer-reference-no <ref>", "Customer reference number")
    .requiredOption("--supplier-reference-no <ref>", "Supplier reference number")
    .option("--reason <text>", "Cancellation reason")
    .action(async (opts) => {
      const body: any = {
        customerReferenceNo: opts.customerReferenceNo,
        supplierReferenceNo: opts.supplierReferenceNo,
      };
      if (opts.reason) body.reason = opts.reason;
      try {
        const client = await makeClient(ctx);
        const resp = await client.post("/api/trade/cancel", body);
        emit(resp, ctx.jsonMode());
      } catch (e: any) {
        if (e instanceof HotelByteError) { error(e.message, ctx.jsonMode()); process.exit(1); }
        throw e;
      }
    });

  // query-orders
  trade
    .command("query-orders")
    .description("Query orders with optional filters")
    .option("--customer-reference-nos <refs>", "Comma-separated customer reference numbers")
    .option("--supplier-reference-nos <refs>", "Comma-separated supplier reference numbers")
    .option("--status-list <statuses>", "Comma-separated status filters")
    .option("--guest-name <name>", "Guest name filter")
    .option("--room-count <n>", "Filter by room count", parseInt)
    .option("--night-count-min <n>", "Minimum nights", parseInt)
    .option("--sort-by <field>", "Sort field")
    .option("--sort-order <order>", "Sort direction: asc|desc")
    .option("--filter <json>", "Full JSON filter object, or @file.json (advanced)")
    .action(async (opts) => {
      const body: any = {};
      if (opts.filter) Object.assign(body, parseJsonInput(opts.filter));
      if (opts.customerReferenceNos) body.customerReferenceNos = opts.customerReferenceNos.split(",");
      if (opts.supplierReferenceNos) body.supplierReferenceNos = opts.supplierReferenceNos.split(",");
      if (opts.statusList) body.statusList = opts.statusList.split(",");
      if (opts.guestName) body.guestName = opts.guestName;
      if (opts.roomCount !== undefined) body.roomCount = opts.roomCount;
      if (opts.nightCountMin !== undefined) body.nightCountMin = opts.nightCountMin;
      if (opts.sortBy) body.sortBy = opts.sortBy;
      if (opts.sortOrder) body.sortOrder = opts.sortOrder;
      try {
        const client = await makeClient(ctx);
        const resp = await client.post("/api/trade/queryOrders", body);
        emit(resp, ctx.jsonMode());
      } catch (e: any) {
        if (e instanceof HotelByteError) { error(e.message, ctx.jsonMode()); process.exit(1); }
        throw e;
      }
    });

  // update-order
  trade
    .command("update-order")
    .description("Update an existing order (e.g. add notes, change status)")
    .requiredOption("--target-order-id <id>", "Order ID to update")
    .requiredOption("--actions <json>", "Actions JSON array, or @file.json")
    .action(async (opts) => {
      const body: any = {
        targetOrderId: opts.targetOrderId,
        actions: parseJsonInput(opts.actions),
      };
      try {
        const client = await makeClient(ctx);
        const resp = await client.post("/api/trade/updateOrder", body);
        emit(resp, ctx.jsonMode());
      } catch (e: any) {
        if (e instanceof HotelByteError) { error(e.message, ctx.jsonMode()); process.exit(1); }
        throw e;
      }
    });

  return trade;
}