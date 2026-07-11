"""commands/openapi/search.py — search endpoints (checkAvail, destinations,
hotelList, hotelRates, hotelStaticDetail, hotelsMetadata, hotelListStream)."""
from __future__ import annotations

import json
from typing import Any

import click

from ...core.auth import authenticate_openapi
from ...core.config import DEFAULT_ENV, ENVIRONMENTS, Profile, load_profile
from ...core.http import HttpClient, HotelByteError
from ...utils.output import emit, error


def _client(ctx: click.Context) -> HttpClient:
    """Build an authenticated HttpClient for the openapi profile."""
    env = ctx.obj.get("env", DEFAULT_ENV)
    profile = load_profile("openapi", env)
    if ctx.obj.get("app_key"):
        profile.app_key = ctx.obj["app_key"]
    if ctx.obj.get("app_secret"):
        profile.app_secret = ctx.obj["app_secret"]
    authenticate_openapi(profile)
    return HttpClient(profile)


def _json_opt(ctx, name, value):
    """Click callback: parse a JSON string or @file path into a Python object."""
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if value.startswith("@"):
        with open(value[1:]) as f:
            return json.load(f)
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value  # keep as string


@click.group("search")
def search_group():
    """Hotel search endpoints."""


# ── checkAvail ─────────────────────────────────────────────────────────

@search_group.command("check-avail")
@click.option("--rate-pkg-id", required=True, help="RatePkg ID obtained from hotelRates")
@click.pass_context
def check_avail(ctx, rate_pkg_id):
    """Check real-time availability for a specific rate package."""
    try:
        c = _client(ctx)
        resp = c.post("/api/search/checkAvail", {"ratePkgId": rate_pkg_id})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


# ── destinations ────────────────────────────────────────────────────────

@search_group.command("destinations")
@click.option("--country-code", help='ISO country code, e.g. "US"')
@click.option("--parent-destination-id", help="Parent region ID")
@click.option("--include", help="Detail level: summary|detail")
@click.option("--min-hotel-count", type=int, help="Minimum hotel count for cities")
@click.option("--filter-empty-cities/--no-filter-empty-cities", default=None, help="Filter out cities without hotels")
@click.pass_context
def destinations(ctx, country_code, parent_destination_id, include, min_hotel_count, filter_empty_cities):
    """List destination regions for hotel search."""
    body: dict[str, Any] = {}
    if country_code:
        body["countryCode"] = country_code
    if parent_destination_id:
        body["parentDestinationId"] = parent_destination_id
    if include:
        body["include"] = include
    if min_hotel_count is not None:
        body["minHotelCount"] = min_hotel_count
    if filter_empty_cities is not None:
        body["filterEmptyCities"] = filter_empty_cities
    try:
        c = _client(ctx)
        resp = c.post("/api/search/destinations", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


# ── hotelList ──────────────────────────────────────────────────────────

@search_group.command("hotel-list")
@click.option("--check-in", help="Check-in date (YYYY-MM-DD)")
@click.option("--check-out", help="Check-out date (YYYY-MM-DD)")
@click.option("--country-code", help='Point-of-sale country code, e.g. "US"')
@click.option("--nationality-code", help='Booker nationality (ISO 3166-1 alpha-2)')
@click.option("--residency-code", help="Booker residency (ISO 3166-1 alpha-2)")
@click.option("--destination-id", help="Destination region ID")
@click.option("--destination-name", help="Destination region name")
@click.option("--hotel-ids", help="Comma-separated hotel IDs (max 50)")
@click.option("--room-occupancies", help="JSON array of room occupancy objects, or @file.json")
@click.option("--page-num", type=int, help="Page number")
@click.option("--page-size", type=int, help="Page size")
@click.option("--cursor", type=int, help="Cursor for next page")
@click.option("--max-rates-per-hotel", type=int, help="Max room rates per hotel")
@click.option("--sort-by", help="Sort order: price-asc, price-desc, rating-desc")
@click.pass_context
def hotel_list(ctx, **kwargs):
    """Search hotels across a destination with rates."""
    body: dict[str, Any] = {}
    for k, v in kwargs.items():
        if v is None:
            continue
        key = k.replace("_", "")
        if k == "hotel_ids":
            body["hotelIds"] = v.split(",")
        elif k == "room_occupancies":
            body["roomOccupancies"] = _json_opt(ctx, k, v)
        else:
            # camelCase conversion
            parts = k.split("_")
            body[parts[0] + "".join(p.capitalize() for p in parts[1:])] = v
    try:
        c = _client(ctx)
        resp = c.post("/api/search/hotelList", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


# ── hotelRates ──────────────────────────────────────────────────────────

@search_group.command("hotel-rates")
@click.option("--hotel-id", required=True, help="Hotel ID")
@click.option("--check-in", help="Check-in date (YYYY-MM-DD)")
@click.option("--check-out", help="Check-out date (YYYY-MM-DD)")
@click.option("--country-code", help='Point-of-sale country code')
@click.option("--nationality-code", help="Booker nationality (ISO 3166-1 alpha-2)")
@click.option("--residency-code", help="Booker residency (ISO 3166-1 alpha-2)")
@click.option("--room-occupancies", help="JSON array of room occupancy objects, or @file.json")
@click.pass_context
def hotel_rates(ctx, hotel_id, check_in, check_out, country_code, nationality_code, residency_code, room_occupancies):
    """Get detailed room rates for a single hotel."""
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
    if room_occupancies:
        body["roomOccupancies"] = _json_opt(ctx, "room_occupancies", room_occupancies)
    try:
        c = _client(ctx)
        resp = c.post("/api/search/hotelRates", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


# ── hotelStaticDetail ──────────────────────────────────────────────────

@search_group.command("hotel-static-detail")
@click.option("--hotel-id", required=True, help="Hotel ID")
@click.pass_context
def hotel_static_detail(ctx, hotel_id):
    """Get static hotel details (descriptions, facilities, images)."""
    try:
        c = _client(ctx)
        resp = c.post("/api/search/hotelStaticDetail", {"hotelId": hotel_id})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


# ── hotelsMetadata ─────────────────────────────────────────────────────

@search_group.command("hotels-metadata")
@click.option("--destination-id", help="Destination region ID")
@click.option("--country-code", help="Country code")
@click.option("--data-source", help="Read target: master|byoc")
@click.option("--catalog-id", help="Catalog ID (required when data-source=byoc)")
@click.option("--page", help="Pagination object as JSON, or @file.json")
@click.pass_context
def hotels_metadata(ctx, destination_id, country_code, data_source, catalog_id, page):
    """List hotel metadata (name, star rating, coordinates, amenities)."""
    body: dict[str, Any] = {}
    if destination_id:
        body["destinationId"] = destination_id
    if country_code:
        body["countryCode"] = country_code
    if data_source:
        body["dataSource"] = data_source
    if catalog_id:
        body["catalogId"] = catalog_id
    if page:
        body["page"] = _json_opt(ctx, "page", page)
    try:
        c = _client(ctx)
        resp = c.post("/api/search/hotelsMetadata", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)