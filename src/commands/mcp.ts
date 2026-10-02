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
import { getBearerTicket, resolveEndpoint, runStdioBridge } from "../core/mcp_bridge.ts";

export function createMcpCommand(ctx: Ctx): Command {
  const mcp = new Command("mcp").description("Local MCP gateway (stdio bridge to the hosted /mcp endpoint)");

  mcp
    .command("serve")
    .description("Run the local stdio MCP gateway for AI agents (Claude Code, Codex, Cursor, ...)")
    .option("--url <url>", "Remote /mcp endpoint override (default: <baseUrl>/mcp of --env)")
    .option("--token <token>", "Bearer token override (default: stored credentials)")
    .option("--timeout-ms <ms>", "Upstream request timeout", parseInt)
    .action(async (opts: { url?: string; token?: string; timeoutMs?: number }) => {
      const env = ctx.env();
      const { token: storedToken, profile } = await getBearerTicket(env);
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

  return mcp;
}
