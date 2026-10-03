/**
 * tests/crm.test.ts — crm command group (in-process, fetch-stubbed).
 *
 * Imports createCrmCommand, registers it into a test-built commander program,
 * and asserts:
 *  - the command tree (groups + subcommands + --confirm placement),
 *  - request paths and bodies against a stubbed global.fetch
 *    (tests/auth.test.ts mockFetchOnce pattern),
 *  - the write guard: every mutating subcommand refuses without --confirm and
 *    never issues an HTTP call (guard negative + positive),
 *  - the read/write route split documented in commands/crm.ts (reads on
 *    /api/crm/tenant/*, writes on /api/crm/customer/* — the tenant route is
 *    read-only by design, crm/service/handler.go denyTenantWrite).
 * STAICLI_HOME is isolated per test; no live environment.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createCrmCommand } from "../src/commands/crm.ts";
import type { Ctx } from "../src/commands/helpers.ts";

const TMP_HOME = join(import.meta.dir, ".tmp-crm-test-home");

beforeEach(() => {
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
  mkdirSync(TMP_HOME, { recursive: true });
  process.env.STAICLI_HOME = TMP_HOME;
  // Cached openapi ticket → makeClient takes the ticket flow with zero auth calls.
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

/** fetch stub (auth.test.ts pattern): records url+body, returns a code-0 envelope. */
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
  program.addCommand(createCrmCommand(ctx));
  return program;
}

/** Sentinel thrown by the stubbed process.exit so guard rejections stay in-process. */
class GuardExit extends Error {}

/** Silence stderr + stub process.exit for guard-negative assertions. */
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

describe("crm command tree", () => {
  it("exposes clients/trips/notes/activities/workspace groups with the full subcommand set", () => {
    const program = buildProgram();
    const crm = sub(program, "crm");
    expect(crm.commands.map((c) => c.name()).sort()).toEqual(["activities", "clients", "notes", "trips", "workspace"]);
    expect(sub(crm, "clients").commands.map((c) => c.name()).sort()).toEqual(["create", "get", "list", "search", "update"]);
    expect(sub(crm, "trips").commands.map((c) => c.name()).sort()).toEqual(["create", "get", "list", "search", "set-stage", "update"]);
    expect(sub(crm, "notes").commands.map((c) => c.name()).sort()).toEqual(["create", "list"]);
    expect(sub(crm, "activities").commands.map((c) => c.name()).sort()).toEqual(["add", "list"]);
  });

  it("carries --confirm exactly on the six write subcommands", () => {
    const crm = sub(buildProgram(), "crm");
    const writes = ["clients create", "clients update", "trips create", "trips update", "trips set-stage", "notes create", "activities add"];
    const reads = ["clients list", "clients search", "clients get", "trips list", "trips search", "trips get", "notes list", "activities list", "workspace"];
    const find = (dotted: string): Command => {
      const parts = dotted.split(" ");
      return parts.length === 1 ? sub(crm, parts[0]!) : sub(sub(crm, parts[0]!), parts[1]!);
    };
    for (const dotted of writes) {
      expect(find(dotted).options.some((o) => o.long === "--confirm")).toBe(true);
    }
    for (const dotted of reads) {
      expect(find(dotted).options.some((o) => o.long === "--confirm")).toBe(false);
    }
  });
});

// ── clients ─────────────────────────────────────────────────────────────

describe("crm clients", () => {
  it("list sends page + stage/tags/archive/recency filters to /api/crm/tenant/listClients", async () => {
    const m = stubFetch();
    try {
      await runProgram(["crm", "clients", "list", "--stage", "quoted", "--tags", "vip, family", "--archived", "--contacted-within-days", "7", "--page-num", "2", "--page-size", "50"]);
      expect(m.captured).toHaveLength(1);
      expect(m.captured[0]!.path).toBe("/api/crm/tenant/listClients");
      expect(m.captured[0]!.body).toEqual({
        page: { pageNum: 2, pageSize: 50 },
        stage: "quoted",
        tags: ["vip", "family"],
        archived: true,
        contactedWithinDays: 7,
      });
    } finally { m.restore(); }
  });

  it("list defaults to page 1/20 with no filter keys", async () => {
    const m = stubFetch();
    try {
      await runProgram(["crm", "clients", "list"]);
      expect(m.captured[0]!.body).toEqual({ page: { pageNum: 1, pageSize: 20 } });
    } finally { m.restore(); }
  });

  it("search sends keyword/stage/tags to /api/crm/tenant/searchClients", async () => {
    const m = stubFetch();
    try {
      await runProgram(["crm", "clients", "search", "--keyword", "zhang", "--stage", "enquiry", "--tags", "honeymoon"]);
      expect(m.captured[0]!.path).toBe("/api/crm/tenant/searchClients");
      expect(m.captured[0]!.body).toEqual({
        page: { pageNum: 1, pageSize: 20 },
        keyword: "zhang",
        stage: "enquiry",
        tags: ["honeymoon"],
      });
    } finally { m.restore(); }
  });

  it("get sends {id} to /api/crm/tenant/getClient", async () => {
    const m = stubFetch({ id: 42, displayName: "Zhang San" });
    try {
      await runProgram(["crm", "clients", "get", "--id", "42"]);
      expect(m.captured[0]!.path).toBe("/api/crm/tenant/getClient");
      expect(m.captured[0]!.body).toEqual({ id: "42" });
    } finally { m.restore(); }
  });

  it("create is guarded: refused without --confirm, executes on /api/crm/customer/createClient with --confirm", async () => {
    const m = stubFetch({ id: 9 });
    const e = stubExit();
    try {
      await expect(runProgram(["crm", "clients", "create", "--display-name", "Zhang San"])).rejects.toThrow(GuardExit);
      expect(m.captured).toHaveLength(0); // guard fires before any HTTP

      await runProgram(["crm", "clients", "create", "--display-name", "Zhang San", "--email", "z@ex.com", "--tags", "vip", "--stage", "won", "--confirm"]);
      expect(m.captured[0]!.path).toBe("/api/crm/customer/createClient");
      expect(m.captured[0]!.body).toEqual({
        displayName: "Zhang San",
        email: "z@ex.com",
        tags: ["vip"],
        stage: "won",
      });
    } finally { e.restore(); m.restore(); }
  });

  it("update carries id + changed fields and supports --archive", async () => {
    const m = stubFetch({ id: 42 });
    const e = stubExit();
    try {
      await expect(runProgram(["crm", "clients", "update", "--id", "42", "--phone", "+86"])).rejects.toThrow(GuardExit);
      expect(m.captured).toHaveLength(0);

      await runProgram(["crm", "clients", "update", "--id", "42", "--phone", "+86", "--archive", "--confirm"]);
      expect(m.captured[0]!.path).toBe("/api/crm/customer/updateClient");
      expect(m.captured[0]!.body).toEqual({ id: "42", phone: "+86", archive: true });
    } finally { e.restore(); m.restore(); }
  });
});

// ── trips ───────────────────────────────────────────────────────────────

describe("crm trips", () => {
  it("list sends client/stage/includeArchived to /api/crm/tenant/listTrips", async () => {
    const m = stubFetch();
    try {
      await runProgram(["crm", "trips", "list", "--client-id", "42", "--stage", "booked", "--include-archived"]);
      expect(m.captured[0]!.path).toBe("/api/crm/tenant/listTrips");
      expect(m.captured[0]!.body).toEqual({
        page: { pageNum: 1, pageSize: 20 },
        clientId: "42",
        stage: "booked",
        includeArchived: true,
      });
    } finally { m.restore(); }
  });

  it("search builds dateWindow from --date-from/--date-to", async () => {
    const m = stubFetch();
    try {
      await runProgram(["crm", "trips", "search", "--keyword", "bali", "--date-from", "2026-10-01", "--date-to", "2026-10-31"]);
      expect(m.captured[0]!.path).toBe("/api/crm/tenant/searchTrips");
      expect(m.captured[0]!.body).toEqual({
        page: { pageNum: 1, pageSize: 20 },
        keyword: "bali",
        dateWindow: { start: "2026-10-01", end: "2026-10-31" },
      });
    } finally { m.restore(); }
  });

  it("get sends {id} to /api/crm/tenant/getTrip", async () => {
    const m = stubFetch({ id: 7 });
    try {
      await runProgram(["crm", "trips", "get", "--id", "7"]);
      expect(m.captured[0]!.path).toBe("/api/crm/tenant/getTrip");
      expect(m.captured[0]!.body).toEqual({ id: "7" });
    } finally { m.restore(); }
  });

  it("create is guarded and posts the CreateTripReq contract", async () => {
    const m = stubFetch({ id: 11 });
    const e = stubExit();
    try {
      await expect(runProgram(["crm", "trips", "create", "--client-id", "42", "--title", "Bali"])).rejects.toThrow(GuardExit);
      expect(m.captured).toHaveLength(0);

      await runProgram([
        "crm", "trips", "create",
        "--client-id", "42", "--title", "Bali", "--destinations", "Ubudu, Kuta",
        "--planned-check-in", "2026-11-01", "--planned-check-out", "2026-11-08",
        "--adults", "2", "--budget-amount", "4800.00", "--budget-currency", "USD", "--stage", "planning",
        "--confirm",
      ]);
      expect(m.captured[0]!.path).toBe("/api/crm/customer/createTrip");
      expect(m.captured[0]!.body).toEqual({
        clientId: "42",
        title: "Bali",
        destinations: ["Ubudu", "Kuta"],
        plannedCheckIn: "2026-11-01",
        plannedCheckOut: "2026-11-08",
        adults: 2,
        budgetAmount: "4800.00",
        budgetCurrency: "USD",
        stage: "planning",
      });
    } finally { e.restore(); m.restore(); }
  });

  it("set-stage is guarded and is the only stage-changing action (id+stage+reopen+note)", async () => {
    const m = stubFetch({ id: 7, stage: "planning" });
    const e = stubExit();
    try {
      await expect(runProgram(["crm", "trips", "set-stage", "--id", "7", "--stage", "completed"])).rejects.toThrow(GuardExit);
      expect(m.captured).toHaveLength(0);

      await runProgram(["crm", "trips", "set-stage", "--id", "7", "--stage", "planning", "--reopen", "--note", "client came back", "--confirm"]);
      expect(m.captured[0]!.path).toBe("/api/crm/customer/setTripStage");
      expect(m.captured[0]!.body).toEqual({ id: "7", stage: "planning", reopen: true, note: "client came back" });
    } finally { e.restore(); m.restore(); }
  });

  it("rejects an invalid --stage client-side (commander choices)", async () => {
    const m = stubFetch();
    const e = stubExit();
    try {
      await expect(runProgram(["crm", "trips", "set-stage", "--id", "7", "--stage", "bogus", "--confirm"])).rejects.toThrow();
      expect(m.captured).toHaveLength(0);
    } finally { e.restore(); m.restore(); }
  });
});

// ── notes / activities / workspace ──────────────────────────────────────

describe("crm notes, activities, workspace", () => {
  it("notes list narrows by association, due window and done state", async () => {
    const m = stubFetch();
    try {
      await runProgram(["crm", "notes", "list", "--client-id", "42", "--due-from", "1760000000", "--due-to", "1760086400", "--done", "false"]);
      expect(m.captured[0]!.path).toBe("/api/crm/tenant/listNotes");
      expect(m.captured[0]!.body).toEqual({
        page: { pageNum: 1, pageSize: 20 },
        clientId: "42",
        dueWindow: { from: 1760000000, to: 1760086400 },
        done: false,
      });
    } finally { m.restore(); }
  });

  it("notes create is guarded and posts title/body (+pinned, association)", async () => {
    const m = stubFetch({ id: 3, version: 1 });
    const e = stubExit();
    try {
      await expect(runProgram(["crm", "notes", "create", "--title", "Visa", "--body", "submit docs"])).rejects.toThrow(GuardExit);
      expect(m.captured).toHaveLength(0);

      await runProgram(["crm", "notes", "create", "--title", "Visa", "--body", "submit docs", "--client-id", "42", "--pinned", "--confirm"]);
      expect(m.captured[0]!.path).toBe("/api/crm/customer/createNote");
      expect(m.captured[0]!.body).toEqual({ title: "Visa", body: "submit docs", clientId: "42", pinned: true });
    } finally { e.restore(); m.restore(); }
  });

  it("activities list requires --client-id and pages under it", async () => {
    const m = stubFetch();
    try {
      await runProgram(["crm", "activities", "list", "--client-id", "42", "--page-num", "3"]);
      expect(m.captured[0]!.path).toBe("/api/crm/tenant/listActivities");
      expect(m.captured[0]!.body).toEqual({ clientId: "42", page: { pageNum: 3, pageSize: 20 } });
    } finally { m.restore(); }
  });

  it("activities add is guarded and posts clientId+content(+tripId)", async () => {
    const m = stubFetch({ id: 5 });
    const e = stubExit();
    try {
      await expect(runProgram(["crm", "activities", "add", "--client-id", "42", "--content", "call"])).rejects.toThrow(GuardExit);
      expect(m.captured).toHaveLength(0);

      await runProgram(["crm", "activities", "add", "--client-id", "42", "--content", "intro call", "--trip-id", "7", "--confirm"]);
      expect(m.captured[0]!.path).toBe("/api/crm/customer/addActivity");
      expect(m.captured[0]!.body).toEqual({ clientId: "42", content: "intro call", tripId: "7" });
    } finally { e.restore(); m.restore(); }
  });

  it("workspace sends the optional upcoming-trips window", async () => {
    const m = stubFetch({ openTripCount: 2 });
    try {
      await runProgram(["crm", "workspace"]);
      expect(m.captured[0]!.path).toBe("/api/crm/tenant/getWorkspaceSummary");
      expect(m.captured[0]!.body).toEqual({});

      await runProgram(["crm", "workspace", "--from", "2026-10-05", "--to", "2026-10-19"]);
      expect(m.captured[1]!.body).toEqual({ from: "2026-10-05", to: "2026-10-19" });
    } finally { m.restore(); }
  });
});
