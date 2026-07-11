"""commands/portal/view.py — portal navigation/menu BFF (PaaSHomepage,
retailHomepage, view permissions)."""
from __future__ import annotations

import click

from ...core.auth import authenticate_portal
from ...core.config import DEFAULT_ENV, load_profile
from ...core.http import HttpClient, HotelByteError
from ...utils.output import emit, error


def _client(ctx: click.Context) -> HttpClient:
    env = ctx.obj.get("env", DEFAULT_ENV)
    profile = load_profile("portal", env)
    if ctx.obj.get("username"):
        profile.username = ctx.obj["username"]
    if ctx.obj.get("password"):
        profile.password = ctx.obj["password"]
    authenticate_portal(profile)
    return HttpClient(profile)


@click.group("view")
def view_group():
    """Portal navigation, menu, and permissions BFF."""


@view_group.command("paas-homepage")
@click.pass_context
def paas_homepage(ctx):
    """Fetch the PaaS portal homepage (menu, permissions, user context)."""
    try:
        c = _client(ctx)
        resp = c.post("/api/view/paasHomepage", {})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@view_group.command("retail-homepage")
@click.pass_context
def retail_homepage(ctx):
    """Fetch the retail/customer-portal homepage."""
    try:
        c = _client(ctx)
        resp = c.post("/api/view/retailHomepage", {})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)