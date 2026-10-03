/**
 * tests/dms.test.ts — dms command group (service dms).
 *
 * In-process CLI layer tests: the factory is registered into a fresh
 * commander program (per-command tests/auth.test.ts fetch-stub pattern) with
 * an isolated STAICLI_HOME. Asserts the command tree, request paths, request
 * bodies against the Go contracts (dms/protocol/protocol.go), the server-side
 * write-confirmation token "<environment>/<dataSource>/<type>"
 * (dms/service/service.go writeConfirm) behind the --confirm guard
 * (positive + negative), --json output, and the --help tree.
 * No live environment; no secrets in fixtures.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createDmsCommand } from "../src/commands/dms.ts";
import type { Ctx } from "../src/commands/helpers.ts";

const TMP_HOME = join(import.meta.dir, ".tmp-dms-test-home");
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
 * Parse `args` against a fresh commander program with the dms factory
 * registered. process.exit is intercepted so write guards are observable
 * in-process; console + stderr writes are captured (commander reports parse
 * errors on process.stderr directly).
 */
async function runCommand(args: string[]): Promise<{ logs: string[]; errors: string[]; exitCode: number | null }> {
  const program = new Command();
  // Mirror the cli.ts global flags the actions expect to exist.
  program.name("hbcli").option("--json", "Emit structured JSON for agent consumption.", false);
  program.addCommand(createDmsCommand(ctx));
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

describe("dms command tree", () => {
  it("exposes datasources/mysql/redis/tdengine/query-history", () => {
    const program = new Command();
    program.addCommand(createDmsCommand(ctx));
    const dms = program.commands.find((c) => c.name() === "dms")!;
    expect(commandNames(dms).sort()).toEqual(["datasources", "mysql", "query-history", "redis", "tdengine"]);

    const datasources = dms.commands.find((c) => c.name() === "datasources")!;
    expect(commandNames(datasources).sort()).toEqual(["check", "environments", "list"]);

    const mysql = dms.commands.find((c) => c.name() === "mysql")!;
    expect(commandNames(mysql).sort()).toEqual(["exec", "query", "schema"]);

    const redis = dms.commands.find((c) => c.name() === "redis")!;
    expect(commandNames(redis).sort()).toEqual(["delete", "get", "keys", "set"]);

    const tdengine = dms.commands.find((c) => c.name() === "tdengine")!;
    expect(commandNames(tdengine)).toEqual(["query"]);
  });
});

// ── datasources ──────────────────────────────────────────────────────────

describe("dms datasources", () => {
  it("environments sends {} to /api/dms/environments", async () => {
    const m = stubFetch(() => ({ enabled: true, environments: [{ name: "uat" }] }));
    try {
      const r = await runCommand(["--json", "dms", "datasources", "environments"]);
      expect(r.exitCode).toBeNull();
      expect(JSON.parse(r.logs[0]).environments[0].name).toBe("uat");
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/dms/environments`);
      expect(m.captured[0]?.body).toEqual({});
    } finally {
      m.restore();
    }
  });

  it("list sends {environment?} to /api/dms/dataSources", async () => {
    const m = stubFetch(() => ({ dataSources: [{ name: "main", type: "mysql" }] }));
    try {
      const withEnv = await runCommand(["--json", "dms", "datasources", "list", "--environment", "uat"]);
      expect(withEnv.exitCode).toBeNull();
      expect(m.captured[0]?.body).toEqual({ environment: "uat" });

      m.captured.length = 0;
      const bare = await runCommand(["--json", "dms", "datasources", "list"]);
      expect(bare.exitCode).toBeNull();
      expect(m.captured[0]?.body).toEqual({});
    } finally {
      m.restore();
    }
  });

  it("check sends {environment, dataSource} to /api/dms/dataSource/check", async () => {
    const m = stubFetch(() => ({ result: { healthy: true } }));
    try {
      const r = await runCommand(["--json", "dms", "datasources", "check", "--environment", "uat", "--data-source", "main"]);
      expect(r.exitCode).toBeNull();
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/dms/dataSource/check`);
      expect(m.captured[0]?.body).toEqual({ environment: "uat", dataSource: "main" });
    } finally {
      m.restore();
    }
  });
});

// ── mysql ────────────────────────────────────────────────────────────────

describe("dms mysql", () => {
  it("query sends env/ds/sql/limit to /api/dms/mysql/query", async () => {
    const m = stubFetch(() => ({ result: { columns: [], rows: [] } }));
    try {
      const r = await runCommand([
        "--json", "dms", "mysql", "query",
        "--environment", "uat", "--data-source", "main", "--sql", "SELECT 1", "--limit", "10",
      ]);
      expect(r.exitCode).toBeNull();
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/dms/mysql/query`);
      expect(m.captured[0]?.body).toEqual({ environment: "uat", dataSource: "main", sql: "SELECT 1", limit: 10 });

      m.captured.length = 0;
      const bare = await runCommand([
        "--json", "dms", "mysql", "query",
        "--environment", "uat", "--data-source", "main", "--sql", "SELECT 1",
      ]);
      expect(bare.exitCode).toBeNull();
      expect(m.captured[0]?.body).toEqual({ environment: "uat", dataSource: "main", sql: "SELECT 1", limit: 50 });
    } finally {
      m.restore();
    }
  });

  it("schema sends env/ds plus optional database/table to /api/dms/mysql/schema", async () => {
    const m = stubFetch(() => ({ databases: [], cachedTime: "2026-10-04T00:00:00Z", ttlMs: 60000 }));
    try {
      const r = await runCommand([
        "--json", "dms", "mysql", "schema",
        "--environment", "uat", "--data-source", "main", "--database", "hotel", "--table", "orders",
      ]);
      expect(r.exitCode).toBeNull();
      expect(m.captured[0]?.body).toEqual({ environment: "uat", dataSource: "main", database: "hotel", table: "orders" });

      m.captured.length = 0;
      const bare = await runCommand(["--json", "dms", "mysql", "schema", "--environment", "uat", "--data-source", "main"]);
      expect(bare.exitCode).toBeNull();
      expect(m.captured[0]?.body).toEqual({ environment: "uat", dataSource: "main" });
    } finally {
      m.restore();
    }
  });

  it("exec refuses without --confirm and never reaches the server", async () => {
    const m = stubFetch();
    try {
      const r = await runCommand([
        "--json", "dms", "mysql", "exec",
        "--environment", "uat", "--data-source", "main", "--sql", "DELETE FROM tmp",
      ]);
      expect(r.exitCode).toBe(1);
      expect(JSON.parse(r.errors[0]).error).toContain("--confirm");
      expect(m.captured).toHaveLength(0);
    } finally {
      m.restore();
    }
  });

  it("exec with --confirm sends the writeConfirm token <env>/<ds>/mysql", async () => {
    const m = stubFetch(() => ({ rowsAffected: 3 }));
    try {
      const r = await runCommand([
        "--json", "dms", "mysql", "exec",
        "--environment", "uat", "--data-source", "main", "--sql", "DELETE FROM tmp", "--confirm",
      ]);
      expect(r.exitCode).toBeNull();
      expect(JSON.parse(r.logs[0]).rowsAffected).toBe(3);
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/dms/mysql/exec`);
      expect(m.captured[0]?.body).toEqual({
        environment: "uat",
        dataSource: "main",
        sql: "DELETE FROM tmp",
        confirm: "uat/main/mysql",
      });
    } finally {
      m.restore();
    }
  });
});

// ── redis ────────────────────────────────────────────────────────────────

describe("dms redis", () => {
  it("get sends {environment, dataSource, key, limit?} to /api/dms/redis/get", async () => {
    const m = stubFetch(() => ({ value: { type: "string", value: "v" } }));
    try {
      const r = await runCommand([
        "--json", "dms", "redis", "get",
        "--environment", "uat", "--data-source", "cache", "--key", "k1", "--limit", "100",
      ]);
      expect(r.exitCode).toBeNull();
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/dms/redis/get`);
      expect(m.captured[0]?.body).toEqual({ environment: "uat", dataSource: "cache", key: "k1", limit: 100 });

      m.captured.length = 0;
      const bare = await runCommand(["--json", "dms", "redis", "get", "--environment", "uat", "--data-source", "cache", "--key", "k1"]);
      expect(bare.exitCode).toBeNull();
      expect(m.captured[0]?.body).toEqual({ environment: "uat", dataSource: "cache", key: "k1" });
    } finally {
      m.restore();
    }
  });

  it("keys sends {environment, dataSource, pattern, limit?} to /api/dms/redis/keys", async () => {
    const m = stubFetch(() => ({ keys: [], truncated: false }));
    try {
      const r = await runCommand([
        "--json", "dms", "redis", "keys",
        "--environment", "uat", "--data-source", "cache", "--pattern", "search:*", "--limit", "10",
      ]);
      expect(r.exitCode).toBeNull();
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/dms/redis/keys`);
      expect(m.captured[0]?.body).toEqual({ environment: "uat", dataSource: "cache", pattern: "search:*", limit: 10 });

      m.captured.length = 0;
      const bare = await runCommand(["--json", "dms", "redis", "keys", "--environment", "uat", "--data-source", "cache"]);
      expect(bare.exitCode).toBeNull();
      expect(m.captured[0]?.body).toEqual({ environment: "uat", dataSource: "cache", pattern: "*" });
    } finally {
      m.restore();
    }
  });

  it("set refuses without --confirm; with --confirm it carries the redis writeConfirm token", async () => {
    const m = stubFetch(() => ({ ok: true }));
    try {
      const guarded = await runCommand([
        "--json", "dms", "redis", "set",
        "--environment", "uat", "--data-source", "cache", "--key", "k1", "--value", "v1",
      ]);
      expect(guarded.exitCode).toBe(1);
      expect(JSON.parse(guarded.errors[0]).error).toContain("--confirm");
      expect(m.captured).toHaveLength(0);

      const ok = await runCommand([
        "--json", "dms", "redis", "set",
        "--environment", "uat", "--data-source", "cache", "--key", "k1", "--value", "v1",
        "--ttl-seconds", "60", "--confirm",
      ]);
      expect(ok.exitCode).toBeNull();
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/dms/redis/set`);
      expect(m.captured[0]?.body).toEqual({
        environment: "uat",
        dataSource: "cache",
        key: "k1",
        value: "v1",
        ttlSeconds: 60,
        confirm: "uat/cache/redis",
      });
    } finally {
      m.restore();
    }
  });

  it("delete refuses without --confirm; with --confirm it carries the redis writeConfirm token", async () => {
    const m = stubFetch(() => ({ ok: true, deleted: 1 }));
    try {
      const guarded = await runCommand([
        "--json", "dms", "redis", "delete",
        "--environment", "uat", "--data-source", "cache", "--key", "k1",
      ]);
      expect(guarded.exitCode).toBe(1);
      expect(JSON.parse(guarded.errors[0]).error).toContain("--confirm");
      expect(m.captured).toHaveLength(0);

      const ok = await runCommand([
        "--json", "dms", "redis", "delete",
        "--environment", "uat", "--data-source", "cache", "--key", "k1", "--confirm",
      ]);
      expect(ok.exitCode).toBeNull();
      expect(JSON.parse(ok.logs[0]).deleted).toBe(1);
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/dms/redis/delete`);
      expect(m.captured[0]?.body).toEqual({
        environment: "uat",
        dataSource: "cache",
        key: "k1",
        confirm: "uat/cache/redis",
      });
    } finally {
      m.restore();
    }
  });
});

// ── tdengine + query history ─────────────────────────────────────────────

describe("dms tdengine + query-history", () => {
  it("tdengine query sends env/ds/sql/limit to /api/dms/tdengine/query", async () => {
    const m = stubFetch(() => ({ result: { columns: [], rows: [] } }));
    try {
      const r = await runCommand([
        "--json", "dms", "tdengine", "query",
        "--environment", "uat", "--data-source", "logs", "--sql", "SELECT 1",
      ]);
      expect(r.exitCode).toBeNull();
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/dms/tdengine/query`);
      expect(m.captured[0]?.body).toEqual({ environment: "uat", dataSource: "logs", sql: "SELECT 1", limit: 50 });
    } finally {
      m.restore();
    }
  });

  it("query-history sends the nested pagehelper page + filters to /api/dms/history", async () => {
    const m = stubFetch(() => ({ items: [], total: 0, hasMore: false }));
    try {
      const r = await runCommand([
        "--json", "dms", "query-history",
        "--environment", "uat", "--data-source", "main", "--type", "mysql",
        "--page-num", "2", "--page-size", "10",
      ]);
      expect(r.exitCode).toBeNull();
      expect(m.captured[0]?.url).toBe(`${BASE_URL}/api/dms/history`);
      expect(m.captured[0]?.body).toEqual({
        page: { pageNum: 2, pageSize: 10 },
        environment: "uat",
        dataSource: "main",
        type: "mysql",
      });
    } finally {
      m.restore();
    }
  });

  it("query-history rejects an out-of-vocabulary --type client-side", async () => {
    const m = stubFetch();
    try {
      const r = await runCommand(["--json", "dms", "query-history", "--type", "oracle"]);
      expect(r.exitCode).toBe(1);
      expect(r.errors.join("\n")).toContain("invalid");
      expect(m.captured).toHaveLength(0);
    } finally {
      m.restore();
    }
  });
});

// ── write help ───────────────────────────────────────────────────────────

describe("dms write subcommands document --confirm", () => {
  it("mysql exec / redis set / redis delete help mention --confirm", async () => {
    for (const args of [
      ["dms", "mysql", "exec", "--help"],
      ["dms", "redis", "set", "--help"],
      ["dms", "redis", "delete", "--help"],
    ]) {
      const r = await runCommand(args);
      expect(r.exitCode).toBe(0);
      expect(r.logs.join("\n")).toContain("--confirm");
    }
  });
});
