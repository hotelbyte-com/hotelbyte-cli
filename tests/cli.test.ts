/**
 * tests/cli.test.ts — CLI smoke tests for the flattened command tree.
 */

import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "src", "cli.ts");

function runCliWithEnv(args: string[], env: Record<string, string>): { stdout: string; stderr: string; exitCode: number | null } {
  const result = spawnSync("bun", ["run", CLI_PATH, ...args], { stdout: "pipe", stderr: "pipe", env });
  return { stdout: result.stdout?.toString() ?? "", stderr: result.stderr?.toString() ?? "", exitCode: result.status };
}

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number | null } {
  const result = spawnSync("bun", ["run", CLI_PATH, ...args], {
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
    expect(stdout).toContain("0.0.1");
  });
});

describe("Search commands", () => {
  it("search --help should list all search subcommands", () => {
    const { stdout, exitCode } = runCli(["search", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("hotel-list");
    expect(stdout).toContain("hotel-rates");
    expect(stdout).toContain("destinations");
    expect(stdout).toContain("check-avail");
    expect(stdout).toContain("hotel-detail");
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

describe("Auth commands", () => {
  it("auth --help should list auth subcommands", () => {
    const { stdout, exitCode } = runCli(["auth", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("set-credentials");
    expect(stdout).toContain("login");
    expect(stdout).toContain("whoami");
    expect(stdout).toContain("logout");
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
