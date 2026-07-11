"""commands/openapi/group.py — OpenAPI profile root group."""
from __future__ import annotations

import click

from .auth import auth_group
from .search import search_group
from .trade import trade_group


@click.group("openapi")
@click.pass_context
def openapi_group(ctx):
    """OpenAPI profile — public search + trade API (appKey/appSecret auth)."""
    if ctx.obj is None:
        ctx.obj = {}
    ctx.obj.setdefault("json", False)


def register_openapi(cli):
    """Attach the openapi command group to the top-level CLI."""
    openapi_group.add_command(auth_group)
    openapi_group.add_command(search_group)
    openapi_group.add_command(trade_group)
    cli.add_command(openapi_group)