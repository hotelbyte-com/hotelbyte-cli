/**
 * tests/storefront.test.ts — storefront command group.
 *
 * In-process CLI layer tests: the factory is imported and registered into a
 * fresh commander program (tests/auth.test.ts fetch-stub pattern) with an
 * isolated STAICLI_HOME and a stubbed global.fetch that records every request
 * path and body. Asserts the command tree, request shapes against the content
 * contracts (content/protocol/{news,community,tour_product,learning}.go —
 * including the nested `page:{}` on news/tours and numeric tourId/status),
 * the --confirm write guard (positive + negative), and client-side choices
 * rejection. No live environment; no secrets in fixtures.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createStorefrontCommand } from "../src/commands/storefront.ts";
import type { Ctx } from "../src/commands/helpers.ts";

const BASE = "https://storefront-stub.test";
const TMP_HOME = join(import.meta.dir, ".tmp-storefront-test-home");

let captured: { url: string; body: Record<string, unknown> }[] = [];

function installFetchStub(): void {
  const originalFetch = global.fetch;
  global.fetch = (async (url: unknown, init?: RequestInit) => {
    captured.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ code: 0, msg: "ok", data: { stub: true } }), { status: 200 });
  }) as typeof fetch;
  (installFetchStub as any).restore = () => {
    global.fetch = originalFetch;
  };
}

async function runCli(args: string[]): Promise<{ exitCode: number | null; stderr: string }> {
  const originalExit = process.exit;
  const originalError = console.error;
  const originalLog = console.log;
  let exitCode: number | null = null;
  let stderr = "";
  (process as any).exit = (code?: number) => {
    exitCode = code ?? 0;
    throw new Error(`__exit__${exitCode}`);
  };
  console.error = (msg: unknown) => {
    stderr += String(msg) + "\n";
  };
  console.log = () => {}; // swallow emit() noise
  try {
    const program = new Command();
    program.addCommand(createStorefrontCommand({ jsonMode: () => true, env: () => "uat" }));
    await program.parseAsync(args, { from: "user" });
    return { exitCode: exitCode === null ? 0 : exitCode, stderr };
  } catch (e: any) {
    if (typeof e?.message === "string" && e.message.startsWith("__exit__")) {
      return { exitCode: Number(e.message.slice("__exit__".length)), stderr };
    }
    // commander (Option.choices etc.) rejects parseAsync with a CommanderError
    // that carries its own exit code — surface it like a spawned process exit.
    if (typeof e?.exitCode === "number") {
      return { exitCode: e.exitCode, stderr: stderr + `${e.message}\n` };
    }
    throw e;
  } finally {
    (process as any).exit = originalExit;
    console.error = originalError;
    console.log = originalLog;
  }
}

beforeEach(() => {
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
  mkdirSync(TMP_HOME, { recursive: true });
  // Cached openapi ticket → makeClient takes the ticket flow with zero auth calls.
  writeFileSync(join(TMP_HOME, "credentials.json"), JSON.stringify({ "openapi:uat": { ticket: "stub-ticket" } }));
  process.env.STAICLI_HOME = TMP_HOME;
  process.env.HOTELBYTE_BASE_URL = BASE;
  captured = [];
  installFetchStub();
});

afterEach(() => {
  (installFetchStub as any).restore();
  delete process.env.STAICLI_HOME;
  delete process.env.HOTELBYTE_BASE_URL;
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
});

// ── command tree ────────────────────────────────────────────────────────

describe("storefront command tree", () => {
  it("registers the storefront group with the four subgroups", () => {
    const program = new Command();
    program.addCommand(createStorefrontCommand({ jsonMode: () => true, env: () => "uat" }));
    const storefront = program.commands.find((c) => c.name() === "storefront");
    expect(storefront).toBeDefined();
    expect(storefront!.commands.map((c) => c.name())).toEqual(["news", "community", "tours", "learning"]);
  });

  it("hangs the documented subcommands under each subgroup", () => {
    const program = new Command();
    program.addCommand(createStorefrontCommand({ jsonMode: () => true, env: () => "uat" }));
    const storefront = program.commands.find((c) => c.name() === "storefront")!;
    const names = (group: string) => storefront.commands.find((c) => c.name() === group)!.commands.map((c) => c.name());
    expect(names("news")).toEqual(["list", "create"]);
    expect(names("community")).toEqual(["queue", "approve", "reject"]);
    expect(names("tours")).toEqual(["list", "get", "create", "publish"]);
    // learning → lessons → list/get
    const learning = storefront.commands.find((c) => c.name() === "learning")!;
    expect(learning.commands.map((c) => c.name())).toEqual(["lessons"]);
    expect(learning.commands[0]!.commands.map((c) => c.name())).toEqual(["list", "get"]);
  });
});

// ── news ────────────────────────────────────────────────────────────────

describe("storefront news", () => {
  it("list sends nested page + numeric status to /api/content/newsOps/listArticles", async () => {
    const r = await runCli(["storefront", "news", "list", "--status", "2", "--page-num", "2", "--page-size", "50"]);
    expect(r.exitCode).toBe(0);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe(`${BASE}/api/content/newsOps/listArticles`);
    expect(captured[0]!.body).toEqual({ page: { pageNum: 2, pageSize: 50 }, status: 2 });
  });

  it("create posts the NewsOpsCreateArticle contract with --confirm", async () => {
    const r = await runCli([
      "storefront", "news", "create",
      "--title", "Rates drop in Bali",
      "--summary", "Q4 outlook",
      "--paragraphs", '["Para one.","Para two."]',
      "--lang", "en",
      "--confirm",
    ]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/content/newsOps/createArticle`);
    expect(captured[0]!.body).toEqual({
      title: "Rates drop in Bali",
      summary: "Q4 outlook",
      paragraphs: ["Para one.", "Para two."],
      lang: "en",
    });
  });

  it("list rejects a bogus status client-side (choices)", async () => {
    const r = await runCli(["storefront", "news", "list", "--status", "9"]);
    expect(r.exitCode).toBe(1);
    expect(captured).toHaveLength(0);
  });
});

// ── community ───────────────────────────────────────────────────────────

describe("storefront community", () => {
  it("queue defaults to the flat PageReq shape on /api/content/communityOps/moderationQueue", async () => {
    const bare = await runCli(["storefront", "community", "queue"]);
    expect(bare.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/content/communityOps/moderationQueue`);
    expect(captured[0]!.body).toEqual({ pageNum: 1, pageSize: 20 });

    const filtered = await runCli(["storefront", "community", "queue", "--status", "hidden", "--page-size", "5"]);
    expect(filtered.exitCode).toBe(0);
    expect(captured[1]!.body).toEqual({ pageNum: 1, pageSize: 5, status: "hidden" });
  });

  it("approve and reject send {postId} with --confirm", async () => {
    const approve = await runCli(["storefront", "community", "approve", "--post-id", "501", "--confirm"]);
    expect(approve.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/content/communityOps/approvePost`);
    expect(captured[0]!.body).toEqual({ postId: "501" });

    const reject = await runCli(["storefront", "community", "reject", "--post-id", "502", "--confirm"]);
    expect(reject.exitCode).toBe(0);
    expect(captured[1]!.url).toBe(`${BASE}/api/content/communityOps/rejectPost`);
    expect(captured[1]!.body).toEqual({ postId: "502" });
  });
});

// ── tours ───────────────────────────────────────────────────────────────

describe("storefront tours", () => {
  it("list sends nested page + numeric status to /api/content/tourOps/listTours", async () => {
    const r = await runCli(["storefront", "tours", "list", "--status", "1", "--page-size", "10"]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/content/tourOps/listTours`);
    expect(captured[0]!.body).toEqual({ page: { pageNum: 1, pageSize: 10 }, status: 1 });
  });

  it("get sends numeric {tourId} to /api/content/tourOps/getTour", async () => {
    const r = await runCli(["storefront", "tours", "get", "--tour-id", "88"]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/content/tourOps/getTour`);
    expect(captured[0]!.body).toEqual({ tourId: 88 });
  });

  it("create parses --data JSON to /api/content/tourOps/createTour with --confirm", async () => {
    const payload = {
      destinationId: 3,
      title: { en: "Kyoto classics", zh: "京都经典" },
      price: { currency: "USD", amount: 120000 },
    };
    const r = await runCli(["storefront", "tours", "create", "--data", JSON.stringify(payload), "--confirm"]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/content/tourOps/createTour`);
    expect(captured[0]!.body).toEqual(payload);
  });

  it("publish sends numeric {tourId} to /api/content/tourOps/publishTour with --confirm", async () => {
    const r = await runCli(["storefront", "tours", "publish", "--tour-id", "88", "--confirm"]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/content/tourOps/publishTour`);
    expect(captured[0]!.body).toEqual({ tourId: 88 });
  });
});

// ── learning ────────────────────────────────────────────────────────────

describe("storefront learning", () => {
  it("lessons list sends filters + flat PageReq to /api/content/learning/listLessons", async () => {
    const r = await runCli(["storefront", "learning", "lessons", "list", "--keyword", "ota", "--track", "supplier-onboarding", "--page-size", "5"]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/content/learning/listLessons`);
    expect(captured[0]!.body).toEqual({ pageNum: 1, pageSize: 5, keyword: "ota", track: "supplier-onboarding" });
  });

  it("lessons get sends {id} to /api/content/learning/getLesson", async () => {
    const r = await runCli(["storefront", "learning", "lessons", "get", "--id", "12"]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/content/learning/getLesson`);
    expect(captured[0]!.body).toEqual({ id: "12" });
  });
});

// ── write guard ─────────────────────────────────────────────────────────

describe("storefront write guard (--confirm)", () => {
  it("all four write subcommands refuse without --confirm and never reach the server", async () => {
    for (const args of [
      ["storefront", "news", "create", "--title", "x"],
      ["storefront", "community", "approve", "--post-id", "1"],
      ["storefront", "community", "reject", "--post-id", "1"],
      ["storefront", "tours", "create", "--data", '{"destinationId":1}'],
      ["storefront", "tours", "publish", "--tour-id", "1"],
    ]) {
      const r = await runCli(args);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("--confirm");
    }
    expect(captured).toHaveLength(0);
  });

  it("write subcommands carry the --confirm option in the command tree", () => {
    const program = new Command();
    program.addCommand(createStorefrontCommand({ jsonMode: () => true, env: () => "uat" }));
    const storefront = program.commands.find((c) => c.name() === "storefront")!;
    const opts = (group: string, sub: string) =>
      storefront.commands.find((c) => c.name() === group)!.commands.find((c) => c.name() === sub)!.options.map((o) => o.long);
    for (const [group, sub] of [
      ["news", "create"],
      ["community", "approve"],
      ["community", "reject"],
      ["tours", "create"],
      ["tours", "publish"],
    ] as const) {
      expect(opts(group, sub)).toContain("--confirm");
    }
  });
});
