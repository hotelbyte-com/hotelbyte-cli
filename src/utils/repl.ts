/**
 * repl.ts — unified REPL interface (CLI-Anything pattern).
 *
 * Provides a branded banner, styled prompt, and a read-eval-print loop
 * that delegates to commander subcommands.
 */

import type { Command } from "commander";
import type { SessionState } from "../core/state.ts";

const BANNER = `
╔══════════════════════════════════════════════╗
║  hotelbyte-cli v{ver:<7s}                       ║
║  Agent-native CLI for the HotelByte platform  ║
║  Profiles: openapi · portal                   ║
╚══════════════════════════════════════════════╝
`;

const REPL_HELP = `\
REPL commands:
  <command>              Run any CLI subcommand (e.g. openapi search check-avail --help)
  help                   Show this help
  exit | quit            Leave the REPL
  state                  Show current session state
  undo                   Show last request/response
`;

export function printBanner(version: string): void {
  console.log(BANNER.replace("{ver:<7s}", version.padEnd(7)));
}

export async function runRepl(program: Command, state: SessionState, version: string): Promise<void> {
  printBanner(version);
  console.log("Type 'help' for REPL commands or '<profile> <command> --help' for CLI help.\n");

  // Create a nested program for REPL dispatch
  const { Command: Cmd } = await import("commander");

  while (true) {
    let line: string;
    try {
      line = prompt(state.prompt) ?? "";
    } catch {
      console.log("\nBye.");
      break;
    }

    line = line.trim();
    if (!line) continue;

    const cmd = line.toLowerCase();
    if (cmd === "exit" || cmd === "quit") {
      console.log("Bye.");
      break;
    }
    if (cmd === "help") {
      console.log(REPL_HELP);
      continue;
    }
    if (cmd === "state") {
      console.log(
        `profile=${state.profile?.name ?? "none"}, ` +
          `last_response_type=${typeof state.lastResponse}, ` +
          `history=${state.history.length}`,
      );
      continue;
    }
    if (cmd === "undo") {
      const entry = state.undo();
      if (entry) {
        console.log(`Last: ${entry.path} → ${JSON.stringify(entry.response).slice(0, 200)}`);
      } else {
        console.log("No history.");
      }
      continue;
    }

    // Delegate to commander — parse the line as args
    try {
      const args = line.split(/\s+/);
      await program.parseAsync(args, { from: "user" });
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
    }
  }
}