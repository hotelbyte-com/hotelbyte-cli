/**
 * commands/portal/orders.ts — tenant-portal order management.
 */

import { Command } from "commander";
import { runPortal, type Ctx } from "./helpers.ts";
import { parseJsonInput } from "../../utils/output.ts";

export function createPortalOrdersCommand(ctx: Ctx): Command {
  const orders = new Command("orders").description("Tenant-portal order and booking management");

  orders
    .command("list")
    .description("List tenant orders (listOrder)")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .option("--status-list <statuses>", "Comma-separated status filters")
    .option("--guest-name <name>", "Guest name filter")
    .action(async (opts) => {
      const body: any = { pageNum: parseInt(opts.pageNum), pageSize: parseInt(opts.pageSize) };
      if (opts.statusList) body.statusList = opts.statusList.split(",");
      if (opts.guestName) body.guestName = opts.guestName;
      await runPortal(ctx, "/api/trade/tenant/listOrder", body);
    });

  orders
    .command("detail")
    .description("Get order details (detailOrder)")
    .requiredOption("--order-id <id>", "Order ID")
    .action(async (opts) => {
      await runPortal(ctx, "/api/trade/tenant/detailOrder", { orderId: opts.orderId });
    });

  orders
    .command("home")
    .description("Tenant order dashboard (orderHomeFunction)")
    .option("--filter <json>", "JSON filter object, or @file.json")
    .action(async (opts) => {
      const body = opts.filter ? parseJsonInput(opts.filter) as any : {};
      await runPortal(ctx, "/api/trade/tenant/orderHomeFunction", body);
    });

  orders
    .command("label")
    .description("Apply a label to an order (labelOrder)")
    .requiredOption("--order-id <id>", "Order ID")
    .option("--label <text>", "Label to apply")
    .action(async (opts) => {
      const body: any = { orderId: opts.orderId };
      if (opts.label) body.label = opts.label;
      await runPortal(ctx, "/api/trade/tenant/labelOrder", body);
    });

  orders
    .command("cancel")
    .description("Cancel a tenant order")
    .requiredOption("--order-id <id>", "Order ID to cancel")
    .option("--reason <text>", "Cancellation reason")
    .action(async (opts) => {
      const body: any = { orderId: opts.orderId };
      if (opts.reason) body.reason = opts.reason;
      await runPortal(ctx, "/api/trade/tenant/cancel", body);
    });

  orders
    .command("create-offline-booking")
    .description("Create an offline (manual) booking")
    .requiredOption("--booking-data <json>", "JSON booking data, or @file.json")
    .action(async (opts) => {
      const body = parseJsonInput(opts.bookingData);
      await runPortal(ctx, "/api/trade/tenant/createOfflineBooking", body);
    });

  orders
    .command("rebooking-pending")
    .description("List pending rebooking approvals")
    .action(async () => {
      await runPortal(ctx, "/api/trade/tenant/listPendingRebookingApprovals", {});
    });

  return orders;
}