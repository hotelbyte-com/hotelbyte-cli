"""commands/openapi/auth.py — authentication for the OpenAPI profile."""
from __future__ import annotations

import click

from ...core.auth import authenticate_openapi
from ...core.config import DEFAULT_ENV, ENVIRONMENTS, Profile, load_profile, save_profile
from ...utils.output import emit, error


def _get_profile(ctx: click.Context) -> Profile:
    """Resolve the active openapi profile from context or config."""
    env = ctx.obj.get("env", DEFAULT_ENV)
    profile = load_profile("openapi", env)
    # override with CLI flags if provided
    if ctx.obj.get("app_key"):
        profile.app_key = ctx.obj["app_key"]
    if ctx.obj.get("app_secret"):
        profile.app_secret = ctx.obj["app_secret"]
    return profile


@click.group("auth")
def auth_group():
    """OpenAPI authentication (appKey/appSecret → JWT ticket)."""


@auth_group.command("set-credentials")
@click.option("--app-key", required=True, help="OpenAPI application key")
@click.option("--app-secret", required=True, help="OpenAPI application secret")
@click.option("--env", default=DEFAULT_ENV, type=click.Choice(list(ENVIRONMENTS)))
@click.pass_context
def set_credentials(ctx, app_key, app_secret, env):
    """Persist OpenAPI credentials for the given environment."""
    profile = Profile(name="openapi", env=env, base_url=ENVIRONMENTS[env], app_key=app_key, app_secret=app_secret)
    save_profile(profile)
    emit({"status": "saved", "env": env}, ctx.obj.get("json", False))


@auth_group.command("ticket")
@click.option("--ttl", type=int, default=0, help="Ticket idle timeout in seconds (0 = server default)")
@click.pass_context
def ticket(ctx, ttl):
    """Exchange appKey/appSecret for a JWT ticket."""
    profile = _get_profile(ctx)
    try:
        from ...core.http import HttpClient
        client = HttpClient(profile)
        body = {"appKey": profile.app_key, "appSecret": profile.app_secret}
        if ttl:
            body["ttl"] = ttl
        resp = client.post("/api/auth/ticket", body)
        # cache ticket
        from ...core.auth import _extract_ticket
        profile.ticket = _extract_ticket(resp)
        save_profile(profile)
        emit(resp, ctx.obj.get("json", False))
    except Exception as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)