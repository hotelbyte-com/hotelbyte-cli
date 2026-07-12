/**
 * commands/search.ts — hotel search commands.
 *
 * search hotel-list       Search hotels across a destination
 * search hotel-rates      Get rates for a specific hotel
 * search destinations     List destination regions
 * search check-avail      Check real-time availability for a rate package
 * search hotel-detail     Get static hotel details
 * search hotels-metadata  List hotel metadata
 */

import { Command } from "commander";
import { run, parseJsonInput, type Ctx } from "./helpers.ts";

export function createSearchCommand(ctx: Ctx): Command {
  const search = new Command("search").description("Search hotels, destinations, and rates");

  search
    .command("hotel-list")
    .description("Search hotels across a destination with rates")
    .option("--check-in <date>", "Check-in date (YYYY-MM-DD)")
    .option("--check-out <date>", "Check-out date (YYYY-MM-DD)")
    .option("--country-code <code>", "Point-of-sale country code")
    .option("--nationality-code <code>", "Booker nationality (ISO 3166-1 alpha-2)")
    .option("--residency-code <code>", "Booker residency (ISO 3166-1 alpha-2)")
    .option("--destination-id <id>", "Destination region ID")
    .option("--destination-name <name>", "Destination region name")
    .option("--hotel-ids <ids>", "Comma-separated hotel IDs (max 50)")
    .option("--room-occupancies <json>", 'JSON array, e.g. \'[{"adultCount":2,"childrenAges":[]}]\', or @file.json')
    .option("--page-num <n>", "Page number", parseInt)
    .option("--page-size <n>", "Page size", parseInt)
    .option("--max-rates-per-hotel <n>", "Max room rates per hotel", parseInt)
    .option("--sort-by <sort>", "Sort: price-asc, price-desc, rating-desc")
    .action(async (opts) => {
      const body: any = {};
      for (const [key, val] of Object.entries(opts)) {
        if (val === undefined) continue;
        if (key === "hotelIds") {
          body.hotelIds = val.split(",");
        } else if (key === "roomOccupancies") {
          body.roomOccupancies = parseJsonInput(val);
        } else {
          body[camelKey(key)] = val;
        }
      }
      await run(ctx, "/api/search/hotelList", body);
    });

  search
    .command("hotel-rates")
    .description("Get room rates for a specific hotel")
    .requiredOption("--hotel-id <id>", "Hotel ID")
    .option("--check-in <date>", "Check-in date (YYYY-MM-DD)")
    .option("--check-out <date>", "Check-out date (YYYY-MM-DD)")
    .option("--country-code <code>", "Point-of-sale country code")
    .option("--nationality-code <code>", "Booker nationality")
    .option("--residency-code <code>", "Booker residency")
    .option("--room-occupancies <json>", 'JSON array, e.g. \'[{"adultCount":2,"childrenAges":[]}]\', or @file.json')
    .action(async (opts) => {
      const body: any = { hotelId: opts.hotelId };
      if (opts.checkIn) body.checkIn = opts.checkIn;
      if (opts.checkOut) body.checkOut = opts.checkOut;
      if (opts.countryCode) body.countryCode = opts.countryCode;
      if (opts.nationalityCode) body.nationalityCode = opts.nationalityCode;
      if (opts.residencyCode) body.residencyCode = opts.residencyCode;
      if (opts.roomOccupancies) body.roomOccupancies = parseJsonInput(opts.roomOccupancies);
      await run(ctx, "/api/search/hotelRates", body);
    });

  search
    .command("destinations")
    .description("List destination regions for hotel search")
    .option("--country-code <code>", 'ISO country code, e.g. "US"')
    .option("--parent-destination-id <id>", "Parent region ID")
    .option("--include <level>", "Detail level: summary|detail")
    .action(async (opts) => {
      const body: any = {};
      if (opts.countryCode) body.countryCode = opts.countryCode;
      if (opts.parentDestinationId) body.parentDestinationId = opts.parentDestinationId;
      if (opts.include) body.include = opts.include;
      await run(ctx, "/api/search/destinations", body);
    });

  search
    .command("check-avail")
    .description("Check real-time availability for a rate package")
    .requiredOption("--rate-pkg-id <id>", "Rate package ID from hotel-rates")
    .action(async (opts) => {
      await run(ctx, "/api/search/checkAvail", { ratePkgId: opts.ratePkgId });
    });

  search
    .command("hotel-detail")
    .description("Get static hotel details (description, facilities, images)")
    .requiredOption("--hotel-id <id>", "Hotel ID")
    .action(async (opts) => {
      await run(ctx, "/api/search/hotelStaticDetail", { hotelId: opts.hotelId });
    });

  search
    .command("hotels-metadata")
    .description("List hotel metadata (name, stars, coordinates)")
    .option("--destination-id <id>", "Destination region ID")
    .option("--country-code <code>", "Country code")
    .option("--data-source <source>", "Read target: master|byoc")
    .option("--catalog-id <id>", "Catalog ID (for byoc)")
    .action(async (opts) => {
      const body: any = {};
      if (opts.destinationId) body.destinationId = opts.destinationId;
      if (opts.countryCode) body.countryCode = opts.countryCode;
      if (opts.dataSource) body.dataSource = opts.dataSource;
      if (opts.catalogId) body.catalogId = opts.catalogId;
      await run(ctx, "/api/search/hotelsMetadata", body);
    });

  return search;
}

/** Convert kebab-case option name to camelCase for API body */
function camelKey(key: string): string {
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
