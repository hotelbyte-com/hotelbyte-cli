/**
 * tests/bi.test.ts — bi command group (services bi/log + bi/order).
 *
 * In-process CLI layer tests: the factory is registered into a fresh
 * commander program (per-command tests/auth.test.ts fetch-stub pattern) with
 * an isolated STAICLI_HOME. Asserts the command tree, request paths, request
 * bodies against the Go contracts (bi/domain/log_query.go,
 * common/domain/session.go, agent/domain/memory.go, bi/protocol/order_analytics.go),
 * the client-side session guard, --json output, and error handling.
 * No live environment; no secrets in fixtures.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createBiCommand } from "../src/commands/bi.ts";
import type { Ctx } from "../src/commands/helpers.ts";

const TMP_HOME = join(import.meta.dir, ".tmp-bi-test-home");
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
 * Parse `args` against a fresh commander program with the bi factory
 * registered. process.exit is intercepted so write guards / client-side
 * validation are observable in-process; console + stderr writes are captured
 * (commander reports parse errors on process.stderr directly).
 */
async function runCommand(args: string[]): Promise<{ logs: string[]; errors: string[]; exitCode: number | null }> {
  const program = new Command();
  // Mirror the cli.ts global flags the actions expect to exist.
  program.name("hbcli").option("--json", "Emit structured JSON for agent consumption.", false);
  program.addCommand(createBiCommand(ctx));
  const logs: string[] = [];
  const errors: string[] = [];
  const origLog = console.log;
  const origError = console.error;
  const origExit = process.exit;
  const origStderrWrite = process.stderr.write;
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

describe("bi command tree", () => {
  it("exposes logs/sessions/incidents/order-analytics with their subcommands", () => {
    const program = new Command();
    program.addCommand(createBiCommand(ctx));
    const bi = program.commands.find((c) => c.name() === "bi")!;
    expect(commandNames(bi).sort()).toEqual(["incidents", "logs", "order-analytics", "sessions"]);

    const logs = bi.commands.find((c) => c.name() === "logs")!;
    expect(commandNames(logs)).toEqual(["query"]);

    const sessions = bi.commands.find((c) => c.name() === "sessions")!;
    expect(commandNames(sessions).sort()).toEqual(["get", "list", "related"]);

    const incidents = bi.commands.find((c) => c.name() === "incidents")!;
    expect(commandNames(incidents)).toEqual(["clusters"]);
  });
});

// ── logs query ───────────────────────────────────────────────────────────

describe("bi logs query", () => {
  it("sends the LogQuery shape to /api/bi/log/queryLogs and emits data", async () => {
    const m = stubFetch(() => ({ logs: [{ id: 1 }], total: 1 }));
    try {
      const r = await runCommand([
        "--json", "bi", "logs", "query",
        "--start-time", "2026-10-04T00:00:00Z",
        "--end-time", "2026-10-04T01:00:00Z",
        "--ids", "101,102",
        "--search-session-id", "sess-1",
        "--search-order-ref", "ord-9",
        "--user-id", "42",
        "--hotel-id", "461850557",
        "--supplier-biz-type", "3",
        "--api-in-path", "/api/search/checkAvail",
        "--api-out-supplier", "Hotelbeds",
        "--biz-error-code", "E101",
        "--output-body-keyword", "timeout",
        "--result-status", "failed",
        "--cost-time-max-ms", "500",
        "--supplier", "Hotelbeds",
        "--page-num", "2",
        "--page-size", "50",
      ]);
      expect(r.exitCode).toBeNull();
      const out = JSON.parse(r.logs[0]);
      expect(out.logs[0].id).toBe(1);
      expect(m.captured).toHaveLength(1);
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/bi/log/queryLogs`);
      expect(m.captured[0]?.auth).toBe("Bearer stub-ticket");
      expect(m.captured[0]?.body).toEqual({
        pageNum: 2,
        pageSize: 50,
        startTime: "2026-10-04T00:00:00Z",
        endTime: "2026-10-04T01:00:00Z",
        ids: [101, 102],
        searchSessionId: "sess-1",
        searchOrderRef: "ord-9",
        userId: "42",
        hotelId: "461850557",
        supplierBizType: 3,
        apiInPath: "/api/search/checkAvail",
        apiOutSupplier: "Hotelbeds",
        bizErrorCode: "E101",
        outputBodyKeyword: "timeout",
        resultStatus: "failed",
        // Go time.Duration wire format: integer nanoseconds.
        costTimeMax: 500_000_000,
        supplier: "Hotelbeds",
      });
    } finally {
      m.restore();
    }
  });

  it("sends bare pagination when no filters are set", async () => {
    const m = stubFetch();
    try {
      const r = await runCommand(["--json", "bi", "logs", "query"]);
      expect(r.exitCode).toBeNull();
      expect(m.captured[0]?.body).toEqual({ pageNum: 1, pageSize: 20 });
    } finally {
      m.restore();
    }
  });

  it("rejects an invalid --result-status client-side", async () => {
    const m = stubFetch();
    try {
      const r = await runCommand(["--json", "bi", "logs", "query", "--result-status", "bogus"]);
      expect(r.exitCode).toBe(1);
      expect(r.errors.join("\n")).toContain("invalid");
      expect(m.captured).toHaveLength(0);
    } finally {
      m.restore();
    }
  });
});

// ── sessions ─────────────────────────────────────────────────────────────

describe("bi sessions", () => {
  it("list sends LogQuery filters plus session-list switches to /api/bi/log/getSessionList", async () => {
    const m = stubFetch(() => ({ sessions: [], total: 0 }));
    try {
      const r = await runCommand([
        "--json", "bi", "sessions", "list",
        "--search-session-id", "sess-1",
        "--result-status", "failed",
        "--exclude-single-logs",
        "--include-session-meta",
      ]);
      expect(r.exitCode).toBeNull();
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/bi/log/getSessionList`);
      expect(m.captured[0]?.body).toEqual({
        pageNum: 1,
        pageSize: 20,
        searchSessionId: "sess-1",
        resultStatus: "failed",
        excludeSingleLogs: true,
        includeSessionMeta: true,
      });
    } finally {
      m.restore();
    }
  });

  it("get sends {id} with --session-id and honors --load-output-body", async () => {
    const m = stubFetch(() => ({ sessionId: "sess-1", logs: [] }));
    try {
      const r = await runCommand(["--json", "bi", "sessions", "get", "--session-id", "sess-1", "--load-output-body"]);
      expect(r.exitCode).toBeNull();
      expect(JSON.parse(r.logs[0]).sessionId).toBe("sess-1");
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/bi/log/getSession`);
      expect(m.captured[0]?.body).toEqual({ id: "sess-1", loadOutputBody: true });
    } finally {
      m.restore();
    }
  });

  it("get falls back to --trace-id with --trace-scope", async () => {
    const m = stubFetch();
    try {
      const r = await runCommand(["--json", "bi", "sessions", "get", "--trace-id", "tr-1", "--trace-scope"]);
      expect(r.exitCode).toBeNull();
      expect(m.captured[0]?.body).toEqual({ searchTraceId: "tr-1", traceScope: true });
    } finally {
      m.restore();
    }
  });

  it("get refuses without --session-id / --trace-id before any HTTP call", async () => {
    const m = stubFetch();
    try {
      const r = await runCommand(["--json", "bi", "sessions", "get"]);
      expect(r.exitCode).toBe(1);
      expect(JSON.parse(r.errors[0]).error).toContain("--session-id or --trace-id");
      expect(m.captured).toHaveLength(0);
    } finally {
      m.restore();
    }
  });

  it("related sends the Go field names of FindMemoryFailuresInput (no json tags)", async () => {
    const m = stubFetch(() => { return { Sessions: [], Total: 0 }; });
    try {
      const r = await runCommand([
        "--json", "bi", "sessions", "related",
        "--session-id", "sess-1",
        "--time-window-min", "30",
        "--max-results", "10",
      ]);
      expect(r.exitCode).toBeNull();
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/bi/log/getRelatedSessions`);
      expect(m.captured[0]?.body).toEqual({ SessionID: "sess-1", TimeWindowMin: 30, MaxResults: 10 });
    } finally {
      m.restore();
    }
  });
});

// ── incidents + order analytics ──────────────────────────────────────────

describe("bi incidents clusters + order-analytics", () => {
  it("clusters sends timeWindowMin/maxResults/minSeverity to /api/bi/log/getIncidentClusters", async () => {
    const m = stubFetch(() => ({ clusters: [{ clusterId: "c1" }], total: 1 }));
    try {
      const r = await runCommand([
        "--json", "bi", "incidents", "clusters",
        "--time-window-min", "60",
        "--max-results", "5",
        "--min-severity", "p1",
      ]);
      expect(r.exitCode).toBeNull();
      expect(JSON.parse(r.logs[0]).clusters[0].clusterId).toBe("c1");
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/bi/log/getIncidentClusters`);
      expect(m.captured[0]?.body).toEqual({ timeWindowMin: 60, maxResults: 5, minSeverity: "p1" });
    } finally {
      m.restore();
    }
  });

  it("clusters rejects an out-of-vocabulary --min-severity client-side", async () => {
    const m = stubFetch();
    try {
      const r = await runCommand(["--json", "bi", "incidents", "clusters", "--min-severity", "p9"]);
      expect(r.exitCode).toBe(1);
      expect(r.errors.join("\n")).toContain("invalid");
      expect(m.captured).toHaveLength(0);
    } finally {
      m.restore();
    }
  });

  it("order-analytics posts to /api/bi/order/getOrderAnalytics with numeric status codes", async () => {
    const m = stubFetch(() => ({ overview: { totalOrders: 7 }, trendData: [] }));
    try {
      const r = await runCommand([
        "--json", "bi", "order-analytics",
        "--start-date", "2026-09-01T00:00:00Z",
        "--end-date", "2026-10-01T00:00:00Z",
        "--granularity", "day",
        "--status-filter", "2, 3",
        "--entity-id", "42",
      ]);
      expect(r.exitCode).toBeNull();
      expect(JSON.parse(r.logs[0]).overview.totalOrders).toBe(7);
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/bi/order/getOrderAnalytics`);
      expect(m.captured[0]?.body).toEqual({
        startDate: "2026-09-01T00:00:00Z",
        endDate: "2026-10-01T00:00:00Z",
        granularity: "day",
        statusFilter: [2, 3],
        entityId: "42",
      });
    } finally {
      m.restore();
    }
  });
});

// ── error path ───────────────────────────────────────────────────────────

describe("bi error handling", () => {
  it("surfaces non-2xx errors via error() and exits 1", async () => {
    const m = stubFetch(() => new Response(JSON.stringify({ code: 500, msg: "tdengine degraded" }), { status: 500 }));
    try {
      const r = await runCommand(["--json", "bi", "logs", "query"]);
      expect(r.exitCode).toBe(1);
      expect(JSON.parse(r.errors[0]).error).toContain("tdengine degraded");
    } finally {
      m.restore();
    }
  });
});
