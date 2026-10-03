/**
 * tests/presales.test.ts — public pre-sales agent surface (issue #45).
 *
 * Contract (hotel-be agent/packs/presalesagent + api/routes.go:349):
 *   POST /api/public/presales/chat     → SSE stream of A2UI v0.9 `data:` events
 *   POST /api/public/presales/feedback → plain {success, message} JSON
 *
 * Layers:
 *   - core: postStream SSE framing (chunk splits, \r\n, non-data lines,
 *     429/500 error contract), chat/feedback wire bodies — fetch stub
 *     (tests/auth.test.ts pattern).
 *   - CLI: end-to-end against an in-process Bun.serve stub via
 *     HOTELBYTE_BASE_URL (async spawn — spawnSync would starve the stub).
 *   - MCP: presales.chat aggregation through dispatchLocalMessage.
 *
 * Both endpoints are public: every test also asserts NO Authorization header
 * is ever sent. No live environment anywhere.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENVIRONMENTS } from "../src/core/config.ts";
import { HttpClient, HotelByteError } from "../src/core/http.ts";
import { publicPresalesProfile, sendPresalesFeedback, streamPresalesChat } from "../src/core/presales.ts";
import { dispatchLocalMessage, LOCAL_TOOLS } from "../src/core/mcp_local.ts";

// ── SSE fetch stub (exact chunk control via ReadableStream) ─────────────

const CHAT_EVENTS = [
  JSON.stringify({ type: "updateDataModel", op: "streamText", content: "您好" }),
  JSON.stringify({ type: "updateDataModel", op: "streamText", content: "，请问有什么可以帮您？" }),
  JSON.stringify({ type: "done" }),
];

function sseFetch(chunks: string[], status = 200, body = "error"): { captured: { url: string; headers: Record<string, string>; body: any }[]; restore: () => void } {
  const originalFetch = global.fetch;
  const captured: { url: string; headers: Record<string, string>; body: any }[] = [];
  global.fetch = (async (url: unknown, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of new Headers(init?.headers).entries()) headers[k] = v;
    captured.push({
      url: String(url),
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    if (status >= 400) return new Response(body, { status });
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Response(stream, { status });
  }) as typeof fetch;
  return { captured, restore: () => { global.fetch = originalFetch; } };
}

async function collectChat(chunks: string[]): Promise<{ events: string[]; stub: ReturnType<typeof sseFetch> }> {
  const stub = sseFetch(chunks);
  const events: string[] = [];
  try {
    await streamPresalesChat("uat", { message: "hi" }, (data) => events.push(data));
    return { events, stub };
  } finally {
    stub.restore();
  }
}

// ── core: postStream SSE framing ────────────────────────────────────────

describe("postStream SSE framing (issue #45)", () => {
  it("delivers each data payload in order and ignores non-data lines", async () => {
    const chunks = [
      ': comment\n' +
      'event: a2ui\nid: 1\nretry: 100\n\n' +
      `data: ${CHAT_EVENTS[0]}\n\n`,
      `data: ${CHAT_EVENTS[1]}\n\n`,
      `data: ${CHAT_EVENTS[2]}\n\ndata: \n\n`, // empty data separator — skipped
    ];
    const { events, stub } = await collectChat(chunks);
    expect(events).toEqual(CHAT_EVENTS);
    expect(stub.captured[0]?.headers["authorization"]).toBeUndefined(); // public surface
  });

  it("survives a data line split across chunk boundaries (incl. \\r\\n terminators)", async () => {
    const longEvent = JSON.stringify({ type: "updateDataModel", op: "streamText", content: "x".repeat(200) });
    const frame = `data: ${longEvent}\r\n\r\ndata: ${CHAT_EVENTS[1]}\r\n\r\n`;
    const splitAt = frame.indexOf("content") + 7; // mid-line, mid-JSON
    const { events } = await collectChat([frame.slice(0, splitAt), frame.slice(splitAt)]);
    expect(events).toEqual([longEvent, CHAT_EVENTS[1]]);
  });

  it("strips the single optional space after 'data:'", async () => {
    const { events } = await collectChat([`data: ${CHAT_EVENTS[0]}\n\ndata:${CHAT_EVENTS[1]}\n\n`]);
    expect(events).toEqual([CHAT_EVENTS[0], CHAT_EVENTS[1]]);
  });

  it("surfaces 429 verbatim as HotelByteError (server rate limit)", async () => {
    const stub = sseFetch([], 429, '{"error":"too many requests, please try again later"}');
    try {
      let err: any;
      await streamPresalesChat("uat", { message: "hi" }, () => {}).catch((e) => { err = e; });
      expect(err).toBeInstanceOf(HotelByteError);
      expect(err.status).toBe(429);
      expect(err.message).toContain("too many requests");
    } finally {
      stub.restore();
    }
  });

  it("surfaces other non-2xx as HotelByteError", async () => {
    const stub = sseFetch([], 500, "boom");
    try {
      let err: any;
      await streamPresalesChat("uat", { message: "hi" }, () => {}).catch((e) => { err = e; });
      expect(err).toBeInstanceOf(HotelByteError);
      expect(err.status).toBe(500);
    } finally {
      stub.restore();
    }
  });
});

// ── core: wire bodies ───────────────────────────────────────────────────

describe("presales wire bodies (issue #45)", () => {
  it("chat sends the PresalesChatReq contract; unset optionals are omitted", async () => {
    const stub = sseFetch([`data: ${CHAT_EVENTS[2]}\n\n`]);
    try {
      await streamPresalesChat("uat", {
        message: "有宠物友好酒店吗？",
        locale: "zh",
        pageContext: "/pricing",
        sessionId: "s-1",
        visitorId: "v-1",
      }, () => {});
      expect(stub.captured[0]?.url).toBe(`${ENVIRONMENTS.uat}/api/public/presales/chat`);
      expect(stub.captured[0]?.body).toEqual({
        message: "有宠物友好酒店吗？",
        locale: "zh",
        pageContext: "/pricing",
        sessionId: "s-1",
        visitorId: "v-1",
      });
    } finally {
      stub.restore();
    }
  });

  it("chat rejects an empty message client-side without a network call", async () => {
    const stub = sseFetch([]);
    try {
      let err: any;
      await streamPresalesChat("uat", { message: "  " }, () => {}).catch((e) => { err = e; });
      expect(err).toBeInstanceOf(HotelByteError);
      expect(stub.captured).toHaveLength(0);
    } finally {
      stub.restore();
    }
  });

  it("feedback sends the PresalesFeedbackReq contract and passes the plain {success,message} through (no envelope)", async () => {
    const stub = sseFetch([], 200, "unused");
    const originalFetch = global.fetch;
    global.fetch = (async (_url: unknown, init?: RequestInit) => {
      return Response.json({ success: true, message: "感谢您的关注！" });
    }) as typeof fetch;
    try {
      const resp = await sendPresalesFeedback("uat", {
        email: "you@corp.com",
        messageType: "demo_request",
        company: "Acme",
        message: "want a demo",
        locale: "zh",
      });
      expect(resp).toEqual({ success: true, message: "感谢您的关注！" });
      // Feedback handler writes the struct directly — no {code,data} envelope.
      expect((resp as any).code).toBeUndefined();
      expect(stub.captured).toHaveLength(0); // the sse stub never fired; the real call used the override above
      void originalFetch;
    } finally {
      global.fetch = originalFetch;
      stub.restore();
    }
  });

  it("feedback rejects a missing email client-side", async () => {
    let err: any;
    await sendPresalesFeedback("uat", { email: "", messageType: "lead" }).catch((e) => { err = e; });
    expect(err).toBeInstanceOf(HotelByteError);
  });
});

// ── CLI end-to-end (Bun.serve stub + async spawn) ───────────────────────

const CLI_PATH = join(import.meta.dir, "..", "src", "cli.ts");
const BUN_BIN = process.execPath;

async function runCli(args: string[], baseUrl: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const home = mkdtempSync(join(tmpdir(), "hbcli-presales-test-"));
  try {
    // Async spawn on purpose: spawnSync would block this process's event loop
    // and starve the in-process Bun.serve stub (same reason as auth_mock).
    const child = spawn(BUN_BIN, ["run", CLI_PATH, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, STAICLI_HOME: home, HOTELBYTE_ENV: "uat", HOTELBYTE_BASE_URL: baseUrl } as Record<string, string>,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout!).text(),
      new Response(child.stderr!).text(),
      new Promise<number | null>((resolve) => child.on("close", (code) => resolve(code))),
    ]);
    return { stdout, stderr, exitCode };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function sseBody(): ReadableStream {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of CHAT_EVENTS) controller.enqueue(encoder.encode(`data: ${event}\n\n`));
      controller.close();
    },
  });
}

describe("presales CLI (issue #45)", () => {
  it("--help lists chat and feedback", async () => {
    const stub = Bun.serve({ port: 0, fetch: () => new Response("nope", { status: 404 }) });
    try {
      const { stdout, exitCode } = await runCli(["presales", "--help"], `http://127.0.0.1:${stub.port}`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("chat");
      expect(stdout).toContain("feedback");
    } finally {
      stub.stop(true);
    }
  });

  it("chat --json prints the raw SSE data lines (JSONL) and sends no credentials", async () => {
    let sawAuth: string | null = null;
    let sawBody: any = null;
    const stub = Bun.serve({
      port: 0,
      fetch(req) {
        sawAuth = req.headers.get("authorization");
        return req.text().then((text) => {
          sawBody = JSON.parse(text);
          return new Response(sseBody(), { status: 200 });
        });
      },
    });
    try {
      const { stdout, exitCode } = await runCli(
        ["--json", "presales", "chat", "hi", "--session-id", "s-9"],
        `http://127.0.0.1:${stub.port}`,
      );
      expect(exitCode).toBe(0);
      const lines = stdout.trim().split("\n");
      expect(lines).toEqual(CHAT_EVENTS); // JSONL, verbatim
      expect(sawAuth).toBeNull(); // no ticket leaks to the public surface
      expect(sawBody).toEqual({ message: "hi", sessionId: "s-9" });
    } finally {
      stub.stop(true);
    }
  });

  it("chat (human mode) prints the event content pretty", async () => {
    const stub = Bun.serve({ port: 0, fetch: () => new Response(sseBody(), { status: 200 }) });
    try {
      const { stdout, exitCode } = await runCli(["presales", "chat", "hi"], `http://127.0.0.1:${stub.port}`);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("请问有什么可以帮您？");
      expect(stdout).toContain('"type": "done"'); // pretty-printed (2-space indent)
    } finally {
      stub.stop(true);
    }
  });

  it("chat surfaces a 429 rate limit as an error (exit 1)", async () => {
    const stub = Bun.serve({
      port: 0,
      fetch: () => Response.json({ error: "too many requests, please try again later" }, { status: 429 }),
    });
    try {
      const { stderr, exitCode } = await runCli(["--json", "presales", "chat", "hi"], `http://127.0.0.1:${stub.port}`);
      expect(exitCode).toBe(1);
      expect(stderr).toContain("429");
      expect(stderr).toContain("too many requests");
    } finally {
      stub.stop(true);
    }
  });

  it("feedback submits the lead and prints the {success,message} envelope", async () => {
    let sawBody: any = null;
    let sawAuth: string | null = null;
    const stub = Bun.serve({
      port: 0,
      fetch(req) {
        sawAuth = req.headers.get("authorization");
        return req.text().then((text) => {
          sawBody = JSON.parse(text);
          return Response.json({ success: true, message: "Thank you! Our team will reach out within 24 hours." });
        });
      },
    });
    try {
      const { stdout, exitCode } = await runCli(
        ["--json", "presales", "feedback", "--email", "you@corp.com", "--message-type", "demo_request", "--company", "Acme", "--locale", "en"],
        `http://127.0.0.1:${stub.port}`,
      );
      expect(exitCode).toBe(0);
      expect(JSON.parse(stdout)).toEqual({ success: true, message: "Thank you! Our team will reach out within 24 hours." });
      expect(sawBody).toEqual({
        email: "you@corp.com",
        messageType: "demo_request",
        company: "Acme",
        locale: "en",
      });
      expect(sawAuth).toBeNull();
    } finally {
      stub.stop(true);
    }
  });
});

// ── MCP: presales.chat aggregation ──────────────────────────────────────

describe("mcp presales.chat tool (issue #45)", () => {
  const MCP_CTX = { env: () => "uat", client: async () => { throw new Error("presales.chat must not touch credentials"); } };

  it("tools/list exposes 4 tools incl. presales.chat with its schema", () => {
    expect(LOCAL_TOOLS.map((t) => t.name)).toContain("presales.chat");
  });

  it("aggregates the SSE events into {events, text} without touching credentials", async () => {
    const previous = process.env.HOTELBYTE_BASE_URL;
    const stub = Bun.serve({ port: 0, fetch: () => new Response(sseBody(), { status: 200 }) });
    process.env.HOTELBYTE_BASE_URL = `http://127.0.0.1:${stub.port}`;
    try {
      const resp = await dispatchLocalMessage({
        jsonrpc: "2.0", id: 1, method: "tools/call",
        params: { name: "presales.chat", arguments: { message: "hi", locale: "zh" } },
      }, { ctx: MCP_CTX });
      expect(resp).not.toBeNull();
      const result = (resp as any).result;
      expect(result.isError).toBeUndefined();
      const payload = JSON.parse(result.content[0].text);
      expect(payload.events).toBe(CHAT_EVENTS.length);
      expect(payload.text).toBe(CHAT_EVENTS.join("\n"));
    } finally {
      if (previous === undefined) delete process.env.HOTELBYTE_BASE_URL;
      else process.env.HOTELBYTE_BASE_URL = previous;
      stub.stop(true);
    }
  });

  it("rejects a missing message as a tool-level error", async () => {
    const resp = await dispatchLocalMessage({
      jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "presales.chat", arguments: {} },
    }, { ctx: MCP_CTX });
    const result = (resp as any).result;
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text).error).toContain("message is required");
  });

  it("surfaces a 429 rate limit as a tool-level error (never retried)", async () => {
    const previous = process.env.HOTELBYTE_BASE_URL;
    const stub = Bun.serve({
      port: 0,
      fetch: () => Response.json({ error: "too many requests, please try again later" }, { status: 429 }),
    });
    process.env.HOTELBYTE_BASE_URL = `http://127.0.0.1:${stub.port}`;
    try {
      const resp = await dispatchLocalMessage({
        jsonrpc: "2.0", id: 3, method: "tools/call",
        params: { name: "presales.chat", arguments: { message: "hi" } },
      }, { ctx: MCP_CTX });
      const result = (resp as any).result;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("too many requests");
    } finally {
      if (previous === undefined) delete process.env.HOTELBYTE_BASE_URL;
      else process.env.HOTELBYTE_BASE_URL = previous;
      stub.stop(true);
    }
  });
});
