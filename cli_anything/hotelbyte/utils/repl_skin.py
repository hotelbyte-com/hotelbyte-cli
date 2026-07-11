"""utils/repl_skin.py — unified REPL interface (CLI-Anything pattern).

Provides a branded banner, styled prompt with context, and a
read-eval-print loop that delegates to Click subcommands.

Usage::

    from cli_anything.hotelbyte.utils.repl_skin import run_repl
    run_repl(cli_group, session_state)
"""
from __future__ import annotations

import shlex
import sys
from typing import Optional

import click

from ..core.state import SessionState

BANNER = r"""
╔══════════════════════════════════════════════╗
║  hotelbyte-cli v{ver:<7s}                       ║
║  Agent-native CLI for the HotelByte platform  ║
║  Profiles: openapi · portal                   ║
╚══════════════════════════════════════════════╝
"""

REPL_HELP = """\
REPL commands:
  <command>              Run any CLI subcommand (e.g. openapi search checkAvail --help)
  help                   Show this help
  exit | quit            Leave the REPL
  state                  Show current session state
  undo                   Show last request/response
"""


def _print_banner(version: str) -> None:
    click.echo(BANNER.format(ver=version))


def run_repl(cli_group: click.Group, state: SessionState, version: str = "0.1.0") -> None:
    """Start the interactive REPL loop."""
    _print_banner(version)
    click.echo("Type 'help' for REPL commands or '<profile> <command> --help' for CLI help.\n")

    while True:
        try:
            prompt = state.prompt
            line = input(prompt).strip()
        except (EOFError, KeyboardInterrupt):
            click.echo("\nBye.")
            break

        if not line:
            continue

        cmd = line.lower()
        if cmd in ("exit", "quit"):
            click.echo("Bye.")
            break
        if cmd == "help":
            click.echo(REPL_HELP)
            continue
        if cmd == "state":
            click.echo(f"profile={state.profile}, last_response_type={type(state.last_response).__name__}, history={len(state.history)}")
            continue
        if cmd == "undo":
            entry = state.undo()
            if entry:
                click.echo(f"Last: {entry['path']} → {entry['response']}")
            else:
                click.echo("No history.")
            continue

        # Delegate to Click group
        try:
            args = shlex.split(line)
            cli_group.main(args=args, prog_name="hotelbyte-cli", standalone_mode=False)
        except click.ClickException as e:
            e.show()
        except SystemExit:
            pass  # Click may call sys.exit; swallow in REPL
        except Exception as e:
            click.echo(f"Error: {e}", err=True)