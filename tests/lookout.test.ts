/**
 * tests/lookout.test.ts — lookout command group (issue #33).
 *
 * CLI layer only: `hbcli lookout` spawned against an in-process Bun.serve
 * stub (tests/products.test.ts pattern; spawn via process.execPath per
 * tests/cli.test.ts) with an isolated STAICLI_HOME. Asserts request bodies
 * against the lookout service contract, the --confirm write guard, --json
 * output, and the --help tree. No live environment; no secrets in fixtures.
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
        case "/api/lookout/listComparisonJobs":
          return Response.json({ code: 0, msg: "ok", data: { items: [{ job: { id: 11, name: "DXB rates" }, lastRunStatus: "completed" }], total: 1 } });
        case "/api/lookout/getComparisonJob":
          return Response.json({ code: 0, msg: "ok", data: { job: { id: 11, name: "DXB rates" } } });
        case "/api/lookout/pauseComparisonJob":
          return Response.json({ code: 0, msg: "ok", data: { job: { id: 11, status: "paused" } } });
        case "/api/lookout/resumeComparisonJob":
          return Response.json({ code: 0, msg: "ok", data: { job: { id: 11, status: "active" } } });
        case "/api/lookout/listComparisonRuns":
          return Response.json({ code: 0, msg: "ok", data: { items: [{ run: { id: 21, status: "completed" }, jobName: "DXB rates" }], total: 1 } });
        case "/api/lookout/getComparisonRun":
          return Response.json({ code: 0, msg: "ok", data: { run: { id: 21, status: "completed" }, reports: [{ id: 31 }] } });
        case "/api/lookout/listComparisonRunResultRows":
          return Response.json({ code: 0, msg: "ok", data: { rows: [{ rowKey: "r1", hotelName: "Stub Hotel", lowestPrice: 100, highestPrice: 180 }], total: 1 } });
        case "/api/lookout/triggerComparisonRun":
          return Response.json({ code: 0, msg: "ok", data: { run: { id: 22, status: "pending" }, plannedCalls: 4, blocked: false } });
        case "/api/lookout/cancelComparisonRun":
          return Response.json({ code: 0, msg: "ok", data: { run: { id: 21, status: "canceled" } } });
        case "/api/lookout/listReports":
          return Response.json({ code: 0, msg: "ok", data: { reports: [{ id: 31, runId: 21 }] } });
        case "/api/lookout/downloadComparisonReport":
          return Response.json({ code: 0, msg: "ok", data: { report: { id: 31, runId: 21 } } });
        case "/api/lookout/getComparisonPriceTrends":
          return Response.json({ code: 0, msg: "ok", data: { trends: [{ runId: 21, runDate: "2026-10-01", avgLowest: 100 }] } });
        case "/api/lookout/getComparisonCoverageTrends":
          return Response.json({ code: 0, msg: "ok", data: { trends: [{ runId: 21, runDate: "2026-10-01", coverage: 0.9 }] } });
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
  return mkdtempSync(join(tmpdir(), "hbcli-lookout-test-"));
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

// ── reads ────────────────────────────────────────────────────────────────

describe("lookout jobs (CLI end-to-end)", () => {
  it("list sends flat pagination + parsed statuses to /api/lookout/listComparisonJobs", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(
        ["--json", "lookout", "jobs", "list", "--page-num", "2", "--page-size", "5", "--keyword", "dxb", "--statuses", "active,paused", "--include-stats"],
        home,
      );
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).items[0].job.id).toBe(11);
      expect(serverCalls).toHaveLength(1);
      expect(serverCalls[0]?.path).toBe("/api/lookout/listComparisonJobs");
      expect(serverCalls[0]?.body).toEqual({
        pageNum: 2,
        pageSize: 5,
        keyword: "dxb",
        statuses: ["active", "paused"],
        includeStats: true,
      });
    } finally {
      cleanupHome(home);
    }
  });

  it("get sends {jobId} to /api/lookout/getComparisonJob", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "lookout", "jobs", "get", "--job-id", "11"], home);
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).job.name).toBe("DXB rates");
      expect(serverCalls[0]?.body).toEqual({ jobId: "11" });
    } finally {
      cleanupHome(home);
    }
  });
});

describe("lookout runs (CLI end-to-end)", () => {
  it("list sends jobId + pagination to /api/lookout/listComparisonRuns", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "lookout", "runs", "list", "--job-id", "11", "--page-size", "5", "--statuses", "completed,failed"], home);
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).items[0].run.id).toBe(21);
      expect(serverCalls[0]?.path).toBe("/api/lookout/listComparisonRuns");
      expect(serverCalls[0]?.body).toEqual({ pageNum: 1, pageSize: 5, jobId: "11", statuses: ["completed", "failed"] });
    } finally {
      cleanupHome(home);
    }
  });

  it("get sends {runId} and surfaces run + reports", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "lookout", "runs", "get", "--run-id", "21"], home);
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(r.stdout.trim());
      expect(out.run.id).toBe(21);
      expect(out.reports[0].id).toBe(31);
      expect(serverCalls[0]?.body).toEqual({ runId: "21" });
    } finally {
      cleanupHome(home);
    }
  });

  it("rows sends runId + split band/status filters to /api/lookout/listComparisonRunResultRows", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(
        ["--json", "lookout", "runs", "rows", "--run-id", "21", "--variance-bands", "high, medium", "--cell-statuses", "returned,no_offer", "--rate-type", "cheapest"],
        home,
      );
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).rows[0].hotelName).toBe("Stub Hotel");
      expect(serverCalls[0]?.path).toBe("/api/lookout/listComparisonRunResultRows");
      expect(serverCalls[0]?.body).toEqual({
        runId: "21",
        pageNum: 1,
        pageSize: 20,
        varianceBands: ["high", "medium"],
        cellStatuses: ["returned", "no_offer"],
        rateType: "cheapest",
      });
    } finally {
      cleanupHome(home);
    }
  });
});

describe("lookout reports + insights (CLI end-to-end)", () => {
  it("reports list passes only the filters that are set", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "lookout", "reports", "list", "--job-id", "11", "--source-market", "US"], home);
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).reports[0].id).toBe(31);
      expect(serverCalls[0]?.body).toEqual({ jobId: "11", sourceMarket: "US" });
    } finally {
      cleanupHome(home);
    }
  });

  it("reports get sends {reportId} to /api/lookout/downloadComparisonReport", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "lookout", "reports", "get", "--report-id", "31"], home);
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).report.runId).toBe(21);
      expect(serverCalls[0]?.path).toBe("/api/lookout/downloadComparisonReport");
      expect(serverCalls[0]?.body).toEqual({ reportId: "31" });
    } finally {
      cleanupHome(home);
    }
  });

  it("insights price-trends / coverage-trends send {jobId, limit}", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const price = await runCli(["--json", "lookout", "insights", "price-trends", "--job-id", "11", "--limit", "10"], home);
      expect(price.exitCode).toBe(0);
      expect(JSON.parse(price.stdout.trim()).trends[0].runDate).toBe("2026-10-01");
      expect(serverCalls[0]?.path).toBe("/api/lookout/getComparisonPriceTrends");
      expect(serverCalls[0]?.body).toEqual({ jobId: "11", limit: 10 });

      serverCalls.length = 0;
      const coverage = await runCli(["--json", "lookout", "insights", "coverage-trends", "--job-id", "11"], home);
      expect(coverage.exitCode).toBe(0);
      expect(JSON.parse(coverage.stdout.trim()).trends[0].coverage).toBeCloseTo(0.9);
      expect(serverCalls[0]?.path).toBe("/api/lookout/getComparisonCoverageTrends");
      expect(serverCalls[0]?.body).toEqual({ jobId: "11", limit: 20 });
    } finally {
      cleanupHome(home);
    }
  });
});

// ── write guard ──────────────────────────────────────────────────────────

describe("lookout write guard (--confirm)", () => {
  it("pause / resume / trigger / cancel refuse without --confirm and never reach the server", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      for (const args of [
        ["lookout", "jobs", "pause", "--job-id", "11"],
        ["lookout", "jobs", "resume", "--job-id", "11"],
        ["lookout", "runs", "trigger", "--job-id", "11"],
        ["lookout", "runs", "cancel", "--run-id", "21"],
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

  it("writes execute with --confirm and carry the lookout request shapes", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const pause = await runCli(["--json", "lookout", "jobs", "pause", "--job-id", "11", "--confirm"], home);
      expect(pause.exitCode).toBe(0);
      expect(JSON.parse(pause.stdout.trim()).job.status).toBe("paused");
      expect(serverCalls[0]).toEqual({ path: "/api/lookout/pauseComparisonJob", body: { jobId: "11" } });

      serverCalls.length = 0;
      const resume = await runCli(["--json", "lookout", "jobs", "resume", "--job-id", "11", "--confirm"], home);
      expect(resume.exitCode).toBe(0);
      expect(JSON.parse(resume.stdout.trim()).job.status).toBe("active");
      expect(serverCalls[0]).toEqual({ path: "/api/lookout/resumeComparisonJob", body: { jobId: "11" } });

      serverCalls.length = 0;
      const trigger = await runCli(
        ["--json", "lookout", "runs", "trigger", "--job-id", "11", "--base-date", "2026-10-04", "--dry-run", "--confirm"],
        home,
      );
      expect(trigger.exitCode).toBe(0);
      expect(JSON.parse(trigger.stdout.trim()).plannedCalls).toBe(4);
      expect(serverCalls[0]).toEqual({
        path: "/api/lookout/triggerComparisonRun",
        body: { jobId: "11", baseDate: "2026-10-04", dryRun: true },
      });

      serverCalls.length = 0;
      const cancel = await runCli(["--json", "lookout", "runs", "cancel", "--run-id", "21", "--confirm"], home);
      expect(cancel.exitCode).toBe(0);
      expect(JSON.parse(cancel.stdout.trim()).run.status).toBe("canceled");
      expect(serverCalls[0]).toEqual({ path: "/api/lookout/cancelComparisonRun", body: { runId: "21" } });
    } finally {
      cleanupHome(home);
    }
  });
});

// ── command tree ────────────────────────────────────────────────────────

describe("lookout command tree (--help)", () => {
  it("top-level help lists the lookout group", async () => {
    const home = freshHome();
    try {
      const { stdout, exitCode } = await runCli(["--help"], home);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/^  lookout\b/m);
    } finally {
      cleanupHome(home);
    }
  });

  it("lookout --help lists the four subgroups", async () => {
    const home = freshHome();
    try {
      const r = await runCli(["lookout", "--help"], home);
      expect(r.exitCode).toBe(0);
      for (const group of ["jobs", "runs", "reports", "insights"]) {
        expect(r.stdout).toContain(group);
      }
    } finally {
      cleanupHome(home);
    }
  });

  it("each subgroup help lists its subcommands", async () => {
    const home = freshHome();
    try {
      const jobs = await runCli(["lookout", "jobs", "--help"], home);
      expect(jobs.exitCode).toBe(0);
      for (const sub of ["list", "get", "pause", "resume"]) expect(jobs.stdout).toContain(sub);

      const runs = await runCli(["lookout", "runs", "--help"], home);
      expect(runs.exitCode).toBe(0);
      for (const sub of ["list", "get", "rows", "trigger", "cancel"]) expect(runs.stdout).toContain(sub);

      const reports = await runCli(["lookout", "reports", "--help"], home);
      expect(reports.exitCode).toBe(0);
      for (const sub of ["list", "get"]) expect(reports.stdout).toContain(sub);

      const insights = await runCli(["lookout", "insights", "--help"], home);
      expect(insights.exitCode).toBe(0);
      for (const sub of ["price-trends", "coverage-trends"]) expect(insights.stdout).toContain(sub);
    } finally {
      cleanupHome(home);
    }
  });

  it("write subcommands document --confirm in their help", async () => {
    const home = freshHome();
    try {
      for (const args of [
        ["lookout", "jobs", "pause", "--help"],
        ["lookout", "jobs", "resume", "--help"],
        ["lookout", "runs", "trigger", "--help"],
        ["lookout", "runs", "cancel", "--help"],
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
