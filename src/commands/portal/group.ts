/**
 * commands/portal/group.ts — Tenant Portal profile root group.
 */

import { Command } from "commander";
import { createPortalAuthCommand } from "./auth.ts";
import { createPortalSearchCommand } from "./search.ts";
import { createPortalOrdersCommand } from "./orders.ts";
import { createPortalUsersCommand } from "./users.ts";
import { createEntityGroup, createCustomersGroup, createSubscriptionsGroup, createSuppliersGroup, createRetailGroup } from "./entity.ts";
import { createPortalViewCommand } from "./view.ts";
import type { Ctx } from "./helpers.ts";

export function createPortalGroup(ctx: Ctx): Command {
  const portal = new Command("portal").description("Tenant Portal profile — BFF for tenant admin (login auth)");
  portal.addCommand(createPortalAuthCommand(ctx));
  portal.addCommand(createPortalSearchCommand(ctx));
  portal.addCommand(createPortalOrdersCommand(ctx));
  portal.addCommand(createPortalUsersCommand(ctx));
  portal.addCommand(createEntityGroup(ctx));
  portal.addCommand(createCustomersGroup(ctx));
  portal.addCommand(createSubscriptionsGroup(ctx));
  portal.addCommand(createSuppliersGroup(ctx));
  portal.addCommand(createRetailGroup(ctx));
  portal.addCommand(createPortalViewCommand(ctx));
  return portal;
}