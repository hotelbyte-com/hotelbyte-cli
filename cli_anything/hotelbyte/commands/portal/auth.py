"""commands/portal/auth.py — authentication for the tenant-portal profile."""
from __future__ import annotations

import click

from ...core.auth import authenticate_portal
from ...core.config import DEFAULT_ENV, ENVIRONMENTS, Profile, load_profile, save_profile
from ...core.http import HttpClient, HotelByteError
from ...utils.output import emit, error


@click.group("auth")
def auth_group():
    """Portal authentication (username/password → JWT ticket)."""


@auth_group.command("login")
@click.option("--username", prompt=True, help="Portal username/email")
@click.option("--password", prompt=True, hide_input=True, help="Portal password")
@click.option("--env", default=DEFAULT_ENV, type=click.Choice(list(ENVIRONMENTS)))
@click.pass_context
def login(ctx, username, password, env):
    """Login and cache the JWT ticket."""
    profile = Profile(name="portal", env=env, base_url=ENVIRONMENTS[env], username=username, password=password)
    try:
        client = HttpClient(profile)
        resp = client.post("/api/auth/login", {"username": username, "password": password})
        from ...core.auth import _extract_ticket
        profile.ticket = _extract_ticket(resp)
        save_profile(profile)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@auth_group.command("logout")
@click.pass_context
def logout(ctx):
    """Clear the cached ticket."""
    from ...core.config import clear_ticket
    env = ctx.obj.get("env", DEFAULT_ENV)
    clear_ticket("portal", env)
    emit({"status": "logged_out", "env": env}, ctx.obj.get("json", False))


@auth_group.command("whoami")
@click.pass_context
def whoami(ctx):
    """Show the current cached credentials/ticket status."""
    env = ctx.obj.get("env", DEFAULT_ENV)
    profile = load_profile("portal", env)
    info = {
        "env": env,
        "username": profile.username,
        "has_ticket": bool(profile.ticket),
        "base_url": profile.base_url,
    }
    emit(info, ctx.obj.get("json", False))