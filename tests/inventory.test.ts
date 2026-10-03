/**
 * tests/inventory.test.ts — inventory command group.
 *
 * Imports the createInventoryCommand factory, registers it into a fresh
 * commander program (tests/auth.test.ts pattern: global.fetch stub + isolated
 * STAICLI_HOME), and asserts the command tree, request paths, request bodies,
 * and the --confirm write guard. No live environment.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createInventoryCommand } from "../src/commands/inventory.ts";

const STUB_BASE = "http://stub.inventory.test";
const TMP_HOME = join(import.meta.dir, ".tmp-inventory-test-home");

let captured: { url: string; body: Record<string, unknown> }[] = [];
const originalFetch = global.fetch;
const originalExit = process.exit;

beforeEach(() => {
  if (captured === undefined) captured = [];
  captured = [];
  rmSync(TMP_HOME, { recursive: true, force: true });
  mkdirSync(TMP_HOME, { recursive: true });
  process.env.STAICLI_HOME = TMP_HOME;
  process.env.HOTELBYTE_BASE_URL = STUB_BASE;
  // Cached openapi ticket → makeClient takes the ticket flow with zero auth calls.
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
  program.addCommand(createInventoryCommand({ jsonMode: () => true, env: () => "uat" }));
  return program;
}

// Make helper.run / requireConfirm's process.exit observable instead of fatal.
function trapExit(): void {
  process.exit = ((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as typeof process.exit;
}

async function run(args: string[]): Promise<void> {
  await buildProgram().parseAsync(args, { from: "user" });
}

// ── command tree ────────────────────────────────────────────────────────

describe("inventory command tree", () => {
  it("registers inventory with stop-sale / release-periods / calendar / reports subgroups", () => {
    const program = buildProgram();
    const inventory = program.commands.find((c) => c.name() === "inventory");
    expect(inventory).toBeDefined();

    const names = (group: string): string[] | undefined =>
      inventory?.commands.find((c) => c.name() === group)?.commands.map((c) => c.name());
    expect(names("stop-sale")).toEqual(["list", "create", "lift", "bulk"]);
    expect(names("release-periods")).toEqual(["list", "create", "delete"]);
    expect(names("calendar")).toEqual(["inventory-matrix", "rate-matrix", "bulk-update"]);
    expect(names("reports")).toEqual(["commission", "sales", "inventory"]);
  });

  it("documents --confirm on every write subcommand", () => {
    const inventory = buildProgram().commands.find((c) => c.name() === "inventory");
    const writes: [string, string][] = [
      ["stop-sale", "create"],
      ["stop-sale", "lift"],
      ["stop-sale", "bulk"],
      ["release-periods", "create"],
      ["release-periods", "delete"],
      ["calendar", "bulk-update"],
    ];
    for (const [group, leaf] of writes) {
      const cmd = inventory?.commands
        .find((c) => c.name() === group)
        ?.commands.find((c) => c.name() === leaf);
      expect(cmd?.options.some((o) => o.long === "--confirm")).toBe(true);
    }
  });
});

// ── stop-sale ───────────────────────────────────────────────────────────

describe("inventory stop-sale", () => {
  it("list sends filters + pagination to /api/inventory/listStopSales", async () => {
    await run(["inventory", "stop-sale", "list", "--hotel-id", "8001", "--status", "active", "--page-size", "5"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/inventory/listStopSales`);
    expect(captured[0]?.body).toEqual({ pageNum: 1, pageSize: 5, hotelId: "8001", status: "active" });
  });

  it("create is rejected without --confirm and never reaches the server", async () => {
    trapExit();
    await expect(run(["inventory", "stop-sale", "create", "--hotel-id", "8001", "--date-from", "20250201", "--date-to", "20250207"])).rejects.toThrow(
      "process.exit(1)",
    );
    expect(captured).toHaveLength(0);
  });

  it("create wraps fields in {stopSale} at /api/inventory/createStopSale", async () => {
    await run([
      "inventory", "stop-sale", "create",
      "--hotel-id", "8001", "--date-from", "20250201", "--date-to", "20250207",
      "--room-type-code", "DLX", "--source-markets", "CN, US", "--reason", "overbooking risk", "--precedence", "3",
      "--confirm",
    ]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/inventory/createStopSale`);
    expect(captured[0]?.body).toEqual({
      stopSale: {
        hotelId: "8001",
        dateFrom: "20250201",
        dateTo: "20250207",
        roomTypeCode: "DLX",
        sourceMarkets: ["CN", "US"],
        reason: "overbooking risk",
        precedence: 3,
      },
    });
  });

  it("lift sends {id, version:number} and requires --confirm", async () => {
    trapExit();
    await expect(run(["inventory", "stop-sale", "lift", "--id", "71", "--version", "2"])).rejects.toThrow("process.exit(1)");
    expect(captured).toHaveLength(0);

    await run(["inventory", "stop-sale", "lift", "--id", "71", "--version", "2", "--confirm"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/inventory/liftStopSale`);
    expect(captured[0]?.body).toEqual({ id: "71", version: 2 });
  });

  it("bulk --op lift posts {items} with numeric versions to /api/inventory/bulkLiftStopSales", async () => {
    await run(["inventory", "stop-sale", "bulk", "--op", "lift", "--items", '[{"id":"1","version":"2"},{"id":3,"version":5}]', "--confirm"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/inventory/bulkLiftStopSales`);
    expect(captured[0]?.body).toEqual({ items: [{ id: "1", version: 2 }, { id: "3", version: 5 }] });
  });

  it("bulk --op delete posts to /api/inventory/bulkDeleteStopSales; bad items fail client-side", async () => {
    await run(["inventory", "stop-sale", "bulk", "--op", "delete", "--items", '[{"id":9,"version":1}]', "--confirm"]);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/inventory/bulkDeleteStopSales`);
    expect(captured[0]?.body).toEqual({ items: [{ id: "9", version: 1 }] });

    trapExit();
    await expect(run(["inventory", "stop-sale", "bulk", "--op", "lift", "--items", "[]", "--confirm"])).rejects.toThrow(
      "process.exit(1)",
    );
    await expect(
      run(["inventory", "stop-sale", "bulk", "--op", "lift", "--items", '[{"id":"1","version":"x"}]', "--confirm"]),
    ).rejects.toThrow("process.exit(1)");
    expect(captured).toHaveLength(1); // only the delete above reached the stub

    // guard: no --confirm at all
    await expect(run(["inventory", "stop-sale", "bulk", "--op", "lift", "--items", '[{"id":1,"version":1}]'])).rejects.toThrow(
      "process.exit(1)",
    );
  });
});

// ── release-periods ─────────────────────────────────────────────────────

describe("inventory release-periods", () => {
  it("list sends filters + pagination to /api/inventory/listReleasePeriods", async () => {
    await run(["inventory", "release-periods", "list", "--hotel-id", "8001", "--contract-id", "C-9", "--page-num", "2"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/inventory/listReleasePeriods`);
    expect(captured[0]?.body).toEqual({ pageNum: 2, pageSize: 20, hotelId: "8001", contractId: "C-9" });
  });

  it("create wraps fields in {releasePeriod} and is guarded by --confirm", async () => {
    trapExit();
    await expect(run(["inventory", "release-periods", "create", "--hotel-id", "8001"])).rejects.toThrow("process.exit(1)");
    expect(captured).toHaveLength(0);

    await run([
      "inventory", "release-periods", "create", "--hotel-id", "8001",
      "--room-type-code", "DLX", "--days-before-checkin", "7", "--cutoff-time", "18:00", "--timezone", "Asia/Shanghai",
      "--confirm",
    ]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/inventory/createReleasePeriod`);
    expect(captured[0]?.body).toEqual({
      releasePeriod: {
        hotelId: "8001",
        roomTypeCode: "DLX",
        daysBeforeCheckin: 7,
        cutoffTime: "18:00",
        timezone: "Asia/Shanghai",
      },
    });
  });

  it("delete sends {id, version:number} and requires --confirm", async () => {
    trapExit();
    await expect(run(["inventory", "release-periods", "delete", "--id", "12", "--version", "1"])).rejects.toThrow(
      "process.exit(1)",
    );
    expect(captured).toHaveLength(0);

    await run(["inventory", "release-periods", "delete", "--id", "12", "--version", "1", "--confirm"]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/inventory/deleteReleasePeriod`);
    expect(captured[0]?.body).toEqual({ id: "12", version: 1 });
  });
});

// ── calendar ────────────────────────────────────────────────────────────

describe("inventory calendar", () => {
  it("inventory-matrix / rate-matrix send the range query to their matrix endpoints", async () => {
    await run(["inventory", "calendar", "inventory-matrix", "--hotel-id", "8001", "--date-from", "20250201", "--date-to", "20250207", "--room-type-code", "DLX"]);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/inventory/getInventoryMatrix`);
    expect(captured[0]?.body).toEqual({ hotelId: "8001", dateFrom: "20250201", dateTo: "20250207", roomTypeCode: "DLX" });

    await run(["inventory", "calendar", "rate-matrix", "--hotel-id", "8001", "--date-from", "20250201", "--date-to", "20250207", "--rate-id", "55"]);
    expect(captured[1]?.url).toBe(`${STUB_BASE}/api/inventory/getRateMatrix`);
    expect(captured[1]?.body).toEqual({ hotelId: "8001", dateFrom: "20250201", dateTo: "20250207", rateId: "55" });
  });

  it("bulk-update is guarded and posts {hotelId, items} verbatim to /api/inventory/bulkUpdateInventory", async () => {
    trapExit();
    await expect(
      run(["inventory", "calendar", "bulk-update", "--hotel-id", "8001", "--items", '[{"roomTypeCode":"DLX","date":20250201,"allotment":3}]']),
    ).rejects.toThrow("process.exit(1)");
    expect(captured).toHaveLength(0);

    await run([
      "inventory", "calendar", "bulk-update", "--hotel-id", "8001", "--items",
      '[{"roomTypeCode":"DLX","date":20250201,"allotment":3,"stopSale":true},{"roomTypeCode":"DLX","rateId":"55","date":"20250202","isFreesale":false}]',
      "--confirm",
    ]);
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/inventory/bulkUpdateInventory`);
    expect(captured[0]?.body).toEqual({
      hotelId: "8001",
      items: [
        { roomTypeCode: "DLX", date: 20250201, allotment: 3, stopSale: true },
        { roomTypeCode: "DLX", rateId: "55", date: "20250202", isFreesale: false },
      ],
    });
  });

  it("bulk-update rejects empty or malformed items client-side", async () => {
    trapExit();
    await expect(run(["inventory", "calendar", "bulk-update", "--hotel-id", "8001", "--items", "[]", "--confirm"])).rejects.toThrow(
      "process.exit(1)",
    );
    await expect(
      run(["inventory", "calendar", "bulk-update", "--hotel-id", "8001", "--items", '[{"date":20250201}]', "--confirm"]),
    ).rejects.toThrow("process.exit(1)");
    expect(captured).toHaveLength(0);
  });
});

// ── reports ─────────────────────────────────────────────────────────────

describe("inventory reports", () => {
  it("commission / sales / inventory map to their report endpoints with the range query", async () => {
    await run(["inventory", "reports", "commission", "--hotel-id", "8001", "--date-from", "20250201", "--date-to", "20250228"]);
    expect(captured[0]?.url).toBe(`${STUB_BASE}/api/inventory/getCommissionReport`);
    expect(captured[0]?.body).toEqual({ hotelId: "8001", dateFrom: "20250201", dateTo: "20250228" });

    await run(["inventory", "reports", "sales", "--hotel-id", "8001", "--date-from", "20250201", "--date-to", "20250228", "--room-type-code", "DLX"]);
    expect(captured[1]?.url).toBe(`${STUB_BASE}/api/inventory/getSalesReport`);
    expect(captured[1]?.body).toEqual({ hotelId: "8001", dateFrom: "20250201", dateTo: "20250228", roomTypeCode: "DLX" });

    await run(["inventory", "reports", "inventory", "--hotel-id", "8001", "--date-from", "20250201", "--date-to", "20250228"]);
    expect(captured[2]?.url).toBe(`${STUB_BASE}/api/inventory/getInventoryReport`);
    expect(captured[2]?.body).toEqual({ hotelId: "8001", dateFrom: "20250201", dateTo: "20250228" });
  });
});
