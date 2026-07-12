/**
 * commands/openapi/search.ts — search endpoints.
 */

import { Command } from "commander";
import { DEFAULT_ENV, loadProfile } from "../../core/config.ts";
import { HttpClient, HotelByteError } from "../../core/http.ts";
import { authenticateOpenapi } from "../../core/auth.ts";
import { emit, error, parseJsonInput, camelCase } from "../../utils/output.ts";

type Ctx = { jsonMode: () => boolean; env: () => string; appKey: () => string | undefined; appSecret: () => string | undefined };

async function makeClient(ctx: Ctx): Promise<HttpClient> {
  const profile = loadProfile("openapi", ctx.env());
  if (ctx.appKey()) profile.appKey = ctx.appKey();
  if (ctx.appSecret()) profile.appSecret = ctx.appSecret();
  await authenticateOpenapi(profile);
  return new HttpClient(profile);
}

async function run(ctx: Ctx, path: string, body: any): Promise<void> {
  try {
    const client = await makeClient(ctx);
    const resp = await client.post(path, body);
    emit(resp, ctx.jsonMode());
  } catch (e: any) {
    if (e instanceof HotelByteError) {
      error(e.message, ctx.jsonMode());
      process.exit(1);
    }
    throw e;
  }
}

export function createOpenapiSearchCommand(ctx: Ctx): Command {
  const search = new Command("search").description("Hotel search endpoints");

  // check-avail
  search
    .command("check-avail")
    .description("Check real-time availability for a specific rate package")
    .requiredOption("--rate-pkg-id <id>", "RatePkg ID obtained from hotelRates")
    .action(async (opts) => {
      await run(ctx, "/api/search/checkAvail", { ratePkgId: opts.ratePkgId });
    });

  // destinations
  search
    .command("destinations")
    .description("List destination regions for hotel search")
    .option("--country-code <code>", 'ISO country code, e.g. "US"')
    .option("--parent-destination-id <id>", "Parent region ID")
    .option("--include <level>", "Detail level: summary|detail")
    .option("--min-hotel-count <n>", "Minimum hotel count for cities", parseInt)
    .option("--filter-empty-cities [bool]", "Filter out cities without hotels")
    .action(async (opts) => {
      const body: any = {};
      if (opts.countryCode) body.countryCode = opts.countryCode;
      if (opts.parentDestinationId) body.parentDestinationId = opts.parentDestinationId;
      if (opts.include) body.include = opts.include;
      if (opts.minHotelCount !== undefined) body.minHotelCount = opts.minHotelCount;
      if (opts.filterEmptyCities !== undefined) body.filterEmptyCities = opts.filterEmptyCities;
      await run(ctx, "/api/search/destinations", body);
    });

  // hotel-list
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
    .option("--room-occupancies <json>", "JSON array of room occupancy objects, or @file.json")
    .option("--page-num <n>", "Page number", parseInt)
    .option("--page-size <n>", "Page size", parseInt)
    .option("--cursor <n>", "Cursor for next page", parseInt)
    .option("--max-rates-per-hotel <n>", "Max room rates per hotel", parseInt)
    .option("--sort-by <sort>", "Sort order: price-asc, price-desc, rating-desc")
    .action(async (opts) => {
      const body: any = {};
      for (const [key, val] of Object.entries(opts)) {
        if (val === undefined) continue;
        if (key === "hotelIds") {
          body.hotelIds = val.split(",");
        } else if (key === "roomOccupancies") {
          body.roomOccupancies = parseJsonInput(val);
        } else {
          body[camelCase(key)] = val;
        }
      }
      await run(ctx, "/api/search/hotelList", body);
    });

  // hotel-rates
  search
    .command("hotel-rates")
    .description("Get detailed room rates for a single hotel")
    .requiredOption("--hotel-id <id>", "Hotel ID")
    .option("--check-in <date>", "Check-in date (YYYY-MM-DD)")
    .option("--check-out <date>", "Check-out date (YYYY-MM-DD)")
    .option("--country-code <code>", "Point-of-sale country code")
    .option("--nationality-code <code>", "Booker nationality (ISO 3166-1 alpha-2)")
    .option("--residency-code <code>", "Booker residency (ISO 3166-1 alpha-2)")
    .option("--room-occupancies <json>", "JSON array of room occupancy objects, or @file.json")
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

  // hotel-static-detail
  search
    .command("hotel-static-detail")
    .description("Get static hotel details (descriptions, facilities, images)")
    .requiredOption("--hotel-id <id>", "Hotel ID")
    .action(async (opts) => {
      await run(ctx, "/api/search/hotelStaticDetail", { hotelId: opts.hotelId });
    });

  // hotels-metadata
  search
    .command("hotels-metadata")
    .description("List hotel metadata (name, star rating, coordinates, amenities)")
    .option("--destination-id <id>", "Destination region ID")
    .option("--country-code <code>", "Country code")
    .option("--data-source <source>", "Read target: master|byoc")
    .option("--catalog-id <id>", "Catalog ID (required when data-source=byoc)")
    .option("--page <json>", "Pagination object as JSON, or @file.json")
    .action(async (opts) => {
      const body: any = {};
      if (opts.destinationId) body.destinationId = opts.destinationId;
      if (opts.countryCode) body.countryCode = opts.countryCode;
      if (opts.dataSource) body.dataSource = opts.dataSource;
      if (opts.catalogId) body.catalogId = opts.catalogId;
      if (opts.page) body.page = parseJsonInput(opts.page);
      await run(ctx, "/api/search/hotelsMetadata", body);
    });

  return search;
}