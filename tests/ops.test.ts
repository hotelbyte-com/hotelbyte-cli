/**
 * tests/ops.test.ts — ops command group (services ops + cronAdmin).
 *
 * In-process CLI layer tests: the factory is registered into a fresh
 * commander program (per-command tests/auth.test.ts fetch-stub pattern) with
 * an isolated STAICLI_HOME. Asserts the command tree, request paths, request
 * bodies against the Go contracts (api/protocol/ops.go, issue_tools.go,
 * api/service/cron_admin.go), the --confirm write guard (positive + negative),
 * --json output, and the audit-reason passthrough. No live environment; no
 * secrets in fixtures.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createOpsCommand } from "../src/commands/ops.ts";
import type { Ctx } from "../src/commands/helpers.ts";

const TMP_HOME = join(import.meta.dir, ".tmp-ops-test-home");
const BASE_URL = "https://stub.test";

const ctx: Ctx = { jsonMode: () => true, env: () => "uat" };

class ExitError extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

interface CapturedCall {
  url: string;
  body: Record<string, unknown>;
  auth: string | null;
}

/** Fetch stub (tests/auth.test.ts pattern): records url/body/auth per call. */
function stubFetch(handler?: (url: string, body: any) => unknown) {
  const originalFetch = global.fetch;
  const captured: CapturedCall[] = [];
  global.fetch = (async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    const headers = (init?.headers ?? {}) as Record<string, string>;
    captured.push({ url: String(url), body, auth: headers["Authorization"] ?? null });
    const out = handler ? handler(String(url), body) : {};
    if (out instanceof Response) return out;
    return new Response(JSON.stringify({ code: 0, msg: "ok", data: out }), { status: 200 });
  }) as typeof fetch;
  return {
    captured,
    restore: () => {
      global.fetch = originalFetch;
    },
  };
}

/**
 * Parse `args` against a fresh commander program with the ops factory
 * registered. process.exit is intercepted so write guards are observable
 * in-process; console + stderr writes are captured (commander reports parse
 * errors on process.stderr directly).
 */
async function runCommand(args: string[]): Promise<{ logs: string[]; errors: string[]; exitCode: number | null }> {
  const program = new Command();
  // Mirror the cli.ts global flags the actions expect to exist.
  program.name("hbcli").option("--json", "Emit structured JSON for agent consumption.", false);
  program.addCommand(createOpsCommand(ctx));
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  const origExit = process.exit;
  const origStderrWrite = process.stderr.write;
  const origStdoutWrite = process.stdout.write;
  console.log = (...a: unknown[]) => {
    logs.push(a.map(String).join(" "));
  };
  console.error = (...a: unknown[]) => {
    errors.push(a.map(String).join(" "));
  };
  process.stderr.write = ((chunk: any) => {
    errors.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  // Commander renders --help via process.stdout.write directly.
  process.stdout.write = ((chunk: any) => {
    logs.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  (process as any).exit = (code?: number) => {
    throw new ExitError(code ?? 0);
  };
  let exitCode: number | null = null;
  try {
    await program.parseAsync(args, { from: "user" });
  } catch (e) {
    if (e instanceof ExitError) exitCode = e.code;
    else throw e;
  } finally {
    console.log = origLog;
    console.error = origError;
    process.stderr.write = origStderrWrite;
    process.stdout.write = origStdoutWrite;
    (process as any).exit = origExit;
  }
  return { logs, errors, exitCode };
}

function commandNames(cmd: Command): string[] {
  return cmd.commands.map((c) => c.name());
}

beforeEach(() => {
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
  mkdirSync(TMP_HOME, { recursive: true });
  // Cached openapi ticket → makeClient takes the ticket flow with zero auth calls.
  writeFileSync(join(TMP_HOME, "credentials.json"), JSON.stringify({ "openapi:uat": { ticket: "stub-ticket" } }));
  process.env.STAICLI_HOME = TMP_HOME;
  process.env.HOTELBYTE_BASE_URL = BASE_URL;
});

afterEach(() => {
  delete process.env.STAICLI_HOME;
  delete process.env.HOTELBYTE_BASE_URL;
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
});

// ── command tree ─────────────────────────────────────────────────────────

describe("ops command tree", () => {
  it("exposes price-cache/issues/cron with their subcommands", () => {
    const program = new Command();
    program.addCommand(createOpsCommand(ctx));
    const ops = program.commands.find((c) => c.name() === "ops")!;
    expect(commandNames(ops).sort()).toEqual(["cron", "issues", "price-cache"]);

    const priceCache = ops.commands.find((c) => c.name() === "price-cache")!;
    expect(commandNames(priceCache).sort()).toEqual(["configs", "purge", "status"]);

    const issues = ops.commands.find((c) => c.name() === "issues")!;
    expect(commandNames(issues).sort()).toEqual(["diagnose", "repair"]);

    const cron = ops.commands.find((c) => c.name() === "cron")!;
    expect(commandNames(cron).sort()).toEqual(["disable", "enable", "list", "trigger"]);
  });
});

// ── price cache ──────────────────────────────────────────────────────────

describe("ops price-cache", () => {
  it("status sends {supplierId?} to /api/ops/priceCache/status", async () => {
    const m = stubFetch(() => ({ enabled: true, stats: [] }));
    try {
      const r = await runCommand(["--json", "ops", "price-cache", "status", "--supplier-id", "Hotelbeds"]);
      expect(r.exitCode).toBeNull();
      expect(JSON.parse(r.logs[0]).enabled).toBe(true);
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/ops/priceCache/status`);
      expect(m.captured[0]?.body).toEqual({ supplierId: "Hotelbeds" });

      m.captured.length = 0;
      const bare = await runCommand(["--json", "ops", "price-cache", "status"]);
      expect(bare.exitCode).toBeNull();
      expect(m.captured[0]?.body).toEqual({});
    } finally {
      m.restore();
    }
  });

  it("configs sends {supplierId?} to /api/ops/priceCache/configs", async () => {
    const m = stubFetch(() => ({ defaultTtlSeconds: 300, items: [] }));
    try {
      const r = await runCommand(["--json", "ops", "price-cache", "configs"]);
      expect(r.exitCode).toBeNull();
      expect(JSON.parse(r.logs[0]).defaultTtlSeconds).toBe(300);
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/ops/priceCache/configs`);
      expect(m.captured[0]?.body).toEqual({});
    } finally {
      m.restore();
    }
  });

  it("purge refuses without --confirm and never reaches the server", async () => {
    const m = stubFetch();
    try {
      const r = await runCommand(["--json", "ops", "price-cache", "purge", "--pattern", "search:price:Hotelbeds:*"]);
      expect(r.exitCode).toBe(1);
      expect(JSON.parse(r.errors[0]).error).toContain("--confirm");
      expect(m.captured).toHaveLength(0);
    } finally {
      m.restore();
    }
  });

  it("purge executes with --confirm, passing dryRun only when set", async () => {
    const m = stubFetch(() => ({ pattern: "search:price:Hotelbeds:*", dryRun: true, matched: 12, deleted: 0 }));
    try {
      const dry = await runCommand([
        "--json", "ops", "price-cache", "purge",
        "--pattern", "search:price:Hotelbeds:*", "--dry-run", "--confirm",
      ]);
      expect(dry.exitCode).toBeNull();
      expect(JSON.parse(dry.logs[0]).matched).toBe(12);
      expect(m.captured[0]).toEqual({
        url: `${BASE_URL}/api/ops/priceCache/purge`,
        auth: "Bearer stub-ticket",
        body: { pattern: "search:price:Hotelbeds:*", dryRun: true },
      });

      m.captured.length = 0;
      const live = await runCommand(["--json", "ops", "price-cache", "purge", "--pattern", "search:price:HB:*", "--confirm"]);
      expect(live.exitCode).toBeNull();
      expect(m.captured[0]?.body).toEqual({ pattern: "search:price:HB:*" });
    } finally {
      m.restore();
    }
  });
});

// ── issues ───────────────────────────────────────────────────────────────

describe("ops issues", () => {
  it("diagnose sends errorCode + IssueRefs to /api/ops/diagnoseIssue", async () => {
    const m = stubFetch(() => ({ errorCode: "30001", summary: "no suppliers", checks: [] }));
    try {
      const r = await runCommand([
        "--json", "ops", "issues", "diagnose",
        "--error-code", "30001",
        "--run-id", "21",
        "--job-id", "11",
        "--session-id", "sess-1",
        "--supplier-id", "5",
        "--credential-ids", "7, 8",
      ]);
      expect(r.exitCode).toBeNull();
      expect(JSON.parse(r.logs[0]).summary).toBe("no suppliers");
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/ops/diagnoseIssue`);
      expect(m.captured[0]?.body).toEqual({
        errorCode: "30001",
        refs: {
          runId: "21",
          jobId: "11",
          sessionId: "sess-1",
          supplierId: "5",
          specifiedCredentialIds: ["7", "8"],
        },
      });
    } finally {
      m.restore();
    }
  });

  it("repair refuses without --confirm, then executes with refs + options", async () => {
    const m = stubFetch(() => ({ errorCode: "30001", actionId: "refresh", applied: true }));
    try {
      const guarded = await runCommand([
        "--json", "ops", "issues", "repair",
        "--error-code", "30001", "--action-id", "refresh",
      ]);
      expect(guarded.exitCode).toBe(1);
      expect(JSON.parse(guarded.errors[0]).error).toContain("--confirm");
      expect(m.captured).toHaveLength(0);

      const ok = await runCommand([
        "--json", "ops", "issues", "repair",
        "--error-code", "30001", "--action-id", "refresh",
        "--customer-entity-id", "42", "--trigger-run", "--confirm",
      ]);
      expect(ok.exitCode).toBeNull();
      expect(JSON.parse(ok.logs[0]).applied).toBe(true);
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/ops/repairIssue`);
      expect(m.captured[0]?.body).toEqual({
        errorCode: "30001",
        actionId: "refresh",
        refs: { customerEntityId: "42" },
        options: { triggerRun: true },
      });
    } finally {
      m.restore();
    }
  });
});

// ── cron admin ───────────────────────────────────────────────────────────

describe("ops cron", () => {
  it("list sends the cronAdmin ListJobsReq shape (q/page/pageSize, tri-state enabled)", async () => {
    const m = stubFetch(() => ({ items: [], total: 0, page: 1, pageSize: 20 }));
    try {
      const r = await runCommand([
        "--json", "ops", "cron", "list",
        "--module", "bi", "--enabled", "false", "--keyword", "agg", "--page", "2", "--page-size", "10",
      ]);
      expect(r.exitCode).toBeNull();
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/cronAdmin/listJobs`);
      expect(m.captured[0]?.body).toEqual({ page: 2, pageSize: 10, module: "bi", enabled: false, q: "agg" });

      m.captured.length = 0;
      const bare = await runCommand(["--json", "ops", "cron", "list"]);
      expect(bare.exitCode).toBeNull();
      expect(m.captured[0]?.body).toEqual({ page: 1, pageSize: 20 }); // enabled omitted → server default
    } finally {
      m.restore();
    }
  });

  it("trigger refuses without --confirm, then sends name + testParams map", async () => {
    const m = stubFetch(() => ({ ok: true, runId: "r-1" }));
    try {
      const guarded = await runCommand(["--json", "ops", "cron", "trigger", "--name", "hbLogHourlyAggregation"]);
      expect(guarded.exitCode).toBe(1);
      expect(JSON.parse(guarded.errors[0]).error).toContain("--confirm");
      expect(m.captured).toHaveLength(0);

      const ok = await runCommand([
        "--json", "ops", "cron", "trigger",
        "--name", "hbLogHourlyAggregation", "--test-params", "date=2026-10-04,dry=1", "--confirm",
      ]);
      expect(ok.exitCode).toBeNull();
      expect(JSON.parse(ok.logs[0]).runId).toBe("r-1");
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/cronAdmin/trigger`);
      expect(m.captured[0]?.body).toEqual({
        name: "hbLogHourlyAggregation",
        testParams: { date: "2026-10-04", dry: "1" },
      });
    } finally {
      m.restore();
    }
  });

  it("enable refuses without --confirm, then sends {name}", async () => {
    const m = stubFetch(() => ({ ok: true }));
    try {
      const guarded = await runCommand(["--json", "ops", "cron", "enable", "--name", "fingerprintCoverageReport"]);
      expect(guarded.exitCode).toBe(1);
      expect(JSON.parse(guarded.errors[0]).error).toContain("--confirm");
      expect(m.captured).toHaveLength(0);

      const ok = await runCommand(["--json", "ops", "cron", "enable", "--name", "fingerprintCoverageReport", "--confirm"]);
      expect(ok.exitCode).toBeNull();
      expect(JSON.parse(ok.logs[0]).ok).toBe(true);
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/cronAdmin/enable`);
      expect(m.captured[0]?.body).toEqual({ name: "fingerprintCoverageReport" });
    } finally {
      m.restore();
    }
  });

  it("disable refuses without --confirm, then sends {name, reason?}", async () => {
    const m = stubFetch(() => ({ ok: true }));
    try {
      const guarded = await runCommand(["--json", "ops", "cron", "disable", "--name", "hBLogRetentionCleanup"]);
      expect(guarded.exitCode).toBe(1);
      expect(JSON.parse(guarded.errors[0]).error).toContain("--confirm");
      expect(m.captured).toHaveLength(0);

      const ok = await runCommand([
        "--json", "ops", "cron", "disable",
        "--name", "hBLogRetentionCleanup", "--reason", "incident 31407", "--confirm",
      ]);
      expect(ok.exitCode).toBeNull();
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/cronAdmin/disable`);
      expect(m.captured[0]?.body).toEqual({ name: "hBLogRetentionCleanup", reason: "incident 31407" });

      m.captured.length = 0;
      const bare = await runCommand(["--json", "ops", "cron", "disable", "--name", "x", "--confirm"]);
      expect(bare.exitCode).toBeNull();
      expect(m.captured[0]?.body).toEqual({ name: "x" }); // reason omitted when unset
    } finally {
      m.restore();
    }
  });

  it("write subcommands document --confirm in their help", async () => {
    for (const args of [
      ["ops", "price-cache", "purge", "--help"],
      ["ops", "issues", "repair", "--help"],
      ["ops", "cron", "trigger", "--help"],
      ["ops", "cron", "enable", "--help"],
      ["ops", "cron", "disable", "--help"],
    ]) {
      const r = await runCommand(args);
      expect(r.exitCode).toBe(0);
      expect(r.logs.join("\n")).toContain("--confirm");
    }
  });
});
