/**
 * tests/whitelabel.test.ts — `hbcli whitelabel` command group.
 *
 * In-process commander tests: the factory is registered into a fresh program
 * and actions run against a global.fetch stub (tests/auth.test.ts pattern)
 * with an isolated STAICLI_HOME seeded by a cached ticket. Asserts request
 * paths and bodies against the whitelabel service contracts
 * (user/protocol/whitelabel.go), the --confirm write guard (positive +
 * negative), and the command tree.
 * No live environment; no secrets in fixtures.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createWhitelabelCommand } from "../src/commands/whitelabel.ts";
import { ENVIRONMENTS } from "../src/core/config.ts";

const TMP_HOME = join(import.meta.dir, ".tmp-test-home-whitelabel");

const captured: { url: string; body: Record<string, unknown> }[] = [];
let originalFetch: typeof fetch;

function stubFetch(data: unknown = { ok: true }): void {
  global.fetch = (async (url: unknown, init?: RequestInit) => {
    captured.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ code: 0, msg: "ok", data }), { status: 200 });
  }) as typeof fetch;
}

class ExitSignal extends Error {
  constructor(public code: number | undefined) {
    super(`exit ${code}`);
  }
}
let originalExit: typeof process.exit;
async function captureExit(fn: () => Promise<void>): Promise<number | undefined> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    if (e instanceof ExitSignal) return e.code;
    throw e;
  }
}

beforeEach(() => {
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
  mkdirSync(TMP_HOME, { recursive: true });
  process.env.STAICLI_HOME = TMP_HOME;
  writeFileSync(join(TMP_HOME, "credentials.json"), JSON.stringify({ "openapi:uat": { ticket: "stub-ticket" } }));
  originalFetch = global.fetch;
  originalExit = process.exit;
  process.exit = ((code?: number) => {
    throw new ExitSignal(code);
  }) as typeof process.exit;
  stubFetch();
  captured.length = 0;
});

afterEach(() => {
  global.fetch = originalFetch;
  process.exit = originalExit;
  delete process.env.STAICLI_HOME;
  if (existsSync(TMP_HOME)) rmSync(TMP_HOME, { recursive: true });
});

function program(): Command {
  const p = new Command();
  p.addCommand(createWhitelabelCommand({ jsonMode: () => true, env: () => "uat" }));
  return p;
}

const BASE = ENVIRONMENTS.uat;

describe("whitelabel command tree", () => {
  it("registers get/update and the domains (add/remove) subgroup", () => {
    const wl = program().commands.find((c) => c.name() === "whitelabel");
    expect(wl).toBeDefined();
    expect(wl?.commands.map((c) => c.name())).toEqual(["get", "update", "domains"]);
    const domains = wl?.commands.find((c) => c.name() === "domains");
    expect(domains?.commands.map((c) => c.name())).toEqual(["add", "remove"]);
  });

  it("documents --confirm on the write subcommands", () => {
    const wl = program().commands.find((c) => c.name() === "whitelabel");
    expect(wl?.commands.find((c) => c.name() === "update")?.options.some((o) => o.long === "--confirm")).toBe(true);
    const domains = wl?.commands.find((c) => c.name() === "domains");
    for (const name of ["add", "remove"]) {
      expect(domains?.commands.find((c) => c.name() === name)?.options.some((o) => o.long === "--confirm")).toBe(true);
    }
  });
});

describe("whitelabel reads (CLI request shapes)", () => {
  it("get posts an empty body to /api/whitelabel/getWhiteLabelConfig", async () => {
    stubFetch({ whiteLabelConfig: { brandAssets: { logo: "/x.png" } } });
    await program().parseAsync(["whitelabel", "get"], { from: "user" });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${BASE}/api/whitelabel/getWhiteLabelConfig`);
    expect(captured[0]?.body).toEqual({});
  });
});

describe("whitelabel write guard (--confirm)", () => {
  it("update / domains add / domains remove refuse without --confirm and never reach the server", async () => {
    for (const args of [
      ["whitelabel", "update", "--data", '{"themeConfig":{"primaryColor":"#0055ff"}}'],
      ["whitelabel", "domains", "add", "--domain", "shop.corp.com"],
      ["whitelabel", "domains", "remove", "--domain", "shop.corp.com"],
    ]) {
      const code = await captureExit(() => program().parseAsync(args, { from: "user" }));
      expect(code).toBe(1);
    }
    expect(captured).toHaveLength(0);
  });

  it("update wraps the payload as {whiteLabelConfig} with --confirm", async () => {
    stubFetch({});
    await program().parseAsync(["whitelabel", "update", "--data", '{"themeConfig":{"primaryColor":"#0055ff"}}', "--confirm"], {
      from: "user",
    });
    expect(captured[0]?.url).toBe(`${BASE}/api/whitelabel/updateWhiteLabelConfig`);
    expect(captured[0]?.body).toEqual({ whiteLabelConfig: { themeConfig: { primaryColor: "#0055ff" } } });
  });

  it("domains add / remove carry the {domain} contract with --confirm", async () => {
    stubFetch({});
    await program().parseAsync(["whitelabel", "domains", "add", "--domain", "shop.corp.com", "--confirm"], { from: "user" });
    expect(captured[0]?.url).toBe(`${BASE}/api/whitelabel/addCustomDomain`);
    expect(captured[0]?.body).toEqual({ domain: "shop.corp.com" });

    captured.length = 0;
    stubFetch({});
    await program().parseAsync(["whitelabel", "domains", "remove", "--domain", "shop.corp.com", "--confirm"], { from: "user" });
    expect(captured[0]?.url).toBe(`${BASE}/api/whitelabel/removeCustomDomain`);
    expect(captured[0]?.body).toEqual({ domain: "shop.corp.com" });
  });
});
