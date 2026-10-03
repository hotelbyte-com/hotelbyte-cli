/**
 * commands/mcp.ts — `hbcli mcp serve`: local stdio MCP gateway.
 *
 * The local half of the unified AI interface: agents talk MCP-over-stdio to
 * this process, it forwards verbatim to the hosted /mcp endpoint. Agent
 * configs contain only `hbcli mcp serve` — zero secrets in .mcp.json (the
 * key lives in the CLI credential store, chmod 600).
 *
 * Usage in Claude Code / Cursor / Codex:
 *   { "mcpServers": { "hotelbyte": { "command": "hbcli", "args": ["mcp", "serve"] } } }
 *
 * Env/lane switching rides the existing global --env flag; --url/--token are
 * escape hatches for CI and sandboxes.
 */

import { Command } from "commander";
import { createInterface } from "node:readline";
import type { Ctx } from "./helpers.ts";
import { emit } from "../utils/output.ts";
import {
  DEFAULT_AGENT_IDLE_SECONDS,
  getBearerTicket,
  issueAgentToken,
  resolveEndpoint,
  runStdioBridge,
} from "../core/mcp_bridge.ts";

export function createMcpCommand(ctx: Ctx): Command {
  const mcp = new Command("mcp").description("Local MCP gateway (stdio bridge to the hosted /mcp endpoint)");

  mcp
    .command("serve")
    .description("Run the local stdio MCP gateway for AI agents (Claude Code, Codex, Cursor, ...)")
    .option("--url <url>", "Remote /mcp endpoint override (default: <baseUrl>/mcp of --env)")
    .option("--token <token>", "Bearer token override (default: stored credentials)")
    .option("--demo", "Use the shared sandbox demo identity (hotel-be#32386)")
    .option("--timeout-ms <ms>", "Upstream request timeout", parseInt)
    .action(async (opts: { url?: string; token?: string; timeoutMs?: number; demo?: boolean }) => {
      const env = ctx.env();
      const { token: storedToken, profile } = await getBearerTicket(env, { demo: opts.demo });
      const endpoint = resolveEndpoint(profile, opts.url);
      const token = opts.token ?? storedToken;

      // stdout is the protocol channel: every diagnostic goes to stderr.
      console.error(`hbcli mcp gateway → ${endpoint} (env=${env})`);

      const rl = createInterface({ input: process.stdin, terminal: false });
      const lines: AsyncIterable<string> = rl;
      const write = (line: string) => process.stdout.write(line + "\n");
      const log = (msg: string) => console.error(msg);

      await runStdioBridge(endpoint, token, lines, write, log, opts.timeoutMs);
    });

  mcp
    .command("token")
    .description("Issue a static agent token (long-idle ticket) for remote MCP configs and print agent config snippets")
    .option("--idle-seconds <s>", "Idle window before the token dies (default 30d; absolute lifetime capped at 365d by the server)", parseInt)
    .action(async (opts: { idleSeconds?: number }) => {
      const env = ctx.env();
      const { token, endpoint } = await issueAgentToken(env, opts.idleSeconds);
      const idle = opts.idleSeconds ?? DEFAULT_AGENT_IDLE_SECONDS;

      if (ctx.jsonMode()) {
        emit({ token, endpoint, idleSeconds: idle }, true);
        return;
      }

      console.log(`Static agent token (env=${env}, idle window ${Math.round(idle / 86400)}d, absolute lifetime ≤365d):`);
      console.log("");
      console.log(`  ${token}`);
      console.log("");
      console.log("Recommended — local gateway (zero secrets in agent config):");
      console.log(`  { "mcpServers": { "hotelbyte": { "command": "hbcli", "args": ["mcp", "serve"] } } }`);
      console.log("");
      console.log("Direct (hosted platforms that cannot run binaries — token lands in the config file):");
      console.log(`  { "mcpServers": { "hotelbyte": { "type": "http", "url": "${endpoint}",`);
      console.log(`      "headers": { "Authorization": "Bearer ${token}" } } } }`);
      console.log("");
      console.log("Treat the token like a password. Revoke: freeze/delete the API user in the portal.");
      console.log("The token is also stored in the CLI credential store, so `hbcli mcp serve` rides it.");
    });

  return mcp;
}
