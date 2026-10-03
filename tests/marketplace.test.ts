/**
 * tests/marketplace.test.ts — marketplace command group (in-process, fetch-stubbed).
 *
 * Imports createMarketplaceCommand, registers it into a test-built commander
 * program, and asserts the command tree, request paths/bodies via a stubbed
 * global.fetch (tests/auth.test.ts pattern; scalar-param methods bind the
 * {buyerEntityId}/{sellerEntityId}/{entityId,role} body keys per the
 * dispatcher's AST param-name fallback), the approvals-process write guard
 * (refuses without --confirm, never reaches the network), and STAICLI_HOME
 * isolation. No live environment.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createMarketplaceCommand } from "../src/commands/marketplace.ts";
import type { Ctx } from "../src/commands/helpers.ts";

const TMP_HOME = join(import.meta.dir, ".tmp-marketplace-test-home");

beforeEach(() => {
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
  mkdirSync(TMP_HOME, { recursive: true });
  process.env.STAICLI_HOME = TMP_HOME;
  writeFileSync(join(TMP_HOME, "credentials.json"), JSON.stringify({ "openapi:uat": { ticket: "stub-ticket" } }));
});

afterEach(() => {
  delete process.env.STAICLI_HOME;
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
});

interface CapturedCall {
  url: string;
  path: string;
  body: Record<string, unknown>;
}

function stubFetch(data: unknown = { ok: true }): { captured: CapturedCall[]; restore: () => void } {
  const originalFetch = global.fetch;
  const captured: CapturedCall[] = [];
  global.fetch = (async (url: unknown, init?: RequestInit) => {
    const parsed = new URL(String(url));
    captured.push({
      url: String(url),
      path: parsed.pathname,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ code: 0, msg: "ok", data }), { status: 200 });
  }) as typeof fetch;
  return { captured, restore: () => { global.fetch = originalFetch; } };
}

const ctx: Ctx = { jsonMode: () => true, env: () => "uat" };

function buildProgram(): Command {
  const program = new Command();
  program.addCommand(createMarketplaceCommand(ctx));
  return program;
}

class GuardExit extends Error {}

function stubExit(): { restore: () => void } {
  const origExit = process.exit;
  const origErr = console.error;
  console.error = () => {};
  process.exit = ((_code?: number) => { throw new GuardExit("exit"); }) as typeof process.exit;
  return { restore: () => { process.exit = origExit; console.error = origErr; } };
}

async function runProgram(argv: string[]): Promise<void> {
  await buildProgram().parseAsync(argv, { from: "user" });
}

function sub(parent: Command, name: string): Command {
  const cmd = parent.commands.find((c) => c.name() === name);
  expect(cmd).toBeDefined();
  return cmd!;
}

// ── command tree ────────────────────────────────────────────────────────

describe("marketplace command tree", () => {
  it("exposes links/approvals/applications groups with the full subcommand set", () => {
    const marketplace = sub(buildProgram(), "marketplace");
    expect(marketplace.commands.map((c) => c.name()).sort()).toEqual(["applications", "approvals", "links"]);
    expect(sub(marketplace, "links").commands.map((c) => c.name()).sort()).toEqual(["by-buyer", "by-seller"]);
    expect(sub(marketplace, "approvals").commands.map((c) => c.name()).sort()).toEqual(["pending", "process"]);
    expect(sub(marketplace, "applications").commands.map((c) => c.name()).sort()).toEqual(["by-entity", "list"]);
  });

  it("carries --confirm exactly on approvals process", () => {
    const marketplace = sub(buildProgram(), "marketplace");
    const find = (group: string, name: string): Command => sub(sub(marketplace, group), name);
    expect(find("approvals", "process").options.some((o) => o.long === "--confirm")).toBe(true);
    for (const [group, name] of [
      ["links", "by-buyer"], ["links", "by-seller"], ["approvals", "pending"],
      ["applications", "list"], ["applications", "by-entity"],
    ] as const) {
      expect(find(group, name).options.some((o) => o.long === "--confirm")).toBe(false);
    }
  });
});

// ── links ───────────────────────────────────────────────────────────────

describe("marketplace links", () => {
  it("by-buyer posts {buyerEntityId} to listEntityEntityLinksByBuyer", async () => {
    const m = stubFetch([{ id: 1, buyerEntityId: 11, sellerEntityId: 22, status: "connected" }]);
    try {
      await runProgram(["marketplace", "links", "by-buyer", "--buyer-entity-id", "11"]);
      expect(m.captured).toHaveLength(1);
      expect(m.captured[0]!.path).toBe("/api/user/tenant/listEntityEntityLinksByBuyer");
      expect(m.captured[0]!.body).toEqual({ buyerEntityId: "11" });
    } finally { m.restore(); }
  });

  it("by-seller posts {sellerEntityId} to listEntityEntityLinksBySeller", async () => {
    const m = stubFetch([]);
    try {
      await runProgram(["marketplace", "links", "by-seller", "--seller-entity-id", "22"]);
      expect(m.captured[0]!.path).toBe("/api/user/tenant/listEntityEntityLinksBySeller");
      expect(m.captured[0]!.body).toEqual({ sellerEntityId: "22" });
    } finally { m.restore(); }
  });
});

// ── approvals ───────────────────────────────────────────────────────────

describe("marketplace approvals", () => {
  it("pending narrows to an approver entity and pages", async () => {
    const m = stubFetch({ rows: [], total: 0 });
    try {
      await runProgram(["marketplace", "approvals", "pending", "--approver-entity-id", "22", "--page-num", "2", "--page-size", "50"]);
      expect(m.captured[0]!.path).toBe("/api/user/tenant/getPendingApprovals");
      expect(m.captured[0]!.body).toEqual({
        page: { pageNum: 2, pageSize: 50 },
        approverEntityId: "22",
      });

      await runProgram(["marketplace", "approvals", "pending"]);
      expect(m.captured[1]!.body).toEqual({ page: { pageNum: 1, pageSize: 20 } });
    } finally { m.restore(); }
  });

  it("process is guarded: refused without --confirm, posts the ProcessApprovalReq contract with --confirm", async () => {
    const m = stubFetch({ id: 5, status: 3 });
    const e = stubExit();
    try {
      await expect(runProgram(["marketplace", "approvals", "process", "--application-id", "5", "--approver-entity-id", "22", "--action", "approve"])).rejects.toThrow(GuardExit);
      expect(m.captured).toHaveLength(0);

      await runProgram(["marketplace", "approvals", "process", "--application-id", "5", "--approver-entity-id", "22", "--action", "approve", "--comment", "welcome aboard", "--confirm"]);
      expect(m.captured[0]!.path).toBe("/api/user/tenant/processApproval");
      expect(m.captured[0]!.body).toEqual({
        applicationId: "5",
        approverEntityId: "22",
        action: "approve",
        comment: "welcome aboard",
      });
    } finally { e.restore(); m.restore(); }
  });

  it("process rejects an invalid --action client-side (commander choices)", async () => {
    const m = stubFetch();
    const e = stubExit();
    try {
      await expect(runProgram(["marketplace", "approvals", "process", "--application-id", "5", "--approver-entity-id", "22", "--action", "maybe", "--confirm"])).rejects.toThrow();
      expect(m.captured).toHaveLength(0);
    } finally { e.restore(); m.restore(); }
  });
});

// ── applications ────────────────────────────────────────────────────────

describe("marketplace applications", () => {
  it("list maps --type/--status to applicationType/numeric status", async () => {
    const m = stubFetch({ rows: [], total: 0 });
    try {
      await runProgram(["marketplace", "applications", "list", "--buyer-entity-id", "11", "--seller-entity-id", "22", "--type", "connection", "--status", "3", "--page-size", "50"]);
      expect(m.captured[0]!.path).toBe("/api/user/tenant/listConnectionApplications");
      expect(m.captured[0]!.body).toEqual({
        page: { pageNum: 1, pageSize: 50 },
        buyerEntityId: "11",
        sellerEntityId: "22",
        applicationType: "connection",
        status: 3,
      });

      await runProgram(["marketplace", "applications", "list"]);
      expect(m.captured[1]!.body).toEqual({ page: { pageNum: 1, pageSize: 20 } });
    } finally { m.restore(); }
  });

  it("by-entity posts {entityId, role} and omits role when unset", async () => {
    const m = stubFetch([]);
    try {
      await runProgram(["marketplace", "applications", "by-entity", "--entity-id", "11", "--role", "seller"]);
      expect(m.captured[0]!.path).toBe("/api/user/tenant/getApplicationsByEntity");
      expect(m.captured[0]!.body).toEqual({ entityId: "11", role: "seller" });

      await runProgram(["marketplace", "applications", "by-entity", "--entity-id", "11"]);
      expect(m.captured[1]!.body).toEqual({ entityId: "11" });
    } finally { m.restore(); }
  });

  it("by-entity rejects an invalid --role client-side (commander choices)", async () => {
    const m = stubFetch();
    const e = stubExit();
    try {
      await expect(runProgram(["marketplace", "applications", "by-entity", "--entity-id", "11", "--role", "owner"])).rejects.toThrow();
      expect(m.captured).toHaveLength(0);
    } finally { e.restore(); m.restore(); }
  });
});
