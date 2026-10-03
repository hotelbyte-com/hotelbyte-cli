/**
 * tests/cli.test.ts — CLI smoke tests for the flattened command tree.
 */

import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "src", "cli.ts");

// process.execPath is the running Bun binary: the suite must not depend on
// "bun" being on PATH (spawnSync would silently fail with empty output).
const BUN_BIN = process.execPath;

function runCliWithEnv(args: string[], env: Record<string, string>): { stdout: string; stderr: string; exitCode: number | null } {
  const result = spawnSync(BUN_BIN, ["run", CLI_PATH, ...args], { stdout: "pipe", stderr: "pipe", env });
  return { stdout: result.stdout?.toString() ?? "", stderr: result.stderr?.toString() ?? "", exitCode: result.status };
}

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number | null } {
  const result = spawnSync(BUN_BIN, ["run", CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    exitCode: result.status,
  };
}

describe("Top-level CLI", () => {
  it("--help should show flat command tree", () => {
    const { stdout, exitCode } = runCli(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("search");
    expect(stdout).toContain("trade");
    expect(stdout).toContain("orders");
    expect(stdout).toContain("team");
    expect(stdout).toContain("account");
    expect(stdout).toContain("auth");
    // Should NOT contain old profile names
    expect(stdout).not.toContain("openapi profile");
    expect(stdout).not.toContain("portal profile");
  });

  it("--version should show version", () => {
    const { stdout, exitCode } = runCli(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("0.0.4");
  });
});

describe("Search commands", () => {
  it("search --help should list all search subcommands", () => {
    const { stdout, exitCode } = runCli(["search", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("anything");
    expect(stdout).toContain("hotel-list");
    expect(stdout).toContain("hotel-rates");
    expect(stdout).toContain("destinations");
    expect(stdout).toContain("check-avail");
    expect(stdout).toContain("hotel-detail");
  });

  it("search anything --help should list mixed-search flags", () => {
    const { stdout, exitCode } = runCli(["search", "anything", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("keyword");
    expect(stdout).toContain("--content-type");
    expect(stdout).toContain("--destination-id");
  });

  it("search anything without credentials should fail with auth guidance (parse + wiring OK, never a module bug)", () => {
    const home = mkdtempSync(join(tmpdir(), "hbcli-anything-test-"));
    try {
      const { stderr, exitCode } = runCliWithEnv(["--json", "search", "anything", "Dali"], {
        ...process.env,
        STAICLI_HOME: home,
      });
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("auth");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("Trade commands", () => {
  it("trade --help should list booking subcommands", () => {
    const { stdout, exitCode } = runCli(["trade", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("book");
    expect(stdout).toContain("cancel");
    expect(stdout).toContain("query-orders");
  });

  it("trade book --help should list duplicate-confirmation flags (409 DUPLICATE_WARNING flow)", () => {
    const { stdout, exitCode } = runCli(["trade", "book", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--confirm-duplicate");
    expect(stdout).toContain("--duplicate-reason");
    expect(stdout).toContain("--customer-reference-no");
  });
});

describe("Orders commands", () => {
  it("orders --help should list order subcommands", () => {
    const { stdout, exitCode } = runCli(["orders", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("detail");
    expect(stdout).toContain("dashboard");
  });
});

describe("Team commands", () => {
  it("team --help should list team subcommands", () => {
    const { stdout, exitCode } = runCli(["team", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("invite");
    expect(stdout).toContain("list-roles");
  });
});

describe("Account commands", () => {
  it("account --help should list account subcommands", () => {
    const { stdout, exitCode } = runCli(["account", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("entity");
    expect(stdout).toContain("subscriptions");
    expect(stdout).toContain("suppliers");
  });

  it("account subscriptions --help should list sub commands", () => {
    const { stdout, exitCode } = runCli(["account", "subscriptions", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("get");
    expect(stdout).toContain("catalog");
    expect(stdout).toContain("invoices");
  });
});

describe("FX commands", () => {
  it("fx --help should list fx subcommands", () => {
    const { stdout, exitCode } = runCli(["fx", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("rates");
  });

  it("fx rates --help should list reference-rates flags", () => {
    const { stdout, exitCode } = runCli(["fx", "rates", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--base");
    expect(stdout).toContain("--currency");
  });
});

describe("Auth commands", () => {
  it("auth --help should list auth subcommands", () => {
    const { stdout, exitCode } = runCli(["auth", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("set-credentials");
    expect(stdout).toContain("login");
    expect(stdout).toContain("whoami");
    expect(stdout).toContain("logout");
  });

  it("auth --help should list registration subcommands (issue #14)", () => {
    const { stdout, exitCode } = runCli(["auth", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("send-code");
    expect(stdout).toContain("check-domain");
    expect(stdout).toContain("register");
    expect(stdout).toContain("customer-send-code");
    expect(stdout).toContain("customer-login");
  });

  it("auth register --help should list tenant-registration flags", () => {
    const { stdout, exitCode } = runCli(["auth", "register", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--email");
    expect(stdout).toContain("--password");
    expect(stdout).toContain("--tenant-name");
    expect(stdout).toContain("--otp-code");
    expect(stdout).toContain("--tenant-domain");
    expect(stdout).toContain("--module");
  });

  it("auth customer-login --help should list customer email-code flags", () => {
    const { stdout, exitCode } = runCli(["auth", "customer-login", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("--email");
    expect(stdout).toContain("--code");
    expect(stdout).toContain("--ttl");
    expect(stdout).toContain("--attribution-token");
  });

  it("auth register with a short password should fail fast without a network call", () => {
    const home = mkdtempSync(join(tmpdir(), "hbcli-register-test-"));
    try {
      const { stderr, exitCode } = runCliWithEnv(
        ["--json", "auth", "register", "--email", "a@b.com", "--password", "short", "--tenant-name", "T", "--otp-code", "123456", "--env", "dev"],
        { ...process.env, STAICLI_HOME: home },
      );
      expect(exitCode).toBe(1);
      expect(stderr).toContain("password must be at least 8 characters");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
describe("room-occupancies runtime wiring (CLI action path)", () => {
  it("string adultCount reaches the action without ReferenceError (import wired; failure must be auth/network, never a module bug)", () => {
    // 无凭证隔离面:请求会失败,但失败必须发生在网络/鉴权层,而不是 normalize 未定义
    const home = mkdtempSync(join(tmpdir(), "staicli-occ-test-"));
    const { stderr, exitCode } = runCliWithEnv(
      ["search", "hotel-rates", "--hotel-id", "900000001", "--room-occupancies", '[{"adultCount":"1","childrenAges":[]}]'],
      { ...process.env, STAICLI_HOME: home, HOTELBYTE_ENV: "uat" } as Record<string, string>,
    );
    expect(stderr).not.toContain("normalizeRoomOccupancies is not defined");
    expect(exitCode).not.toBe(0);
    rmSync(home, { recursive: true, force: true });
  });
});
