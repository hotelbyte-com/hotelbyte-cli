/**
 * tests/mcp_local.test.ts — local stdio MCP tool server (issue #30, D4/D5).
 *
 * Unit layer: dispatchLocalMessage/handleLocalLine/runLocalMcpServer with a
 * stubbed global fetch (mockFetchOnce pattern from tests/auth.test.ts) and an
 * isolated STAICLI_HOME — no live environment.
 *
 * Subprocess layer: `hbcli mcp serve --local --demo` spawned against an
 * in-process Bun.serve stub (pattern from tests/mcp.test.ts) — full-chain
 * JSON-RPC over real stdio, including the demo credential flow, the write
 * guard, notification silence, and non-JSON line tolerance.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { existsSync, rmSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { ENVIRONMENTS } from "../src/core/config.ts";
import { HttpClient, HotelByteError } from "../src/core/http.ts";
import { CATALOG_ENDPOINT } from "../src/core/api_catalog.ts";
import {
  DEFAULT_CATALOG_LIMIT,
  LOCAL_MCP_SERVER_NAME,
  dispatchLocalMessage,
  handleLocalLine,
  runLocalMcpServer,
} from "../src/core/mcp_local.ts";
import { VERSION } from "../src/core/version.ts";
import type { ApiCatalogCtx, MethodMeta } from "../src/core/api_catalog.ts";

// ── shared fixtures ─────────────────────────────────────────────────────

const TMP_HOME = join(import.meta.dir, ".tmp-mcp-local-home");

beforeEach(() => {
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
  mkdirSync(TMP_HOME, { recursive: true });
  process.env.STAICLI_HOME = TMP_HOME;
});

afterEach(() => {
  delete process.env.STAICLI_HOME;
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
});

// Capture-able fetch stub (tests/auth.test.ts pattern): the handler's return
// value is the JSON response body; a throw simulates a network failure.
function stubFetch(handler: (call: { url: string; body: Record<string, unknown> }, index: number) => unknown) {
  const originalFetch = global.fetch;
  const captured: { url: string; body: Record<string, unknown> }[] = [];
  global.fetch = (async (url: unknown, init?: RequestInit) => {
    const call = { url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> };
    captured.push(call);
    return new Response(JSON.stringify(handler(call, captured.length)), { status: 200 });
  }) as typeof fetch;
  return {
    captured,
    restore: () => { global.fetch = originalFetch; },
  };
}

const UNIT_METHODS: MethodMeta[] = [
  {
    serviceName: "tenant", methodName: "listOrder", path: "/api/trade/tenant/listOrder",
    operationType: "read", paramNames: ["pageNum", "pageSize"], permissions: ["order:view"],
  },
  { serviceName: "tenant", methodName: "labelOrder", path: "/api/trade/tenant/labelOrder", operationType: "write" },
  // No operationType → heuristic applies (export… is not a read prefix).
  { serviceName: "tenant", methodName: "exportThings", path: "/api/trade/tenant/exportThings" },
  { serviceName: "tenant", methodName: "dashboardSummary", path: "/api/trade/tenant/dashboardSummary" },
];

const catalogResp = () => ({ code: 0, msg: "ok", data: UNIT_METHODS });

function unitCtx(overrides: Partial<ApiCatalogCtx> = {}): ApiCatalogCtx {
  return {
    env: () => "uat",
    client: async () => new HttpClient({ name: "openapi", env: "uat", baseUrl: ENVIRONMENTS.uat, ticket: "tok" }),
    ...overrides,
  };
}

const logsOf = () => {
  const logs: string[] = [];
  return { logs, log: (m: string) => logs.push(m) };
};

/** tools/call request frame. */
const callFrame = (id: unknown, name: string, args: Record<string, unknown>) =>
  ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

/** unwrap: tools/call result → { text, isError } */
function toolPayload(resp: any): { payload: any; isError: boolean } {
  const result = resp.result;
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe("text");
  return { payload: JSON.parse(result.content[0].text), isError: result.isError === true };
}

// ── initialize / ping / notifications / errors ──────────────────────────

describe("initialize", () => {
  it("echoes the client protocolVersion and returns capabilities + serverInfo", async () => {
    const resp = await dispatchLocalMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
      { ctx: unitCtx() },
    );
    expect(resp).not.toBeNull();
    expect(resp!.result.protocolVersion).toBe("2024-11-05");
    expect(resp!.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(resp!.result.serverInfo).toEqual({ name: LOCAL_MCP_SERVER_NAME, version: VERSION });
    expect(resp!.id).toBe(1);
  });

  it("falls back to the default protocolVersion when the client sends none", async () => {
    const resp = await dispatchLocalMessage({ jsonrpc: "2.0", id: "a", method: "initialize" }, { ctx: unitCtx() });
    expect(resp!.result.protocolVersion).toBe("2025-06-18");
  });
});

describe("notifications and framing", () => {
  it("never answers notifications (no id) — initialized/cancelled/progress", async () => {
    for (const method of ["notifications/initialized", "notifications/cancelled", "notifications/roots/list_changed"]) {
      const resp = await dispatchLocalMessage({ jsonrpc: "2.0", method }, { ctx: unitCtx() });
      expect(resp).toBeNull();
    }
  });

  it("ping → empty result object", async () => {
    const resp = await dispatchLocalMessage({ jsonrpc: "2.0", id: 7, method: "ping" }, { ctx: unitCtx() });
    expect(resp!.id).toBe(7);
    expect(resp!.result).toEqual({});
  });

  it("unknown method → -32601 carrying the request id", async () => {
    const resp = await dispatchLocalMessage({ jsonrpc: "2.0", id: 9, method: "resources/list" }, { ctx: unitCtx() });
    expect(resp!.id).toBe(9);
    expect(resp!.error.code).toBe(-32601);
    expect(resp!.error.message).toContain("resources/list");
  });

  it("request without a method → -32600", async () => {
    const resp = await dispatchLocalMessage({ jsonrpc: "2.0", id: 3, params: {} }, { ctx: unitCtx() });
    expect(resp!.error.code).toBe(-32600);
  });
});

describe("non-JSON / garbage stdin tolerance", () => {
  it("handleLocalLine ignores non-JSON lines with a stderr note and answers nothing", async () => {
    const { logs, log } = logsOf();
    const out = await handleLocalLine("this is not json", { ctx: unitCtx(), log });
    expect(out).toBeNull();
    expect(logs.join("\n")).toContain("non-JSON");
  });

  it("ignores empty lines and non-object JSON frames silently", async () => {
    const { logs, log } = logsOf();
    expect(await handleLocalLine("   ", { ctx: unitCtx(), log })).toBeNull();
    expect(await handleLocalLine("[1,2,3]", { ctx: unitCtx(), log })).toBeNull();
    expect(logs.join("\n")).toContain("non-object");
  });

  it("runLocalMcpServer writes only the good responses when noise is interleaved", async () => {
    const wrote: string[] = [];
    async function* gen() {
      yield "not json";
      yield "";
      yield JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
      yield JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
      yield JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    }
    await runLocalMcpServer(gen(), (l) => wrote.push(l), { ctx: unitCtx() });
    expect(wrote).toHaveLength(2);
    expect(JSON.parse(wrote[0]).result).toEqual({});
    expect(JSON.parse(wrote[1]).result.tools).toHaveLength(3);
  });
});

// ── tools/list ──────────────────────────────────────────────────────────

describe("tools/list", () => {
  it("serves exactly the three generic tools with the declared params", async () => {
    const resp = await dispatchLocalMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { ctx: unitCtx() });
    const tools = resp!.result.tools;
    expect(tools.map((t: any) => t.name)).toEqual(["portal.catalog", "portal.describe", "portal.call"]);

    const byName = Object.fromEntries(tools.map((t: any) => [t.name, t]));
    expect(Object.keys(byName["portal.catalog"].inputSchema.properties)).toEqual(["filter", "service", "limit"]);
    expect(byName["portal.describe"].inputSchema.required).toEqual(["path"]);

    // D5: portal.call must declare confirm in its schema.
    expect(byName["portal.call"].inputSchema.properties.confirm.type).toBe("boolean");
    expect(byName["portal.call"].inputSchema.required).toEqual(["path"]);
    expect(byName["portal.call"].inputSchema.properties.data.type).toBe("object");
  });
});

// ── portal.catalog ──────────────────────────────────────────────────────

describe("portal.catalog", () => {
  it("returns compact rows with effective operationType and honors filter/service/limit", async () => {
    const m = stubFetch(() => catalogResp());
    try {
      const resp = await dispatchLocalMessage(
        callFrame(11, "portal.catalog", { service: "Tenant", limit: 2 }),
        { ctx: unitCtx() },
      );
      const { payload, isError } = toolPayload(resp);
      expect(isError).toBe(false);
      expect(m.captured[0].url).toBe(`${ENVIRONMENTS.uat}${CATALOG_ENDPOINT}`);
      expect(m.captured[0].body).toEqual({ type: "", limit: 0 });
      expect(payload.total).toBe(4);
      expect(payload.returned).toBe(2);
      expect(payload.methods).toHaveLength(2);
      expect(payload.methods[0]).toEqual({
        path: "/api/trade/tenant/listOrder",
        service: "tenant",
        method: "listOrder",
        operationType: "read",
      });
      // heuristic verdicts surface in operationType
      expect(payload.methods[1]).toEqual({
        path: "/api/trade/tenant/labelOrder",
        service: "tenant",
        method: "labelOrder",
        operationType: "write",
      });
    } finally {
      m.restore();
    }
  });

  it("filter matches case-insensitively across path/service/method; heuristic verdicts surface", async () => {
    const m = stubFetch(() => catalogResp());
    try {
      const resp = await dispatchLocalMessage(callFrame(12, "portal.catalog", { filter: "LABELORDER" }), { ctx: unitCtx() });
      const { payload } = toolPayload(resp);
      expect(payload.total).toBe(1);
      expect(payload.methods[0].path).toBe("/api/trade/tenant/labelOrder");
      expect(payload.methods[0].operationType).toBe("write");

      const heuristic = await dispatchLocalMessage(callFrame(12, "portal.catalog", { filter: "exportThings" }), { ctx: unitCtx() });
      const h = toolPayload(heuristic).payload;
      expect(h.total).toBe(1);
      expect(h.methods[0].operationType).toBe("write (heuristic)");
    } finally {
      m.restore();
    }
  });

  it("default limit caps the rows but reports the full total", async () => {
    const many: MethodMeta[] = Array.from({ length: DEFAULT_CATALOG_LIMIT + 10 }, (_, i) => ({
      serviceName: "s", methodName: `getThing${i}`, path: `/api/x/s/getThing${i}`, operationType: "read",
    }));
    const m = stubFetch(() => ({ code: 0, msg: "ok", data: many }));
    try {
      const resp = await dispatchLocalMessage(callFrame(13, "portal.catalog", {}), { ctx: unitCtx() });
      const { payload } = toolPayload(resp);
      expect(payload.total).toBe(DEFAULT_CATALOG_LIMIT + 10);
      expect(payload.returned).toBe(DEFAULT_CATALOG_LIMIT);
    } finally {
      m.restore();
    }
  });

  it("rejects a non-positive or non-integer limit as a tool error", async () => {
    for (const limit of [0, -1, 1.5]) {
      const resp = await dispatchLocalMessage(callFrame(14, "portal.catalog", { limit }), { ctx: unitCtx() });
      const { payload, isError } = toolPayload(resp);
      expect(isError).toBe(true);
      expect(payload.error).toContain("limit");
    }
  });

  it("surfaces a failed catalog pull (no cache, no credentials) as a tool error", async () => {
    const noAuth: ApiCatalogCtx = {
      env: () => "uat",
      client: async () => { throw new HotelByteError(401, "No credentials found. Run: hbcli auth set-credentials ...", "mcp"); },
    };
    const resp = await dispatchLocalMessage(callFrame(15, "portal.catalog", {}), { ctx: noAuth });
    const { payload, isError } = toolPayload(resp);
    expect(isError).toBe(true);
    expect(payload.error).toContain("No credentials found");
    // tool error, not a protocol error: the frame is still a result
    expect(resp!.result.isError).toBe(true);
    expect(resp!.error).toBeUndefined();
  });
});

// ── portal.describe ─────────────────────────────────────────────────────

describe("portal.describe", () => {
  it("returns full metadata plus isWrite, by path and by service/method", async () => {
    const m = stubFetch(() => catalogResp());
    try {
      const byPath = await dispatchLocalMessage(
        callFrame(21, "portal.describe", { path: "trade/tenant/labelOrder" }),
        { ctx: unitCtx() },
      );
      const { payload } = toolPayload(byPath);
      expect(payload.path).toBe("/api/trade/tenant/labelOrder");
      expect(payload.paramNames).toBeUndefined();
      expect(payload.isWrite).toBe(true);

      const byService = await dispatchLocalMessage(
        callFrame(22, "portal.describe", { path: "tenant/listOrder" }),
        { ctx: unitCtx() },
      );
      const p2 = toolPayload(byService).payload;
      expect(p2.paramNames).toEqual(["pageNum", "pageSize"]);
      expect(p2.isWrite).toBe(false);
    } finally {
      m.restore();
    }
  });

  it("missing path → tool error; unknown endpoint → tool error", async () => {
    const missing = await dispatchLocalMessage(callFrame(23, "portal.describe", {}), { ctx: unitCtx() });
    expect(toolPayload(missing).isError).toBe(true);

    const m = stubFetch(() => catalogResp());
    try {
      const unknown = await dispatchLocalMessage(callFrame(24, "portal.describe", { path: "no/such_thing" }), { ctx: unitCtx() });
      const { payload, isError } = toolPayload(unknown);
      expect(isError).toBe(true);
      expect(payload.error).toContain("not found");
    } finally {
      m.restore();
    }
  });
});

// ── portal.call — read/write guardrails (D5) ────────────────────────────

describe("portal.call", () => {
  it("read operation passes straight through to the endpoint with the given body", async () => {
    const m = stubFetch((call) => {
      if (call.url.endsWith(CATALOG_ENDPOINT)) return catalogResp();
      return { code: 0, msg: "ok", data: { orders: [{ id: "o-1" }] } };
    });
    try {
      const resp = await dispatchLocalMessage(
        callFrame(31, "portal.call", { path: "trade/tenant/listOrder", data: { pageNum: 1 } }),
        { ctx: unitCtx() },
      );
      const { payload, isError } = toolPayload(resp);
      expect(isError).toBe(false);
      expect(payload.orders[0].id).toBe("o-1");
      expect(m.captured.map((c) => c.url)).toEqual([
        `${ENVIRONMENTS.uat}${CATALOG_ENDPOINT}`,
        `${ENVIRONMENTS.uat}/api/trade/tenant/listOrder`,
      ]);
      expect(m.captured[1].body).toEqual({ pageNum: 1 });
    } finally {
      m.restore();
    }
  });

  it("heuristic read (operationType missing, read-prefixed method) passes without confirm", async () => {
    const m = stubFetch((call) => {
      if (call.url.endsWith(CATALOG_ENDPOINT)) return catalogResp();
      return { code: 0, msg: "ok", data: { today: 3 } };
    });
    try {
      const resp = await dispatchLocalMessage(
        callFrame(32, "portal.call", { path: "trade/tenant/dashboardSummary" }),
        { ctx: unitCtx() },
      );
      expect(toolPayload(resp).payload.today).toBe(3);
    } finally {
      m.restore();
    }
  });

  it("write operation (operationType=write) without confirm → tool error, endpoint never hit", async () => {
    const m = stubFetch(() => catalogResp());
    try {
      const resp = await dispatchLocalMessage(
        callFrame(33, "portal.call", { path: "trade/tenant/labelOrder", data: { orderId: "o-1" } }),
        { ctx: unitCtx() },
      );
      const { payload, isError } = toolPayload(resp);
      expect(isError).toBe(true);
      expect(payload.error).toContain("WRITE");
      expect(payload.error).toContain("confirm=true");
      expect(payload.error).toContain("operationType=write");
      // only the catalog lookup happened — the write endpoint was never called
      expect(m.captured.map((c) => c.url)).toEqual([`${ENVIRONMENTS.uat}${CATALOG_ENDPOINT}`]);
    } finally {
      m.restore();
    }
  });

  it("heuristic write without confirm → tool error naming the heuristic basis", async () => {
    const m = stubFetch(() => catalogResp());
    try {
      const resp = await dispatchLocalMessage(
        callFrame(34, "portal.call", { path: "trade/tenant/exportThings" }),
        { ctx: unitCtx() },
      );
      const { payload, isError } = toolPayload(resp);
      expect(isError).toBe(true);
      expect(payload.error).toContain("read-prefix list");
      expect(m.captured.map((c) => c.url)).toEqual([`${ENVIRONMENTS.uat}${CATALOG_ENDPOINT}`]);
    } finally {
      m.restore();
    }
  });

  it("confirm=false is treated as unconfirmed", async () => {
    const m = stubFetch(() => catalogResp());
    try {
      const resp = await dispatchLocalMessage(
        callFrame(35, "portal.call", { path: "/api/trade/tenant/labelOrder", confirm: false }),
        { ctx: unitCtx() },
      );
      expect(toolPayload(resp).isError).toBe(true);
    } finally {
      m.restore();
    }
  });

  it("confirm=true executes the write and skips the classification lookup entirely", async () => {
    const m = stubFetch(() => ({ code: 0, msg: "ok", data: { labeled: true } }));
    try {
      const resp = await dispatchLocalMessage(
        callFrame(36, "portal.call", { path: "/api/trade/tenant/labelOrder", data: { orderId: "o-1" }, confirm: true }),
        { ctx: unitCtx() },
      );
      const { payload, isError } = toolPayload(resp);
      expect(isError).toBe(false);
      expect(payload.labeled).toBe(true);
      expect(m.captured.map((c) => c.url)).toEqual([`${ENVIRONMENTS.uat}/api/trade/tenant/labelOrder`]);
      expect(m.captured[0].body).toEqual({ orderId: "o-1" });
    } finally {
      m.restore();
    }
  });

  it("catalog unavailable during classification → heuristic fallback note on stderr, still guarded", async () => {
    const { logs, log } = logsOf();
    const m = stubFetch(() => { throw new TypeError("network down"); });
    try {
      const resp = await dispatchLocalMessage(
        callFrame(37, "portal.call", { path: "trade/tenant/labelOrder" }),
        { ctx: unitCtx(), log },
      );
      expect(toolPayload(resp).isError).toBe(true);
      expect(logs.join("\n")).toContain("method-name heuristic");
    } finally {
      m.restore();
    }
  });

  it("out-of-scope paths are rejected client-side with zero fetches", async () => {
    const m = stubFetch(() => catalogResp());
    try {
      const internal = await dispatchLocalMessage(callFrame(38, "portal.call", { path: "internal/foo/bar", confirm: true }), { ctx: unitCtx() });
      const { payload, isError } = toolPayload(internal);
      expect(isError).toBe(true);
      expect(payload.error).toContain("out of scope");
      expect(m.captured).toHaveLength(0);
    } finally {
      m.restore();
    }
  });

  it("non-object data and missing path are tool errors", async () => {
    const badData = await dispatchLocalMessage(callFrame(39, "portal.call", { path: "trade/tenant/listOrder", data: [1, 2] }), { ctx: unitCtx() });
    expect(toolPayload(badData).isError).toBe(true);

    const noPath = await dispatchLocalMessage(callFrame(40, "portal.call", {}), { ctx: unitCtx() });
    expect(toolPayload(noPath).isError).toBe(true);
  });

  it("unknown tool name is a tool error listing the available tools", async () => {
    const resp = await dispatchLocalMessage(callFrame(41, "portal.bookings", {}), { ctx: unitCtx() });
    const { payload, isError } = toolPayload(resp);
    expect(isError).toBe(true);
    expect(payload.error).toContain("portal.catalog");
  });

  it("API errors from the endpoint surface as tool errors (not swallowed)", async () => {
    const m = stubFetch((call) => {
      if (call.url.endsWith(CATALOG_ENDPOINT)) return catalogResp();
      // Real API error shape {code != 0, msg, data} → HttpClient raises HotelByteError.
      return { code: 1_00_00_0403, msg: "permission denied: order:view", data: null };
    });
    try {
      const resp = await dispatchLocalMessage(callFrame(42, "portal.call", { path: "trade/tenant/listOrder" }), { ctx: unitCtx() });
      const { payload, isError } = toolPayload(resp);
      expect(isError).toBe(true);
      expect(payload.error).toContain("permission denied");
    } finally {
      m.restore();
    }
  });
});

// ── subprocess end-to-end: `hbcli mcp serve --local --demo` ─────────────

const serverCalls: { path: string; auth?: string | null; body: any }[] = [];

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    return req.text().then((text) => {
      let body: any = {};
      try { body = text ? JSON.parse(text) : {}; } catch { /* keep {} */ }
      serverCalls.push({ path: url.pathname, auth: req.headers.get("authorization"), body });
      switch (url.pathname) {
        case "/api/auth/ticket":
          if (body.appKey === "hotelbyte_api_demo" && body.appSecret === "hotelbyte_api_demo") {
            return Response.json({ code: 0, msg: "ok", data: { ticket: "demo-local-ticket" } });
          }
          return Response.json({ code: 401, msg: "invalid credential" });
        case CATALOG_ENDPOINT:
          return Response.json({ code: 0, msg: "ok", data: UNIT_METHODS });
        case "/api/trade/tenant/listOrder":
          return Response.json({ code: 0, msg: "ok", data: { orders: [{ id: "o-1" }] } });
        case "/api/trade/tenant/labelOrder":
          return Response.json({ code: 0, msg: "ok", data: { labeled: true } });
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
// process.execPath is the running Bun binary: the suite must not depend on
// "bun" being on PATH (tests/cli.test.ts precedent).
const BUN_BIN = process.execPath;

function runServeLocal(inputLines: string[], home: string, extraArgs: string[] = []): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(BUN_BIN, ["run", CLI_PATH, "mcp", "serve", "--local", "--demo", ...extraArgs], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        STAICLI_HOME: home,
        HOTELBYTE_BASE_URL: `http://localhost:${server.port}`,
        HOTELBYTE_ENV: "uat",
      },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`mcp serve --local timed out; stdout so far: ${stdout}; stderr so far: ${stderr}`));
    }, 30_000);
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ stdout, stderr, exitCode: code }); });
    for (const line of inputLines) child.stdin.write(line + "\n");
    child.stdin.end();
  });
}

describe("mcp serve --local (subprocess stdio, demo identity)", () => {
  it("runs the full chain: initialize → tools/list → portal.catalog → portal.call guard + read", async () => {
    const home = mkdtempSync(join(tmpdir(), "hbcli-mcp-local-"));
    serverCalls.length = 0;
    try {
      const r = await runServeLocal([
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } }),
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        "this line is not json",
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
        JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "portal.catalog", arguments: { filter: "labelorder" } } }),
        JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "portal.call", arguments: { path: "trade/tenant/labelOrder", data: { orderId: "o-1" } } } }),
        JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "portal.call", arguments: { path: "trade/tenant/listOrder", data: { pageNum: 2 } } } }),
        JSON.stringify({ jsonrpc: "2.0", id: 6, method: "ping" }),
      ], home);

      // clean EOF exit; diagnostics on stderr only; stdout is pure protocol
      expect(r.exitCode).toBe(0);
      expect(r.stderr).toContain("hbcli mcp local tool server");
      expect(r.stderr).toContain("non-JSON");

      const lines = r.stdout.trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(6); // notification + non-JSON line answered nothing

      const init = JSON.parse(lines[0]);
      expect(init.id).toBe(1);
      expect(init.result.serverInfo).toEqual({ name: "hotelbyte-portal", version: VERSION });
      expect(init.result.protocolVersion).toBe("2025-06-18");

      const tools = JSON.parse(lines[1]).result.tools;
      expect(tools.map((t: any) => t.name)).toEqual(["portal.catalog", "portal.describe", "portal.call"]);

      const catalog = JSON.parse(lines[2]).result;
      expect(catalog.isError).toBeUndefined();
      expect(JSON.parse(catalog.content[0].text).methods[0].path).toBe("/api/trade/tenant/labelOrder");

      const guard = JSON.parse(lines[3]).result;
      expect(guard.isError).toBe(true);
      expect(JSON.parse(guard.content[0].text).error).toContain("confirm=true");

      const read = JSON.parse(lines[4]).result;
      expect(read.isError).toBeUndefined();
      expect(JSON.parse(read.content[0].text).orders[0].id).toBe("o-1");

      const ping = JSON.parse(lines[5]);
      expect(ping.id).toBe(6);
      expect(ping.result).toEqual({});

      // Demo flow on the wire: one ticket exchange (then cached), one catalog
      // pull (then cached in the child's STAICLI_HOME), and the read call.
      // The guarded write never reached the server.
      const paths = serverCalls.map((c) => c.path);
      expect(paths).toEqual(["/api/auth/ticket", CATALOG_ENDPOINT, "/api/trade/tenant/listOrder"]);
      expect(serverCalls[0].body).toEqual({ appKey: "hotelbyte_api_demo", appSecret: "hotelbyte_api_demo" });
      expect(serverCalls[1].auth).toBe("Bearer demo-local-ticket");
      expect(paths).not.toContain("/api/trade/tenant/labelOrder");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
