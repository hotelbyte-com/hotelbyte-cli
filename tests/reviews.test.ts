/**
 * tests/reviews.test.ts — reviews command group (evaluation service).
 *
 * Imports the createReviewsCommand factory, registers it into a fresh
 * commander program (tests/auth.test.ts pattern: global.fetch stub + isolated
 * STAICLI_HOME), and asserts the command tree, request paths, request bodies,
 * and the --confirm write guard on create/recalc. No live environment.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createReviewsCommand } from "../src/commands/reviews.ts";

const STUB_BASE = "http://stub.reviews.test";
const TMP_HOME = join(import.meta.dir, ".tmp-reviews-test-home");

let captured: { url: string; body: Record<string, unknown> }[] = [];
const originalFetch = global.fetch;
const originalExit = process.exit;

beforeEach(() => {
  captured = [];
  rmSync(TMP_HOME, { recursive: true, force: true });
  mkdirSync(TMP_HOME, { recursive: true });
  process.env.STAICLI_HOME = TMP_HOME;
  process.env.HOTELBYTE_BASE_URL = STUB_BASE;
  writeFileSync(join(TMP_HOME, "credentials.json"), JSON.stringify({ "openapi:uat": { ticket: "stub-ticket" } }));
  global.fetch = (async (url: unknown, init?: RequestInit) => {
    captured.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ code: 0, msg: "ok", data: { ok: true } }), { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  process.exit = originalExit;
  delete process.env.STAICLI_HOME;
  delete process.env.HOTELBYTE_BASE_URL;
  rmSync(TMP_HOME, { recursive: true, force: true });
});

function buildProgram(): Command {
  const program = new Command();
  program.addCommand(createReviewsCommand({ jsonMode: () => true, env: () => "uat" }));
  return program;
}

function trapExit(): void {
  process.exit = ((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as typeof process.exit;
}

async function run(args: string[]): Promise<void> {
  await buildProgram().parseAsync(args, { from: "user" });
}

// ── command tree ────────────────────────────────────────────────────────

describe("reviews command tree", () => {
  it("registers list / create / rating-stats / scores(list, detail) / recalc", () => {
    const reviews = buildProgram().commands.find((c) => c.name() === "reviews");
    expect(reviews).toBeDefined();
    expect(reviews?.commands.map((c) => c.name())).toEqual(["list", "create", "rating-stats", "scores", "recalc"]);
    expect(reviews?.commands.find((c) => c.name() === "scores")?.commands.map((c) => c.name())).toEqual(["list", "detail"]);
  });

  it("documents --confirm on create and recalc only", () => {
    const reviews = buildProgram().commands.find((c) => c.name() === "reviews");
    const hasConfirm = (name: string): boolean | undefined =>
      reviews?.commands.find((c) => c.name() === name)?.options.some((o) => o.long === "--confirm");
    expect(hasConfirm("create")).toBe(true);
    expect(hasConfirm("recalc")).toBe(true);
    expect(hasConfirm("list")).toBe(false);
    expect(hasConfirm("rating-stats")).toBe(false);
  });
});

// ── reads ───────────────────────────────────────────────────────────────

describe("reviews reads", () => {
  it("list posts {hotelId, status?, pageNum, pageSize} to /api/evaluation/listHotelReviews", async () => {
    await run(["reviews", "list", "--hotel-id", "8001", "--status", "1", "--page-num", "2", "--page-size", "10"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/evaluation/listHotelReviews`);
    expect(captured[0]?.body).toEqual({ hotelId: "8001", status: 1, pageNum: 2, pageSize: 10 });

    await run(["reviews", "list", "--hotel-id", "8001"]);
    expect(captured[1]?.body).toEqual({ hotelId: "8001", pageNum: 1, pageSize: 20 }); // status omitted → backend default
  });

  it("rating-stats posts {hotelId} to /api/evaluation/getHotelRatingStats", async () => {
    await run(["reviews", "rating-stats", "--hotel-id", "8001"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/evaluation/getHotelRatingStats`);
    expect(captured[0]?.body).toEqual({ hotelId: "8001" });
  });

  it("scores list coerces hotel-ids/days to numbers; detail posts {hotelId}", async () => {
    await run(["reviews", "scores", "list", "--hotel-ids", "8001, 8002", "--sort-by", "hqsTotal", "--sort-order", "desc", "--days", "90", "--page-size", "5"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/evaluation/listHotelScores`);
    expect(captured[0]?.body).toEqual({
      pageNum: 1,
      pageSize: 5,
      hotelIds: [8001, 8002],
      sortBy: "hqsTotal",
      sortOrder: "desc",
      days: 90,
    });

    await run(["reviews", "scores", "list"]);
    expect(captured[1]?.body).toEqual({ pageNum: 1, pageSize: 20 }); // no filters → backend defaults

    await run(["reviews", "scores", "detail", "--hotel-id", "8001"]);
    expect(captured[2]?.url).toBe(`${STUB_BASE}/api/evaluation/getHotelScoreDetail`);
    expect(captured[2]?.body).toEqual({ hotelId: "8001" });
  });
});

// ── writes ──────────────────────────────────────────────────────────────

describe("reviews writes (--confirm)", () => {
  it("create is rejected without --confirm and never reaches the server", async () => {
    trapExit();
    await expect(
      run(["reviews", "create", "--hotel-id", "8001", "--customer-entity-id", "990", "--overall-rating", "4.5", "--review-text", "great"]),
    ).rejects.toThrow("process.exit(1)");
    expect(captured).toHaveLength(0);
  });

  it("create posts the CreateReviewReq shape with numeric ratings", async () => {
    await run([
      "reviews", "create",
      "--hotel-id", "8001", "--customer-entity-id", "990", "--order-id", "77001",
      "--overall-rating", "4.5", "--location-rating", "4", "--cleanliness-rating", "5",
      "--service-rating", "4", "--facility-rating", "3.5", "--value-rating", "4", "--sleep-rating", "4", "--dining-rating", "4",
      "--review-text", "Great stay", "--tags", "clean, quiet", "--lang", "en", "--stay-date", "2025-01-01",
      "--media", '[{"mediaType":1,"url":"https://cdn/x.jpg","sortOrder":1}]',
      "--confirm",
    ]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/evaluation/createReview`);
    expect(captured[0]?.body).toEqual({
      hotelId: "8001",
      customerEntityId: "990",
      orderId: "77001",
      overallRating: 4.5,
      locationRating: 4,
      cleanlinessRating: 5,
      serviceRating: 4,
      facilityRating: 3.5,
      valueRating: 4,
      sleepRating: 4,
      diningRating: 4,
      reviewText: "Great stay",
      tags: ["clean", "quiet"],
      lang: "en",
      stayDate: "2025-01-01",
      media: [{ mediaType: 1, url: "https://cdn/x.jpg", sortOrder: 1 }],
    });
  });

  it("create omits unset optionals instead of sending empty values", async () => {
    await run([
      "reviews", "create",
      "--hotel-id", "8001", "--customer-entity-id", "990", "--overall-rating", "5", "--review-text", "perfect",
      "--confirm",
    ]);
    expect(captured[0]?.body).toEqual({
      hotelId: "8001",
      customerEntityId: "990",
      overallRating: 5,
      reviewText: "perfect",
    });
  });

  it("recalc is guarded and posts {hotelId} to /api/evaluation/recalculateHotelScore", async () => {
    trapExit();
    await expect(run(["reviews", "recalc", "--hotel-id", "8001"])).rejects.toThrow("process.exit(1)");
    expect(captured).toHaveLength(0);

    await run(["reviews", "recalc", "--hotel-id", "8001", "--confirm"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/evaluation/recalculateHotelScore`);
    expect(captured[0]?.body).toEqual({ hotelId: "8001" });
  });
});
