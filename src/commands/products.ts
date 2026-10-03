/**
 * commands/products.ts — portal /products read surface (issue #31).
 *
 * products list   List managed products (paged; keyword/status/geo filters)
 * products get    Read one product row by platform or BYOC hotel ID
 *
 * Both read through POST /api/content/hotelsMetadata (content service
 * HotelsMetadata, content_hotel_metadata.go). Request shape follows
 * HotelsMetadataReq: pagination nests under `page`, keyword travels as
 * `productKeyword`, status is active|inactive|unavailable
 * (content/domain/hotel_availability.go).
 */

import { Command, Option } from "commander";
import { run, type Ctx } from "./helpers.ts";

function pageBody(pageNum: string, pageSize: string): { page: { pageNum: number; pageSize: number } } {
  return { page: { pageNum: parseInt(pageNum, 10), pageSize: parseInt(pageSize, 10) } };
}

export function createProductsCommand(ctx: Ctx): Command {
  const products = new Command("products").description("Portal products: managed hotel inventory (/products)");

  products
    .command("list")
    .description("List managed products (paged, filterable)")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .option("--keyword <text>", "Server-side search by product ID, name or supplier ID")
    .addOption(new Option("--status <status>", "Availability filter").choices(["active", "inactive", "unavailable"]))
    .option("--destination-id <id>", "Destination region ID")
    .option("--country-code <code>", "Country code (ISO 3166-1 alpha-2)")
    .option("--city <name>", "City name filter (substring)")
    .addOption(new Option("--data-source <source>", "Read target").choices(["platform", "byoc"]))
    .option("--catalog-id <id>", "Catalog ID (required for byoc reads)")
    .option("--hotel-ids <ids>", "Comma-separated platform hotel IDs")
    .option("--stars <list>", "Comma-separated star ratings, e.g. 3,4,5")
    .option("--tags <list>", "Comma-separated tags (requires --catalog-id)")
    .action(async (opts) => {
      const body: any = pageBody(opts.pageNum, opts.pageSize);
      if (opts.keyword) body.productKeyword = opts.keyword;
      if (opts.status) body.status = opts.status;
      if (opts.destinationId) body.destinationId = opts.destinationId;
      if (opts.countryCode) body.countryCode = opts.countryCode;
      if (opts.city) body.cityName = opts.city;
      if (opts.dataSource) body.dataSource = opts.dataSource;
      if (opts.catalogId) body.catalogId = opts.catalogId;
      if (opts.hotelIds) body.hotelIds = opts.hotelIds.split(",").map((s: string) => s.trim()).filter(Boolean);
      if (opts.stars) body.hotelStars = opts.stars.split(",").map((s: string) => parseInt(s.trim(), 10)).filter((n: number) => Number.isInteger(n));
      if (opts.tags) body.tags = opts.tags.split(",").map((s: string) => s.trim()).filter(Boolean);
      await run(ctx, "/api/content/hotelsMetadata", body);
    });

  products
    .command("get")
    .description("Get one product row (platform hotel ID, or BYOC hotel ID within a catalog)")
    .option("--hotel-id <id>", "Platform hotel ID")
    .option("--byoc-hotel-id <id>", "BYOC hotel ID (requires --catalog-id)")
    .option("--catalog-id <id>", "Catalog ID for BYOC lookups")
    .action(async (opts) => {
      if (!opts.hotelId && !opts.byocHotelId) {
        console.error("✗ --hotel-id or --byoc-hotel-id is required");
        process.exit(1);
      }
      if (opts.hotelId && opts.byocHotelId) {
        console.error("✗ --hotel-id and --byoc-hotel-id are mutually exclusive");
        process.exit(1);
      }
      const body: any = { ...pageBody("1", "1") };
      if (opts.byocHotelId) {
        if (!opts.catalogId) {
          console.error("✗ --byoc-hotel-id requires --catalog-id (BYOC rows are catalog-scoped)");
          process.exit(1);
        }
        body.dataSource = "byoc";
        body.catalogId = opts.catalogId;
        body.byocHotelIds = [opts.byocHotelId];
      } else {
        body.hotelIds = [opts.hotelId];
      }
      await run(ctx, "/api/content/hotelsMetadata", body);
    });

  return products;
}
