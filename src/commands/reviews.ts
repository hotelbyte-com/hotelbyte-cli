/**
 * commands/reviews.ts — hotel guest reviews and HQS scores (evaluation service).
 *
 * reviews list             List a hotel's reviews (paged)
 * reviews create           Create a guest review (write — requires --confirm)
 * reviews rating-stats     Average rating + review count for a hotel
 * reviews scores list      HQS score rows across hotels (paged)
 * reviews scores detail    Full HQS score breakdown for one hotel
 * reviews recalc           Recalculate a hotel's HQS score (write — requires --confirm)
 *
 * All endpoints are evaluation-service methods (reflection routing under
 * /api/evaluation/, verified live via /api/view/getApiPaths type=evaluation):
 * listHotelReviews / createReview / getHotelRatingStats / listHotelScores /
 * getHotelScoreDetail / recalculateHotelScore (evaluation/service/review.go,
 * evaluation/protocol/review.go).
 *
 * Write confirmation follows the `catalogs` guardrail model: createReview
 * (@permission PrivilegeCode_Evaluation_Review_Edit) and recalculateHotelScore
 * (PrivilegeCode_Evaluation_Score_Run) refuse to execute without an explicit
 * --confirm.
 */

import { Command } from "commander";
import { run, parseJsonInput, type Ctx } from "./helpers.ts";
import { error } from "../utils/output.ts";

/** Write guard (catalogs.ts habit). */
function requireConfirm(ctx: Ctx, label: string, confirmed: boolean): void {
  if (confirmed) return;
  error(`${label} is a WRITE operation. Re-run with --confirm to execute.`, ctx.jsonMode());
  process.exit(1);
}

/** Comma-separated CLI flag → trimmed string array (catalogs.ts habit). */
function splitList(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Comma-separated CLI flag → integer array (listHotelScores.hotelIds is []int64). */
function splitIntList(value: string): number[] {
  return splitList(value).map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n));
}

export function createReviewsCommand(ctx: Ctx): Command {
  const reviews = new Command("reviews").description("Hotel guest reviews and HQS scores");

  reviews
    .command("list")
    .description("List a hotel's reviews (paged)")
    .requiredOption("--hotel-id <id>", "Hotel ID")
    .option("--status <n>", "Filter by review status", parseInt)
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = { hotelId: opts.hotelId, pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) };
      if (opts.status !== undefined) body.status = opts.status;
      await run(ctx, "/api/evaluation/listHotelReviews", body);
    });

  reviews
    .command("create")
    .description("Create a guest review (write operation — requires --confirm)")
    .requiredOption("--hotel-id <id>", "Hotel ID")
    .requiredOption("--customer-entity-id <id>", "Reviewing customer entity ID")
    .requiredOption("--overall-rating <n>", "Overall rating", parseFloat)
    .requiredOption("--review-text <text>", "Review body")
    .option("--order-id <id>", "Linked order ID")
    .option("--location-rating <n>", "Location sub-rating", parseFloat)
    .option("--cleanliness-rating <n>", "Cleanliness sub-rating", parseFloat)
    .option("--service-rating <n>", "Service sub-rating", parseFloat)
    .option("--facility-rating <n>", "Facility sub-rating", parseFloat)
    .option("--value-rating <n>", "Value sub-rating", parseFloat)
    .option("--sleep-rating <n>", "Sleep sub-rating", parseFloat)
    .option("--dining-rating <n>", "Dining sub-rating", parseFloat)
    .option("--tags <tags>", "Comma-separated tags")
    .option("--lang <lang>", "Review language (e.g. en)")
    .option("--stay-date <date>", "Stay date (e.g. 2025-01-01)")
    .option("--media <json>", 'Media JSON array of {mediaType, url, thumbUrl?, sortOrder?}, or @file.json')
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "reviews create", opts.confirm);
      const body: any = {
        hotelId: opts.hotelId,
        customerEntityId: opts.customerEntityId,
        overallRating: opts.overallRating,
        reviewText: opts.reviewText,
      };
      if (opts.orderId) body.orderId = opts.orderId;
      for (const [flag, field] of [
        ["locationRating", "locationRating"],
        ["cleanlinessRating", "cleanlinessRating"],
        ["serviceRating", "serviceRating"],
        ["facilityRating", "facilityRating"],
        ["valueRating", "valueRating"],
        ["sleepRating", "sleepRating"],
        ["diningRating", "diningRating"],
      ] as const) {
        if (opts[flag] !== undefined) body[field] = opts[flag];
      }
      if (opts.tags) body.tags = splitList(opts.tags);
      if (opts.lang) body.lang = opts.lang;
      if (opts.stayDate) body.stayDate = opts.stayDate;
      if (opts.media) body.media = parseJsonInput(opts.media);
      await run(ctx, "/api/evaluation/createReview", body);
    });

  reviews
    .command("rating-stats")
    .description("Average rating + review count for a hotel")
    .requiredOption("--hotel-id <id>", "Hotel ID")
    .action(async (opts) => {
      await run(ctx, "/api/evaluation/getHotelRatingStats", { hotelId: opts.hotelId });
    });

  const scores = new Command("scores").description("HQS score queries");

  scores
    .command("list")
    .description("List HQS score rows across hotels (paged)")
    .option("--hotel-ids <ids>", "Comma-separated hotel IDs (omit = all)")
    .option("--sort-by <field>", "Sort field")
    .option("--sort-order <order>", "Sort order (asc / desc)")
    .option("--days <n>", "Only reviews within the last N days", parseInt)
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) };
      if (opts.hotelIds) body.hotelIds = splitIntList(opts.hotelIds);
      if (opts.sortBy) body.sortBy = opts.sortBy;
      if (opts.sortOrder) body.sortOrder = opts.sortOrder;
      if (opts.days !== undefined) body.days = opts.days;
      await run(ctx, "/api/evaluation/listHotelScores", body);
    });

  scores
    .command("detail")
    .description("Full HQS score breakdown for one hotel")
    .requiredOption("--hotel-id <id>", "Hotel ID")
    .action(async (opts) => {
      await run(ctx, "/api/evaluation/getHotelScoreDetail", { hotelId: opts.hotelId });
    });

  reviews.addCommand(scores);

  reviews
    .command("recalc")
    .description("Recalculate a hotel's HQS score (write operation — requires --confirm)")
    .requiredOption("--hotel-id <id>", "Hotel ID")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "reviews recalc", opts.confirm);
      await run(ctx, "/api/evaluation/recalculateHotelScore", { hotelId: opts.hotelId });
    });

  return reviews;
}
