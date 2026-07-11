"""cli.py — HotelByte CLI top-level entry point.

Design: single binary, two profiles routed by subcommand.
  hotelbyte-cli openapi …  — public OpenAPI (appKey/appSecret auth)
  hotelbyte-cli portal …   — tenant-portal BFF (username/password auth)

Global flags:
  --json          Emit structured JSON for agent consumption.
  --env           Select environment (dev|uat|prod).
  --repl           Start interactive REPL mode.

Usage examples::

    hotelbyte-cli openapi auth set-credentials --app-key X --app-secret Y
    hotelbyte-cli openapi search hotel-list --check-in 2026-08-01 --country-code US …
    hotelbyte-cli portal auth login --username admin@example.com
    hotelbyte-cli portal orders list --status-list confirmed
    hotelbyte-cli --json portal entity list
    hotelbyte-cli --repl
"""
from __future__ import annotations

import sys
from typing import Any

import click

from . import __version__
from .commands.openapi.group import register_openapi
from .commands.portal.group import register_portal
from .core.config import DEFAULT_ENV, ENVIRONMENTS
from .core.state import get_state
from .utils.output import emit
from .utils.repl_skin import run_repl


@click.group(invoke_without_command=True)
@click.option("--json", "json_mode", is_flag=True, default=False, help="Emit structured JSON for agent consumption.")
@click.option("--env", default=DEFAULT_ENV, type=click.Choice(list(ENVIRONMENTS)), help="Target environment.")
@click.option("--app-key", help="OpenAPI app key (overrides credential store).")
@click.option("--app-secret", help="OpenAPI app secret (overrides credential store).")
@click.option("--username", help="Portal username (overrides credential store).")
@click.option("--password", help="Portal password (overrides credential store).")
@click.option("--repl", is_flag=True, default=False, help="Start interactive REPL mode.")
@click.version_option(version=__version__, prog_name="hotelbyte-cli")
@click.pass_context
def cli(ctx, json_mode, env, app_key, app_secret, username, password, repl):
    """HotelByte CLI — agent-native interface for OpenAPI and Tenant Portal."""
    ctx.ensure_object(dict)
    ctx.obj["json"] = json_mode
    ctx.obj["env"] = env
    ctx.obj["app_key"] = app_key
    ctx.obj["app_secret"] = app_secret
    ctx.obj["username"] = username
    ctx.obj["password"] = password

    if repl or ctx.invoked_subcommand is None:
        if repl:
            state = get_state()
            run_repl(cli, state, __version__)
            ctx.exit()
        elif ctx.invoked_subcommand is None:
            click.echo(ctx.get_help())
            ctx.exit()


# Register profile groups
register_openapi(cli)
register_portal(cli)


def main() -> None:
    """Console entry point: ``hotelbyte-cli``."""
    cli(prog_name="hotelbyte-cli")


if __name__ == "__main__":
    main()