/**
 * tests/billing.test.ts — billing command group (issue #34).
 *
 * CLI layer only: `hbcli billing` spawned against an in-process Bun.serve
 * stub (tests/products.test.ts / tests/lookout.test.ts pattern; spawn via
 * process.execPath per tests/cli.test.ts) with an isolated STAICLI_HOME.
 * Asserts request bodies against the payment service contracts (three
 * prefixes: /api/bi/cost, /api/settlement, /api/promoAdmin), the --confirm
 * write guard, --json output, and the --help tree.
 * No live environment; no secrets in fixtures.
 */

import { describe, it, expect, afterAll } from "bun:test";
import { rmSync, writeFileSync, mkdtempSync } from "node:fs";
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
        case "/api/bi/cost/analytics":
          return Response.json({ code: 0, msg: "ok", data: { statDate: "2026-10-01", currency: "USD", totalRequests: 42 } });
        case "/api/bi/cost/trend":
          return Response.json({ code: 0, msg: "ok", data: { trend: [{ date: "2026-10-01", cost: 1.5 }], summary: { totalCost: 1.5 } } });
        case "/api/bi/cost/monthlyBill":
          return Response.json({ code: 0, msg: "ok", data: { billMonth: "2026-09", sellerEntityId: 7, requestCount: 100 } });
        case "/api/bi/cost/pricingRule":
          return Response.json({ code: 0, msg: "ok", data: { ruleType: "request", pricingType: "per_request", unitPrice: 0.001 } });
        case "/api/settlement/getSettlementOverview":
          return Response.json({ code: 0, msg: "ok", data: { rows: [{ month: "2026-09", grossAmount: 1000 }] } });
        case "/api/settlement/listSettlementEntries":
          return Response.json({ code: 0, msg: "ok", data: { entries: [{ id: 5, flow: "STOREFRONT" }], total: 1 } });
        case "/api/settlement/listTenantPayables":
          return Response.json({ code: 0, msg: "ok", data: { payables: [{ tenantEntityId: 9, currency: "USD", netAmount: 500 }] } });
        case "/api/settlement/listTenantPayouts":
          return Response.json({ code: 0, msg: "ok", data: { payouts: [{ id: 3, status: "pending" }], total: 1 } });
        case "/api/settlement/createTenantPayout":
          return Response.json({ code: 0, msg: "ok", data: { id: 4, status: "pending" } });
        case "/api/settlement/cancelTenantPayout":
          return Response.json({ code: 0, msg: "ok", data: { id: 3, status: "canceled" } });
        case "/api/promoAdmin/listPromoCodes":
          return Response.json({ code: 0, msg: "ok", data: { list: [{ id: 1, code: "LAUNCH20" }], total: 1 } });
        case "/api/promoAdmin/getPromoCode":
          return Response.json({ code: 0, msg: "ok", data: { promoCode: { id: 1, code: "LAUNCH20", status: "active" } } });
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
  return mkdtempSync(join(tmpdir(), "hbcli-billing-test-"));
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

// ── cost ────────────────────────────────────────────────────────────────

describe("billing cost (CLI end-to-end)", () => {
  it("analytics sends only the filters that are set to /api/bi/cost/analytics", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(
        ["--json", "billing", "cost", "analytics", "--stat-date", "2026-10-01", "--seller-id", "7", "--api-path", "/api/search/hotelList"],
        home,
      );
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).totalRequests).toBe(42);
      expect(serverCalls).toHaveLength(1);
      expect(serverCalls[0]?.path).toBe("/api/bi/cost/analytics");
      expect(serverCalls[0]?.body).toEqual({
        statDate: "2026-10-01",
        sellerId: "7",
        apiPath: "/api/search/hotelList",
      });
    } finally {
      cleanupHome(home);
    }
  });

  it("trend sends the window to /api/bi/cost/trend", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "billing", "cost", "trend", "--start-date", "2026-09-01", "--end-date", "2026-09-30"], home);
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).summary.totalCost).toBeCloseTo(1.5);
      expect(serverCalls[0]?.path).toBe("/api/bi/cost/trend");
      expect(serverCalls[0]?.body).toEqual({ startDate: "2026-09-01", endDate: "2026-09-30" });
    } finally {
      cleanupHome(home);
    }
  });

  it("monthly-bill requires bill-month and seller-id, sends both", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const missing = await runCli(["--json", "billing", "cost", "monthly-bill", "--bill-month", "2026-09"], home);
      expect(missing.exitCode).toBe(1);
      expect(serverCalls).toHaveLength(0);

      const r = await runCli(["--json", "billing", "cost", "monthly-bill", "--bill-month", "2026-09", "--seller-id", "7"], home);
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).billMonth).toBe("2026-09");
      expect(serverCalls[0]?.body).toEqual({ billMonth: "2026-09", sellerId: "7" });
    } finally {
      cleanupHome(home);
    }
  });

  it("pricing-rule enforces rule-type choices client-side", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const bogus = await runCli(["--json", "billing", "cost", "pricing-rule", "--rule-type", "bogus"], home);
      expect(bogus.exitCode).toBe(1);
      expect(serverCalls).toHaveLength(0);

      const r = await runCli(["--json", "billing", "cost", "pricing-rule", "--rule-type", "request", "--tenant-id", "9"], home);
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).pricingType).toBe("per_request");
      expect(serverCalls[0]?.body).toEqual({ ruleType: "request", tenantId: "9" });
    } finally {
      cleanupHome(home);
    }
  });
});

// ── settlement ──────────────────────────────────────────────────────────

describe("billing settlement (CLI end-to-end)", () => {
  it("overview passes only the filters that are set", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(
        ["--json", "billing", "settlement", "overview", "--from-month", "2026-08", "--to-month", "2026-09", "--tenant-entity-id", "9"],
        home,
      );
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).rows[0].month).toBe("2026-09");
      expect(serverCalls[0]?.path).toBe("/api/settlement/getSettlementOverview");
      expect(serverCalls[0]?.body).toEqual({ fromMonth: "2026-08", toMonth: "2026-09", tenantEntityId: "9" });
    } finally {
      cleanupHome(home);
    }
  });

  it("entries sends pagination + filters to /api/settlement/listSettlementEntries", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(
        ["--json", "billing", "settlement", "entries", "--page-num", "2", "--page-size", "50", "--currency", "USD", "--unsettled-only", "--payout-id", "3"],
        home,
      );
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).entries[0].flow).toBe("STOREFRONT");
      expect(serverCalls[0]?.path).toBe("/api/settlement/listSettlementEntries");
      expect(serverCalls[0]?.body).toEqual({
        pageNum: 2,
        pageSize: 50,
        currency: "USD",
        payoutId: "3",
        unsettledOnly: true,
      });
    } finally {
      cleanupHome(home);
    }
  });

  it("payables sends tenant filter to /api/settlement/listTenantPayables", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "billing", "settlement", "payables", "--tenant-entity-id", "9"], home);
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).payables[0].netAmount).toBe(500);
      expect(serverCalls[0]?.body).toEqual({ tenantEntityId: "9" });
    } finally {
      cleanupHome(home);
    }
  });

  it("payouts sends pagination + filters to /api/settlement/listTenantPayouts", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(
        ["--json", "billing", "settlement", "payouts", "--tenant-entity-id", "9", "--status", "pending", "--page-size", "5"],
        home,
      );
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).payouts[0].status).toBe("pending");
      expect(serverCalls[0]?.path).toBe("/api/settlement/listTenantPayouts");
      expect(serverCalls[0]?.body).toEqual({ pageNum: 1, pageSize: 5, tenantEntityId: "9", status: "pending" });
    } finally {
      cleanupHome(home);
    }
  });
});

// ── payouts writes ──────────────────────────────────────────────────────

describe("billing payouts write guard (--confirm)", () => {
  it("create / cancel refuse without --confirm and never reach the server", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      for (const args of [
        ["billing", "payouts", "create", "--tenant-entity-id", "9", "--currency", "USD"],
        ["billing", "payouts", "cancel", "--payout-id", "3"],
      ]) {
        const r = await runCli(["--json", ...args], home);
        expect(r.exitCode).toBe(1);
        expect(JSON.parse(r.stderr.trim()).error).toContain("--confirm");
      }
      expect(serverCalls).toHaveLength(0);
    } finally {
      cleanupHome(home);
    }
  });

  it("writes execute with --confirm and carry the settlement request shapes", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const create = await runCli(
        ["--json", "billing", "payouts", "create", "--tenant-entity-id", "9", "--currency", "USD", "--beneficiary-id", "12", "--confirm"],
        home,
      );
      expect(create.exitCode).toBe(0);
      expect(JSON.parse(create.stdout.trim()).id).toBe(4);
      expect(serverCalls[0]).toEqual({
        path: "/api/settlement/createTenantPayout",
        body: { tenantEntityId: "9", currency: "USD", beneficiaryId: "12" },
      });

      serverCalls.length = 0;
      const cancel = await runCli(["--json", "billing", "payouts", "cancel", "--payout-id", "3", "--confirm"], home);
      expect(cancel.exitCode).toBe(0);
      expect(JSON.parse(cancel.stdout.trim()).status).toBe("canceled");
      expect(serverCalls[0]).toEqual({ path: "/api/settlement/cancelTenantPayout", body: { payoutId: "3" } });
    } finally {
      cleanupHome(home);
    }
  });
});

// ── promo ───────────────────────────────────────────────────────────────

describe("billing promo (CLI end-to-end)", () => {
  it("list sends offset/limit + status to /api/promoAdmin/listPromoCodes", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "billing", "promo", "list", "--status", "active", "--offset", "10", "--limit", "5"], home);
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).list[0].code).toBe("LAUNCH20");
      expect(serverCalls[0]?.path).toBe("/api/promoAdmin/listPromoCodes");
      expect(serverCalls[0]?.body).toEqual({ offset: 10, limit: 5, status: "active" });
    } finally {
      cleanupHome(home);
    }
  });

  it("get requires --id or --code (client-side rejection, no HTTP)", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const missing = await runCli(["--json", "billing", "promo", "get"], home);
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr).toContain("--id or --code");
      expect(serverCalls).toHaveLength(0);

      const byId = await runCli(["--json", "billing", "promo", "get", "--id", "1"], home);
      expect(byId.exitCode).toBe(0);
      expect(JSON.parse(byId.stdout.trim()).promoCode.code).toBe("LAUNCH20");
      expect(serverCalls[0]?.body).toEqual({ id: "1" });

      serverCalls.length = 0;
      const byCode = await runCli(["--json", "billing", "promo", "get", "--code", "launch20"], home);
      expect(byCode.exitCode).toBe(0);
      expect(serverCalls[0]?.body).toEqual({ code: "launch20" });
    } finally {
      cleanupHome(home);
    }
  });
});

// ── command tree ────────────────────────────────────────────────────────

describe("billing command tree (--help)", () => {
  it("top-level help lists the billing group", async () => {
    const home = freshHome();
    try {
      const { stdout, exitCode } = await runCli(["--help"], home);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/^  billing\b/m);
    } finally {
      cleanupHome(home);
    }
  });

  it("billing --help lists the four subgroups", async () => {
    const home = freshHome();
    try {
      const r = await runCli(["billing", "--help"], home);
      expect(r.exitCode).toBe(0);
      for (const group of ["cost", "settlement", "payouts", "promo"]) {
        expect(r.stdout).toContain(group);
      }
    } finally {
      cleanupHome(home);
    }
  });

  it("each subgroup help lists its subcommands", async () => {
    const home = freshHome();
    try {
      const cost = await runCli(["billing", "cost", "--help"], home);
      expect(cost.exitCode).toBe(0);
      for (const sub of ["analytics", "trend", "monthly-bill", "pricing-rule"]) expect(cost.stdout).toContain(sub);

      const settlement = await runCli(["billing", "settlement", "--help"], home);
      expect(settlement.exitCode).toBe(0);
      for (const sub of ["overview", "entries", "payables", "payouts"]) expect(settlement.stdout).toContain(sub);

      const payouts = await runCli(["billing", "payouts", "--help"], home);
      expect(payouts.exitCode).toBe(0);
      for (const sub of ["create", "cancel"]) expect(payouts.stdout).toContain(sub);

      const promo = await runCli(["billing", "promo", "--help"], home);
      expect(promo.exitCode).toBe(0);
      for (const sub of ["list", "get"]) expect(promo.stdout).toContain(sub);
    } finally {
      cleanupHome(home);
    }
  });

  it("write subcommands document --confirm in their help", async () => {
    const home = freshHome();
    try {
      for (const args of [
        ["billing", "payouts", "create", "--help"],
        ["billing", "payouts", "cancel", "--help"],
      ]) {
        const r = await runCli(args, home);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain("--confirm");
      }
    } finally {
      cleanupHome(home);
    }
  });
});
