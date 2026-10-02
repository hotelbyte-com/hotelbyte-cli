/**
 * commands/fx.ts — FX reference rates (hotel-be /api/fx/rates).
 *
 * Read-only daily reference table (date/base/rates/fetchedAt provenance).
 * Conversion and rounding rules belong to the consumer's contract — the CLI
 * passes the table through verbatim, it never computes money.
 */

import { Command } from "commander";
import { run } from "./helpers.ts";

type Ctx = { jsonMode: () => boolean; env: () => string };

export function createFxCommand(ctx: Ctx): Command {
  const fx = new Command("fx").description("FX reference rates (daily table, read-only)");

  fx
    .command("rates")
    .description("Get daily FX reference rates (authed; defaults to full USD-based table)")
    .option("--base <currency>", "Base currency for the quotes (default USD, case-insensitive)")
    .option("--currency <code>", "Quote currency to include, repeatable (e.g. --currency CNY --currency EUR); default = all", (v: string, acc: string[]) => { acc.push(v); return acc; }, [] as string[])
    .action(async (opts) => {
      const body: Record<string, unknown> = {};
      if (opts.base) body.base = opts.base;
      if (opts.currency.length > 0) body.currencies = opts.currency;
      await run(ctx, "/api/fx/rates", body);
    });

  return fx;
}
