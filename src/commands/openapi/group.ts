/**
 * commands/openapi/group.ts — OpenAPI profile root group.
 */

import { Command } from "commander";
import { createOpenapiAuthCommand } from "./auth.ts";
import { createOpenapiSearchCommand } from "./search.ts";
import { createOpenapiTradeCommand } from "./trade.ts";

type Ctx = { jsonMode: () => boolean; env: () => string; appKey: () => string | undefined; appSecret: () => string | undefined };

export function createOpenapiGroup(ctx: Ctx): Command {
  const openapi = new Command("openapi").description("OpenAPI profile — public search + trade API (appKey/appSecret auth)");
  openapi.addCommand(createOpenapiAuthCommand(ctx.jsonMode, ctx.env, ctx.appKey, ctx.appSecret));
  openapi.addCommand(createOpenapiSearchCommand(ctx));
  openapi.addCommand(createOpenapiTradeCommand(ctx));
  return openapi;
}