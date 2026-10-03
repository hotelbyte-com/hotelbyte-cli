/**
 * tests/agents.test.ts — `hbcli agents` command group (management plane).
 *
 * In-process commander tests: the factory is registered into a fresh program
 * and actions run against a global.fetch stub (tests/auth.test.ts pattern)
 * with an isolated STAICLI_HOME seeded by a cached ticket, so makeClient
 * performs zero auth HTTP calls. Asserts request paths and bodies against
 * the bi/agent service contracts (agent/service/api.go), the --confirm write
 * guard (positive + negative), and the command tree.
 * No live environment; no secrets in fixtures.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { createAgentsCommand } from "../src/commands/agents.ts";
import { ENVIRONMENTS } from "../src/core/config.ts";

const TMP_HOME = join(import.meta.dir, ".tmp-test-home-agents");

const captured: { url: string; body: Record<string, unknown> }[] = [];
let originalFetch: typeof fetch;

/** Stub global.fetch: record url + parsed body, answer the standard envelope. */
function stubFetch(data: unknown = { ok: true }): void {
  global.fetch = (async (url: unknown, init?: RequestInit) => {
    captured.push({
      url: String(url),
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ code: 0, msg: "ok", data }), { status: 200 });
  }) as typeof fetch;
}

/**
 * In-process stand-in for process.exit: the write guard calls exit(1) after
 * error(); capture the code by throwing instead of killing the test runner.
 */
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
  // Cached openapi ticket → makeClient goes straight to the ticket flow.
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
  p.addCommand(createAgentsCommand({ jsonMode: () => true, env: () => "uat" }));
  return p;
}

const BASE = ENVIRONMENTS.uat;

describe("agents command tree", () => {
  it("registers runs (list/get/messages), skills (list/get), knowledge tree and dispatch", () => {
    const agents = program().commands.find((c) => c.name() === "agents");
    expect(agents).toBeDefined();
    const runs = agents?.commands.find((c) => c.name() === "runs");
    expect(runs?.commands.map((c) => c.name())).toEqual(["list", "get", "messages"]);
    const skills = agents?.commands.find((c) => c.name() === "skills");
    expect(skills?.commands.map((c) => c.name())).toEqual(["list", "get"]);
    const knowledge = agents?.commands.find((c) => c.name() === "knowledge");
    expect(knowledge?.commands.map((c) => c.name())).toEqual(["tree"]);
    expect(agents?.commands.map((c) => c.name())).toContain("dispatch");
  });

  it("documents --confirm on the write subcommands", () => {
    const agents = program().commands.find((c) => c.name() === "agents");
    for (const path of [["runs", "messages"], ["dispatch"]]) {
      let cmd = agents;
      for (const seg of path) cmd = cmd?.commands.find((c) => c.name() === seg);
      expect(cmd?.options.some((o) => o.long === "--confirm")).toBe(true);
    }
  });
});

describe("agents runs (CLI request shapes)", () => {
  it("list sends profileId + pagination to /api/bi/agent/listAgentRuns", async () => {
    stubFetch({ runs: [], total: 0 });
    await program().parseAsync(["agents", "runs", "list", "--profile-id", "tenant_data_agent", "--page-size", "5"], { from: "user" });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${BASE}/api/bi/agent/listAgentRuns`);
    expect(captured[0]?.body).toEqual({ profileId: "tenant_data_agent", pageNum: 1, pageSize: 5 });
  });

  it("get sends runId + message pagination to /api/bi/agent/getAgentRun", async () => {
    stubFetch({ run: { runId: "r1" }, messages: [] });
    await program().parseAsync(["agents", "runs", "get", "--run-id", "r1"], { from: "user" });
    expect(captured[0]?.url).toBe(`${BASE}/api/bi/agent/getAgentRun`);
    expect(captured[0]?.body).toEqual({ runId: "r1", pageNum: 1, pageSize: 20 });
  });

  it("messages is a write: refused without --confirm, sent with it", async () => {
    // Negative: guard fires before any HTTP call.
    const code = await captureExit(() =>
      program().parseAsync(["agents", "runs", "messages", "--run-id", "r1", "--message", "hi"], { from: "user" }),
    );
    expect(code).toBe(1);
    expect(captured).toHaveLength(0);

    // Positive: --confirm carries the AgentMessageSendReq contract.
    stubFetch({ run: { runId: "r1" }, messages: [{ role: "assistant" }] });
    await program().parseAsync(
      ["agents", "runs", "messages", "--run-id", "r1", "--message", "hi", "--idempotency-key", "k1", "--model", "gpt-x", "--confirm"],
      { from: "user" },
    );
    expect(captured[0]?.url).toBe(`${BASE}/api/bi/agent/sendAgentMessage`);
    expect(captured[0]?.body).toEqual({ runId: "r1", userMessage: "hi", idempotencyKey: "k1", modelOverride: "gpt-x" });
  });
});

describe("agents skills + knowledge (CLI request shapes)", () => {
  it("skills list omits unset profileId toward /api/bi/agent/listAgentSkills", async () => {
    stubFetch({ skills: [{ id: "s1" }] });
    await program().parseAsync(["agents", "skills", "list"], { from: "user" });
    expect(captured[0]?.url).toBe(`${BASE}/api/bi/agent/listAgentSkills`);
    expect(captured[0]?.body).toEqual({});

    captured.length = 0;
    await program().parseAsync(["agents", "skills", "list", "--profile-id", "p1"], { from: "user" });
    expect(captured[0]?.body).toEqual({ profileId: "p1" });
  });

  it("skills get maps to exportAgentSkill with skillId", async () => {
    stubFetch({ skill: { id: "s1", content: "# t" } });
    await program().parseAsync(["agents", "skills", "get", "--skill-id", "s1", "--profile-id", "p1"], { from: "user" });
    expect(captured[0]?.url).toBe(`${BASE}/api/bi/agent/exportAgentSkill`);
    expect(captured[0]?.body).toEqual({ skillId: "s1", profileId: "p1" });
  });

  it("knowledge tree maps to listAgentKnowledgeTree", async () => {
    stubFetch({ profileId: "p1", tree: { id: "root" } });
    await program().parseAsync(["agents", "knowledge", "tree", "--profile-id", "p1"], { from: "user" });
    expect(captured[0]?.url).toBe(`${BASE}/api/bi/agent/listAgentKnowledgeTree`);
    expect(captured[0]?.body).toEqual({ profileId: "p1" });
  });
});

describe("agents dispatch write guard (--confirm)", () => {
  it("refuses without --confirm and never reaches the server", async () => {
    const code = await captureExit(() =>
      program().parseAsync(["agents", "dispatch", "--run-id", "r1", "--action-id", "a1"], { from: "user" }),
    );
    expect(code).toBe(1);
    expect(captured).toHaveLength(0);
  });

  it("confirms the pending action with --confirm via confirmAgentAction", async () => {
    stubFetch({ action: { actionId: "a1", status: "confirmed" }, job: { jobId: "j1" } });
    await program().parseAsync(["agents", "dispatch", "--run-id", "r1", "--action-id", "a1", "--confirm"], { from: "user" });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.url).toBe(`${BASE}/api/bi/agent/confirmAgentAction`);
    expect(captured[0]?.body).toEqual({ runId: "r1", actionId: "a1" });
  });
});
