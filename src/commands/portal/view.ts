/**
 * commands/portal/view.ts — portal navigation/menu BFF.
 */

import { Command } from "commander";
import { runPortal, type Ctx } from "./helpers.ts";

export function createPortalViewCommand(ctx: Ctx): Command {
  const view = new Command("view").description("Portal navigation, menu, and permissions BFF");

  view.command("paas-homepage").description("Fetch the PaaS portal homepage (menu, permissions, user context)")
    .action(async () => { await runPortal(ctx, "/api/view/paasHomepage", {}); });

  view.command("retail-homepage").description("Fetch the retail/customer-portal homepage")
    .action(async () => { await runPortal(ctx, "/api/view/retailHomepage", {}); });

  return view;
}