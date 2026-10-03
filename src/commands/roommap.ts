/**
 * commands/roommap.ts — room-type mapping: mapping APIs, usage, HB annotation
 * samples, and algorithm evaluation.
 *
 * roommap map rooms                 Map supplier rooms onto canonical groups (write — requires --confirm)
 * roommap map rooms-batch           Batch-map rooms across hotels (write — requires --confirm)
 * roommap usage                     Query the tenant's room-mapping usage
 * roommap annotation samples        List annotation samples
 * roommap annotation review         Review an annotation sample (write — requires --confirm)
 * roommap annotation stats          Sample coverage/quality stats
 * roommap evaluation create-test-set  Create an evaluation test set (write — requires --confirm)
 * roommap evaluation evaluate       Run an algorithm evaluation (write — requires --confirm)
 * roommap evaluation history        Evaluation history for a test set
 * roommap evaluation compare        Compare two algorithm versions on a test set
 *
 * Endpoints (reflection routing, verified live via /api/view/getApiPaths):
 *   roomMapping service (room_mapping_api_service.go):
 *     /api/roomMapping/mapRooms / mapRoomsBatch / getMappingUsage
 *   mapping/hbAnnotation service (annotation_service.go, annotation_stats.go):
 *     /api/mapping/hbAnnotation/listSamples / reviewSample / getSampleStats
 *   mapping/hbEvaluation service (evaluation_service.go):
 *     /api/mapping/hbEvaluation/createTestSet / evaluate / getEvaluationHistory /
 *     compareAlgorithms
 *
 * Write confirmation follows the `catalogs` guardrail model: mapRooms bills
 * per-room usage and review/evaluate/createTestSet carry backend write
 * permissions (mapping:annotation:write / mapping:evaluation:write), so all of
 * them refuse to execute without an explicit --confirm.
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

/** Exit with a client-side validation message (no HTTP call). */
function fail(ctx: Ctx, msg: string): never {
  error(msg, ctx.jsonMode());
  process.exit(1);
}

/** Parse a --<name> JSON flag into a non-empty array, else exit. */
function jsonArray(ctx: Ctx, name: string, value: string): unknown[] {
  const parsed = parseJsonInput(value);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    fail(ctx, `--${name} must be a non-empty JSON array (or @file.json)`);
  }
  return parsed;
}

/** Comma-separated CLI flag → trimmed string array (catalogs.ts habit). */
function splitList(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

export function createRoommapCommand(ctx: Ctx): Command {
  const roommap = new Command("roommap").description(
    "Room-type mapping: mapping APIs, usage, annotation samples, evaluation",
  );

  // ── map ───────────────────────────────────────────────────────────────

  const map = new Command("map").description("Map supplier rooms onto canonical room groups (billed per room)");

  map
    .command("rooms")
    .description("Map one country batch of supplier rooms (write operation — requires --confirm)")
    .requiredOption("--country-code <code>", "Country code (e.g. US)")
    .requiredOption("--rooms <json>", 'Rooms JSON array of {hotelId, supplier, roomCode, roomName, ratePkgId?, amount?}, or @file.json')
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "roommap map rooms", opts.confirm);
      const rooms = jsonArray(ctx, "rooms", opts.rooms);
      await run(ctx, "/api/roomMapping/mapRooms", { countryCode: opts.countryCode, rooms });
    });

  map
    .command("rooms-batch")
    .description("Batch-map rooms across multiple hotels (write operation — requires --confirm)")
    .requiredOption("--requests <json>", 'Requests JSON array of {countryCode, rooms}, or @file.json')
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "roommap map rooms-batch", opts.confirm);
      const requests = jsonArray(ctx, "requests", opts.requests);
      await run(ctx, "/api/roomMapping/mapRoomsBatch", { requests });
    });

  roommap.addCommand(map);

  // ── usage ─────────────────────────────────────────────────────────────

  roommap
    .command("usage")
    .description("Query the tenant's room-mapping usage")
    .option("--tenant-entity-id <id>", "Tenant entity ID (omit for current)")
    .action(async (opts) => {
      const body: any = {};
      if (opts.tenantEntityId) body.tenantEntityId = opts.tenantEntityId;
      await run(ctx, "/api/roomMapping/getMappingUsage", body);
    });

  // ── annotation ────────────────────────────────────────────────────────

  const annotation = new Command("annotation").description("HB mapping annotation samples");

  annotation
    .command("samples")
    .description("List annotation samples (paged, filterable)")
    .option("--limit <n>", "Page size (default 50)", parseInt)
    .option("--offset <n>", "Page offset (default 0)", parseInt)
    .option("--type <type>", "Sample type filter")
    .option("--annotated", "Only annotated samples")
    .option("--no-annotated", "Only unannotated samples")
    .option("--review-status <status>", "Review status filter")
    .action(async (opts) => {
      const body: any = {};
      if (opts.limit !== undefined) body.limit = opts.limit;
      if (opts.offset !== undefined) body.offset = opts.offset;
      if (opts.type) body.type = opts.type;
      if (opts.annotated !== undefined) body.annotated = opts.annotated;
      if (opts.reviewStatus) body.reviewStatus = opts.reviewStatus;
      await run(ctx, "/api/mapping/hbAnnotation/listSamples", body);
    });

  annotation
    .command("review")
    .description("Set the review status of an annotation sample (write operation — requires --confirm)")
    .requiredOption("--sample-id <id>", "Sample ID")
    .requiredOption("--status <status>", "Review status (e.g. approved / rejected)")
    .option("--comment <text>", "Review comment")
    .option("--reviewed-by <who>", "Reviewer identity")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "roommap annotation review", opts.confirm);
      const body: any = { sampleId: opts.sampleId, status: opts.status };
      if (opts.comment) body.comment = opts.comment;
      if (opts.reviewedBy) body.reviewedBy = opts.reviewedBy;
      await run(ctx, "/api/mapping/hbAnnotation/reviewSample", body);
    });

  annotation
    .command("stats")
    .description("Sample coverage stats (by review status, case type, supplier, country)")
    .action(async () => {
      await run(ctx, "/api/mapping/hbAnnotation/getSampleStats", {});
    });

  roommap.addCommand(annotation);

  // ── evaluation ────────────────────────────────────────────────────────

  const evaluation = new Command("evaluation").description("Room-mapping algorithm evaluation");

  evaluation
    .command("create-test-set")
    .description("Create an evaluation test set (write operation — requires --confirm)")
    .requiredOption("--name <name>", "Test set name")
    .requiredOption("--version <version>", "Version label")
    .option("--description <text>", "Description")
    .option("--created-by <who>", "Creator identity")
    .option("--sample-ids <ids>", "Comma-separated sample IDs")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "roommap evaluation create-test-set", opts.confirm);
      const body: any = { name: opts.name, version: opts.version };
      if (opts.description) body.description = opts.description;
      if (opts.createdBy) body.createdBy = opts.createdBy;
      if (opts.sampleIds) body.sampleIds = splitList(opts.sampleIds);
      await run(ctx, "/api/mapping/hbEvaluation/createTestSet", body);
    });

  evaluation
    .command("evaluate")
    .description("Evaluate an algorithm version against a test set (write operation — requires --confirm)")
    .requiredOption("--test-set-id <n>", "Test set ID", parseInt)
    .requiredOption("--algorithm-version <version>", "Algorithm version to evaluate")
    .option("--evaluated-by <who>", "Evaluator identity")
    .option("--notes <text>", "Notes")
    .option("--confirm", "Confirm execution of write operations", false)
    .action(async (opts) => {
      requireConfirm(ctx, "roommap evaluation evaluate", opts.confirm);
      const body: any = { testSetId: opts.testSetId, algorithmVersion: opts.algorithmVersion };
      if (opts.evaluatedBy) body.evaluatedBy = opts.evaluatedBy;
      if (opts.notes) body.notes = opts.notes;
      await run(ctx, "/api/mapping/hbEvaluation/evaluate", body);
    });

  evaluation
    .command("history")
    .description("Evaluation history for a test set")
    .requiredOption("--test-set-id <n>", "Test set ID", parseInt)
    .option("--limit <n>", "Max results (default 10)", parseInt)
    .action(async (opts) => {
      const body: any = { testSetId: opts.testSetId };
      if (opts.limit !== undefined) body.limit = opts.limit;
      await run(ctx, "/api/mapping/hbEvaluation/getEvaluationHistory", body);
    });

  evaluation
    .command("compare")
    .description("Compare two algorithm versions on one test set")
    .requiredOption("--test-set-id <n>", "Test set ID", parseInt)
    .requiredOption("--version1 <version>", "First algorithm version")
    .requiredOption("--version2 <version>", "Second algorithm version")
    .action(async (opts) => {
      await run(ctx, "/api/mapping/hbEvaluation/compareAlgorithms", {
        testSetId: opts.testSetId,
        version1: opts.version1,
        version2: opts.version2,
      });
    });

  roommap.addCommand(evaluation);

  return roommap;
}
