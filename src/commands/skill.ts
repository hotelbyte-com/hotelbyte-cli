/**
 * commands/skill.ts — `hbcli skill install`: wire the HotelByte agent skill.
 *
 * The skill's single source of truth is the BE tool contract, rendered to
 * SKILL.md (mcp/gateway/cmd/renderskill, drift-guarded by tests) and published
 * at https://hotelbyte.com/skills/hotelbyte/SKILL.md. This command installs it
 * into the client's skills directory so the agent picks it up automatically.
 */

import { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Ctx } from "./helpers.ts";
import { emit } from "../utils/output.ts";

// Primary source is the OPEN skill repo (users can read/fork/audit it);
// the site mirror is the fallback.
export const SKILL_SOURCES = [
  "https://raw.githubusercontent.com/hotelbyte-com/hotelbyte-skills/main/SKILL.md",
  "https://hotelbyte.com/skills/hotelbyte/SKILL.md",
] as const;

type ClientId = "claude-code";

const CLIENT_DIRS: Record<ClientId, string> = {
  "claude-code": join(homedir(), ".claude", "skills", "hotelbyte"),
};

export function createSkillCommand(ctx: Ctx): Command {
  const skill = new Command("skill").description("Agent skill management (install the HotelByte usage skill)");

  skill
    .command("install")
    .description("Install the HotelByte skill so agents learn efficient tool usage (large results, two-phase booking)")
    .option("--client <client>", "Target client (default: claude-code)", "claude-code")
    .option("--file <path>", "Install from a local SKILL.md instead of downloading")
    .action(async (opts: { client?: string; file?: string }) => {
      const client = (opts.client ?? "claude-code") as ClientId;
      const dir = CLIENT_DIRS[client];
      if (!dir) throw new Error(`Unknown client "${opts.client}". Supported: ${Object.keys(CLIENT_DIRS).join(", ")}`);

      let body: string;
      if (opts.file) {
        body = (await import("node:fs")).readFileSync(opts.file, "utf-8");
      } else {
        const errors: string[] = [];
        for (const src of SKILL_SOURCES) {
          try {
            const resp = await fetch(src, { redirect: "follow" });
            if (resp.ok) { body = await resp.text(); break; }
            errors.push(`${src} → HTTP ${resp.status}`);
          } catch (e) {
            errors.push(`${src} → ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (body === undefined) throw new Error(`Failed to download the skill: ${errors.join("; ")} — use --file for offline install.`);
      }

      mkdirSync(dir, { recursive: true });
      const target = join(dir, "SKILL.md");
      writeFileSync(target, body, "utf-8");

      const version = /version:\s*([\d.]+)/.exec(body)?.[1] ?? "unknown";
      if (ctx.jsonMode()) {
        emit({ installed: true, target, source: opts.file ?? SKILL_SOURCES[0], version }, true);
        return;
      }
      console.log(`\n✓ HotelByte skill installed → ${target} (v${version})`);
      console.log(`  source: ${opts.file ?? SKILL_SOURCES[0]}`);
      console.log("  restart the agent (Claude Code: new session) and it will load automatically.\n");
    });

  return skill;
}
