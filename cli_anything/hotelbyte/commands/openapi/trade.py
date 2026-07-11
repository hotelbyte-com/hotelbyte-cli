"""commands/openapi/trade.py — booking endpoints (book, cancel, queryOrders, updateOrder)."""
from __future__ import annotations

import json
from typing import Any

import click

from ...core.auth import authenticate_openapi
from ...core.config import DEFAULT_ENV, load_profile
from ...core.http import HttpClient, HotelByteError
from ...utils.output import emit, error


def _client(ctx: click.Context) -> HttpClient:
    env = ctx.obj.get("env", DEFAULT_ENV)
    profile = load_profile("openapi", env)
    if ctx.obj.get("app_key"):
        profile.app_key = ctx.obj["app_key"]
    if ctx.obj.get("app_secret"):
        profile.app_secret = ctx.obj["app_secret"]
    authenticate_openapi(profile)
    return HttpClient(profile)


def _parse_json(ctx, value, name):
    if value is None:
        return None
    if value.startswith("@"):
        with open(value[1:]) as f:
            return json.load(f)
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return value


@click.group("trade")
def trade_group():
    """Booking and order management endpoints."""


# ── book ───────────────────────────────────────────────────────────────

@trade_group.command("book")
@click.option("--rate-pkg-id", required=True, help="RatePkg ID from hotelRates/hotelStaticDetail")
@click.option("--holder", required=True, help="Holder contact JSON, or @file.json")
@click.option("--guests", required=True, help="Guests JSON array, or @file.json")
@click.option("--customer-reference-no", help="Optional customer reference number")
@click.option("--callback-url", help="Optional webhook URL for order status notifications")
@click.pass_context
def book(ctx, rate_pkg_id, holder, guests, customer_reference_no, callback_url):
    """Create a hotel booking."""
    body: dict[str, Any] = {
        "ratePkgId": rate_pkg_id,
        "holder": _parse_json(ctx, holder, "holder"),
        "guests": _parse_json(ctx, guests, "guests"),
    }
    if customer_reference_no:
        body["customerReferenceNo"] = customer_reference_no
    if callback_url:
        body["callbackUrl"] = callback_url
    try:
        c = _client(ctx)
        resp = c.post("/api/trade/book", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


# ── cancel ─────────────────────────────────────────────────────────────

@trade_group.command("cancel")
@click.option("--customer-reference-no", required=True, help="Customer reference number")
@click.option("--supplier-reference-no", required=True, help="Supplier reference number")
@click.option("--reason", help="Cancellation reason")
@click.pass_context
def cancel(ctx, customer_reference_no, supplier_reference_no, reason):
    """Cancel an existing booking."""
    body: dict[str, Any] = {
        "customerReferenceNo": customer_reference_no,
        "supplierReferenceNo": supplier_reference_no,
    }
    if reason:
        body["reason"] = reason
    try:
        c = _client(ctx)
        resp = c.post("/api/trade/cancel", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


# ── queryOrders ────────────────────────────────────────────────────────

@trade_group.command("query-orders")
@click.option("--customer-reference-nos", help="Comma-separated customer reference numbers")
@click.option("--supplier-reference-nos", help="Comma-separated supplier reference numbers")
@click.option("--status-list", help="Comma-separated status filters")
@click.option("--guest-name", help="Guest name filter")
@click.option("--room-count", type=int, help="Filter by room count")
@click.option("--night-count-min", type=int, help="Minimum nights")
@click.option("--sort-by", help="Sort field")
@click.option("--sort-order", help="Sort direction: asc|desc")
@click.option("--filter", help="Full JSON filter object, or @file.json (advanced)")
@click.pass_context
def query_orders(ctx, customer_reference_nos, supplier_reference_nos, status_list, guest_name, room_count, night_count_min, sort_by, sort_order, filter):
    """Query orders with optional filters."""
    body: dict[str, Any] = {}
    if filter:
        body.update(_parse_json(ctx, filter, "filter"))
    if customer_reference_nos:
        body["customerReferenceNos"] = customer_reference_nos.split(",")
    if supplier_reference_nos:
        body["supplierReferenceNos"] = supplier_reference_nos.split(",")
    if status_list:
        body["statusList"] = status_list.split(",")
    if guest_name:
        body["guestName"] = guest_name
    if room_count is not None:
        body["roomCount"] = room_count
    if night_count_min is not None:
        body["nightCountMin"] = night_count_min
    if sort_by:
        body["sortBy"] = sort_by
    if sort_order:
        body["sortOrder"] = sort_order
    try:
        c = _client(ctx)
        resp = c.post("/api/trade/queryOrders", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


# ── updateOrder ────────────────────────────────────────────────────────

@trade_group.command("update-order")
@click.option("--target-order-id", required=True, help="Order ID to update")
@click.option("--actions", required=True, help="Actions JSON array, or @file.json")
@click.pass_context
def update_order(ctx, target_order_id, actions):
    """Update an existing order (e.g. add notes, change status)."""
    body: dict[str, Any] = {
        "targetOrderId": target_order_id,
        "actions": _parse_json(ctx, actions, "actions"),
    }
    try:
        c = _client(ctx)
        resp = c.post("/api/trade/updateOrder", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)