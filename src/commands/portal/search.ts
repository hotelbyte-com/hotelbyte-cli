/**
 * commands/portal/search.ts — Portal search (same backend, portal JWT).
 */

import { Command } from "commander";
import { runPortal, type Ctx } from "./helpers.ts";
import { parseJsonInput } from "../../utils/output.ts";

export function createPortalSearchCommand(ctx: Ctx): Command {
  const search = new Command("search").description("Portal hotel search (uses portal JWT, same search endpoints)");

  search
    .command("check-avail")
    .description("Check real-time availability")
    .requiredOption("--rate-pkg-id <id>", "RatePkg ID")
    .action(async (opts) => {
      await runPortal(ctx, "/api/search/checkAvail", { ratePkgId: opts.ratePkgId });
    });

  search
    .command("hotel-list")
    .description("Search hotels")
    .option("--check-in <date>", "Check-in date")
    .option("--check-out <date>", "Check-out date")
    .option("--country-code <code>", "Country code")
    .option("--nationality-code <code>", "Nationality code")
    .option("--residency-code <code>", "Residency code")
    .option("--destination-id <id>", "Destination ID")
    .option("--destination-name <name>", "Destination name")
    .option("--room-occupancies <json>", "JSON array, or @file.json")
    .option("--page-size <n>", "Page size", parseInt)
    .action(async (opts) => {
      const body: any = {};
      for (const [key, val] of Object.entries(opts)) {
        if (val === undefined) continue;
        if (key === "roomOccupancies") {
          body.roomOccupancies = parseJsonInput(val);
        } else {
          const camel = key.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
          body[camel] = val;
        }
      }
      await runPortal(ctx, "/api/search/hotelList", body);
    });

  search
    .command("hotel-rates")
    .description("Get hotel rates")
    .requiredOption("--hotel-id <id>", "Hotel ID")
    .option("--check-in <date>", "Check-in date")
    .option("--check-out <date>", "Check-out date")
    .option("--country-code <code>", "Country code")
    .option("--nationality-code <code>", "Nationality code")
    .option("--residency-code <code>", "Residency code")
    .action(async (opts) => {
      const body: any = { hotelId: opts.hotelId };
      if (opts.checkIn) body.checkIn = opts.checkIn;
      if (opts.checkOut) body.checkOut = opts.checkOut;
      if (opts.countryCode) body.countryCode = opts.countryCode;
      if (opts.nationalityCode) body.nationalityCode = opts.nationalityCode;
      if (opts.residencyCode) body.residencyCode = opts.residencyCode;
      await runPortal(ctx, "/api/search/hotelRates", body);
    });

  return search;
}