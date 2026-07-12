#!/usr/bin/env bun
/**
 * staicli (hbcli) — HotelByte CLI
 *
 * Brand: staicli   Command: hbcli
 *
 * Flat command tree — no profile layer. Auth is auto-detected:
 *   API key stored   → /api/auth/ticket flow (integrator)
 *   Portal login     → /api/auth/login flow (admin)
 *
 * Compile:
 *   bun build --compile --target=bun-darwin-arm64 --outfile=hbcli src/cli.ts
 */

import { Command, Option } from "commander";
import { DEFAULT_ENV, ENVIRONMENTS, STAICLI_HOME } from "./core/config.ts";
import { getState } from "./core/state.ts";
import { runRepl } from "./utils/repl.ts";
import { createAuthCommand } from "./commands/auth.ts";
import { createSearchCommand } from "./commands/search.ts";
import { createTradeCommand } from "./commands/trade.ts";
import { createOrdersCommand } from "./commands/orders.ts";
import { createTeamCommand } from "./commands/team.ts";
import { createAccountCommand } from "./commands/account.ts";
import { createViewCommand } from "./commands/view.ts";
import type { Ctx } from "./commands/helpers.ts";

// ── version ────────────────────────────────────────────────────────────

const VERSION = "0.3.0";

// ── self-update ────────────────────────────────────────────────────────

const REPO = "hotelbyte-com/hotelbyte-cli";
const GITHUB_API = `https://api.github.com/repos/${REPO}/releases/latest`;

async function selfUpdate(jsonMode: boolean): Promise<void> {
  const { emit, error } = await import("./utils/output.ts");
  try {
    const resp = await fetch(GITHUB_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!resp.ok) throw new Error(`Failed to fetch latest release: ${resp.status}`);
    const data = await resp.json() as any;
    const latest = data.tag_name?.replace(/^v/, "") ?? "unknown";

    if (latest === VERSION) {
      if (jsonMode) emit({ status: "up-to-date", version: VERSION }, true);
      else console.log(`Already at latest version ${VERSION}`);
      return;
    }

    if (!jsonMode) console.log(`Updating ${VERSION} → ${latest}…`);

    const platform = process.platform;
    const arch = process.arch;
    const assetName = `hbcli-${platform}-${arch}${platform === "win32" ? ".exe" : ""}`;
    const asset = (data.assets as any[])?.find((a: any) => a.name === assetName);
    if (!asset) throw new Error(`No binary for ${platform}/${arch}. Available: ${(data.assets as any[])?.map((a) => a.name).join(", ")}`);

    if (!jsonMode) console.log(`Downloading ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)…`);

    const binaryResp = await fetch(asset.browser_download_url);
    if (!binaryResp.ok) throw new Error(`Download failed: ${binaryResp.status}`);
    const binary = await binaryResp.arrayBuffer();

    const { join } = await import("node:path");
    const { existsSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, unlinkSync } = await import("node:fs");
    const installDir = STAICLI_HOME;
    const versionDir = join(installDir, "versions", latest);
    mkdirSync(versionDir, { recursive: true });
    const binaryPath = join(versionDir, "hbcli");
    writeFileSync(binaryPath, binary);
    chmodSync(binaryPath, 0o755);

    const currentLink = join(installDir, "current");
    if (existsSync(currentLink)) unlinkSync(currentLink);
    try { symlinkSync(versionDir, currentLink); } catch {
      writeFileSync(currentLink, binary);
    }

    const localBin = join(process.env.HOME ?? "~", ".local", "bin", "hbcli");
    const localBinDir = join(process.env.HOME ?? "~", ".local", "bin");
    if (existsSync(localBinDir)) {
      if (existsSync(localBin)) unlinkSync(localBin);
      try { symlinkSync(binaryPath, localBin); } catch {
        writeFileSync(localBin, binary);
        chmodSync(localBin, 0o755);
      }
    }

    if (jsonMode) {
      emit({ status: "updated", from: VERSION, to: latest, path: binaryPath }, true);
    } else {
      console.log(`✓ Updated to ${latest} at ${binaryPath}`);
    }
  } catch (e: any) {
    error(e.message, jsonMode);
    process.exit(1);
  }
}

function showVersion(): void {
  console.log(`hbcli (staicli) ${VERSION}`);
  console.log(`  binary: ${process.execPath ?? "(unknown)"}`);
  console.log(`  home:   ${STAICLI_HOME}`);
}

// ── main ───────────────────────────────────────────────────────────────

function main(): void {
  const program = new Command();

  program
    .name("hbcli")
    .description("staicli — HotelByte CLI\n  Search hotels, manage bookings, run your travel business from the terminal.")
    .version(VERSION)
    .option("--json", "Emit structured JSON for agent consumption.", false)
    .addOption(new Option("--env <env>", "Target environment.").choices(Object.keys(ENVIRONMENTS)).default(DEFAULT_ENV))
    .option("--repl", "Start interactive REPL mode.", false);

  // Scan global flags before subcommand
  const argv = process.argv.slice(2);
  const globalOpts: Record<string, any> = { json: false, env: DEFAULT_ENV, repl: false };
  for (const arg of argv) {
    if (!arg.startsWith("-")) break;
    if (arg === "--json") globalOpts.json = true;
    else if (arg === "--repl") globalOpts.repl = true;
    else if (arg.startsWith("--env=")) globalOpts.env = arg.slice(6);
    else if (arg === "--env") { const i = argv.indexOf(arg); if (i >= 0 && i + 1 < argv.length) globalOpts.env = argv[i + 1]; }
  }

  const ctx: Ctx = {
    jsonMode: () => globalOpts.json,
    env: () => globalOpts.env,
  };

  // Register flat command tree
  program.addCommand(createAuthCommand(ctx));
  program.addCommand(createSearchCommand(ctx));
  program.addCommand(createTradeCommand(ctx));
  program.addCommand(createOrdersCommand(ctx));
  program.addCommand(createTeamCommand(ctx));
  program.addCommand(createAccountCommand(ctx));
  program.addCommand(createViewCommand(ctx));

  // version / update
  program.command("version").description("Show version and installation path").action(showVersion);
  program.command("update").description("Update to the latest version").action(async () => { await selfUpdate(ctx.jsonMode()); });

  // REPL
  if (globalOpts.repl) {
    const state = getState();
    runRepl(program, state, VERSION).then(() => process.exit(0));
  } else {
    program.parseAsync(process.argv).catch((e: any) => {
      console.error(`Error: ${e.message}`);
      process.exit(1);
    });
  }
}

main();
