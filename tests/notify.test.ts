/**
 * tests/notify.test.ts — notify command group.
 *
 * In-process CLI layer tests: the factory is imported and registered into a
 * fresh commander program (tests/auth.test.ts fetch-stub pattern) with an
 * isolated STAICLI_HOME and a stubbed global.fetch that records every request
 * path and body. Asserts the command tree, request shapes against the notify
 * contracts (notify/protocol/requests.go + notification.go), the --confirm
 * write guard (positive + negative), and client-side required-flag rejection.
 * No live environment; no secrets in fixtures.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createNotifyCommand } from "../src/commands/notify.ts";
import type { Ctx } from "../src/commands/helpers.ts";

const BASE = "https://notify-stub.test";
const TMP_HOME = join(import.meta.dir, ".tmp-notify-test-home");

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
    program.addCommand(createNotifyCommand({ jsonMode: () => true, env: () => "uat" }));
    await program.parseAsync(args, { from: "user" });
    return { exitCode: exitCode === null ? 0 : exitCode, stderr };
  } catch (e: any) {
    if (typeof e?.message === "string" && e.message.startsWith("__exit__")) {
      return { exitCode: Number(e.message.slice("__exit__".length)), stderr };
    }
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

describe("notify command tree", () => {
  it("registers the notify group with the three subgroups", () => {
    const program = new Command();
    program.addCommand(createNotifyCommand({ jsonMode: () => true, env: () => "uat" }));
    const notify = program.commands.find((c) => c.name() === "notify");
    expect(notify).toBeDefined();
    expect(notify!.commands.map((c) => c.name())).toEqual(["templates", "send", "in-app"]);
  });

  it("hangs the documented subcommands under each subgroup", () => {
    const program = new Command();
    program.addCommand(createNotifyCommand({ jsonMode: () => true, env: () => "uat" }));
    const notify = program.commands.find((c) => c.name() === "notify")!;
    const names = (group: string) => notify.commands.find((c) => c.name() === group)!.commands.map((c) => c.name());
    expect(names("templates")).toEqual(["list", "get", "create", "update"]);
    expect(names("send")).toEqual(["email", "notification"]);
    expect(names("in-app")).toEqual(["list", "unread-count", "read"]);
  });
});

// ── templates ───────────────────────────────────────────────────────────

describe("notify templates", () => {
  it("list sends flat page/pageSize ints + filters to /api/notify/listTemplates", async () => {
    const r = await runCli(["notify", "templates", "list", "--type", "email", "--scenario", "otp_verification", "--page", "2", "--page-size", "50"]);
    expect(r.exitCode).toBe(0);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe(`${BASE}/api/notify/listTemplates`);
    expect(captured[0]!.body).toEqual({ page: 2, pageSize: 50, type: "email", scenario: "otp_verification" });
  });

  it("get sends numeric {id} to /api/notify/getTemplate", async () => {
    const r = await runCli(["notify", "templates", "get", "--id", "3"]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/notify/getTemplate`);
    expect(captured[0]!.body).toEqual({ id: 3 });
  });

  it("create posts the CreateTemplateRequest contract with numeric channel/entity with --confirm", async () => {
    const r = await runCli([
      "notify", "templates", "create",
      "--name", "Ops alert",
      "--channel", "2",
      "--scenario", "ops_alert",
      "--content", "Hello {{name}}",
      "--subject", "Alert",
      "--entity-id", "9",
      "--confirm",
    ]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/notify/createTemplate`);
    expect(captured[0]!.body).toEqual({
      channel: 2,
      scenario: "ops_alert",
      name: "Ops alert",
      content: "Hello {{name}}",
      subject: "Alert",
      entityId: 9,
    });
  });

  it("update sends {id} plus only the fields that are set with --confirm", async () => {
    const r = await runCli(["notify", "templates", "update", "--id", "3", "--subject", "New subject", "--confirm"]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/notify/updateTemplate`);
    expect(captured[0]!.body).toEqual({ id: 3, subject: "New subject" });
  });
});

// ── send ────────────────────────────────────────────────────────────────

describe("notify send", () => {
  it("email posts {to[], subject, body} to /api/notify/sendEmail with --confirm", async () => {
    const r = await runCli([
      "notify", "send", "email",
      "--to", "a@corp.com, b@corp.com",
      "--subject", "Welcome",
      "--body", "Hello there",
      "--tenant-brand-entity-id", "9",
      "--confirm",
    ]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/notify/sendEmail`);
    expect(captured[0]!.body).toEqual({
      to: ["a@corp.com", "b@corp.com"],
      subject: "Welcome",
      body: "Hello there",
      tenantBrandEntityId: "9",
    });
  });

  it("notification coerces channel/businessType to numbers and passes IDs through with --confirm", async () => {
    const r = await runCli([
      "notify", "send", "notification",
      "--channel", "2",
      "--business-type", "7",
      "--scenario", "booking_confirmation",
      "--recipient", "guest@mail.com",
      "--subject", "Booked",
      "--content", "Your stay is confirmed",
      "--template-id", "1",
      "--variables", '{"ORDER_ID":"HB-1"}',
      "--receiver-user-id", "42",
      "--confirm",
    ]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/notify/sendNotification`);
    expect(captured[0]!.body).toEqual({
      channel: 2,
      businessType: 7,
      scenario: "booking_confirmation",
      recipient: "guest@mail.com",
      subject: "Booked",
      content: "Your stay is confirmed",
      templateId: "1",
      variables: { ORDER_ID: "HB-1" },
      receiverUserId: "42",
    });
  });

  it("email rejects an all-blank --to client-side before any HTTP call", async () => {
    const r = await runCli(["notify", "send", "email", "--to", " , ", "--subject", "x", "--body", "y", "--confirm"]);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain("--to");
    expect(captured).toHaveLength(0);
  });
});

// ── in-app ──────────────────────────────────────────────────────────────

describe("notify in-app", () => {
  it("list sends pagination + isRead=false for --unread-only to /api/notify/getInAppNotifications", async () => {
    const r = await runCli(["notify", "in-app", "list", "--unread-only", "--page-size", "5"]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/notify/getInAppNotifications`);
    expect(captured[0]!.body).toEqual({ pageNum: 1, pageSize: 5, isRead: false });
  });

  it("unread-count sends {} or {businessType} to /api/notify/getUnreadCount", async () => {
    const bare = await runCli(["notify", "in-app", "unread-count"]);
    expect(bare.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/notify/getUnreadCount`);
    expect(captured[0]!.body).toEqual({});

    const filtered = await runCli(["notify", "in-app", "unread-count", "--business-type", "7"]);
    expect(filtered.exitCode).toBe(0);
    expect(captured[1]!.body).toEqual({ businessType: 7 });
  });

  it("read sends {notificationId} to /api/notify/markAsRead with --confirm", async () => {
    const r = await runCli(["notify", "in-app", "read", "--notification-id", "77", "--confirm"]);
    expect(r.exitCode).toBe(0);
    expect(captured[0]!.url).toBe(`${BASE}/api/notify/markAsRead`);
    expect(captured[0]!.body).toEqual({ notificationId: "77" });
  });
});

// ── write guard ─────────────────────────────────────────────────────────

describe("notify write guard (--confirm)", () => {
  it("all five write subcommands refuse without --confirm and never reach the server", async () => {
    for (const args of [
      ["notify", "templates", "create", "--name", "x", "--channel", "2", "--scenario", "s", "--content", "c"],
      ["notify", "templates", "update", "--id", "3"],
      ["notify", "send", "email", "--to", "a@b.com", "--subject", "s", "--body", "b"],
      ["notify", "send", "notification", "--content", "c"],
      ["notify", "in-app", "read", "--notification-id", "7"],
    ]) {
      const r = await runCli(args);
      expect(r.exitCode).toBe(1);
      expect(r.stderr).toContain("--confirm");
    }
    expect(captured).toHaveLength(0);
  });

  it("write subcommands carry the --confirm option in the command tree", () => {
    const program = new Command();
    program.addCommand(createNotifyCommand({ jsonMode: () => true, env: () => "uat" }));
    const notify = program.commands.find((c) => c.name() === "notify")!;
    const opts = (group: string, sub: string) =>
      notify.commands.find((c) => c.name() === group)!.commands.find((c) => c.name() === sub)!.options.map((o) => o.long);
    for (const [group, sub] of [
      ["templates", "create"],
      ["templates", "update"],
      ["send", "email"],
      ["send", "notification"],
      ["in-app", "read"],
    ] as const) {
      expect(opts(group, sub)).toContain("--confirm");
    }
  });
});
