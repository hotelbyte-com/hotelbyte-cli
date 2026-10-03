/**
 * commands/catalogs.ts — portal /catalogs surface (issue #31).
 *
 * catalogs list           List hotel catalogs by owner entity
 * catalogs get            Get one catalog by ID
 * catalogs create         Create a catalog (write — requires --confirm)
 * catalogs hotels         List hotels inside a catalog (paged)
 * catalogs add-hotels     Batch add hotels to a catalog (write — requires --confirm)
 * catalogs remove-hotels  Batch remove hotels from a catalog (write — requires --confirm)
 *
 * All endpoints are content-service methods (no @path overrides → method-name
 * routing under /api/content/): listHotelCatalog (content_catalog_query.go),
 * getHotelCatalog / createHotelCatalog (content_catalog.go),
 * getHotelCatalogHotels (content_catalog_hotels.go), batchAddHotelsToCatalog /
 * batchRemoveHotelsFromCatalog (content_catalog_relation.go).
 *
 * Write confirmation follows the `api call` guardrail model (commands/api.ts):
 * known writes refuse to execute without an explicit --confirm.
 */

import { Command, Option } from "commander";
import { run, type Ctx } from "./helpers.ts";
import { error } from "../utils/output.ts";

/** Write guard shared by create / add-hotels / remove-hotels (api.ts habit). */
function requireConfirm(ctx: Ctx, label: string, confirmed: boolean): void {
  if (confirmed) return;
  error(`${label} is a WRITE operation. Re-run with --confirm to execute.`, ctx.jsonMode());
  process.exit(1);
}

export function createCatalogsCommand(ctx: Ctx): Command {
  const catalogs = new Command("catalogs").description("Hotel catalogs: curated product sets (/catalogs)");

  catalogs
    .command("list")
    .description("List hotel catalogs (defaults to the current user's entity)")
    .option("--owner-entity-id <id>", "Owner entity ID (omit for current)")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) };
      if (opts.ownerEntityId) body.ownerEntityId = opts.ownerEntityId;
      await run(ctx, "/api/content/listHotelCatalog", body);
    });

  catalogs
    .command("get")
    .description("Get one catalog (with BYOS workspace summary when applicable)")
    .requiredOption("--catalog-id <id>", "Catalog ID")
    .action(async (opts) => {
      await run(ctx, "/api/content/getHotelCatalog", { id: opts.catalogId });
    });

  catalogs
    .command("create")
    .description("Create a catalog (write operation — requires --confirm)")
    .requiredOption("--name <name>", "Catalog name (1-100 chars)")
    .option("--owner-entity-id <id>", "Owner entity ID (omit for current)")
    .addOption(new Option("--catalog-type <type>", "Catalog type").choices(["standard", "byoc", "byos"]))
    .addOption(new Option("--location-mode <mode>", "Location mode").choices(["geo_only", "text_only", "hybrid"]))
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "catalogs create", opts.confirm);
      const body: any = { name: opts.name };
      if (opts.ownerEntityId) body.ownerEntityId = opts.ownerEntityId;
      if (opts.catalogType) body.catalogType = opts.catalogType;
      if (opts.locationMode) body.locationMode = opts.locationMode;
      await run(ctx, "/api/content/createHotelCatalog", body);
    });

  catalogs
    .command("hotels")
    .description("List hotels inside a catalog (paged; static members plus dynamic rule matches)")
    .requiredOption("--catalog-id <id>", "Catalog ID")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = {
        catalogId: opts.catalogId,
        pageNum: parseInt(opts.pageNum, 10),
        pageSize: parseInt(opts.pageSize, 10),
      };
      await run(ctx, "/api/content/getHotelCatalogHotels", body);
    });

  catalogs
    .command("add-hotels")
    .description("Batch add hotels to a catalog (write operation — requires --confirm)")
    .requiredOption("--catalog-id <id>", "Catalog ID")
    .option("--hotel-ids <ids>", "Comma-separated platform hotel IDs (standard catalogs)")
    .option("--tenant-hotel-ids <ids>", "Comma-separated tenant hotel IDs (BYOC catalogs)")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "catalogs add-hotels", opts.confirm);
      const hotelIds = opts.hotelIds?.split(",").map((s: string) => s.trim()).filter(Boolean);
      const tenantHotelIds = opts.tenantHotelIds?.split(",").map((s: string) => s.trim()).filter(Boolean);
      if (!hotelIds?.length && !tenantHotelIds?.length) {
        console.error("✗ --hotel-ids or --tenant-hotel-ids is required");
        process.exit(1);
      }
      const body: any = { catalogId: opts.catalogId };
      if (hotelIds?.length) body.hotelIds = hotelIds;
      if (tenantHotelIds?.length) body.tenantHotelIds = tenantHotelIds;
      await run(ctx, "/api/content/batchAddHotelsToCatalog", body);
    });

  catalogs
    .command("remove-hotels")
    .description("Batch remove hotels from a catalog (write operation — requires --confirm)")
    .requiredOption("--catalog-id <id>", "Catalog ID")
    .option("--hotel-ids <ids>", "Comma-separated platform hotel IDs (standard catalogs)")
    .option("--tenant-hotel-ids <ids>", "Comma-separated tenant hotel IDs (BYOC catalogs)")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "catalogs remove-hotels", opts.confirm);
      const hotelIds = opts.hotelIds?.split(",").map((s: string) => s.trim()).filter(Boolean);
      const tenantHotelIds = opts.tenantHotelIds?.split(",").map((s: string) => s.trim()).filter(Boolean);
      if (!hotelIds?.length && !tenantHotelIds?.length) {
        console.error("✗ --hotel-ids or --tenant-hotel-ids is required");
        process.exit(1);
      }
      const body: any = { catalogId: opts.catalogId };
      if (hotelIds?.length) body.hotelIds = hotelIds;
      if (tenantHotelIds?.length) body.tenantHotelIds = tenantHotelIds;
      await run(ctx, "/api/content/batchRemoveHotelsFromCatalog", body);
    });

  return catalogs;
}
