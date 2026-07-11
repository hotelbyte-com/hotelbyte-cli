"""commands/portal/group.py — Tenant Portal profile root group."""
from __future__ import annotations

import click

from .auth import auth_group
from .entity import (
    customers_group,
    entity_group,
    retail_group,
    subscriptions_group,
    suppliers_group,
)
from .orders import orders_group
from .search import search_group
from .users import users_group
from .view import view_group


@click.group("portal")
@click.pass_context
def portal_group(ctx):
    """Tenant Portal profile — BFF for tenant admin (login auth)."""
    if ctx.obj is None:
        ctx.obj = {}
    ctx.obj.setdefault("json", False)


def register_portal(cli):
    """Attach the portal command group to the top-level CLI."""
    portal_group.add_command(auth_group)
    portal_group.add_command(search_group)
    portal_group.add_command(orders_group)
    portal_group.add_command(users_group)
    portal_group.add_command(entity_group)
    portal_group.add_command(customers_group)
    portal_group.add_command(subscriptions_group)
    portal_group.add_command(suppliers_group)
    portal_group.add_command(retail_group)
    portal_group.add_command(view_group)
    cli.add_command(portal_group)