/**
 * tests/connectors.test.ts — connectors command group (issue #32).
 *
 * CLI layer: `hbcli connectors` spawned against an in-process Bun.serve stub
 * (tests/mcp.test.ts pattern; spawn via process.execPath per tests/cli.test.ts)
 * with an isolated STAICLI_HOME. Asserts request bodies (only explicit flags
 * travel — the backend fields are pointer-optional), --json output, the
 * no-secrets contract (no credential material in any request body or output),
 * and the --help tree including the `account suppliers accessible` alias note.
 * No live environment.
 */

import { describe, it, expect, afterAll } from "bun:test";
import { rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const serverCalls: { path: string; body: any }[] = [];

const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url);
    return req.text().then((text) => {
      let body: any = {};
      try { body = text ? JSON.parse(text) : {}; } catch { /* keep {} */ }
      serverCalls.push({ path: url.pathname, body });
      switch (url.pathname) {
        case "/api/search/suppliers":
          // Supplier directory shape: names/flags only, never credential values.
          return Response.json({
            code: 0,
            msg: "ok",
            data: { suppliers: [{ code: "hotelbeds", displayName: "Hotelbeds", isActive: true }] },
          });
        case "/api/user/tenant/getAccessibleCredentials":
          // Server-sanitized response: supplier view carries no credential
          // metadata (user/service/accessible_credentials.go).
          return Response.json({
            code: 0,
            msg: "ok",
            data: { credentials: [{ supplier: "hotelbeds", entity: "demo" }] },
          });
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
const BUN_BIN = process.execPath;

function freshHome(): string {
  return mkdtempSync(join(tmpdir(), "hbcli-connectors-test-"));
}

function seedTicket(home: string): void {
  // Cached openapi ticket → makeClient takes the ticket flow with zero auth calls.
  writeFileSync(join(home, "credentials.json"), JSON.stringify({ "openapi:uat": { ticket: "stub-ticket" } }));
}

function runCli(args: string[], home: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(BUN_BIN, ["run", CLI_PATH, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        STAICLI_HOME: home,
        HOTELBYTE_BASE_URL: `http://localhost:${server.port}`,
        HOTELBYTE_ENV: "uat",
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", () => resolve({ stdout, stderr, exitCode: null }));
    child.on("close", (code) => resolve({ stdout, stderr, exitCode: code }));
  });
}

function cleanupHome(home: string): void {
  rmSync(home, { recursive: true, force: true });
}

describe("connectors suppliers (CLI end-to-end)", () => {
  it("no flags → empty body to /api/search/suppliers (pointer-optional fields stay absent)", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "connectors", "suppliers"], home);
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).suppliers[0].code).toBe("hotelbeds");
      expect(serverCalls).toHaveLength(1);
      expect(serverCalls[0]?.path).toBe("/api/search/suppliers");
      expect(serverCalls[0]?.body).toEqual({});
    } finally {
      cleanupHome(home);
    }
  });

  it("explicit flags travel as true; unset flags are omitted, not false", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(
        ["--json", "connectors", "suppliers", "--only-active", "--include-unconnected"],
        home,
      );
      expect(r.exitCode).toBe(0);
      expect(serverCalls[0]?.body).toEqual({ onlyActive: true, includeUnconnected: true });
      expect(serverCalls[0]?.body).not.toHaveProperty("withCredit");
      expect(serverCalls[0]?.body).not.toHaveProperty("includeModeMismatched");
    } finally {
      cleanupHome(home);
    }
  });
});

describe("connectors accessible (CLI end-to-end)", () => {
  it("hits the same endpoint as `account suppliers accessible` with an empty body", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      const r = await runCli(["--json", "connectors", "accessible"], home);
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.stdout.trim()).credentials[0].supplier).toBe("hotelbeds");

      const accountView = await runCli(["--json", "account", "suppliers", "accessible"], home);
      expect(accountView.exitCode).toBe(0);
      expect(JSON.parse(accountView.stdout.trim())).toEqual(JSON.parse(r.stdout.trim()));

      expect(serverCalls.map((c) => c.path)).toEqual([
        "/api/user/tenant/getAccessibleCredentials",
        "/api/user/tenant/getAccessibleCredentials",
      ]);
      expect(serverCalls.every((c) => JSON.stringify(c.body) === "{}")).toBe(true);
    } finally {
      cleanupHome(home);
    }
  });
});

describe("connectors secret hygiene", () => {
  it("no credential material ever appears in a request body or output", async () => {
    const home = freshHome();
    seedTicket(home);
    serverCalls.length = 0;
    try {
      for (const args of [["--json", "connectors", "suppliers"], ["--json", "connectors", "accessible"]]) {
        const r = await runCli(args, home);
        expect(r.exitCode).toBe(0);
        expect(r.stdout + r.stderr).not.toMatch(/secret|appSecret|password|apiKey|credentialMetadata/i);
      }
      for (const c of serverCalls) {
        expect(JSON.stringify(c.body)).not.toMatch(/secret|appSecret|password|apiKey/i);
      }
    } finally {
      cleanupHome(home);
    }
  });
});

describe("connectors command tree (--help)", () => {
  it("top-level help lists the connectors group", async () => {
    const home = freshHome();
    try {
      const { stdout, exitCode } = await runCli(["--help"], home);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(/^  connectors\b/m);
    } finally {
      cleanupHome(home);
    }
  });

  it("connectors --help lists suppliers and accessible; accessible documents the account alias", async () => {
    const home = freshHome();
    try {
      const r = await runCli(["connectors", "--help"], home);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("suppliers");
      expect(r.stdout).toContain("accessible");
      // Commander wraps long descriptions across lines — compare with folded
      // whitespace so the assertion survives terminal-width wrapping.
      const folded = r.stdout.replace(/\s+/g, " ");
      expect(folded).toContain("account suppliers accessible");

      // The connect flow is NOT duplicated here — help points at account.
      expect(folded).toContain("account suppliers connect");
      const connect = r.stdout.match(/^  connect\b/m);
      expect(connect).toBeNull();
    } finally {
      cleanupHome(home);
    }
  });

  it("connectors suppliers --help lists the four filter flags", async () => {
    const home = freshHome();
    try {
      const r = await runCli(["connectors", "suppliers", "--help"], home);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("--only-active");
      expect(r.stdout).toContain("--with-credit");
      expect(r.stdout).toContain("--include-unconnected");
      expect(r.stdout).toContain("--include-mode-mismatched");
    } finally {
      cleanupHome(home);
    }
  });
});
