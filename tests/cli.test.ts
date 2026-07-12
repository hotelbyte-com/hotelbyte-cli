/**
 * tests/cli.test.ts — CLI smoke tests via Bun's subprocess runner.
 */

import { describe, it, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "src", "cli.ts");

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
  it("--help should show openapi and portal profiles", () => {
    const { stdout, exitCode } = runCli(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("openapi");
    expect(stdout).toContain("portal");
  });

  it("--version should show version", () => {
    const { stdout, exitCode } = runCli(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("0.2.0");
  });
});

describe("OpenAPI group", () => {
  it("openapi --help should show auth, search, trade", () => {
    const { stdout, exitCode } = runCli(["openapi", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("auth");
    expect(stdout).toContain("search");
    expect(stdout).toContain("trade");
  });

  it("openapi search --help should list search commands", () => {
    const { stdout, exitCode } = runCli(["openapi", "search", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("hotel-list");
    expect(stdout).toContain("hotel-rates");
    expect(stdout).toContain("check-avail");
    expect(stdout).toContain("destinations");
  });

  it("openapi trade --help should list trade commands", () => {
    const { stdout, exitCode } = runCli(["openapi", "trade", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("book");
    expect(stdout).toContain("cancel");
    expect(stdout).toContain("query-orders");
  });
});

describe("Portal group", () => {
  it("portal --help should show all subgroups", () => {
    const { stdout, exitCode } = runCli(["portal", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("orders");
    expect(stdout).toContain("users");
    expect(stdout).toContain("entity");
    expect(stdout).toContain("subscriptions");
    expect(stdout).toContain("suppliers");
  });

  it("portal orders --help should list order commands", () => {
    const { stdout, exitCode } = runCli(["portal", "orders", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("detail");
  });

  it("portal users --help should list user commands", () => {
    const { stdout, exitCode } = runCli(["portal", "users", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("invite");
  });

  it("portal entity --help should list entity commands", () => {
    const { stdout, exitCode } = runCli(["portal", "entity", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("list");
    expect(stdout).toContain("get");
  });
});