/**
 * tests/roommap.test.ts — roommap command group.
 *
 * Imports the createRoommapCommand factory, registers it into a fresh
 * commander program (tests/auth.test.ts pattern: global.fetch stub + isolated
 * STAICLI_HOME), and asserts the command tree, request paths, request bodies,
 * and the --confirm write guard on map/annotation-review/evaluation writes.
 * No live environment.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createRoommapCommand } from "../src/commands/roommap.ts";

const STUB_BASE = "http://stub.roommap.test";
const TMP_HOME = join(import.meta.dir, ".tmp-roommap-test-home");

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
  program.addCommand(createRoommapCommand({ jsonMode: () => true, env: () => "uat" }));
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

describe("roommap command tree", () => {
  it("registers roommap with map / usage / annotation / evaluation", () => {
    const roommap = buildProgram().commands.find((c) => c.name() === "roommap");
    expect(roommap).toBeDefined();
    const names = (group: string): string[] | undefined =>
      roommap?.commands.find((c) => c.name() === group)?.commands.map((c) => c.name());
    expect(names("map")).toEqual(["rooms", "rooms-batch"]);
    expect(roommap?.commands.some((c) => c.name() === "usage")).toBe(true);
    expect(names("annotation")).toEqual(["samples", "review", "stats"]);
    expect(names("evaluation")).toEqual(["create-test-set", "evaluate", "history", "compare"]);
  });

  it("documents --confirm on map rooms/rooms-batch, annotation review, and evaluation writes", () => {
    const roommap = buildProgram().commands.find((c) => c.name() === "roommap");
    const leaf = (group: string, name: string) =>
      roommap?.commands.find((c) => c.name() === group)?.commands.find((c) => c.name() === name);
    for (const cmd of [
      leaf("map", "rooms"),
      leaf("map", "rooms-batch"),
      leaf("annotation", "review"),
      leaf("evaluation", "create-test-set"),
      leaf("evaluation", "evaluate"),
    ]) {
      expect(cmd?.options.some((o) => o.long === "--confirm")).toBe(true);
    }
  });
});

// ── map ─────────────────────────────────────────────────────────────────

describe("roommap map", () => {
  const roomsJson = '[{"hotelId":"8001","supplier":"ctrip","roomCode":"RM-1","roomName":"Deluxe"},{"hotelId":"8001","supplier":"ctrip","roomCode":"RM-2","roomName":"Suite"}]';

  it("rooms is guarded and posts {countryCode, rooms} to /api/roomMapping/mapRooms", async () => {
    trapExit();
    await expect(run(["roommap", "map", "rooms", "--country-code", "US", "--rooms", roomsJson])).rejects.toThrow(
      "process.exit(1)",
    );
    expect(captured).toHaveLength(0);

    await run(["roommap", "map", "rooms", "--country-code", "US", "--rooms", roomsJson, "--confirm"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/roomMapping/mapRooms`);
    expect(captured[0]?.body).toEqual({
      countryCode: "US",
      rooms: [
        { hotelId: "8001", supplier: "ctrip", roomCode: "RM-1", roomName: "Deluxe" },
        { hotelId: "8001", supplier: "ctrip", roomCode: "RM-2", roomName: "Suite" },
      ],
    });
  });

  it("rooms-batch posts {requests} to /api/roomMapping/mapRoomsBatch and is guarded", async () => {
    trapExit();
    await expect(run(["roommap", "map", "rooms-batch", "--requests", '[{"countryCode":"US","rooms":[]}]'])).rejects.toThrow(
      "process.exit(1)",
    );
    expect(captured).toHaveLength(0);

    await run(["roommap", "map", "rooms-batch", "--requests", '[{"countryCode":"US","rooms":[{"hotelId":"1","supplier":"s","roomCode":"c","roomName":"n"}]}]', "--confirm"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/roomMapping/mapRoomsBatch`);
    expect(captured[0]?.body).toEqual({
      requests: [{ countryCode: "US", rooms: [{ hotelId: "1", supplier: "s", roomCode: "c", roomName: "n" }] }],
    });
  });

  it("rooms rejects empty or non-array rooms client-side", async () => {
    trapExit();
    await expect(run(["roommap", "map", "rooms", "--country-code", "US", "--rooms", "[]", "--confirm"])).rejects.toThrow(
      "process.exit(1)",
    );
    await expect(run(["roommap", "map", "rooms", "--country-code", "US", "--rooms", '{"rooms":[]}', "--confirm"])).rejects.toThrow(
      "process.exit(1)",
    );
    expect(captured).toHaveLength(0);
  });
});

// ── usage ───────────────────────────────────────────────────────────────

describe("roommap usage", () => {
  it("posts {tenantEntityId} (omitted when unset) to /api/roomMapping/getMappingUsage", async () => {
    await run(["roommap", "usage"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/roomMapping/getMappingUsage`);
    expect(captured[0]?.body).toEqual({});

    await run(["roommap", "usage", "--tenant-entity-id", "42"]);
    expect(captured[1]?.body).toEqual({ tenantEntityId: "42" });
  });
});

// ── annotation ──────────────────────────────────────────────────────────

describe("roommap annotation", () => {
  it("samples posts filters to /api/mapping/hbAnnotation/listSamples", async () => {
    await run(["roommap", "annotation", "samples", "--limit", "10", "--type", "low_confidence", "--no-annotated", "--review-status", "pending"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/mapping/hbAnnotation/listSamples`);
    expect(captured[0]?.body).toEqual({ limit: 10, type: "low_confidence", annotated: false, reviewStatus: "pending" });

    await run(["roommap", "annotation", "samples"]);
    expect(captured[1]?.body).toEqual({}); // no filters → empty body, backend defaults apply
  });

  it("review is guarded and posts {sampleId, status} to /api/mapping/hbAnnotation/reviewSample", async () => {
    trapExit();
    await expect(run(["roommap", "annotation", "review", "--sample-id", "s-1", "--status", "approved"])).rejects.toThrow(
      "process.exit(1)",
    );
    expect(captured).toHaveLength(0);

    await run(["roommap", "annotation", "review", "--sample-id", "s-1", "--status", "approved", "--comment", "ok", "--reviewed-by", "alice", "--confirm"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/mapping/hbAnnotation/reviewSample`);
    expect(captured[0]?.body).toEqual({ sampleId: "s-1", status: "approved", comment: "ok", reviewedBy: "alice" });
  });

  it("stats posts {} to /api/mapping/hbAnnotation/getSampleStats", async () => {
    await run(["roommap", "annotation", "stats"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/mapping/hbAnnotation/getSampleStats`);
    expect(captured[0]?.body).toEqual({});
  });
});

// ── evaluation ──────────────────────────────────────────────────────────

describe("roommap evaluation", () => {
  it("create-test-set is guarded and posts the CreateTestSetRequest shape", async () => {
    trapExit();
    await expect(run(["roommap", "evaluation", "create-test-set", "--name", "t1", "--version", "v1"])).rejects.toThrow(
      "process.exit(1)",
    );
    expect(captured).toHaveLength(0);

    await run(["roommap", "evaluation", "create-test-set", "--name", "t1", "--version", "v1", "--description", "d", "--created-by", "alice", "--sample-ids", " a, b ", "--confirm"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/mapping/hbEvaluation/createTestSet`);
    expect(captured[0]?.body).toEqual({ name: "t1", version: "v1", description: "d", createdBy: "alice", sampleIds: ["a", "b"] });
  });

  it("evaluate is guarded and coerces testSetId to a number", async () => {
    trapExit();
    await expect(run(["roommap", "evaluation", "evaluate", "--test-set-id", "7", "--algorithm-version", "v2"])).rejects.toThrow(
      "process.exit(1)",
    );
    expect(captured).toHaveLength(0);

    await run(["roommap", "evaluation", "evaluate", "--test-set-id", "7", "--algorithm-version", "v2", "--evaluated-by", "bob", "--notes", "n", "--confirm"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/mapping/hbEvaluation/evaluate`);
    expect(captured[0]?.body).toEqual({ testSetId: 7, algorithmVersion: "v2", evaluatedBy: "bob", notes: "n" });
  });

  it("history and compare hit their endpoints with numeric testSetId", async () => {
    await run(["roommap", "evaluation", "history", "--test-set-id", "7", "--limit", "5"]);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/mapping/hbEvaluation/getEvaluationHistory`);
    expect(captured[0]?.body).toEqual({ testSetId: 7, limit: 5 });

    await run(["roommap", "evaluation", "compare", "--test-set-id", "7", "--version1", "v1", "--version2", "v2"]);
    expect(captured[1]?.url).toBe(`${STUB_BASE}/api/mapping/hbEvaluation/compareAlgorithms`);
    expect(captured[1]?.body).toEqual({ testSetId: 7, version1: "v1", version2: "v2" });
  });
});
