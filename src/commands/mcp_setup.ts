/**
 * commands/mcp_setup.ts — `hbcli mcp setup [client]`: one-command agent wiring.
 *
 * Every quickstart card on hotelbyte.com starts with `hbcli mcp setup <client>`:
 *  - file-based clients (Cursor, Codex, VS Code, Cline) get their config
 *    written/merged automatically (other servers in the file are preserved);
 *  - Claude Code is wired via `claude mcp add` when the CLI is on PATH;
 *  - form-based clients (ChatGPT, Claude connectors, Coze, Cherry Studio, ...)
 *    get a fresh static token plus the exact three fields to paste.
 * Every path ends with a live initialize probe against the /mcp endpoint.
 */

import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Ctx } from "./helpers.ts";
import { emit } from "../utils/output.ts";
import {
  DEFAULT_AGENT_IDLE_SECONDS,
  getBearerTicket,
  issueAgentToken,
  resolveEndpoint,
} from "../core/mcp_bridge.ts";

type ClientId =
  | "claude-code" | "cursor" | "chatgpt" | "codex" | "claude-connectors"
  | "grok" | "trae" | "vscode" | "cline" | "doubao" | "workbuddy" | "coze" | "cherry" | "generic";

interface ClientSpec {
  label: string;
  kind: "file" | "claude-cli" | "token";
}

const CLIENTS: Record<ClientId, ClientSpec> = {
  "claude-code": { label: "Claude Code", kind: "claude-cli" },
  cursor: { label: "Cursor", kind: "file" },
  chatgpt: { label: "ChatGPT (custom plugin)", kind: "token" },
  codex: { label: "Codex", kind: "file" },
  "claude-connectors": { label: "Claude Desktop / Web connectors", kind: "token" },
  grok: { label: "Grok Bot (local config.toml)", kind: "file" },
  trae: { label: "Trae / Traex", kind: "file" },
  vscode: { label: "VS Code · Copilot", kind: "file" },
  cline: { label: "Cline", kind: "file" },
  doubao: { label: "豆包 Doubao (desktop connectors)", kind: "token" },
  workbuddy: { label: "WorkBuddy (Tencent)", kind: "token" },
  coze: { label: "Coze · 扣子", kind: "token" },
  cherry: { label: "Cherry Studio", kind: "token" },
  generic: { label: "Any other MCP client", kind: "token" },
};

/** Resolve the absolute hbcli path so GUI-launched clients (Cursor from the
 * Dock, VS Code) can spawn it even when ~/.local/bin is not on their PATH. */
function hbcliAbsolutePath(): string {
  try {
    return execSync("command -v hbcli", { encoding: "utf-8", shell: process.env.SHELL ?? "/bin/sh" }).trim();
  } catch {
    return process.argv[1] ? realpathSync(process.argv[1]) : "hbcli";
  }
}

const STdioEntry = (command = "hbcli"): Record<string, unknown> => ({
  command,
  args: ["mcp", "serve"],
});

function clineSettingsPath(): string {
  const home = homedir();
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
  }
  if (process.platform === "win32") {
    return join(home, "AppData", "Roaming", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
  }
  return join(home, ".config", "Code", "User", "globalStorage", "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json");
}

function configFileFor(id: ClientId): { path: string; key: "mcpServers" | "servers" } | null {
  switch (id) {
    case "cursor": return { path: join(homedir(), ".cursor", "mcp.json"), key: "mcpServers" };
    case "vscode": return { path: join(process.cwd(), ".vscode", "mcp.json"), key: "servers" };
    case "cline": return { path: clineSettingsPath(), key: "mcpServers" };
    default: return null;
  }
}

/** Merge the hotelbyte stdio entry into an mcp.json-style file without
 * touching other servers. Returns a human summary for the report. */
export function mergeMcpJson(existingRaw: string | null, key: "mcpServers" | "servers", command = "hbcli"): string {
  let doc: Record<string, unknown> = {};
  if (existingRaw && existingRaw.trim()) {
    doc = JSON.parse(existingRaw) as Record<string, unknown>;
  }
  const servers = (doc[key] as Record<string, unknown> | undefined) ?? {};
  servers.hotelbyte = STdioEntry(command);
  doc[key] = servers;
  return JSON.stringify(doc, null, 2) + "\n";
}

/** Append a [mcp_servers.hotelbyte] section to Codex config.toml, or return
 * null when the section already exists (never rewrite TOML we don't own). */
export function appendCodexToml(existingRaw: string | null, command = "hbcli"): string | null {
  if (existingRaw && existingRaw.includes("[mcp_servers.hotelbyte]")) return null;
  const section = `\n[mcp_servers.hotelbyte]\ncommand = "${command}"\nargs = ["mcp", "serve"]\n`;
  return (existingRaw ?? "") + section;
}

async function verifyEndpoint(endpoint: string, token: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "hbcli-setup", version: "1.0" } },
      }),
    });
    if (resp.ok) return { ok: true, detail: `initialize → HTTP ${resp.status}` };
    return { ok: false, detail: `initialize → HTTP ${resp.status} ${resp.statusText}` };
  } catch (err) {
    return { ok: false, detail: `initialize failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

function tokenGuide(id: ClientId, token: string, endpoint: string): string[] {
  const auth = `Header: Authorization\nValue:  Bearer ${token}`;
  switch (id) {
    case "chatgpt":
      return [
        "ChatGPT → New Plugin (developer mode), then paste:",
        `  Server URL:      ${endpoint}`,
        "  Authentication:  API key   ← NOT OAuth (creation fails on the OAuth probe)",
        auth,
      ];
    case "claude-connectors":
      return [
        "Claude → Settings → Extensions/Connectors → Add custom connector:",
        `  URL:             ${endpoint}`,
        `  Authentication:  Bearer token → ${token}`,
      ];
    case "doubao":
      return [
        "豆包电脑版 → 侧边栏 技能·连接器 → 新建 → 自定义连接器:",
        `  URL:   ${endpoint}`,
        `  token: ${token}`,
        "（或命令方式：运行命令 hbcli、参数 mcp serve）",
      ];
    case "workbuddy":
      return [
        "WorkBuddy → MCP 连接器 → 自定义 MCP Server:",
        `  URL:             ${endpoint}`,
        auth,
      ];
    case "coze":
      return [
        "Coze → Bot/工作流 → 扩展 → MCP (Streamable HTTP):",
        `  URL:             ${endpoint}`,
        auth,
      ];
    case "cherry":
      return [
        "Cherry Studio → 设置 → MCP 服务器 → 添加:",
        "  Type: Streamable HTTP",
        `  URL:  ${endpoint}`,
        auth,
      ];
    default:
      return [
        "Point your MCP client at:",
        `  URL:  ${endpoint}`,
        auth,
      ];
  }
}

export function createMcpSetupCommand(ctx: Ctx): Command {
  const setup = new Command("setup")
    .description("One-command agent wiring: writes the client config (or prints the exact fields to paste) and verifies the connection")
    .argument("[client]", `agent to wire: ${Object.keys(CLIENTS).join(", ")}`)
    .option("--idle-seconds <s>", "Idle window for issued static tokens (default 30d)", parseInt)
    .action(async (clientId: string | undefined, opts: { idleSeconds?: number }) => {
      const env = ctx.env();

      // Resolve the client (interactive when omitted).
      let id: ClientId | undefined = clientId as ClientId | undefined;
      if (id && !(id in CLIENTS)) {
        throw new Error(`Unknown client "${clientId}". Choose one of: ${Object.keys(CLIENTS).join(", ")}`);
      }
      if (!id) {
        console.log("\nWire which agent? (one-command setup)\n");
        const ids = Object.keys(CLIENTS) as ClientId[];
        ids.forEach((k, i) => console.log(`  ${i + 1}. ${CLIENTS[k].label}`));
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await rl.question("\nNumber: ");
        rl.close();
        const n = parseInt(answer.trim(), 10);
        id = ids[n - 1];
        if (!id) throw new Error("Invalid selection.");
      }
      const spec = CLIENTS[id];

      // Credentials first — token clients need static issuance, stdio rides the store.
      const report: Record<string, unknown> = { client: spec.label, env };
      const { token: sessionToken, profile } = await getBearerTicket(env);
      const endpoint = resolveEndpoint(profile);
      report.endpoint = endpoint;

      let pastedToken = "";
      if (spec.kind === "token") {
        const { token } = await issueAgentToken(env, opts.idleSeconds);
        pastedToken = token;
        report.tokenIssued = true;
        report.idleSeconds = opts.idleSeconds ?? DEFAULT_AGENT_IDLE_SECONDS;
      }

      const steps: string[] = [];
      if (spec.kind === "claude-cli") {
        try {
          execSync("claude --version", { stdio: "ignore" });
          execSync(`claude mcp add hotelbyte --scope user -- ${hbcliAbsolutePath()} mcp serve`, { stdio: "inherit" });
          steps.push("✓ `claude mcp add hotelbyte --scope user -- hbcli mcp serve` executed (user scope)");
          report.configured = "claude-mcp-add";
        } catch {
          steps.push("Claude CLI not found on PATH or the add failed — paste this into ~/.claude.json → mcpServers:");
          steps.push(`  ${JSON.stringify({ hotelbyte: STdioEntry(hbcliAbsolutePath()) })}`);
          report.configured = "manual-json";
        }
      } else if (spec.kind === "file") {
        const tomlPaths: Partial<Record<ClientId, string>> = {
          codex: join(homedir(), ".codex", "config.toml"),
          grok: join(homedir(), ".grok", "config.toml"),
          trae: join(homedir(), ".trae", "traecli.toml"),
        };
        const tomlPath = id ? tomlPaths[id] : undefined;
        if (tomlPath) {
          const existing = existsSync(tomlPath) ? readFileSync(tomlPath, "utf-8") : null;
          const next = appendCodexToml(existing, hbcliAbsolutePath());
          if (next === null) {
            steps.push(`✓ ${tomlPath} already has [mcp_servers.hotelbyte] — nothing to do`);
          } else {
            mkdirSync(dirname(tomlPath), { recursive: true });
            writeFileSync(tomlPath, next, "utf-8");
            steps.push(`✓ wrote [mcp_servers.hotelbyte] into ${tomlPath}`);
          }
          report.configFile = tomlPath;
        } else {
          const target = configFileFor(id);
          if (!target) throw new Error("No config path for this client.");
          const existing = existsSync(target.path) ? readFileSync(target.path, "utf-8") : null;
          const merged = mergeMcpJson(existing, target.key, hbcliAbsolutePath());
          mkdirSync(dirname(target.path), { recursive: true });
          writeFileSync(target.path, merged, "utf-8");
          steps.push(`✓ merged hotelbyte into ${target.path} (other servers preserved)`);
          report.configFile = target.path;
        }
      } else {
        steps.push(`Static token issued (idle window ${Math.round((opts.idleSeconds ?? DEFAULT_AGENT_IDLE_SECONDS) / 86400)}d, absolute lifetime ≤365d):`);
        steps.push(...tokenGuide(id!, pastedToken, endpoint));
        steps.push("Treat the token like a password — revoke by freezing the API user in the portal.");
      }

      // Live verify: initialize through the same path the agent will use.
      const verifyToken = spec.kind === "token" ? pastedToken : sessionToken;
      const verify = await verifyEndpoint(endpoint, verifyToken);
      report.verified = verify.ok;
      report.verifyDetail = verify.detail;

      if (ctx.jsonMode()) {
        emit({ ...report, steps }, true);
        return;
      }
      console.log(`\nhotelbyte MCP setup — ${spec.label} (env=${env})\n`);
      steps.forEach((s) => console.log(`  ${s}`));
      console.log(`\n  Connection check: ${verify.ok ? "✓ " : "✗ "}${verify.detail}`);
      if (!verify.ok) {
        console.log("  The endpoint rejected the probe — check credentials (`hbcli auth set-credentials`) and try again.");
      }
      console.log("");
    });
  return setup;
}
