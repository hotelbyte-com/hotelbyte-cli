/**
 * tests/rules.test.ts — `hbcli rules` command group.
 *
 * In-process commander tests: the factory is registered into a fresh program
 * and actions run against a global.fetch stub (tests/auth.test.ts pattern)
 * with an isolated STAICLI_HOME seeded by a cached ticket. Asserts request
 * paths and bodies against the rule service contracts (rule/protocol/rule.go,
 * rule/service/rule.go), the --confirm write guard (positive + negative),
 * the @file params splice, and the command tree.
 * No live environment; no secrets in fixtures.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createRulesCommand } from "../src/commands/rules.ts";
import { ENVIRONMENTS } from "../src/core/config.ts";

const TMP_HOME = join(import.meta.dir, ".tmp-test-home-rules");
const TMP_PARAMS = join(TMP_HOME, "params.json");

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
async function captureExit(fn: () => Promise<unknown>): Promise<number | undefined> {
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
  p.addCommand(createRulesCommand({ jsonMode: () => true, env: () => "uat" }));
  return p;
}

const BASE = ENVIRONMENTS.uat;

describe("rules command tree", () => {
  it("registers list/get/metadata/factors/families/upsert/simulate", () => {
    const rules = program().commands.find((c) => c.name() === "rules");
    expect(rules?.commands.map((c) => c.name())).toEqual([
      "list",
      "get",
      "metadata",
      "factors",
      "families",
      "upsert",
      "simulate",
    ]);
  });

  it("documents --confirm on the write subcommands", () => {
    const rules = program().commands.find((c) => c.name() === "rules");
    for (const name of ["upsert", "simulate"]) {
      const cmd = rules?.commands.find((c) => c.name() === name);
      expect(cmd?.options.some((o) => o.long === "--confirm")).toBe(true);
    }
  });
});

describe("rules reads (CLI request shapes)", () => {
  it("list defaults to /api/rule/getRules with an empty body", async () => {
    stubFetch([{ id: 1 }]);
    await program().parseAsync(["rules", "list"], { from: "user" });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${BASE}/api/rule/getRules`);
    expect(captured[0]?.body).toEqual({});
  });

  it("list with family/phase filters switches to /api/rule/getRulesFiltered", async () => {
    stubFetch([]);
    await program().parseAsync(["rules", "list", "--family", "markup", "--phase", "pre_order"], { from: "user" });
    expect(captured[0]?.url).toBe(`${BASE}/api/rule/getRulesFiltered`);
    expect(captured[0]?.body).toEqual({ family: "markup", phase: "pre_order" });

    captured.length = 0;
    await program().parseAsync(["rules", "list", "--phase", "cron_eval"], { from: "user" });
    expect(captured[0]?.body).toEqual({ phase: "cron_eval" });
  });

  it("get sends a numeric id (types.ID wire contract) to /api/rule/getRule", async () => {
    stubFetch({ id: 7, name: "r" });
    await program().parseAsync(["rules", "get", "--id", "7"], { from: "user" });
    expect(captured[0]?.url).toBe(`${BASE}/api/rule/getRule`);
    expect(captured[0]?.body).toEqual({ id: 7 });
  });

  it("metadata / factors / families hit their metadata endpoints with empty bodies", async () => {
    stubFetch({ factors: [], actions: [] });
    await program().parseAsync(["rules", "metadata"], { from: "user" });
    expect(captured[0]?.url).toBe(`${BASE}/api/rule/getRuleMetadata`);
    expect(captured[0]?.body).toEqual({});

    captured.length = 0;
    await program().parseAsync(["rules", "factors"], { from: "user" });
    expect(captured[0]?.url).toBe(`${BASE}/api/rule/getFactorMetadata`);

    captured.length = 0;
    await program().parseAsync(["rules", "families"], { from: "user" });
    expect(captured[0]?.url).toBe(`${BASE}/api/rule/getRuleFamilies`);
  });
});

describe("rules write guard (--confirm)", () => {
  const condition = `{"type":"compare","left":1,"op":">","right":0}`;
  const aim = `{"actions":[{"name":"markup","params":{"percent":5}}]}`;

  it("upsert / simulate refuse without --confirm and never reach the server", async () => {
    for (const args of [
      ["rules", "upsert", "--data", '{"name":"r"}'],
      ["rules", "simulate", "--condition", condition, "--params", "{}", "--aim", aim],
    ]) {
      const code = await captureExit(() => program().parseAsync(args, { from: "user" }));
      expect(code).toBe(1);
    }
    expect(captured).toHaveLength(0);
  });

  it("upsert sends the parsed domain.Rule payload with --confirm", async () => {
    stubFetch({ id: 9, name: "r" });
    await program().parseAsync(["rules", "upsert", "--data", '{"id":9,"name":"r","condition":"{}","aim":"{}"}', "--confirm"], {
      from: "user",
    });
    expect(captured[0]?.url).toBe(`${BASE}/api/rule/upsertRule`);
    expect(captured[0]?.body).toEqual({ id: 9, name: "r", condition: "{}", aim: "{}" });
  });

  it("simulate sends condition/params/aim strings (params stays a JSON string) with --confirm", async () => {
    stubFetch({ aim: "{}", extra: { passed: true } });
    await program().parseAsync(
      ["rules", "simulate", "--condition", condition, "--params", '{"basePrice":100}', "--aim", aim, "--family", "markup", "--confirm"],
      { from: "user" },
    );
    expect(captured[0]?.url).toBe(`${BASE}/api/rule/simulateRule`);
    expect(captured[0]?.body).toEqual({
      condition,
      params: '{"basePrice":100}',
      aim,
      family: "markup",
    });
  });

  it("simulate splices @file params verbatim as the wire string", async () => {
    stubFetch({ aim: "{}" });
    writeFileSync(TMP_PARAMS, '{"basePrice":42}');
    await program().parseAsync(
      ["rules", "simulate", "--condition", condition, `--params`, `@${TMP_PARAMS}`, "--aim", aim, "--confirm"],
      { from: "user" },
    );
    expect(captured[0]?.body).toEqual({ condition, params: '{"basePrice":42}', aim });
  });
});
