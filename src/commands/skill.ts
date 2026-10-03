/**
 * commands/skill.ts — `hbcli skill install`: wire the HotelByte agent skill.
 *
 * The skill's single source of truth is the BE tool contract, rendered to
 * SKILL.md (mcp/gateway/cmd/renderskill, drift-guarded by tests) and published
 * at https://hotelbyte.com/skills/hotelbyte/SKILL.md. This command installs it
 * into the client's skills directory so the agent picks it up automatically.
 */

import { Command } from "commander";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Ctx } from "./helpers.ts";
import { emit } from "../utils/output.ts";

// Primary source is the OPEN skill repo (users can read/fork/audit it);
// the site mirror is the fallback. A skill is a directory: SKILL.md plus
// scripts/ and references/ — every file on this manifest is installed.
export const SKILL_FILE_MANIFEST = [
  "SKILL.md",
  "scripts/doctor.sh",
  "references/tools.md",
] as const;

const SKILL_SOURCE_ROOTS = [
  "https://raw.githubusercontent.com/hotelbyte-com/hotelbyte-skills/main",
  "https://hotelbyte.com/skills/hotelbyte",
] as const;

type ClientId = "claude-code" | "grok" | "trae" | "codex" | "qoder";

// Clients with a native skills directory (<home>/.<agent>/skills/<name>/SKILL.md).
// Clients without one (Cursor, ChatGPT, VS Code, Cline, 豆包, WorkBuddy, Coze,
// Cherry Studio) are MCP-config-only — their tool surface carries the skill
// knowledge via the MCP tool descriptions.
const CLIENT_DIRS: Record<ClientId, string> = {
  "claude-code": join(homedir(), ".claude", "skills", "hotelbyte"),
  grok: join(homedir(), ".grok", "skills", "hotelbyte"),
  trae: join(homedir(), ".trae", "skills", "hotelbyte"),
  codex: join(homedir(), ".codex", "skills", "hotelbyte"),
  qoder: join(homedir(), ".qoder", "skills", "hotelbyte"),
};

/** Install the skill directory into one client (returns written files).
 *  Shared by `skill install` and `mcp setup` so wiring an agent config
 *  and its skill always land together. */
export async function installSkillForClient(ctx: Ctx, client: ClientId): Promise<string[]> {
  const dir = CLIENT_DIRS[client];
  const written: string[] = [];
  const errors: string[] = [];
  let root: string | undefined;
  for (const r of SKILL_SOURCE_ROOTS) {
    try {
      const resp = await fetch(`${r}/SKILL.md`, { redirect: "follow" });
      if (resp.ok) { root = r; break; }
      errors.push(`${r} → HTTP ${resp.status}`);
    } catch (e) {
      errors.push(`${r} → ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!root) throw new Error(`Failed to download the skill: ${errors.join("; ")}`);
  for (const rel of SKILL_FILE_MANIFEST) {
    const resp = await fetch(`${root}/${rel}`, { redirect: "follow" });
    if (!resp.ok) {
      if (rel === "SKILL.md") throw new Error(`Failed to download ${rel} (${resp.status})`);
      continue;
    }
    const target = join(dir, rel);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, await resp.text(), "utf-8");
    if (rel.endsWith(".sh")) chmodSync(target, 0o755);
    written.push(rel);
  }
  if (ctx.jsonMode()) return written;
  return written;
}

export function skillClientDir(client: ClientId): string {
  return CLIENT_DIRS[client];
}

export const SKILL_CAPABLE_CLIENTS = Object.keys(CLIENT_DIRS) as ClientId[];

export function createSkillCommand(ctx: Ctx): Command {
  const skill = new Command("skill").description("Agent skill management (install the HotelByte usage skill)");

  skill
    .command("install")
    .description("Install the HotelByte skill so agents learn efficient tool usage (large results, two-phase booking)")
    .option("--client <client>", `Target client (default: claude-code); comma-separated for several; or "all"`)
    .option("--all", "Install into every skill-capable client")
    .option("--file <path>", "Install from a local SKILL.md instead of downloading (single file, claude-code only)")
    .action(async (opts: { client?: string; file?: string; all?: boolean }) => {
      if (opts.all) {
        const done: string[] = [];
        for (const c of SKILL_CAPABLE_CLIENTS) {
          try {
            await installSkillForClient(ctx, c);
            done.push(c);
          } catch (e) {
            console.error(`  ✗ ${c}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (ctx.jsonMode()) { emit({ installed: done }, true); return; }
        console.log(`\n✓ HotelByte skill installed → ${done.join(", ")}`);
        console.log("  restart the agents and they will load automatically.\n");
        return;
      }
      const client = (opts.client ?? "claude-code") as ClientId;
      const dir = CLIENT_DIRS[client];
      if (!dir) throw new Error(`Unknown client "${opts.client}". Supported: ${Object.keys(CLIENT_DIRS).join(", ")} (or --all)`);

      let written: string[];
      if (opts.file) {
        // Offline single-file install: SKILL.md only (scripts/references absent).
        const body = (await import("node:fs")).readFileSync(opts.file, "utf-8");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "SKILL.md"), body, "utf-8");
        written = ["SKILL.md"];
      } else {
        written = await installSkillForClient(ctx, client);
      }

      const mainDoc = (await import("node:fs")).readFileSync(join(dir, "SKILL.md"), "utf-8");
      const version = /version:\s*([\d.]+)/.exec(mainDoc)?.[1] ?? "unknown";
      if (ctx.jsonMode()) {
        emit({ installed: true, dir, files: written, version }, true);
        return;
      }
      console.log(`\n✓ HotelByte skill installed → ${dir} (v${version})`);
      written.forEach((f) => console.log(`  · ${f}`));
      console.log("  self-check: bash " + join(dir, "scripts", "doctor.sh"));
      console.log("  restart the agent and it will load automatically.\n");
    });

  return skill;
}
