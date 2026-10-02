/**
 * tests/mcp.test.ts — local stdio MCP gateway bridge tests.
 *
 * Drives runStdioBridge/forwardLine against an in-process Bun.serve stub that
 * mimics the hosted stateless /mcp endpoint: request → one JSON line,
 * notification → 202 empty, auth failure → 401.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_AGENT_IDLE_SECONDS,
  forwardLine,
  issueAgentToken,
  resolveEndpoint,
  runStdioBridge,
} from "../src/core/mcp_bridge.ts";
import { loadProfile } from "../src/core/config.ts";
import { HotelByteError } from "../src/core/http.ts";

let ticketRequests: any[] = [];

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/auth/ticket") {
      return req.text().then((body) => {
        ticketRequests.push(JSON.parse(body));
        const { appKey, appSecret } = ticketRequests[ticketRequests.length - 1];
        if (appKey !== "hbk_test" || appSecret !== "hbs_test") {
          return Response.json({ code: 401, msg: "invalid credential" }, { status: 200 });
        }
        return Response.json({ code: 0, msg: "ok", data: { ticket: "static-test-ticket" } });
      });
    }
    const auth = req.headers.get("authorization");
    if (auth !== "Bearer test-ticket") {
      return new Response(`{"error":"unauthorized"}`, { status: 401 });
    }
    if (url.pathname !== "/mcp") {
      return new Response("not found", { status: 404 });
    }
    return req.text().then((body) => {
      const msg = JSON.parse(body);
      if (msg.id === undefined) {
        // MCP notification: stateless servers acknowledge with an empty body.
        return new Response(null, { status: 202 });
      }
      return Response.json({
        jsonrpc: "2.0",
        id: msg.id,
        result: { echo: msg.method, sawAuth: true },
      });
    });
  },
});

const ENDPOINT = `http://localhost:${server.port}/mcp`;

afterAll(() => {
  server.stop(true);
});

describe("resolveEndpoint", () => {
  it("derives /mcp from the profile base URL", () => {
    expect(resolveEndpoint({ baseUrl: "https://api.hotelbyte.com" } as any)).toBe(
      "https://api.hotelbyte.com/mcp",
    );
    expect(resolveEndpoint({ baseUrl: "https://api.hotelbyte.com/" } as any)).toBe(
      "https://api.hotelbyte.com/mcp",
    );
  });

  it("honors an explicit override", () => {
    expect(resolveEndpoint({ baseUrl: "https://api.hotelbyte.com" } as any, "http://localhost:9999/mcp")).toBe(
      "http://localhost:9999/mcp",
    );
  });
});

describe("forwardLine", () => {
  it("forwards a request with auth and returns the response line", async () => {
    const out = await forwardLine(ENDPOINT, "test-ticket", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`);
    expect(out).toHaveLength(1);
    const resp = JSON.parse(out[0]);
    expect(resp.id).toBe(1);
    expect(resp.result.echo).toBe("tools/list");
  });

  it("emits nothing for notifications (202 empty)", async () => {
    const out = await forwardLine(ENDPOINT, "test-ticket", `{"jsonrpc":"2.0","method":"notifications/initialized"}`);
    expect(out).toHaveLength(0);
  });

  it("synthesizes a JSON-RPC error carrying the request id on 401", async () => {
    const out = await forwardLine(ENDPOINT, "wrong-token", `{"jsonrpc":"2.0","id":42,"method":"tools/list"}`);
    expect(out).toHaveLength(1);
    const resp = JSON.parse(out[0]);
    expect(resp.id).toBe(42);
    expect(resp.error.message).toContain("401");
  });

  it("ignores non-JSON stdin noise", async () => {
    const out = await forwardLine(ENDPOINT, "test-ticket", "not json at all");
    expect(out).toHaveLength(0);
  });
});

describe("runStdioBridge", () => {
  async function* gen(lines: string[]) {
    for (const l of lines) yield l;
  }

  it("streams initialize → tools/list in order and keeps notifications silent", async () => {
    const wrote: string[] = [];
    const logs: string[] = [];
    await runStdioBridge(
      ENDPOINT,
      "test-ticket",
      gen([
        `{"jsonrpc":"2.0","id":1,"method":"initialize"}`,
        `{"jsonrpc":"2.0","method":"notifications/initialized"}`,
        `{"jsonrpc":"2.0","id":2,"method":"tools/list"}`,
      ]),
      (l) => wrote.push(l),
      (m) => logs.push(m),
    );
    expect(wrote).toHaveLength(2);
    expect(JSON.parse(wrote[0]).id).toBe(1);
    expect(JSON.parse(wrote[1]).result.echo).toBe("tools/list");
    expect(logs).toHaveLength(0);
  });
});

describe("issueAgentToken", () => {
  const TMP_HOME = join(import.meta.dir, ".tmp-test-home");

  beforeEach(() => {
    if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
    mkdirSync(TMP_HOME, { recursive: true });
    process.env.STAICLI_HOME = TMP_HOME;
    process.env.HOTELBYTE_BASE_URL = `http://localhost:${server.port}`;
    ticketRequests = [];
  });

  afterEach(() => {
    delete process.env.STAICLI_HOME;
    delete process.env.HOTELBYTE_BASE_URL;
    if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
  });

  it("exchanges appKey/appSecret for a long-idle ticket, stores it, returns the endpoint", async () => {
    const { saveProfile } = await import("../src/core/config.ts");
    saveProfile({
      name: "openapi",
      env: "uat",
      baseUrl: `http://localhost:${server.port}`,
      appKey: "hbk_test",
      appSecret: "hbs_test",
    });

    const { token, endpoint } = await issueAgentToken("uat");
    expect(token).toBe("static-test-ticket");
    expect(endpoint).toBe(`http://localhost:${server.port}/mcp`);

    // Server received the requested idle window as ttl.
    expect(ticketRequests).toHaveLength(1);
    expect(ticketRequests[0].ttl).toBe(DEFAULT_AGENT_IDLE_SECONDS);

    // Ticket stored back so `mcp serve` rides it.
    const stored = loadProfile("openapi", "uat");
    expect(stored.ticket).toBe("static-test-ticket");
  });

  it("forwards a custom idle window", async () => {
    const { saveProfile } = await import("../src/core/config.ts");
    saveProfile({
      name: "openapi",
      env: "uat",
      baseUrl: `http://localhost:${server.port}`,
      appKey: "hbk_test",
      appSecret: "hbs_test",
    });
    await issueAgentToken("uat", 3600);
    expect(ticketRequests[0].ttl).toBe(3600);
  });

  it("refuses to issue without API credentials (guidance, not a stack trace)", async () => {
    await expect(issueAgentToken("uat")).rejects.toThrow(HotelByteError);
  });
});
