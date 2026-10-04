/**
 * tests/auth_mock.test.ts — server-side view-as impersonation (issue #44).
 *
 * Contract (api/service/auth_mock.go + user/protocol/mock.go):
 *   mockStart  {targetUserId, reason, sessionTtl?, source?} → {token, targetUser,
 *              originalUser, sessionId, expiresTime}
 *   mockStatus → {isMocking, sessionId, expiresTime, bannedActions, ...}
 *   mockExit   {} → {}
 *   listMockableUsers {customerId} → {users: [{id, key, username, activated, mockable}]}
 *
 * Layers:
 *   - core: mockStart slot persistence, makeClient priority, withAuthRetry 401
 *     clearing — fetch stub (tests/auth.test.ts pattern), STAICLI_HOME isolated.
 *   - CLI: end-to-end against an in-process Bun.serve stub wired through
 *     HOTELBYTE_BASE_URL (tests/mcp.test.ts pattern).
 *
 * No test touches a live environment; every ticket below is fake.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ENVIRONMENTS,
  clearMockSession,
  loadMockSession,
  loadProfile,
  saveProfile,
  type Profile,
} from "../src/core/config.ts";
import { HttpClient, HotelByteError } from "../src/core/http.ts";
import { mockStart } from "../src/core/auth.ts";
import { makeClient, withAuthRetry } from "../src/commands/helpers.ts";

const TMP_HOME = join(import.meta.dir, ".tmp-test-home");

beforeEach(() => {
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
  mkdirSync(TMP_HOME, { recursive: true });
  process.env.STAICLI_HOME = TMP_HOME;
  delete process.env.HOTELBYTE_TOKEN;
  delete process.env.HOTELBYTE_APP_KEY;
  delete process.env.HOTELBYTE_APP_SECRET;
});

afterEach(() => {
  delete process.env.STAICLI_HOME;
  delete process.env.HOTELBYTE_TOKEN;
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
});

// ── shared fixtures ─────────────────────────────────────────────────────

const MOCK_START_RESP = {
  token: "mock-jwt-TOKEN",
  targetUser: { id: 12345, key: "guest@mail.com", username: "alice" },
  originalUser: { id: 1, key: "admin@corp.com", username: "admin" },
  sessionId: "sess_abc123",
  expiresTime: "2026-10-04T10:30:00Z",
  source: "customer_detail",
};

// Capture-able fetch stub (tests/auth.test.ts pattern).
function mockFetch(handler: (url: string, body: any) => Response | Promise<Response>) {
  const originalFetch = global.fetch;
  const captured: { url: string; body: any }[] = [];
  global.fetch = (async (url: unknown, init?: RequestInit) => {
    const bodyText = String(init?.body ?? "");
    captured.push({ url: String(url), body: bodyText ? JSON.parse(bodyText) : null });
    return Promise.resolve(handler(String(url), bodyText ? JSON.parse(bodyText) : null));
  }) as typeof fetch;
  return {
    captured,
    restore: () => { global.fetch = originalFetch; },
  };
}

function portalProfile(over: Partial<Profile> = {}): Profile {
  return { name: "portal", env: "uat", baseUrl: ENVIRONMENTS.uat, username: "admin@corp.com", password: "pw1", ticket: "portal-ticket", ...over };
}

function seedRawStore(store: unknown): void {
  writeFileSync(join(TMP_HOME, "credentials.json"), JSON.stringify(store, null, 2));
}

function rawStore(): any {
  return JSON.parse(readFileSync(join(TMP_HOME, "credentials.json"), "utf8"));
}

// ── core: mockStart slot persistence ────────────────────────────────────

describe("mockStart (issue #44)", () => {
  it("posts the wire contract and stores ticket + session summary in the mock slot", async () => {
    const m = mockFetch(() => Response.json(MOCK_START_RESP));
    try {
      const client = new HttpClient(portalProfile());
      const { resp, session } = await mockStart(client, "uat", {
        targetUserId: "12345",
        ttl: 3600,
        source: "customer_detail",
        reason: "support session",
      });
      expect(resp.sessionId).toBe("sess_abc123");
      // Wire field is sessionTtl (user/protocol/mock.go:14), lowercase l.
      expect(m.captured[0]?.url).toBe(`${ENVIRONMENTS.uat}/api/auth/mockStart`);
      expect(m.captured[0]?.body).toEqual({
        targetUserId: "12345",
        sessionTtl: 3600,
        source: "customer_detail",
        reason: "support session",
      });
      // Slot persisted with ticket + summaries (never the raw user objects).
      const stored = loadMockSession("uat");
      expect(stored).toBeDefined();
      expect(stored!.ticket).toBe("mock-jwt-TOKEN");
      expect(stored!.sessionId).toBe("sess_abc123");
      expect(stored!.expiresTime).toBe("2026-10-04T10:30:00Z");
      expect(stored!.targetUser).toBe("guest@mail.com");
      expect(stored!.originalUser).toBe("admin@corp.com");
      expect(session.ticket).toBe("mock-jwt-TOKEN");
      // Raw store: mock slot rides the standard "profile:env" layout.
      expect(rawStore()["mock:uat"].ticket).toBe("mock-jwt-TOKEN");
    } finally {
      m.restore();
    }
  });

  it("omits sessionTtl when no ttl is passed (server default 7200)", async () => {
    const m = mockFetch(() => Response.json(MOCK_START_RESP));
    try {
      const client = new HttpClient(portalProfile());
      await mockStart(client, "uat", { targetUserId: "12345", source: "customer_detail", reason: "r" });
      expect(m.captured[0]?.body.sessionTtl).toBeUndefined();
      expect(m.captured[0]?.body).toEqual({ targetUserId: "12345", source: "customer_detail", reason: "r" });
    } finally {
      m.restore();
    }
  });

  it("rejects a tokenless mockStart response and stores nothing", async () => {
    const m = mockFetch(() => Response.json({ unrelated: "shape" }));
    try {
      const client = new HttpClient(portalProfile());
      await expect(mockStart(client, "uat", { targetUserId: "1", reason: "r" })).rejects.toThrow(HotelByteError);
      expect(loadMockSession("uat")).toBeUndefined();
    } finally {
      m.restore();
    }
  });
});

describe("mock slot store semantics (issue #44)", () => {
  it("loadMockSession reads the store only — HOTELBYTE_TOKEN must not fake a session", () => {
    process.env.HOTELBYTE_TOKEN = "env-injected-ticket";
    expect(loadMockSession("uat")).toBeUndefined();
  });

  it("clearMockSession removes ticket and metadata together", () => {
    seedRawStore({
      "portal:uat": { username: "admin@corp.com", ticket: "portal-ticket" },
      "mock:uat": { ticket: "mock-jwt", sessionId: "sess_1", expiresTime: "2026-10-04T10:30:00Z", originalUser: "admin@corp.com", targetUser: "guest@mail.com" },
    });
    clearMockSession("uat");
    const store = rawStore();
    expect(store["mock:uat"]).toBeUndefined();
    expect(store["portal:uat"].ticket).toBe("portal-ticket"); // other slots untouched
    expect(loadMockSession("uat")).toBeUndefined();
  });
});

// ── makeClient priority + stale-401 handling ────────────────────────────

const CTX = { jsonMode: () => false, env: () => "uat" };

describe("makeClient mock priority (issue #44)", () => {
  it("an active mock session outranks the portal slot and rides the mock ticket", async () => {
    seedRawStore({
      "portal:uat": { username: "admin@corp.com", password: "pw1", ticket: "portal-ticket" },
      "mock:uat": { ticket: "mock-jwt", sessionId: "sess_1", targetUser: "guest@mail.com" },
    });
    const client = await makeClient(CTX);
    expect(client.profile.name).toBe("mock");
    expect(client.profile.ticket).toBe("mock-jwt");
  });

  it("without a mock slot the portal precedence is unchanged (regression)", async () => {
    seedRawStore({ "portal:uat": { username: "admin@corp.com", ticket: "portal-ticket" } });
    const client = await makeClient(CTX);
    expect(client.profile.name).toBe("portal");
    expect(client.profile.ticket).toBe("portal-ticket");
  });

  it("stale-401 drops the mock slot (ticket + metadata) and falls back to the caller's own identity", async () => {
    seedRawStore({
      "portal:uat": { username: "admin@corp.com", password: "pw1" }, // no ticket → re-auth on retry
      "mock:uat": { ticket: "stale-mock-jwt", sessionId: "sess_1", targetUser: "guest@mail.com" },
    });
    let targetCalls = 0;
    const m = mockFetch((url) => {
      if (url.endsWith("/api/auth/login")) {
        return Response.json({ token: "fresh-portal-ticket" });
      }
      targetCalls += 1;
      if (targetCalls === 1) return new Response('{"code":401,"msg":"authentication denied"}', { status: 401 });
      return Response.json({ ok: true, sawAuth: true });
    });
    try {
      const resp = await withAuthRetry(CTX, (client) => client.post("/api/trade/tenant/listOrder", {}));
      expect(resp).toEqual({ ok: true, sawAuth: true });
      expect(targetCalls).toBe(2); // mock ticket 401 → retry with fresh portal ticket
      // First attempt rode the mock ticket; the retry rode the re-issued portal one.
      expect(loadMockSession("uat")).toBeUndefined();
      const store = rawStore();
      expect(store["mock:uat"]).toBeUndefined(); // metadata cleared with the ticket
      expect(store["portal:uat"].ticket).toBe("fresh-portal-ticket");
    } finally {
      m.restore();
    }
  });
});

// ── CLI end-to-end against a Bun.serve stub (tests/mcp.test.ts pattern) ──

const CLI_PATH = join(import.meta.dir, "..", "src", "cli.ts");
const BUN_BIN = process.execPath;

interface StubRequest { path: string; auth: string | null; body: any }

function startStub(handler: (req: StubRequest) => Response): { url: string; requests: StubRequest[]; stop: () => void } {
  const requests: StubRequest[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      return req.text().then((text) => {
        const entry: StubRequest = {
          path: url.pathname,
          auth: req.headers.get("authorization"),
          body: text ? JSON.parse(text) : null,
        };
        requests.push(entry);
        return handler(entry);
      });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, requests, stop: () => server.stop(true) };
}

// Async spawn on purpose: spawnSync would block this process's event loop,
// starving the in-process Bun.serve stub the child talks to (deadlock → 5s
// timeout). Awaited spawns keep the stub live while the child runs.
async function runCli(args: string[], home: string, baseUrl: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
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
}

function cliHome(): string {
  return mkdtempSync(join(tmpdir(), "hbcli-mock-test-"));
}

function seedStore(home: string, store: unknown): void {
  writeFileSync(join(home, "credentials.json"), JSON.stringify(store, null, 2));
}

describe("auth mock commands CLI (issue #44)", () => {
  it("impersonate stores the mock slot and reports the session summary (--json before the subcommand)", async () => {
    const home = cliHome();
    const stub = startStub((req) => {
      if (req.path === "/api/auth/mockStart") return Response.json(MOCK_START_RESP);
      return new Response("not found", { status: 404 });
    });
    try {
      seedStore(home, { "portal:uat": { username: "admin@corp.com", password: "pw1", ticket: "portal-ticket" } });
      const { stdout, stderr, exitCode } = await runCli(
        ["--json", "auth", "impersonate", "--target-user-id", "12345", "--source", "customer_detail"],
        home, stub.url,
      );
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const out = JSON.parse(stdout);
      expect(out.status).toBe("impersonating");
      expect(out.token_saved).toBe(true);
      expect(out.target_user).toBe("guest@mail.com");
      expect(out.original_user).toBe("admin@corp.com");
      expect(out.session_id).toBe("sess_abc123");
      expect(out.expires_time).toBe("2026-10-04T10:30:00Z");
      expect(stdout).not.toContain("mock-jwt-TOKEN"); // ticket persisted, never echoed
      // Server saw the audit reason default and the wire field name.
      expect(stub.requests[0]?.body).toEqual({
        targetUserId: "12345",
        sessionTtl: undefined,
        source: "customer_detail",
        reason: "hbcli auth impersonate",
      });
      expect(stub.requests[0]?.auth).toBe("Bearer portal-ticket");
      const store = JSON.parse(readFileSync(join(home, "credentials.json"), "utf8"));
      expect(store["mock:uat"].ticket).toBe("mock-jwt-TOKEN");
    } finally {
      stub.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("with a mock slot active, commands ride the impersonation ticket (priority 0 e2e)", async () => {
    const home = cliHome();
    const stub = startStub((req) => {
      if (req.path === "/api/auth/mockStatus") {
        return Response.json({ isMocking: true, sawAuth: req.auth, sessionId: "sess_abc123" });
      }
      return new Response("not found", { status: 404 });
    });
    try {
      seedStore(home, {
        "portal:uat": { username: "admin@corp.com", ticket: "portal-ticket" },
        "mock:uat": { ticket: "mock-jwt-TOKEN", sessionId: "sess_abc123", targetUser: "guest@mail.com" },
      });
      const { stdout, exitCode } = await runCli(["--json", "auth", "mock-status"], home, stub.url);
      expect(exitCode).toBe(0);
      const out = JSON.parse(stdout);
      expect(out.isMocking).toBe(true);
      // The stub echoes the bearer it received: the mock ticket wins over portal.
      expect(out.sawAuth).toBe("Bearer mock-jwt-TOKEN");
    } finally {
      stub.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("mock-exit clears the local mock slot on success", async () => {
    const home = cliHome();
    const stub = startStub((req) => {
      if (req.path === "/api/auth/mockExit") return Response.json({});
      return new Response("not found", { status: 404 });
    });
    try {
      seedStore(home, { "mock:uat": { ticket: "mock-jwt", sessionId: "sess_1", targetUser: "guest@mail.com" } });
      const { stdout, stderr, exitCode } = await runCli(["--json", "auth", "mock-exit"], home, stub.url);
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ status: "mock_exited", env: "uat", api_ok: true });
      const store = JSON.parse(readFileSync(join(home, "credentials.json"), "utf8"));
      expect(store["mock:uat"]).toBeUndefined();
    } finally {
      stub.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("mock-exit clears the local mock slot even when the API call fails (stderr warning, exit 0)", async () => {
    const home = cliHome();
    const stub = startStub((req) => {
      if (req.path === "/api/auth/mockExit") return new Response('{"code":500,"msg":"backend down"}', { status: 500 });
      return new Response("not found", { status: 404 });
    });
    try {
      seedStore(home, { "mock:uat": { ticket: "mock-jwt", sessionId: "sess_1", targetUser: "guest@mail.com" } });
      const { stdout, stderr, exitCode } = await runCli(["--json", "auth", "mock-exit"], home, stub.url);
      expect(exitCode).toBe(0); // the local goal (clearing the slot) is achieved
      expect(stderr).toContain("⚠");
      expect(stderr).toContain("mockExit call failed");
      expect(JSON.parse(stdout)).toEqual({ status: "mock_exited", env: "uat", api_ok: false });
      const store = JSON.parse(readFileSync(join(home, "credentials.json"), "utf8"));
      expect(store["mock:uat"]).toBeUndefined(); // cleared despite the API failure
    } finally {
      stub.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("whoami shows the impersonating summary when the mock slot is active", async () => {
    const home = cliHome();
    const stub = startStub(() => new Response("not found", { status: 404 }));
    try {
      seedStore(home, {
        "portal:uat": { username: "admin@corp.com", ticket: "portal-ticket" },
        "mock:uat": {
          ticket: "mock-jwt", sessionId: "sess_abc123", expiresTime: "2026-10-04T10:30:00Z",
          originalUser: "admin@corp.com", targetUser: "guest@mail.com",
        },
      });
      const { stdout, exitCode } = await runCli(["--json", "auth", "whoami"], home, stub.url);
      expect(exitCode).toBe(0);
      const out = JSON.parse(stdout);
      expect(out.impersonating).toEqual({
        target_user: "guest@mail.com",
        original_user: "admin@corp.com",
        session_id: "sess_abc123",
        expires_time: "2026-10-04T10:30:00Z",
      });
    } finally {
      stub.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("whoami reports impersonating: null without a mock slot", async () => {
    const home = cliHome();
    const stub = startStub(() => new Response("not found", { status: 404 }));
    try {
      seedStore(home, { "portal:uat": { username: "admin@corp.com", ticket: "portal-ticket" } });
      const { stdout } = await runCli(["--json", "auth", "whoami"], home, stub.url);
      expect(JSON.parse(stdout).impersonating).toBeNull();
    } finally {
      stub.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("mockable lists mockable users through listMockableUsers", async () => {
    const home = cliHome();
    const stub = startStub((req) => {
      if (req.path === "/api/auth/listMockableUsers") {
        return Response.json({
          users: [
            { id: 12345, key: "guest@mail.com", username: "alice", activated: true, mockable: true },
            { id: 12346, key: "bob@mail.com", username: "bob", activated: false, mockable: false },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    });
    try {
      seedStore(home, { "portal:uat": { username: "admin@corp.com", ticket: "portal-ticket" } });
      const { stdout, exitCode } = await runCli(["--json", "auth", "mockable", "--customer-id", "77"], home, stub.url);
      expect(exitCode).toBe(0);
      const out = JSON.parse(stdout);
      expect(out.users).toHaveLength(2);
      expect(out.users[0].mockable).toBe(true);
      expect(stub.requests[0]?.body).toEqual({ customerId: "77" });
      expect(stub.requests[0]?.auth).toBe("Bearer portal-ticket");
    } finally {
      stub.stop();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
