/**
 * tests/products.test.ts — products + catalogs command groups (issue #31).
 *
 * CLI layer only: `hbcli products|catalogs` spawned against an in-process
 * Bun.serve stub (tests/mcp.test.ts pattern; spawn via process.execPath per
 * tests/cli.test.ts) with an isolated STAICLI_HOME. Asserts request bodies,
 * the --confirm write guard, --json output, and the --help tree.
 * No live environment; no secrets in fixtures.
 */

import { describe, it, expect, afterAll } from "bun:test";
import { rmSync, mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const serverCalls: { path: string; body: any }[] = [];

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    return req.text().then((text) => {
      let body: any = {};
      try { body = text ? JSON.parse(text) : {}; } catch { /* keep {} */ }
      serverCalls.push({ path: url.pathname, body });
      switch (url.pathname) {
        case "/api/content/hotelsMetadata":
          return Response.json({ code: 0, msg: "ok", data: { hotelsMetadata: [{ hotelId: 461850557, name: "Stub Hotel" }], page: { total: 1, hasMore: false } } });
        case "/api/content/listHotelCatalog":
          return Response.json({ code: 0, msg: "ok", data: { catalogs: [{ id: 7, name: "EU 2027" }], total: 1 } });
        case "/api/content/getHotelCatalog":
          return Response.json({ code: 0, msg: "ok", data: { catalog: { id: 7, name: "EU 2027" } } });
        case "/api/content/createHotelCatalog":
          return Response.json({ code: 0, msg: "ok", data: { id: 9 } });
        case "/api/content/getHotelCatalogHotels":
          return Response.json({ code: 0, msg: "ok", data: { hotelIds: [461850557], items: [{ hotelId: 461850557, sourceType: "platform" }], totalExact: true, total: 1, hasMore: false } });
        case "/api/content/batchAddHotelsToCatalog":
          return Response.json({ code: 0, msg: "ok", data: { addedCount: 2 } });
        case "/api/content/batchRemoveHotelsFromCatalog":
          return Response.json({ code: 0, msg: "ok", data: { removedCount: 1 } });
        default:
          return Response.json({ code: 0, msg: "ok", data: { path: url.pathname } });
      }
    });
  },
});

afterAll(() => {
  server.stop(true);
});

const CLI_PATH = join(import.meta.dir, "..", "src", "cli.ts");
const BUN_BIN = process.execPath;

function freshHome(): string {
  return mkdtempSync(join(tmpdir(), "hbcli-products-test-"));
}

function seedTicket(home: string): void {
  // Cached openapi ticket → makeClient takes the ticket flow with zero auth calls.
  writeFileSync(join(home, "credentials.json"), JSON.stringify({ "openapi:uat": { ticket: "stub-ticket" } }));
}

function runCli(args: string[], home: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(BUN_BIN, ["run", CLI_PATH, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        STAICLI_HOME: home,
        HOTELBYTE_BASE_URL: `http://localhost:${server.port}`,
        HOTELBYTE_ENV: "uat",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", () => resolve({ stdout, stderr, exitCode: null }));
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code }));
  });
}

function cleanupHome(home: string): void {
  rmSync(home, { recursive: true, force: true });
}

// ── products ────────────────────────────────────────────────────────────

describe("products list / get (CLI end-to-end)", () => {
  it("list sends nested page + filters to /api/content/hotelsMetadata", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(
        ["--json", "products", "list", "--page-num", "2", "--page-size", "50", "--keyword", "hilton", "--status", "inactive", "--country-code", "AE"],
        home,
      );
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(r.stdout.trim());
      expect(out.hotelsMetadata[0].hotelId).toBe(461850557);
      expect(serverCalls).toHaveLength(1);
      expect(serverCalls[0]?.path).toBe("/api/content/hotelsMetadata");
      expect(serverCalls[0]?.body).toEqual({
        page: { pageNum: 2, pageSize: 50 },
        productKeyword: "hilton",
        status: "inactive",
        countryCode: "AE",
      });
    } finally {
      cleanupHome(home);
    }
  });

  it("list parses comma-separated hotel-ids / stars / tags into arrays", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(
        ["--json", "products", "list", "--hotel-ids", "1, 2", "--stars", "4,5", "--tags", "beach, resort", "--catalog-id", "7"],
        home,
      );
      expect(r.exitCode).toBe(0);
      expect(serverCalls[0]?.body.hotelIds).toEqual(["1", "2"]);
      expect(serverCalls[0]?.body.hotelStars).toEqual([4, 5]);
      expect(serverCalls[0]?.body.tags).toEqual(["beach", "resort"]);
      expect(serverCalls[0]?.body.catalogId).toBe("7");
    } finally {
      cleanupHome(home);
    }
  });

  it("get --hotel-id reads the platform row with a single-item page", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "products", "get", "--hotel-id", "461850557"], home);
      expect(r.exitCode).toBe(0);
      expect(serverCalls[0]?.body).toEqual({ page: { pageNum: 1, pageSize: 1 }, hotelIds: ["461850557"] });
    } finally {
      cleanupHome(home);
    }
  });

  it("get --byoc-hotel-id requires --catalog-id and sends the byoc read shape", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const missing = await runCli(["--json", "products", "get", "--byoc-hotel-id", "bh-1"], home);
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr).toContain("--catalog-id");
      expect(serverCalls).toHaveLength(0); // client-side rejection, no HTTP

      const ok = await runCli(["--json", "products", "get", "--byoc-hotel-id", "bh-1", "--catalog-id", "7"], home);
      expect(ok.exitCode).toBe(0);
      expect(serverCalls[0]?.body).toEqual({
        page: { pageNum: 1, pageSize: 1 },
        dataSource: "byoc",
        catalogId: "7",
        byocHotelIds: ["bh-1"],
      });
    } finally {
      cleanupHome(home);
    }
  });

  it("list rejects an invalid --status client-side (commander choices)", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "products", "list", "--status", "bogus"], home);
      expect(r.exitCode).toBe(1);
      expect(serverCalls).toHaveLength(0);
    } finally {
      cleanupHome(home);
    }
  });
});

// ── catalogs ────────────────────────────────────────────────────────────

describe("catalogs reads (CLI end-to-end)", () => {
  it("list sends flat pageNum/pageSize (+optional owner) to /api/content/listHotelCatalog", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "catalogs", "list", "--page-size", "5", "--owner-entity-id", "42"], home);
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).catalogs[0].id).toBe(7);
      expect(serverCalls[0]?.path).toBe("/api/content/listHotelCatalog");
      expect(serverCalls[0]?.body).toEqual({ pageNum: 1, pageSize: 5, ownerEntityId: "42" });
    } finally {
      cleanupHome(home);
    }
  });

  it("get sends {id} to /api/content/getHotelCatalog", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "catalogs", "get", "--catalog-id", "7"], home);
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).catalog.name).toBe("EU 2027");
      expect(serverCalls[0]?.body).toEqual({ id: "7" });
    } finally {
      cleanupHome(home);
    }
  });

  it("hotels sends catalogId + pagination to /api/content/getHotelCatalogHotels", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "catalogs", "hotels", "--catalog-id", "7", "--page-num", "3"], home);
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).hotelIds).toEqual([461850557]);
      expect(serverCalls[0]?.path).toBe("/api/content/getHotelCatalogHotels");
      expect(serverCalls[0]?.body).toEqual({ catalogId: "7", pageNum: 3, pageSize: 20 });
    } finally {
      cleanupHome(home);
    }
  });
});

describe("catalogs write guard (--confirm)", () => {
  it("create is rejected without --confirm and never reaches the server", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "catalogs", "create", "--name", "EU 2027"], home);
      expect(r.exitCode).toBe(1);
      expect(JSON.parse(r.stderr.trim()).error).toContain("--confirm");
      expect(serverCalls).toHaveLength(0);
    } finally {
      cleanupHome(home);
    }
  });

  it("create executes with --confirm and sends the HotelCatalog fields", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(
        ["--json", "catalogs", "create", "--name", "EU 2027", "--catalog-type", "byoc", "--location-mode", "hybrid", "--confirm"],
        home,
      );
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).id).toBe(9);
      expect(serverCalls[0]?.path).toBe("/api/content/createHotelCatalog");
      expect(serverCalls[0]?.body).toEqual({ name: "EU 2027", catalogType: "byoc", locationMode: "hybrid" });
    } finally {
      cleanupHome(home);
    }
  });

  it("add-hotels / remove-hotels guard, validate targets, and batch shapes", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const guarded = await runCli(["--json", "catalogs", "add-hotels", "--catalog-id", "7", "--hotel-ids", "1,2"], home);
      expect(guarded.exitCode).toBe(1);
      expect(guarded.stderr).toContain("--confirm");
      expect(serverCalls).toHaveLength(0);

      const noTargets = await runCli(["--json", "catalogs", "add-hotels", "--catalog-id", "7", "--confirm"], home);
      expect(noTargets.exitCode).toBe(1);
      expect(noTargets.stderr).toContain("--hotel-ids or --tenant-hotel-ids");
      expect(serverCalls).toHaveLength(0);

      const add = await runCli(["--json", "catalogs", "add-hotels", "--catalog-id", "7", "--hotel-ids", "1, 2", "--confirm"], home);
      expect(add.exitCode).toBe(0);
      expect(JSON.parse(add.stdout.trim()).addedCount).toBe(2);
      expect(serverCalls[0]?.path).toBe("/api/content/batchAddHotelsToCatalog");
      expect(serverCalls[0]?.body).toEqual({ catalogId: "7", hotelIds: ["1", "2"] });

      serverCalls.length = 0;
      const remove = await runCli(
        ["--json", "catalogs", "remove-hotels", "--catalog-id", "7", "--tenant-hotel-ids", "bh-1,bh-2", "--confirm"],
        home,
      );
      expect(remove.exitCode).toBe(0);
      expect(JSON.parse(remove.stdout.trim()).removedCount).toBe(1);
      expect(serverCalls[0]?.path).toBe("/api/content/batchRemoveHotelsFromCatalog");
      expect(serverCalls[0]?.body).toEqual({ catalogId: "7", tenantHotelIds: ["bh-1", "bh-2"] });
    } finally {
      cleanupHome(home);
    }
  });
});

// ── command tree ────────────────────────────────────────────────────────

describe("products / catalogs command tree (--help)", () => {
  it("top-level help lists both groups", async () => {
    const home = freshHome();
    try {
      const { stdout, exitCode } = await runCli(["--help"], home);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/^  products\b/m);
      expect(stdout).toMatch(/^  catalogs\b/m);
    } finally {
      cleanupHome(home);
    }
  });

  it("products --help lists list/get; catalogs --help lists all six subcommands", async () => {
    const home = freshHome();
    try {
      const products = await runCli(["products", "--help"], home);
      expect(products.exitCode).toBe(0);
      expect(products.stdout).toContain("list");
      expect(products.stdout).toContain("get");

      const catalogs = await runCli(["catalogs", "--help"], home);
      expect(catalogs.exitCode).toBe(0);
      for (const sub of ["list", "get", "create", "hotels", "add-hotels", "remove-hotels"]) {
        expect(catalogs.stdout).toContain(sub);
      }
    } finally {
      cleanupHome(home);
    }
  });

  it("write subcommands document --confirm in their help", async () => {
    const home = freshHome();
    try {
      for (const sub of ["create", "add-hotels", "remove-hotels"]) {
        const r = await runCli(["catalogs", sub, "--help"], home);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("--confirm");
      }
    } finally {
      cleanupHome(home);
    }
  });
});
