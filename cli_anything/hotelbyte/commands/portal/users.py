"""commands/portal/users.py — tenant user management."""
from __future__ import annotations

import json
from typing import Any

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


@click.group("users")
def users_group():
    """Tenant user management (invite, list, update, roles)."""


@users_group.command("list")
@click.option("--page-num", type=int, default=1, help="Page number")
@click.option("--page-size", type=int, default=20, help="Page size")
@click.pass_context
def list_users(ctx, page_num, page_size):
    """List tenant users."""
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/listUser", {"pageNum": page_num, "pageSize": page_size})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@users_group.command("get")
@click.option("--user-id", required=True, help="User ID")
@click.pass_context
def get_user(ctx, user_id):
    """Get a single user by ID."""
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/getUser", {"userId": user_id})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@users_group.command("invite")
@click.option("--email", required=True, help="Invitee email")
@click.option("--role-id", help="Role ID to assign")
@click.option("--name", help="Display name")
@click.pass_context
def invite(ctx, email, role_id, name):
    """Invite a user to the tenant."""
    body: dict[str, Any] = {"email": email}
    if role_id:
        body["roleId"] = role_id
    if name:
        body["name"] = name
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/inviteUser", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@users_group.command("batch-invite")
@click.option("--file", "file_path", required=True, help="JSON file with invite list, or @file.json")
@click.pass_context
def batch_invite(ctx, file_path):
    """Batch invite users from a JSON file."""
    path = file_path[1:] if file_path.startswith("@") else file_path
    with open(path) as f:
        invites = json.load(f)
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/batchInviteUser", {"invites": invites})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@users_group.command("update")
@click.option("--user-id", required=True, help="User ID")
@click.option("--name", help="New display name")
@click.option("--role-id", help="New role ID")
@click.pass_context
def update_user(ctx, user_id, name, role_id):
    """Update a tenant user."""
    body: dict[str, Any] = {"userId": user_id}
    if name:
        body["name"] = name
    if role_id:
        body["roleId"] = role_id
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/updateUser", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@users_group.command("list-roles")
@click.pass_context
def list_roles(ctx):
    """List roles available to the tenant."""
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/listRole", {})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@users_group.command("list-team-members")
@click.pass_context
def list_team_members(ctx):
    """List team members for the current tenant."""
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/listTeamMembers", {})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)