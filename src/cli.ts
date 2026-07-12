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
    .option("--app-key <key>", "OpenAPI app key (overrides credential store).")
    .option("--app-secret <secret>", "OpenAPI app secret (overrides credential store).")
    .option("--username <user>", "Portal username (overrides credential store).")
    .option("--password <pass>", "Portal password (overrides credential store).")
    .option("--repl", "Start interactive REPL mode.", false);

  // Context accessor for subcommands
  const ctx: Ctx = {
    jsonMode: () => program.opts().json ?? false,
    env: () => program.opts().env ?? DEFAULT_ENV,
    username: () => program.opts().username,
    password: () => program.opts().password,
  };
  const openapiCtx = {
    jsonMode: ctx.jsonMode,
    env: ctx.env,
    appKey: () => program.opts().appKey,
    appSecret: () => program.opts().appSecret,
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