/**
 * tests/api.test.ts — L0 generic passthrough (issue #29).
 *
 * Unit layer: fetchCatalog/loadCatalog against a stubbed global fetch
 * (mockFetchOnce pattern from tests/auth.test.ts), path normalization,
 * write/read classification. No live environment.
 *
 * CLI layer: `api catalog/describe/call` spawned against an in-process
 * Bun.serve stub (pattern from tests/mcp.test.ts) with an isolated
 * STAICLI_HOME — the write guard is asserted end-to-end via exit codes.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { existsSync, rmSync, mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { ENVIRONMENTS } from "../src/core/config.ts";
import { HttpClient, HotelByteError, parseEnvelopeBody } from "../src/core/http.ts";
import {
  CATALOG_ENDPOINT,
  CATALOG_TTL_MS,
  catalogCachePath,
  fetchCatalog,
  isWriteOperation,
  loadCatalog,
  normalizeApiPath,
  type ApiCatalogCtx,
  type MethodMeta,
} from "../src/core/api_catalog.ts";

const TMP_HOME = join(import.meta.dir, ".tmp-api-test-home");

beforeEach(() => {
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
  mkdirSync(TMP_HOME, { recursive: true });
  process.env.STAICLI_HOME = TMP_HOME;
});

afterEach(() => {
  delete process.env.STAICLI_HOME;
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
});

// ── unit helpers ────────────────────────────────────────────────────────

// Capture-able fetch stub (tests/auth.test.ts pattern): the handler's return
// value is the JSON response body; a throw simulates a network failure.
function stubFetch(handler: (call: { url: string; body: Record<string, unknown> }, index: number) => unknown) {
  const originalFetch = global.fetch;
  const captured: { url: string; body: Record<string, unknown> }[] = [];
  global.fetch = (async (url: unknown, init?: RequestInit) => {
    const call = { url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> };
    captured.push(call);
    const body = handler(call, captured.length);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return {
    captured,
    restore: () => { global.fetch = originalFetch; },
  };
}

function unitCtx(overrides: Partial<ApiCatalogCtx> = {}): ApiCatalogCtx {
  return {
    env: () => "uat",
    client: async () => new HttpClient({ name: "openapi", env: "uat", baseUrl: ENVIRONMENTS.uat, ticket: "tok" }),
    ...overrides,
  };
}

const UNIT_METHODS: MethodMeta[] = [
  { serviceName: "lookout", methodName: "listAlerts", path: "/api/lookout/alert/listAlerts", operationType: "read" },
  { serviceName: "tenant", methodName: "labelOrder", path: "/api/trade/tenant/labelOrder", operationType: "write" },
];

const catalogResp = (methods: MethodMeta[]) => ({ code: 0, msg: "ok", data: methods });

function seedCache(methods: MethodMeta[], fetchedAt: number, env = "uat"): void {
  writeFileSync(catalogCachePath(env), JSON.stringify({ fetchedAt, methods }));
}

function captureStderr(): { notes: string[]; done: () => void } {
  const notes: string[] = [];
  const original = console.error;
  console.error = (msg?: any, ...rest: any[]) => { notes.push([msg, ...rest].join(" ")); };
  return { notes, done: () => { console.error = original; } };
}

// ── parseEnvelopeBody (shared by the JSON and raw channels, issue #41) ──

describe("parseEnvelopeBody", () => {
  it("unwraps a code=0 envelope to data", () => {
    expect(parseEnvelopeBody('{"code":0,"msg":"ok","data":{"a":1}}', "/api/x/y")).toEqual({ a: 1 });
  });

  it("raises HotelByteError on a code!=0 envelope (raw channel at HTTP 200)", () => {
    try {
      parseEnvelopeBody('{"code":100000403,"msg":"denied","data":null}', "/api/x/y");
      throw new Error("should not reach");
    } catch (e: any) {
      expect(e).toBeInstanceOf(HotelByteError);
      expect(e.status).toBe(100000403);
      expect(e.message).toContain("denied");
    }
  });

  it("passes through non-envelope JSON and unparseable bodies untouched", () => {
    expect(parseEnvelopeBody('{"plain":"json"}', "/api/x/y")).toEqual({ plain: "json" });
    expect(parseEnvelopeBody("not json", "/api/x/y")).toBe("not json");
    expect(parseEnvelopeBody("", "/api/x/y")).toBeUndefined();
  });
});

// ── normalizeApiPath ────────────────────────────────────────────────────

describe("normalizeApiPath", () => {
  it("expands shorthand to the full /api/ path", () => {
    expect(normalizeApiPath("trade/tenant/listOrder")).toBe("/api/trade/tenant/listOrder");
  });

  it("accepts an explicit /api/ prefix and trims whitespace", () => {
    expect(normalizeApiPath("/api/trade/tenant/listOrder")).toBe("/api/trade/tenant/listOrder");
    expect(normalizeApiPath("  /api/trade/tenant/listOrder  ")).toBe("/api/trade/tenant/listOrder");
  });

  it("accepts a bare api/ prefix", () => {
    expect(normalizeApiPath("api/trade/tenant/listOrder")).toBe("/api/trade/tenant/listOrder");
  });

  it("rejects internal/webhook/uploads paths", () => {
    expect(() => normalizeApiPath("internal/foo/bar")).toThrow(HotelByteError);
    expect(() => normalizeApiPath("/api/internal/foo")).toThrow(HotelByteError);
    expect(() => normalizeApiPath("/api/webhook/paddle")).toThrow(HotelByteError);
    expect(() => normalizeApiPath("/api/uploads/logo.png")).toThrow(HotelByteError);
  });

  it("rejects non-/api/ targets (webhook / uploads / arbitrary URLs)", () => {
    expect(() => normalizeApiPath("/webhook/paddle")).toThrow(/\/api\/ JSON endpoint/);
    expect(() => normalizeApiPath("/uploads/logo.png")).toThrow(/\/api\/ JSON endpoint/);
    expect(() => normalizeApiPath("https://api.hotelbyte.com/api/x/y")).toThrow(HotelByteError);
    expect(() => normalizeApiPath("   ")).toThrow(HotelByteError);
  });
});

// ── isWriteOperation ────────────────────────────────────────────────────

describe("isWriteOperation", () => {
  it("trusts operationType when present", () => {
    expect(isWriteOperation({ operationType: "write", methodName: "anything" })).toBe(true);
    expect(isWriteOperation({ operationType: "read", methodName: "destroyEverything" })).toBe(false);
  });

  it("falls back to the read-prefix heuristic when operationType is missing", () => {
    expect(isWriteOperation({ methodName: "listOrder" })).toBe(false);
    expect(isWriteOperation({ methodName: "getHotelDetail" })).toBe(false);
    expect(isWriteOperation({ methodName: "searchHotels" })).toBe(false);
    expect(isWriteOperation({ methodName: "dashboardSummary" })).toBe(false);
    expect(isWriteOperation({ methodName: "GetUserStatistics" })).toBe(false); // case-insensitive
    expect(isWriteOperation({ methodName: "cancelOrder" })).toBe(true);
    expect(isWriteOperation({ methodName: "exportThings" })).toBe(true);
    expect(isWriteOperation({ methodName: "" })).toBe(true); // unknown = write (default-deny)
  });
});

// ── fetchCatalog / loadCatalog ──────────────────────────────────────────

describe("fetchCatalog", () => {
  it("POSTs {type:\"\",limit:0} to /api/view/getApiPaths and returns the MethodMeta array", async () => {
    const m = stubFetch(() => catalogResp(UNIT_METHODS));
    try {
      const methods = await fetchCatalog(unitCtx());
      expect(m.captured).toHaveLength(1);
      expect(m.captured[0]?.url).toBe(`${ENVIRONMENTS.uat}${CATALOG_ENDPOINT}`);
      expect(m.captured[0]?.body).toEqual({ type: "", limit: 0 });
      expect(methods).toHaveLength(2);
      expect(methods[0]?.serviceName).toBe("lookout");
    } finally {
      m.restore();
    }
  });

  it("accepts the live envelope {methodMetas:[...], total} (UAT shape, 2026-10-04 smoke)", async () => {
    const m = stubFetch(() => ({ code: 0, msg: "ok", data: { methodMetas: UNIT_METHODS, total: UNIT_METHODS.length } }));
    try {
      const methods = await fetchCatalog(unitCtx());
      expect(methods).toHaveLength(2);
      expect(methods[1]?.methodName).toBe("labelOrder");
    } finally {
      m.restore();
    }
  });

  it("rejects a non-array catalog response instead of returning garbage", async () => {
    const m = stubFetch(() => ({ code: 0, msg: "ok", data: { unexpected: true } }));
    try {
      await expect(fetchCatalog(unitCtx())).rejects.toThrow(HotelByteError);
    } finally {
      m.restore();
    }
  });
});

describe("loadCatalog cache behavior", () => {
  it("persists the pull to $STAICLI_HOME/api-catalog-<env>.json with fetchedAt", async () => {
    const m = stubFetch(() => catalogResp(UNIT_METHODS));
    try {
      const before = Date.now();
      const snap = await loadCatalog(unitCtx());
      expect(snap.source).toBe("network");
      expect(snap.fetchedAt).toBeGreaterThanOrEqual(before);
      expect(existsSync(catalogCachePath("uat"))).toBe(true);
      const cached = JSON.parse(await Bun.file(catalogCachePath("uat")).text());
      expect(cached.fetchedAt).toBe(snap.fetchedAt);
      expect(cached.methods).toHaveLength(2);
    } finally {
      m.restore();
    }
  });

  it("serves a fresh cache hit without touching the network", async () => {
    const m = stubFetch(() => catalogResp(UNIT_METHODS));
    try {
      await loadCatalog(unitCtx());
      expect(m.captured).toHaveLength(1);
    } finally {
      m.restore();
    }
    // Network now hard-down: a fresh (<24h) cache must answer with zero fetches.
    const down = stubFetch(() => { throw new TypeError("fetch failed"); });
    const cap = captureStderr();
    try {
      const snap = await loadCatalog(unitCtx());
      expect(snap.source).toBe("cache");
      expect(snap.stale).toBe(false);
      expect(snap.methods).toHaveLength(2);
      expect(down.captured).toHaveLength(0);
    } finally {
      down.restore();
      cap.done();
    }
  });

  it("--refresh forces a re-pull even when the cache is fresh", async () => {
    const updated: MethodMeta[] = [{ serviceName: "x", methodName: "y", path: "/api/x/y/z", operationType: "read" }];
    const m = stubFetch(() => catalogResp(UNIT_METHODS));
    try {
      await loadCatalog(unitCtx());
    } finally {
      m.restore();
    }
    const m2 = stubFetch(() => catalogResp(updated));
    try {
      const snap = await loadCatalog(unitCtx(), { refresh: true });
      expect(m2.captured).toHaveLength(1);
      expect(snap.source).toBe("network");
      expect(snap.methods).toEqual(updated);
    } finally {
      m2.restore();
    }
  });

  it("re-pulls once the 24h TTL has passed", async () => {
    seedCache(UNIT_METHODS, Date.now() - CATALOG_TTL_MS - 1000);
    const m = stubFetch(() => catalogResp(UNIT_METHODS));
    try {
      const snap = await loadCatalog(unitCtx());
      expect(m.captured).toHaveLength(1);
      expect(snap.source).toBe("network");
    } finally {
      m.restore();
    }
  });

  it("falls back to the cached copy (with a stderr note) when a refresh fails", async () => {
    seedCache(UNIT_METHODS, Date.now() - CATALOG_TTL_MS - 1000); // stale cache
    const m = stubFetch(() => { throw new TypeError("network down"); });
    const cap = captureStderr();
    try {
      const snap = await loadCatalog(unitCtx());
      expect(snap.source).toBe("cache");
      expect(snap.stale).toBe(true);
      expect(snap.methods).toHaveLength(2);
      expect(cap.notes.join("\n")).toContain("using cached copy");
    } finally {
      m.restore();
      cap.done();
    }
  });

  it("falls back to the cache when credentials are missing (makeClient 401)", async () => {
    seedCache(UNIT_METHODS, Date.now()); // fresh cache, but --refresh forces a pull
    const ctx = unitCtx({
      client: async () => { throw new HotelByteError(401, "No credentials found", "auth"); },
    });
    const cap = captureStderr();
    try {
      const snap = await loadCatalog(ctx, { refresh: true });
      expect(snap.source).toBe("cache");
      expect(snap.methods).toHaveLength(2);
      expect(cap.notes.join("\n")).toContain("No credentials found");
    } finally {
      cap.done();
    }
  });

  it("rethrows when a pull fails and no cache exists", async () => {
    const m = stubFetch(() => { throw new TypeError("network down"); });
    try {
      await expect(loadCatalog(unitCtx())).rejects.toThrow("network down");
    } finally {
      m.restore();
    }
  });

  it("treats a corrupt cache file as a miss and rewrites it", async () => {
    writeFileSync(catalogCachePath("uat"), "{not json");
    const m = stubFetch(() => catalogResp(UNIT_METHODS));
    try {
      const snap = await loadCatalog(unitCtx());
      expect(snap.source).toBe("network");
      const cached = JSON.parse(await Bun.file(catalogCachePath("uat")).text());
      expect(cached.methods).toHaveLength(2);
    } finally {
      m.restore();
    }
  });
});

// ── CLI layer: `hbcli api` against a Bun.serve stub ─────────────────────

const CATALOG: MethodMeta[] = [
  {
    serviceName: "tenant", methodName: "listOrder", path: "/api/trade/tenant/listOrder",
    operationType: "read", authMethod: "user", permissions: ["order:view"],
    paramNames: ["pageNum", "pageSize"], apidoc: "List tenant orders (paged).",
  },
  { serviceName: "tenant", methodName: "labelOrder", path: "/api/trade/tenant/labelOrder", operationType: "write" },
  // No operationType → heuristic applies.
  { serviceName: "tenant", methodName: "exportThings", path: "/api/trade/tenant/exportThings" },
  { serviceName: "tenant", methodName: "dashboardSummary", path: "/api/trade/tenant/dashboardSummary" },
  // D6 channels (issue #41): exportCsv/getDocument mirror the server's
  // streaming endpoints (raw bytes + Content-Disposition, no JSON envelope);
  // uploadBrandAsset mirrors the multipart decoder contract.
  { serviceName: "tenant", methodName: "exportCsv", path: "/api/trade/tenant/exportCsv" },
  { serviceName: "tenant", methodName: "getDocument", path: "/api/trade/tenant/getDocument" },
  { serviceName: "whitelabel", methodName: "uploadBrandAsset", path: "/api/whitelabel/uploadBrandAsset" },
];

const serverCalls: { path: string; body: any }[] = [];

/** Captured multipart entries of upload stub hits. */
type MultipartEntry = { name: string; value: string } | { name: string; filename: string; bytes: Uint8Array };
const uploadCaptures: MultipartEntry[][] = [];

// Binary payloads prove byte-exact transit (0x00/0xFF would not survive any
// accidental text round-trip).
const CSV_BYTES = new Uint8Array([0x69, 0x64, 0x2c, 0x6e, 0x61, 0x6d, 0x65, 0x0a, 0x31, 0x2c, 0x00, 0xff]);
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x00, 0xff, 0x01]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff]);

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    // Multipart upload stub: parse the real form so field names / filename /
    // bytes can be asserted (tests/mcp.test.ts Bun.serve pattern).
    if (url.pathname === "/api/whitelabel/uploadBrandAsset") {
      const form = await req.formData();
      const entries: MultipartEntry[] = [];
      for (const [name, value] of (form as any).entries()) {
        if (typeof value === "string") entries.push({ name, value });
        else entries.push({ name, filename: value.name, bytes: new Uint8Array(await value.arrayBuffer()) });
      }
      uploadCaptures.push(entries);
      serverCalls.push({ path: url.pathname, body: { multipart: entries.map((e) => e.name) } });
      return Response.json({ code: 0, msg: "ok", data: { url: "/uploads/brand-assets/1/logo.png" } });
    }
    const text = await req.text();
    let body: any = {};
    try { body = text ? JSON.parse(text) : {}; } catch { /* keep {} */ }
    serverCalls.push({ path: url.pathname, body });
    switch (url.pathname) {
      case CATALOG_ENDPOINT:
        return Response.json({ code: 0, msg: "ok", data: CATALOG });
      case "/api/trade/tenant/listOrder":
        return Response.json({ code: 0, msg: "ok", data: { orders: [{ id: "o-1" }] } });
      case "/api/trade/tenant/labelOrder":
        return Response.json({ code: 0, msg: "ok", data: { labeled: true } });
      case "/api/trade/tenant/exportThings":
        return Response.json({ code: 0, msg: "ok", data: { exported: true } });
      case "/api/trade/tenant/dashboardSummary":
        return Response.json({ code: 0, msg: "ok", data: { today: 3 } });
      // Streaming-style responses: raw bytes, no {code,msg,data} envelope.
      case "/api/trade/tenant/exportCsv":
        return new Response(CSV_BYTES, {
          headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="orders.csv"' },
        });
      case "/api/trade/tenant/getDocument":
        return new Response(PDF_BYTES, {
          headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="doc.pdf"' },
        });
      case "/api/trade/tenant/getDeniedDocument":
        return Response.json({ code: 100000403, msg: "forbidden by RBAC", data: null }, { status: 403 });
      default:
        return Response.json({ code: 0, msg: "ok", data: { path: url.pathname } });
    }
  },
});

afterAll(() => {
  server.stop(true);
});

const CLI_PATH = join(import.meta.dir, "..", "src", "cli.ts");
// process.execPath is the running Bun binary: the suite must not depend on
// "bun" being on PATH (tests/cli.test.ts precedent).
const BUN_BIN = process.execPath;

function freshHome(): string {
  return mkdtempSync(join(tmpdir(), "hbcli-api-test-"));
}

function seedTicket(home: string): void {
  // Cached openapi ticket → makeClient takes the ticket flow with zero auth calls.
  writeFileSync(join(home, "credentials.json"), JSON.stringify({ "openapi:uat": { ticket: "stub-ticket" } }));
}

// Async spawn (not spawnSync): the Bun.serve stub lives in THIS process, and a
// synchronous spawn would block the event loop that must serve the child's
// HTTP requests (the child would hang until the test timeout).
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

describe("api call write guard (CLI end-to-end)", () => {
  it("read operation passes straight through without --confirm", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "api", "call", "trade/tenant/listOrder", "--data", '{"pageNum":1}'], home);
      expect(r.exitCode).toBe(0);
      const out = JSON.parse(r.stdout.trim());
      expect(out.orders[0].id).toBe("o-1");
      expect(serverCalls.map((c) => c.path)).toEqual([CATALOG_ENDPOINT, "/api/trade/tenant/listOrder"]);
      expect(serverCalls[1]?.body).toEqual({ pageNum: 1 });
    } finally {
      cleanupHome(home);
    }
  });

  it("heuristic read (operationType missing, read-prefixed method) passes through", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "api", "call", "trade/tenant/dashboardSummary"], home);
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).today).toBe(3);
      expect(serverCalls.map((c) => c.path)).toEqual([CATALOG_ENDPOINT, "/api/trade/tenant/dashboardSummary"]);
      expect(serverCalls[1]?.body).toEqual({}); // no --data → empty object body
    } finally {
      cleanupHome(home);
    }
  });

  it("write operation (operationType=write) is rejected without --confirm and never reaches the server", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "api", "call", "trade/tenant/labelOrder", "--data", '{"orderId":"o-1"}'], home);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("--confirm");
      expect(serverCalls.map((c) => c.path)).toEqual([CATALOG_ENDPOINT]); // only the catalog lookup
    } finally {
      cleanupHome(home);
    }
  });

  it("heuristic write (operationType missing, non-read method) is rejected without --confirm", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "api", "call", "trade/tenant/exportThings"], home);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("--confirm");
      expect(r.stderr).toContain("read-prefix list");
      expect(serverCalls.map((c) => c.path)).toEqual([CATALOG_ENDPOINT]);
    } finally {
      cleanupHome(home);
    }
  });

  it("write operation executes with --confirm (and skips the catalog lookup)", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(
        ["--json", "api", "call", "/api/trade/tenant/labelOrder", "--confirm", "--data", '{"orderId":"o-1"}'],
        home,
      );
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).labeled).toBe(true);
      expect(serverCalls.map((c) => c.path)).toEqual(["/api/trade/tenant/labelOrder"]);
      expect(serverCalls[0]?.body).toEqual({ orderId: "o-1" });
    } finally {
      cleanupHome(home);
    }
  });

  it("rejects out-of-scope paths client-side (no network at all)", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const internal = await runCli(["api", "call", "internal/foo/bar"], home);
      expect(internal.exitCode).toBe(1);
      expect(internal.stderr).toContain("out of scope");

      const webhook = await runCli(["api", "call", "/webhook/paddle"], home);
      expect(webhook.exitCode).toBe(1);
      expect(webhook.stderr).toContain("/api/ JSON endpoint");

      expect(serverCalls).toHaveLength(0); // normalization happens before any HTTP
    } finally {
      cleanupHome(home);
    }
  });
});

describe("api catalog / describe (CLI end-to-end)", () => {
  it("catalog --filter returns matching rows as JSON and writes the cache", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "api", "catalog", "--filter", "labelorder"], home);
      expect(r.exitCode).toBe(0);
      const rows = JSON.parse(r.stdout.trim());
      expect(rows).toHaveLength(1);
      expect(rows[0].path).toBe("/api/trade/tenant/labelOrder");
      expect(rows[0].operationType).toBe("write");
      expect(existsSync(join(home, "api-catalog-uat.json"))).toBe(true);
    } finally {
      cleanupHome(home);
    }
  });

  it("catalog --service filters by exact service name; a second run serves the cache without a fetch", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const first = await runCli(["--json", "api", "catalog", "--service", "tenant"], home);
      expect(first.exitCode).toBe(0);
      expect(JSON.parse(first.stdout.trim())).toHaveLength(6);
      expect(serverCalls).toHaveLength(1);

      const second = await runCli(["--json", "api", "catalog", "--service", "Tenant"], home);
      expect(second.exitCode).toBe(0);
      expect(JSON.parse(second.stdout.trim())).toHaveLength(6);
      expect(serverCalls).toHaveLength(1); // fresh cache hit — no second getApiPaths
    } finally {
      cleanupHome(home);
    }
  });

  it("describe prints single-endpoint metadata by path and by service/method", async () => {
    const home = freshHome();
    seedTicket(home);
    try {
      const byPath = await runCli(["--json", "api", "describe", "/api/trade/tenant/listOrder"], home);
      expect(byPath.exitCode).toBe(0);
      const meta = JSON.parse(byPath.stdout.trim());
      expect(meta.paramNames).toEqual(["pageNum", "pageSize"]);
      expect(meta.permissions).toEqual(["order:view"]);
      expect(meta.apidoc).toContain("List tenant orders");

      const byServiceMethod = await runCli(["--json", "api", "describe", "tenant/listOrder"], home);
      expect(byServiceMethod.exitCode).toBe(0);
      expect(JSON.parse(byServiceMethod.stdout.trim()).path).toBe("/api/trade/tenant/listOrder");

      const human = await runCli(["api", "describe", "tenant/listOrder"], home);
      expect(human.exitCode).toBe(0);
      expect(human.stdout).toContain("/api/trade/tenant/listOrder");
      expect(human.stdout).toContain("order:view");

      const missing = await runCli(["api", "describe", "no/such_endpoint"], home);
      expect(missing.exitCode).toBe(1);
      expect(missing.stderr).toContain("not found");
    } finally {
      cleanupHome(home);
    }
  });
});

describe("api command tree (--help)", () => {
  it("top-level help lists the api group", async () => {
    const home = freshHome();
    try {
      const { stdout, exitCode } = await runCli(["--help"], home);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/^  api\b/m);
    } finally {
      cleanupHome(home);
    }
  });

  it("api --help lists the subcommands", async () => {
    const home = freshHome();
    try {
      const { stdout, exitCode } = await runCli(["api", "--help"], home);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("catalog");
      expect(stdout).toContain("describe");
      expect(stdout).toContain("call");
      expect(stdout).toContain("download");
      expect(stdout).toContain("upload");
    } finally {
      cleanupHome(home);
    }
  });

  it("api catalog --help lists discovery flags; api call --help lists guard flags", async () => {
    const home = freshHome();
    try {
      const catalog = await runCli(["api", "catalog", "--help"], home);
      expect(catalog.exitCode).toBe(0);
      expect(catalog.stdout).toContain("--filter");
      expect(catalog.stdout).toContain("--service");
      expect(catalog.stdout).toContain("--refresh");

      const call = await runCli(["api", "call", "--help"], home);
      expect(call.exitCode).toBe(0);
      expect(call.stdout).toContain("--data");
      expect(call.stdout).toContain("--confirm");
    } finally {
      cleanupHome(home);
    }
  });

  it("api download/upload --help list the D6 channel flags (issue #41)", async () => {
    const home = freshHome();
    try {
      const download = await runCli(["api", "download", "--help"], home);
      expect(download.exitCode).toBe(0);
      expect(download.stdout).toContain("--data");
      expect(download.stdout).toContain("--out");
      expect(download.stdout).toContain("--confirm");

      const upload = await runCli(["api", "upload", "--help"], home);
      expect(upload.exitCode).toBe(0);
      expect(upload.stdout).toContain("--file");
      expect(upload.stdout).toContain("--field");
      expect(upload.stdout).toContain("--data");
      expect(upload.stdout).toContain("--confirm");
    } finally {
      cleanupHome(home);
    }
  });
});

// ── D6 non-JSON channels: api download (issue #41) ──────────────────────

describe("api download (CLI end-to-end)", () => {
  it("saves a non-JSON response verbatim to --out and reports the attachment filename", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    const out = join(home, "orders.csv");
    try {
      const r = await runCli(["--json", "api", "download", "trade/tenant/exportCsv", "--out", out, "--confirm"], home);
      expect(r.exitCode).toBe(0);
      // Byte-exact transit: 0x00/0xFF bytes survive only a true raw channel.
      expect(new Uint8Array(await Bun.file(out).arrayBuffer())).toEqual(CSV_BYTES);
      const summary = JSON.parse(r.stdout.trim());
      expect(summary.savedTo).toBe(out);
      expect(summary.bytes).toBe(CSV_BYTES.length);
      expect(summary.contentType).toBe("text/csv; charset=utf-8");
      expect(summary.fileName).toBe("orders.csv"); // from Content-Disposition
      expect(serverCalls.map((c) => c.path)).toEqual(["/api/trade/tenant/exportCsv"]); // --confirm skips the catalog lookup
    } finally {
      cleanupHome(home);
    }
  });

  it("get*-prefixed paths count as reads — no --confirm needed", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    const out = join(home, "doc.pdf");
    try {
      const r = await runCli(["--json", "api", "download", "trade/tenant/getDocument", "--out", out], home);
      expect(r.exitCode).toBe(0);
      expect(new Uint8Array(await Bun.file(out).arrayBuffer())).toEqual(PDF_BYTES);
      expect(serverCalls.map((c) => c.path)).toEqual([CATALOG_ENDPOINT, "/api/trade/tenant/getDocument"]);
    } finally {
      cleanupHome(home);
    }
  });

  it("write-classified paths demand --confirm and never reach the endpoint without it", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "api", "download", "trade/tenant/exportCsv", "--out", join(home, "x.csv")], home);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("--confirm");
      expect(r.stderr).toContain("WRITE");
      expect(serverCalls.map((c) => c.path)).toEqual([CATALOG_ENDPOINT]);
      expect(existsSync(join(home, "x.csv"))).toBe(false);
    } finally {
      cleanupHome(home);
    }
  });

  it("JSON-envelope responses are unpacked like api call — nothing is written to --out", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    const out = join(home, "unused.bin");
    try {
      // exportThings is heuristic-write and returns a JSON envelope.
      const r = await runCli(["--json", "api", "download", "trade/tenant/exportThings", "--out", out, "--confirm"], home);
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim())).toEqual({ exported: true });
      expect(existsSync(out)).toBe(false);
    } finally {
      cleanupHome(home);
    }
  });

  it("surfaces non-2xx envelopes as errors and writes no file", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    const out = join(home, "denied.bin");
    try {
      const r = await runCli(["--json", "api", "download", "trade/tenant/getDeniedDocument", "--out", out], home);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("forbidden by RBAC");
      expect(existsSync(out)).toBe(false);
    } finally {
      cleanupHome(home);
    }
  });
});

// ── D6 non-JSON channels: api upload (issue #41) ────────────────────────

describe("api upload (CLI end-to-end)", () => {
  it("rejects an upload without --confirm before any file leaves the machine", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    uploadCaptures.length = 0;
    const file = join(home, "logo.png");
    writeFileSync(file, PNG_BYTES);
    try {
      const r = await runCli(
        ["--json", "api", "upload", "whitelabel/uploadBrandAsset", "--file", file, "--data", '{"assetType":"logo"}'],
        home,
      );
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("--confirm");
      expect(serverCalls.map((c) => c.path)).toEqual([CATALOG_ENDPOINT]);
      expect(uploadCaptures).toHaveLength(0);
    } finally {
      cleanupHome(home);
    }
  });

  it("uploads the file part (default field `file`) + scalar fields and emits the envelope", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    uploadCaptures.length = 0;
    const file = join(home, "logo.png");
    writeFileSync(file, PNG_BYTES);
    try {
      const r = await runCli(
        [
          "--json", "api", "upload", "whitelabel/uploadBrandAsset",
          "--file", file, "--data", '{"assetType":"logo","entityId":"42"}', "--confirm",
        ],
        home,
      );
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).url).toBe("/uploads/brand-assets/1/logo.png");

      expect(uploadCaptures).toHaveLength(1);
      const entries = uploadCaptures[0]!;
      const scalar = Object.fromEntries(entries.filter((e) => "value" in e).map((e) => [e.name, e.value]));
      expect(scalar).toEqual({ assetType: "logo", entityId: "42" });
      const filePart = entries.find((e) => "filename" in e) as any;
      expect(filePart).toBeDefined();
      expect(filePart.name).toBe("file"); // server contract field name
      expect(filePart.filename).toBe("logo.png");
      expect(filePart.bytes).toEqual(PNG_BYTES);

      expect(serverCalls.map((c) => c.path)).toEqual(["/api/whitelabel/uploadBrandAsset"]); // --confirm skips the catalog lookup
    } finally {
      cleanupHome(home);
    }
  });

  it("honors --field for endpoints that name the file part differently", async () => {
    const home = freshHome();
    seedTicket(home);
    uploadCaptures.length = 0;
    const file = join(home, "pic.png");
    writeFileSync(file, PNG_BYTES);
    try {
      const r = await runCli(
        ["--json", "api", "upload", "whitelabel/uploadBrandAsset", "--file", file, "--field", "image", "--confirm"],
        home,
      );
      expect(r.exitCode).toBe(0);
      const filePart = uploadCaptures[0]?.find((e) => "filename" in e) as any;
      expect(filePart?.name).toBe("image");
      expect(filePart?.filename).toBe("pic.png");
    } finally {
      cleanupHome(home);
    }
  });

  it("fails fast when --file does not exist (no network)", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    uploadCaptures.length = 0;
    try {
      const r = await runCli(
        ["--json", "api", "upload", "whitelabel/uploadBrandAsset", "--file", join(home, "nope.png"), "--confirm"],
        home,
      );
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("nope.png");
      expect(serverCalls).toHaveLength(0);
      expect(uploadCaptures).toHaveLength(0);
    } finally {
      cleanupHome(home);
    }
  });
});
