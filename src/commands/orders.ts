/**
 * commands/orders.ts — tenant-scoped order management (admin-facing).
 *
 * orders list                    List tenant orders
 * orders detail                  Get order details
 * orders dashboard               Order dashboard / home function
 * orders label                   Apply a label to an order
 * orders cancel                  Cancel a tenant order
 * orders create-offline-booking  Create a manual/offline booking
 * orders rebooking-pending       List pending rebooking approvals
 */

import { Command } from "commander";
import { run, parseJsonInput, type Ctx } from "./helpers.ts";

export function createOrdersCommand(ctx: Ctx): Command {
  const orders = new Command("orders").description("Tenant order management");

  orders
    .command("list")
    .description("List orders")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .option("--status-list <statuses>", "Comma-separated status filters")
    .option("--guest-name <name>", "Guest name filter")
    .action(async (opts) => {
      const body: any = { pageNum: parseInt(opts.pageNum), pageSize: parseInt(opts.pageSize) };
      if (opts.statusList) body.statusList = opts.statusList.split(",");
      if (opts.guestName) body.guestName = opts.guestName;
      await run(ctx, "/api/trade/tenant/listOrder", body);
    });

  orders
    .command("detail")
    .description("Get order details")
    .requiredOption("--order-id <id>", "Order ID")
    .action(async (opts) => {
      await run(ctx, "/api/trade/tenant/detailOrder", { orderId: opts.orderId });
    });

  orders
    .command("dashboard")
    .description("Order dashboard / home function")
    .action(async () => {
      await run(ctx, "/api/trade/tenant/orderHomeFunction", {});
    });

  orders
    .command("label")
    .description("Apply a label to an order")
    .requiredOption("--order-id <id>", "Order ID")
    .option("--label <text>", "Label text")
    .action(async (opts) => {
      const body: any = { orderId: opts.orderId };
      if (opts.label) body.label = opts.label;
      await run(ctx, "/api/trade/tenant/labelOrder", body);
    });

  orders
    .command("cancel")
    .description("Cancel a tenant order")
    .requiredOption("--order-id <id>", "Order ID")
    .option("--reason <text>", "Cancellation reason")
    .action(async (opts) => {
      const body: any = { orderId: opts.orderId };
      if (opts.reason) body.reason = opts.reason;
      await run(ctx, "/api/trade/tenant/cancel", body);
    });

  orders
    .command("create-offline-booking")
    .description("Create a manual/offline booking")
    .requiredOption("--data <json>", "Booking JSON, or @file.json")
    .action(async (opts) => {
      await run(ctx, "/api/trade/tenant/createOfflineBooking", parseJsonInput(opts.data));
    });

  orders
    .command("rebooking-pending")
    .description("List pending rebooking approvals")
    .action(async () => {
      await run(ctx, "/api/trade/tenant/listPendingRebookingApprovals", {});
    });

  return orders;
}
