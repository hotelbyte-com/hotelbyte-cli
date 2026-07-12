#!/usr/bin/env bun
/**
 * cli.ts — HotelByte CLI top-level entry point.
 *
 * Design: single binary, two profiles routed by subcommand.
 *   hotelbyte-cli openapi …  — public OpenAPI (appKey/appSecret auth)
 *   hotelbyte-cli portal …   — tenant-portal BFF (username/password auth)
 *
 * Global flags:
 *   --json          Emit structured JSON for agent consumption.
 *   --env           Select environment (dev|uat|prod).
 *   --repl          Start interactive REPL mode.
 *
 * Built with Bun. Compile with:
 *   bun build --compile --target=bun-darwin-arm64 --outfile=hotelbyte-cli src/cli.ts
 */

import { Command, Option } from "commander";
import { DEFAULT_ENV, ENVIRONMENTS, HOTELBYTE_HOME } from "./core/config.ts";
import { getState } from "./core/state.ts";
import { runRepl } from "./utils/repl.ts";
import { createOpenapiGroup } from "./commands/openapi/group.ts";
import { createPortalGroup } from "./commands/portal/group.ts";
import type { Ctx } from "./commands/portal/helpers.ts";

// ── version ────────────────────────────────────────────────────────────

const VERSION = "0.2.0";

// ── self-update ────────────────────────────────────────────────────────

const REPO = "hotelbyte-com/hotelbyte-cli";
const GITHUB_API = `https://api.github.com/repos/${REPO}/releases/latest`;

async function getLatestVersion(): Promise<string> {
  const resp = await fetch(GITHUB_API, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!resp.ok) throw new Error(`Failed to fetch latest release: ${resp.status}`);
  const data = await resp.json() as any;
  return data.tag_name?.replace(/^v/, "") ?? "unknown";
}

function getCurrentBinaryPath(): string | null {
  return process.execPath || null;
}

function getInstallDir(): string {
  return HOTELBYTE_HOME;
}

async function selfUpdate(jsonMode: boolean): Promise<void> {
  const { emit, error } = await import("./utils/output.ts");
  try {
    const latest = await getLatestVersion();
    if (latest === VERSION) {
      if (jsonMode) emit({ status: "up-to-date", version: VERSION }, true);
      else console.log(`Already at latest version ${VERSION}`);
      return;
    }

    if (!jsonMode) console.log(`Updating from ${VERSION} → ${latest}…`);

    // Determine platform binary asset name
    const platform = process.platform;
    const arch = process.arch;
    const assetName = `hotelbyte-cli-${platform}-${arch}${platform === "win32" ? ".exe" : ""}`;

    // Fetch release assets
    const resp = await fetch(GITHUB_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    const data = await resp.json() as any;
    const asset = (data.assets as any[])?.find((a: any) => a.name === assetName);

    if (!asset) {
      throw new Error(`No binary asset found for ${platform}/${arch}. Available: ${(data.assets as any[])?.map((a) => a.name).join(", ")}`);
    }

    if (!jsonMode) console.log(`Downloading ${asset.name} (${(asset.size / 1024 / 1024).toFixed(1)} MB)…`);

    // Download binary
    const binaryResp = await fetch(asset.browser_download_url);
    if (!binaryResp.ok) throw new Error(`Download failed: ${binaryResp.status}`);
    const binary = await binaryResp.arrayBuffer();

    // Write to versioned directory
    const { join } = await import("node:path");
    const { existsSync, mkdirSync, writeFileSync, chmodSync, symlinkSync, unlinkSync } = await import("node:fs");
    const installDir = getInstallDir();
    const versionDir = join(installDir, "versions", latest);
    mkdirSync(versionDir, { recursive: true });
    const binaryPath = join(versionDir, "hotelbyte-cli");
    writeFileSync(binaryPath, binary);
    chmodSync(binaryPath, 0o755);

    // Update 'current' symlink
    const currentLink = join(installDir, "current");
    if (existsSync(currentLink)) unlinkSync(currentLink);
    try {
      symlinkSync(versionDir, currentLink);
    } catch {
      // Fallback: copy binary directly (e.g. Windows without admin)
      writeFileSync(currentLink, binary);
    }

    // Update ~/.local/bin symlink if it exists
    const localBin = join(process.env.HOME ?? "~", ".local", "bin", "hotelbyte-cli");
    const localBinDir = join(process.env.HOME ?? "~", ".local", "bin");
    if (existsSync(localBinDir)) {
      if (existsSync(localBin)) unlinkSync(localBin);
      try {
        symlinkSync(binaryPath, localBin);
      } catch {
        writeFileSync(localBin, binary);
        chmodSync(localBin, 0o755);
      }
    }

    if (jsonMode) {
      emit({ status: "updated", from: VERSION, to: latest, path: binaryPath }, true);
    } else {
      console.log(`✓ Updated to ${latest} at ${binaryPath}`);
      console.log(`  Run 'hotelbyte-cli version' to verify.`);
    }
  } catch (e: any) {
    error(e.message, jsonMode);
    process.exit(1);
  }
}

function showVersion(): void {
  const execPath = getCurrentBinaryPath();
  const installDir = getInstallDir();
  console.log(`hotelbyte-cli ${VERSION}`);
  console.log(`  binary: ${execPath ?? "(unknown)"}`);
  console.log(`  home:   ${installDir}`);
}

// ── main ───────────────────────────────────────────────────────────────

function main(): void {
  const program = new Command();

  program
    .name("hotelbyte-cli")
    .description("HotelByte CLI — agent-native interface for OpenAPI and Tenant Portal.")
    .version(VERSION)
    .option("--json", "Emit structured JSON for agent consumption.", false)
    .addOption(new Option("--env <env>", "Target environment.").choices(Object.keys(ENVIRONMENTS)).default(DEFAULT_ENV))
    .option("--repl", "Start interactive REPL mode.", false);

  // Parse global flags that appear before the subcommand.
  // Commander stores parent and child options separately, so we read
  // the global flags from argv directly to share them with subcommands.
  const argv = process.argv.slice(2);
  const globalOpts: Record<string, any> = {
    json: false,
    env: DEFAULT_ENV,
    appKey: undefined,
    appSecret: undefined,
    username: undefined,
    password: undefined,
    repl: false,
  };
  // Scan for global flags before the first non-option arg (the subcommand)
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("-")) break; // first positional = subcommand name
    if (arg === "--json") globalOpts.json = true;
    else if (arg === "--env") globalOpts.env = argv[++i] ?? DEFAULT_ENV;
    else if (arg === "--repl") globalOpts.repl = true;
    else if (arg.startsWith("--env=")) globalOpts.env = arg.slice(6);
    // --app-key etc are NOT global anymore — they're subcommand-scoped
  }

  // Context accessor for subcommands — reads from pre-parsed global opts
  const ctx: Ctx = {
    jsonMode: () => globalOpts.json,
    env: () => globalOpts.env,
    username: () => globalOpts.username,
    password: () => globalOpts.password,
  };
  const openapiCtx = {
    jsonMode: ctx.jsonMode,
    env: ctx.env,
    appKey: () => globalOpts.appKey,
    appSecret: () => globalOpts.appSecret,
  };

  // Register profile groups
  program.addCommand(createOpenapiGroup(openapiCtx));
  program.addCommand(createPortalGroup(ctx));

  // Top-level: version (explicit command, not just --version flag)
  program
    .command("version")
    .description("Show current version and installation path")
    .action(() => showVersion());

  // Top-level: update
  program
    .command("update")
    .description("Check for and install the latest version")
    .action(async () => {
      await selfUpdate(ctx.jsonMode());
    });

  // Handle --repl: detect before parsing subcommands
  if (process.argv.includes("--repl")) {
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