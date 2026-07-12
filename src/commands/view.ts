/**
 * commands/view.ts — portal navigation and menu BFF.
 */

import { Command } from "commander";
import { run, type Ctx } from "./helpers.ts";

export function createViewCommand(ctx: Ctx): Command {
  const view = new Command("view").description("Portal navigation and menus");

  view
    .command("homepage")
    .description("Fetch portal homepage (navigation, permissions, user context)")
    .action(async () => {
      await run(ctx, "/api/view/paasHomepage", {});
    });

  view
    .command("retail-homepage")
    .description("Fetch retail/customer-portal homepage")
    .action(async () => {
      await run(ctx, "/api/view/retailHomepage", {});
    });

  return view;
}
