"""commands/portal/search.py — tenant-portal search (same search backend,
portal auth instead of appKey/appSecret)."""
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


@click.group("search")
def search_group():
    """Portal hotel search (uses portal JWT, same search endpoints)."""


@search_group.command("check-avail")
@click.option("--rate-pkg-id", required=True)
@click.pass_context
def check_avail(ctx, rate_pkg_id):
    try:
        c = _client(ctx)
        resp = c.post("/api/search/checkAvail", {"ratePkgId": rate_pkg_id})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@search_group.command("hotel-list")
@click.option("--check-in")
@click.option("--check-out")
@click.option("--country-code")
@click.option("--nationality-code")
@click.option("--residency-code")
@click.option("--destination-id")
@click.option("--destination-name")
@click.option("--room-occupancies", help="JSON array, or @file.json")
@click.option("--page-size", type=int)
@click.pass_context
def hotel_list(ctx, **kwargs):
    body: dict[str, Any] = {}
    for k, v in kwargs.items():
        if v is None:
            continue
        if k == "room_occupancies":
            path = v[1:] if v.startswith("@") else v
            try:
                body["roomOccupancies"] = json.loads(path)
            except json.JSONDecodeError:
                with open(path) as f:
                    body["roomOccupancies"] = json.load(f)
        else:
            parts = k.split("_")
            body[parts[0] + "".join(p.capitalize() for p in parts[1:])] = v
    try:
        c = _client(ctx)
        resp = c.post("/api/search/hotelList", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@search_group.command("hotel-rates")
@click.option("--hotel-id", required=True)
@click.option("--check-in")
@click.option("--check-out")
@click.option("--country-code")
@click.option("--nationality-code")
@click.option("--residency-code")
@click.pass_context
def hotel_rates(ctx, hotel_id, check_in, check_out, country_code, nationality_code, residency_code):
    body: dict[str, Any] = {"hotelId": hotel_id}
    if check_in:
        body["checkIn"] = check_in
    if check_out:
        body["checkOut"] = check_out
    if country_code:
        body["countryCode"] = country_code
    if nationality_code:
        body["nationalityCode"] = nationality_code
    if residency_code:
        body["residencyCode"] = residency_code
    try:
        c = _client(ctx)
        resp = c.post("/api/search/hotelRates", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)