/**
 * commands/storefront.ts — storefront content operations: news ops, community
 * moderation, tour products, learning lessons.
 *
 * news list            List news articles (ops view)
 * news create          Create a news article as draft (write — requires --confirm)
 * community queue      Community moderation queue
 * community approve    Approve a queued post (write — requires --confirm)
 * community reject     Reject a queued post (write — requires --confirm)
 * tours list           List tour products (ops view)
 * tours get            Get one tour product by ID
 * tours create         Create a tour product as draft (write — requires --confirm)
 * tours publish        Publish a tour product (write — requires --confirm)
 * learning lessons     List learning lessons
 *
 * All endpoints are content-service methods (live catalog 2026-10-04):
 * newsOps/listArticles + newsOps/createArticle, communityOps/moderationQueue +
 * communityOps/approvePost + communityOps/rejectPost, tourOps/listTours +
 * tourOps/getTour + tourOps/createTour + tourOps/publishTour,
 * learning/listLessons + learning/getLesson. Request shapes follow
 * content/protocol/{news,community,tour_product,learning}.go: news and tours
 * take a nested `page:{pageNum,pageSize}`, community and learning embed a flat
 * PageReq; news/tours status filters are numeric codes; tourId is a numeric
 * uint64 on the wire; tour create carries the i18n/money payload via --data.
 *
 * Write confirmation follows the `catalogs` guardrail model
 * (commands/catalogs.ts): known writes refuse to execute without --confirm.
 */

import { Command, Option } from "commander";
import { run, parseJsonInput, type Ctx } from "./helpers.ts";
import { error } from "../utils/output.ts";

/** Write guard shared by every mutating subcommand (catalogs.ts habit). */
function requireConfirm(ctx: Ctx, label: string, confirmed: boolean): void {
  if (confirmed) return;
  error(`${label} is a WRITE operation. Re-run with --confirm to execute.`, ctx.jsonMode());
  process.exit(1);
}

export function createStorefrontCommand(ctx: Ctx): Command {
  const storefront = new Command("storefront").description("Storefront content: news, community moderation, tours, learning");

  // ── news (content/newsOps) ─────────────────────────────────────────────

  const news = storefront.command("news").description("News article operations");

  news
    .command("list")
    .description("List news articles (ops view)")
    .addOption(new Option("--status <n>", "Status filter (1=draft, 2=published, 3=offline)").choices(["1", "2", "3"]))
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = { page: { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) } };
      if (opts.status) body.status = parseInt(opts.status, 10);
      await run(ctx, "/api/content/newsOps/listArticles", body);
    });

  news
    .command("create")
    .description("Create a news article as draft (write operation — requires --confirm)")
    .requiredOption("--title <title>", "Article title")
    .option("--summary <text>", "Article summary")
    .option("--cover-image <url>", "Cover image URL")
    .option("--paragraphs <json>", "Paragraph array as JSON, or @file.json")
    .option("--lang <lang>", "Language code (e.g. en, zh)")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "storefront news create", opts.confirm);
      const body: any = { title: opts.title };
      if (opts.summary) body.summary = opts.summary;
      if (opts.coverImage) body.coverImage = opts.coverImage;
      if (opts.paragraphs) body.paragraphs = parseJsonInput(opts.paragraphs);
      if (opts.lang) body.lang = opts.lang;
      await run(ctx, "/api/content/newsOps/createArticle", body);
    });

  // ── community (content/communityOps) ───────────────────────────────────

  const community = storefront.command("community").description("Community moderation");

  community
    .command("queue")
    .description("Community moderation queue (defaults to pending)")
    .addOption(new Option("--status <status>", "Queue filter").choices(["pending", "published", "hidden", "rejected"]))
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) };
      if (opts.status) body.status = opts.status;
      await run(ctx, "/api/content/communityOps/moderationQueue", body);
    });

  community
    .command("approve")
    .description("Approve a queued post (write operation — requires --confirm)")
    .requiredOption("--post-id <id>", "Post ID")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "storefront community approve", opts.confirm);
      await run(ctx, "/api/content/communityOps/approvePost", { postId: opts.postId });
    });

  community
    .command("reject")
    .description("Reject a queued post (write operation — requires --confirm)")
    .requiredOption("--post-id <id>", "Post ID")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "storefront community reject", opts.confirm);
      await run(ctx, "/api/content/communityOps/rejectPost", { postId: opts.postId });
    });

  // ── tours (content/tourOps) ────────────────────────────────────────────

  const tours = storefront.command("tours").description("Tour product operations");

  tours
    .command("list")
    .description("List tour products (ops view)")
    .addOption(new Option("--status <n>", "Status filter (1=draft, 2=published)").choices(["1", "2"]))
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = { page: { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) } };
      if (opts.status) body.status = parseInt(opts.status, 10);
      await run(ctx, "/api/content/tourOps/listTours", body);
    });

  tours
    .command("get")
    .description("Get one tour product by ID (includes drafts)")
    .requiredOption("--tour-id <n>", "Tour ID")
    .action(async (opts) => {
      await run(ctx, "/api/content/tourOps/getTour", { tourId: parseInt(opts.tourId, 10) });
    });

  tours
    .command("create")
    .description("Create a tour product as draft (write operation — requires --confirm)")
    .requiredOption("--data <json>", "TourContentPayload JSON (destinationId/title i18n/price money), or @file.json")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "storefront tours create", opts.confirm);
      await run(ctx, "/api/content/tourOps/createTour", parseJsonInput(opts.data));
    });

  tours
    .command("publish")
    .description("Publish a tour product (write operation — requires --confirm)")
    .requiredOption("--tour-id <n>", "Tour ID")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "storefront tours publish", opts.confirm);
      await run(ctx, "/api/content/tourOps/publishTour", { tourId: parseInt(opts.tourId, 10) });
    });

  // ── learning (content/learning) ────────────────────────────────────────

  const lessons = storefront.command("learning").description("Learning academy").command("lessons").description("Learning lessons");

  lessons
    .command("list")
    .description("List learning lessons")
    .option("--keyword <text>", "LIKE match on title/summary")
    .option("--track <track>", "Exact learning-path filter")
    .option("--page-num <n>", "Page number", "1")
    .option("--page-size <n>", "Page size", "20")
    .action(async (opts) => {
      const body: any = { pageNum: parseInt(opts.pageNum, 10), pageSize: parseInt(opts.pageSize, 10) };
      if (opts.keyword) body.keyword = opts.keyword;
      if (opts.track) body.track = opts.track;
      await run(ctx, "/api/content/learning/listLessons", body);
    });

  lessons
    .command("get")
    .description("Get one lesson by ID")
    .requiredOption("--id <id>", "Lesson ID")
    .action(async (opts) => {
      await run(ctx, "/api/content/learning/getLesson", { id: opts.id });
    });

  return storefront;
}
