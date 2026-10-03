/**
 * tests/identity.test.ts — identity command group (in-process, fetch-stubbed).
 *
 * Imports createIdentityCommand, registers it into a test-built commander
 * program, and asserts the command tree, request paths/bodies via a stubbed
 * global.fetch (tests/auth.test.ts pattern), the write guards (roles upsert,
 * mfa setup, preferences update refuse without --confirm and never reach the
 * network), and STAICLI_HOME isolation. No live environment.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createIdentityCommand } from "../src/commands/identity.ts";
import type { Ctx } from "../src/commands/helpers.ts";

const TMP_HOME = join(import.meta.dir, ".tmp-identity-test-home");

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
  program.addCommand(createIdentityCommand(ctx));
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

describe("identity command tree", () => {
  it("exposes audit-logs/roles/mfa/preferences groups with the full subcommand set", () => {
    const identity = sub(buildProgram(), "identity");
    expect(identity.commands.map((c) => c.name()).sort()).toEqual(["audit-logs", "mfa", "preferences", "roles"]);
    expect(sub(identity, "audit-logs").commands.map((c) => c.name())).toEqual(["list"]);
    expect(sub(identity, "roles").commands.map((c) => c.name()).sort()).toEqual(["list", "upsert"]);
    expect(sub(identity, "mfa").commands.map((c) => c.name()).sort()).toEqual(["setup", "verify"]);
    expect(sub(identity, "preferences").commands.map((c) => c.name()).sort()).toEqual(["get", "update"]);
  });

  it("carries --confirm exactly on roles upsert, mfa setup, preferences update", () => {
    const identity = sub(buildProgram(), "identity");
    const find = (group: string, name: string): Command => sub(sub(identity, group), name);
    for (const [group, name] of [["roles", "upsert"], ["mfa", "setup"], ["preferences", "update"]] as const) {
      expect(find(group, name).options.some((o) => o.long === "--confirm")).toBe(true);
    }
    for (const [group, name] of [["audit-logs", "list"], ["roles", "list"], ["mfa", "verify"], ["preferences", "get"]] as const) {
      expect(find(group, name).options.some((o) => o.long === "--confirm")).toBe(false);
    }
  });
});

// ── audit-logs ──────────────────────────────────────────────────────────

describe("identity audit-logs", () => {
  it("list posts flat query fields + pageNum/pageSize (embedded AuditLogQuery/PageReq promotion)", async () => {
    const m = stubFetch({ rows: [], total: 0 });
    try {
      await runProgram([
        "identity", "audit-logs", "list",
        "--action-type", "USER_INVITE", "--actor-user-id", "7", "--affected-entity-id", "12",
        "--keyword", "role", "--include-details", "--include-statistics",
        "--sort-by", "actionTime", "--sort-order", "desc", "--page-num", "2", "--page-size", "50",
      ]);
      expect(m.captured).toHaveLength(1);
      expect(m.captured[0]!.path).toBe("/api/user/tenant/listAuditLogs");
      expect(m.captured[0]!.body).toEqual({
        pageNum: 2,
        pageSize: 50,
        actionType: "USER_INVITE",
        actorUserId: "7",
        affectedEntityId: "12",
        keyword: "role",
        includeDetails: true,
        includeStatistics: true,
        sortBy: "actionTime",
        sortOrder: "desc",
      });
    } finally { m.restore(); }
  });

  it("list defaults to page 1/20 with no filter keys", async () => {
    const m = stubFetch({ rows: [] });
    try {
      await runProgram(["identity", "audit-logs", "list"]);
      expect(m.captured[0]!.body).toEqual({ pageNum: 1, pageSize: 20 });
    } finally { m.restore(); }
  });
});

// ── roles ───────────────────────────────────────────────────────────────

describe("identity roles", () => {
  it("list posts page + entityIds scope", async () => {
    const m = stubFetch({ rows: [] });
    try {
      await runProgram(["identity", "roles", "list", "--scope", "1:*", "--page-size", "50"]);
      expect(m.captured[0]!.path).toBe("/api/user/tenant/listRole");
      expect(m.captured[0]!.body).toEqual({ page: { pageNum: 1, pageSize: 50 }, entityIds: "1:*" });
    } finally { m.restore(); }
  });

  it("upsert is guarded and posts the domain.Role contract (create and update)", async () => {
    const m = stubFetch({ ok: true });
    const e = stubExit();
    try {
      await expect(runProgram(["identity", "roles", "upsert", "--name", "ops"])).rejects.toThrow(GuardExit);
      expect(m.captured).toHaveLength(0);

      await runProgram(["identity", "roles", "upsert", "--name", "ops", "--privileges", "invite_tenant_user, manage_markups", "--scope", "1:*", "--description", "Ops team", "--confirm"]);
      expect(m.captured[0]!.path).toBe("/api/user/tenant/upsertRole");
      expect(m.captured[0]!.body).toEqual({
        name: "ops",
        privileges: ["invite_tenant_user", "manage_markups"],
        scope: "1:*",
        description: "Ops team",
      });

      await runProgram(["identity", "roles", "upsert", "--id", "33", "--name", "ops-v2", "--confirm"]);
      expect(m.captured[1]!.body).toEqual({ id: 33, name: "ops-v2" });
    } finally { e.restore(); m.restore(); }
  });
});

// ── mfa ─────────────────────────────────────────────────────────────────

describe("identity mfa", () => {
  it("setup is guarded (rotates state) and posts provider/force", async () => {
    const m = stubFetch({ provider: "totp", secret: "S", qrCodeDataUri: "data:" });
    const e = stubExit();
    try {
      await expect(runProgram(["identity", "mfa", "setup", "--force"])).rejects.toThrow(GuardExit);
      expect(m.captured).toHaveLength(0);

      await runProgram(["identity", "mfa", "setup", "--confirm"]);
      expect(m.captured[0]!.path).toBe("/api/user/tenant/generateMFASetup");
      expect(m.captured[0]!.body).toEqual({});

      await runProgram(["identity", "mfa", "setup", "--provider", "totp", "--force", "--confirm"]);
      expect(m.captured[1]!.body).toEqual({ provider: "totp", force: true });
    } finally { e.restore(); m.restore(); }
  });

  it("verify is a pure check: no guard, posts {code, provider?}", async () => {
    const m = stubFetch({ provider: "totp", verified: true });
    try {
      await runProgram(["identity", "mfa", "verify", "--code", "123456"]);
      expect(m.captured).toHaveLength(1);
      expect(m.captured[0]!.path).toBe("/api/user/tenant/verifyMFA");
      expect(m.captured[0]!.body).toEqual({ code: "123456" });

      await runProgram(["identity", "mfa", "verify", "--code", "123456", "--provider", "totp"]);
      expect(m.captured[1]!.body).toEqual({ code: "123456", provider: "totp" });
    } finally { m.restore(); }
  });
});

// ── preferences ─────────────────────────────────────────────────────────

describe("identity preferences", () => {
  it("get posts an empty body to getMyPreferences", async () => {
    const m = stubFetch({ market: "TZ", currency: "USD", version: 3 });
    try {
      await runProgram(["identity", "preferences", "get"]);
      expect(m.captured[0]!.path).toBe("/api/user/tenant/getMyPreferences");
      expect(m.captured[0]!.body).toEqual({});
    } finally { m.restore(); }
  });

  it("update is guarded; pointer semantics keep unset fields out and empty strings as clears", async () => {
    const m = stubFetch({ id: 1, version: 4 });
    const e = stubExit();
    try {
      await expect(runProgram(["identity", "preferences", "update", "--version", "3"])).rejects.toThrow(GuardExit);
      expect(m.captured).toHaveLength(0);

      await runProgram(["identity", "preferences", "update", "--market", "TZ", "--currency", "USD", "--version", "3", "--confirm"]);
      expect(m.captured[0]!.path).toBe("/api/user/tenant/updateMyPreferences");
      expect(m.captured[0]!.body).toEqual({ market: "TZ", currency: "USD", version: 3 });

      // version-only update: neither market nor currency is carried (nil = no change).
      await runProgram(["identity", "preferences", "update", "--version", "4", "--confirm"]);
      expect(m.captured[1]!.body).toEqual({ version: 4 });

      // empty string = explicit clear.
      await runProgram(["identity", "preferences", "update", "--market", "", "--version", "5", "--confirm"]);
      expect(m.captured[2]!.body).toEqual({ market: "", version: 5 });
    } finally { e.restore(); m.restore(); }
  });
});
