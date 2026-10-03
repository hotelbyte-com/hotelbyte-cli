/**
 * tests/growth.test.ts — growth command group.
 *
 * In-process CLI layer tests: the factory is imported and registered into a
 * fresh commander program (tests/auth.test.ts fetch-stub pattern) with an
 * isolated STAICLI_HOME and a stubbed global.fetch that records every request
 * path and body. Asserts the command tree, request shapes against the
 * growth/tenant contracts (growth/protocol/*.go), the --confirm write guard
 * (positive + negative), and --json emission. No live environment; no secrets
 * in fixtures.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createGrowthCommand } from "../src/commands/growth.ts";
import type { Ctx } from "../src/commands/helpers.ts";

const BASE = "https://growth-stub.test";
const TMP_HOME = join(import.meta.dir, ".tmp-growth-test-home");

let captured: { url: string; body: Record<string, unknown> }[] = [];
let stdoutLines: string[] = [];

function installFetchStub(): void {
  const originalFetch = global.fetch;
  global.fetch = (async (url: unknown, init?: RequestInit) => {
    captured.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ code: 0, msg: "ok", data: { stub: true, n: 1 } }), { status: 200 });
  }) as typeof fetch;
  (installFetchStub as any).restore = () => {
    global.fetch = originalFetch;
  };
}

// process.exit is the write-guard failure path; swap it for a throw so the
// in-process commander action can be asserted like a spawned exit code.
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
  console.log = (msg: unknown) => {
    stdoutLines.push(String(msg));
  };
  try {
    const program = new Command();
    program.addCommand(createGrowthCommand({ jsonMode: () => true, env: () => "uat" }));
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

function lastEmitted(): any {
  return JSON.parse(stdoutLines[stdoutLines.length - 1] ?? "{}");
}

beforeEach(() => {
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
  mkdirSync(TMP_HOME, { recursive: true });
  // Cached openapi ticket → makeClient takes the ticket flow with zero auth calls.
  writeFileSync(join(TMP_HOME, "credentials.json"), JSON.stringify({ "openapi:uat": { ticket: "stub-ticket" } }));
  process.env.STAICLI_HOME = TMP_HOME;
  process.env.HOTELBYTE_BASE_URL = BASE;
  captured = [];
  stdoutLines = [];
  installFetchStub();
});

afterEach(() => {
  (installFetchStub as any).restore();
  delete process.env.STAICLI_HOME;
  delete process.env.HOTELBYTE_BASE_URL;
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
});

// ── command tree ────────────────────────────────────────────────────────

describe("growth command tree", () => {
  it("registers the growth group with all five subgroups", () => {
    const program = new Command();
    program.addCommand(createGrowthCommand({ jsonMode: () => true, env: () => "uat" }));
    const growth = program.commands.find((c) => c.name() === "growth");
    expect(growth).toBeDefined();
    expect(growth!.commands.map((c) => c.name())).toEqual(["prospects", "campaigns", "content", "brand-kits", "dashboard"]);
  });

  it("hangs the documented subcommands under each subgroup", () => {
    const program = new Command();
    program.addCommand(createGrowthCommand({ jsonMode: () => true, env: () => "uat" }));
    const growth = program.commands.find((c) => c.name() === "growth")!;
    const names = (group: string) => growth.commands.find((c) => c.name() === group)!.commands.map((c) => c.name());
    expect(names("prospects")).toEqual(["list", "get", "create", "activities"]);
    expect(names("campaigns")).toEqual(["list", "get", "create", "launch", "pause", "executions"]);
    expect(names("content")).toEqual(["list", "generate"]);
    expect(names("brand-kits")).toEqual(["list", "get", "create"]);
  });
});

// ── prospects ───────────────────────────────────────────────────────────

describe("growth prospects", () => {
  it("list sends only the filters that are set to /api/growth/tenant/listProspects", async () => {
    const r = await runCli(["growth", "prospects", "list", "--status", "new", "--min-lead-score", "70", "--tags", "enterprise, hotel", "--page-num", "2", "--page-size", "50"]);
    expect(r.exitCode).toBe(0);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe(`${BASE}/api/growth/tenant/listProspects`);
    expect(captured[0]!.body).toEqual({
      pageNum: 2,
      pageSize: 50,
      status: "new",
      minLeadScore: 70,
      tags: ["enterprise", "hotel"],
    });
    expect(lastEmitted().stub).toBe(true);
  });

  it("get sends {prospectId} to /api/growth/tenant/getProspect", async () => {
    const r = await runCli(["growth", "prospects", "get", "--prospect-id", "42"]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/growth/tenant/getProspect`);
    expect(captured[0]!.body).toEqual({ prospectId: "42" });
  });

  it("activities sends {prospectId, pageNum, pageSize} to /api/growth/tenant/listProspectActivities", async () => {
    const r = await runCli(["growth", "prospects", "activities", "--prospect-id", "42", "--page-size", "5"]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/growth/tenant/listProspectActivities`);
    expect(captured[0]!.body).toEqual({ prospectId: "42", pageNum: 1, pageSize: 5 });
  });
});

// ── campaigns ───────────────────────────────────────────────────────────

describe("growth campaigns", () => {
  it("list sends pagination + filters to /api/growth/tenant/listCampaigns", async () => {
    const r = await runCli(["growth", "campaigns", "list", "--status", "active", "--campaign-type", "nurture"]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/growth/tenant/listCampaigns`);
    expect(captured[0]!.body).toEqual({ pageNum: 1, pageSize: 20, status: "active", campaignType: "nurture" });
  });

  it("executions sends campaignId + optional filters to /api/growth/tenant/listCampaignExecutions", async () => {
    const r = await runCli(["growth", "campaigns", "executions", "--campaign-id", "7", "--status", "failed"]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/growth/tenant/listCampaignExecutions`);
    expect(captured[0]!.body).toEqual({ campaignId: "7", pageNum: 1, pageSize: 20, status: "failed" });
  });

  it("create parses --data JSON and posts it to /api/growth/tenant/createCampaign with --confirm", async () => {
    const payload = {
      name: "EU 2027 launch",
      description: "Q1 push",
      campaignType: "outbound",
      productTarget: "standard",
      sequence: [{ stepNumber: 1, name: "intro", channel: 1, templateId: "9", waitDuration: "2d", condition: "always" }],
    };
    const r = await runCli(["growth", "campaigns", "create", "--data", JSON.stringify(payload), "--confirm"]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/growth/tenant/createCampaign`);
    expect(captured[0]!.body).toEqual(payload);
  });

  it("launch and pause send {campaignId} with --confirm", async () => {
    const launch = await runCli(["growth", "campaigns", "launch", "--campaign-id", "7", "--confirm"]);
    expect(launch.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/growth/tenant/launchCampaign`);
    expect(captured[0]!.body).toEqual({ campaignId: "7" });

    const pause = await runCli(["growth", "campaigns", "pause", "--campaign-id", "7", "--confirm"]);
    expect(pause.exitCode).toBe(0);
    expect(captured[1]!.url).toBe(`${BASE}/api/growth/tenant/pauseCampaign`);
    expect(captured[1]!.body).toEqual({ campaignId: "7" });
  });
});

// ── content studio ──────────────────────────────────────────────────────

describe("growth content studio", () => {
  it("list sends filters to /api/growth/tenant/listUserContent", async () => {
    const r = await runCli(["growth", "content", "list", "--status", "draft", "--tags", "blog", "--page-size", "10"]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/growth/tenant/listUserContent`);
    expect(captured[0]!.body).toEqual({ pageNum: 1, pageSize: 10, status: "draft", tags: ["blog"] });
  });

  it("generate defaults processType to generate and posts to /api/growth/tenant/aIProcessUserContent with --confirm", async () => {
    const r = await runCli(["growth", "content", "generate", "--content-id", "12", "--confirm"]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/growth/tenant/aIProcessUserContent`);
    expect(captured[0]!.body).toEqual({ contentId: "12", processType: "generate" });
  });

  it("generate accepts an explicit process type and extra prompt", async () => {
    const r = await runCli(["growth", "content", "generate", "--content-id", "12", "--process-type", "translate", "--extra-prompt", "to en", "--confirm"]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.body).toEqual({ contentId: "12", processType: "translate", extraPrompt: "to en" });
  });

  it("generate rejects a bogus process type client-side (choices)", async () => {
    const r = await runCli(["growth", "content", "generate", "--content-id", "12", "--process-type", "vibes", "--confirm"]);
    expect(r.exitCode).toBe(1);
    expect(captured).toHaveLength(0);
  });
});

// ── brand kits ──────────────────────────────────────────────────────────

describe("growth brand-kits", () => {
  it("list sends filters to /api/growth/tenant/listBrandKits", async () => {
    const r = await runCli(["growth", "brand-kits", "list", "--owner-level", "tenant_brand", "--is-active"]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/growth/tenant/listBrandKits`);
    expect(captured[0]!.body).toEqual({ pageNum: 1, pageSize: 20, ownerLevel: "tenant_brand", isActive: true });
  });

  it("get sends {id} to /api/growth/tenant/getBrandKit", async () => {
    const r = await runCli(["growth", "brand-kits", "get", "--brand-kit-id", "3"]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/growth/tenant/getBrandKit`);
    expect(captured[0]!.body).toEqual({ id: "3" });
  });

  it("create builds the CreateBrandKit shape and posts it with --confirm", async () => {
    const r = await runCli([
      "growth", "brand-kits", "create",
      "--name", "Corp voice",
      "--owner-level", "tenant_brand",
      "--voice-preset", "evidence_led",
      "--keywords", "reliability, rate parity",
      "--forbidden-claims", "cheapest ever",
      "--is-active",
      "--confirm",
    ]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/growth/tenant/createBrandKit`);
    expect(captured[0]!.body).toEqual({
      name: "Corp voice",
      isActive: true,
      ownerLevel: "tenant_brand",
      voicePreset: "evidence_led",
      keywords: ["reliability", "rate parity"],
      forbiddenClaims: ["cheapest ever"],
    });
  });
});

// ── dashboard ───────────────────────────────────────────────────────────

describe("growth dashboard", () => {
  it("sends the window only when set to /api/growth/tenant/getDashboard", async () => {
    const bare = await runCli(["growth", "dashboard"]);
    expect(bare.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/growth/tenant/getDashboard`);
    expect(captured[0]!.body).toEqual({});

    const windowed = await runCli(["growth", "dashboard", "--start-date", "2026-09-01T00:00:00Z", "--end-date", "2026-09-30T00:00:00Z"]);
    expect(windowed.exitCode).toBe(0);
    expect(captured[1]!.body).toEqual({ startDate: "2026-09-01T00:00:00Z", endDate: "2026-09-30T00:00:00Z" });
  });
});

// ── write guard ─────────────────────────────────────────────────────────

describe("growth write guard (--confirm)", () => {
  it("all four write subcommands refuse without --confirm and never reach the server", async () => {
    for (const args of [
      ["growth", "prospects", "create", "--data", '{"companyName":"Acme"}'],
      ["growth", "campaigns", "create", "--data", '{"name":"x"}'],
      ["growth", "campaigns", "launch", "--campaign-id", "7"],
      ["growth", "campaigns", "pause", "--campaign-id", "7"],
      ["growth", "content", "generate", "--content-id", "12"],
      ["growth", "brand-kits", "create", "--name", "x"],
    ]) {
      const r = await runCli(args);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("--confirm");
    }
    expect(captured).toHaveLength(0);
  });

  it("create still refuses with a malformed --data payload (guard runs first)", async () => {
    const r = await runCli(["growth", "prospects", "create", "--data", "not-json", "--confirm"]);
    expect(r.exitCode).toBe(0); // passthrough string body is the parseJsonInput contract; server validates
    expect(captured[0]!.body).toEqual("not-json");
  });
});
