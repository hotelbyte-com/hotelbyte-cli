"""commands/portal/orders.py — tenant-portal order/bookings management."""
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


@click.group("orders")
def orders_group():
    """Tenant-portal order and booking management."""


@orders_group.command("list")
@click.option("--page-num", type=int, default=1)
@click.option("--page-size", type=int, default=20)
@click.option("--status-list", help="Comma-separated status filters")
@click.option("--guest-name", help="Guest name filter")
@click.pass_context
def list_orders(ctx, page_num, page_size, status_list, guest_name):
    """List tenant orders (listOrder)."""
    body: dict[str, Any] = {"pageNum": page_num, "pageSize": page_size}
    if status_list:
        body["statusList"] = status_list.split(",")
    if guest_name:
        body["guestName"] = guest_name
    try:
        c = _client(ctx)
        resp = c.post("/api/trade/tenant/listOrder", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@orders_group.command("detail")
@click.option("--order-id", required=True, help="Order ID")
@click.pass_context
def detail_order(ctx, order_id):
    """Get order details (detailOrder)."""
    try:
        c = _client(ctx)
        resp = c.post("/api/trade/tenant/detailOrder", {"orderId": order_id})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@orders_group.command("home")
@click.option("--filter", help="JSON filter object, or @file.json")
@click.pass_context
def order_home(ctx, filter):
    """Tenant order dashboard (orderHomeFunction)."""
    body: dict[str, Any] = {}
    if filter:
        path = filter[1:] if filter.startswith("@") else filter
        try:
            body = json.loads(path)
        except json.JSONDecodeError:
            with open(path) as f:
                body = json.load(f)
    try:
        c = _client(ctx)
        resp = c.post("/api/trade/tenant/orderHomeFunction", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@orders_group.command("label")
@click.option("--order-id", required=True)
@click.option("--label", help="Label to apply")
@click.pass_context
def label_order(ctx, order_id, label):
    """Apply a label to an order (labelOrder)."""
    body: dict[str, Any] = {"orderId": order_id}
    if label:
        body["label"] = label
    try:
        c = _client(ctx)
        resp = c.post("/api/trade/tenant/labelOrder", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@orders_group.command("cancel")
@click.option("--order-id", required=True, help="Order ID to cancel")
@click.option("--reason", help="Cancellation reason")
@click.pass_context
def cancel_order(ctx, order_id, reason):
    """Cancel a tenant order."""
    body: dict[str, Any] = {"orderId": order_id}
    if reason:
        body["reason"] = reason
    try:
        c = _client(ctx)
        resp = c.post("/api/trade/tenant/cancel", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@orders_group.command("create-offline-booking")
@click.option("--booking-data", required=True, help="JSON booking data, or @file.json")
@click.pass_context
def create_offline_booking(ctx, booking_data):
    """Create an offline (manual) booking."""
    path = booking_data[1:] if booking_data.startswith("@") else booking_data
    try:
        body = json.loads(path)
    except json.JSONDecodeError:
        with open(path) as f:
            body = json.load(f)
    try:
        c = _client(ctx)
        resp = c.post("/api/trade/tenant/createOfflineBooking", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@orders_group.command("rebooking-pending")
@click.pass_context
def rebooking_pending(ctx):
    """List pending rebooking approvals."""
    try:
        c = _client(ctx)
        resp = c.post("/api/trade/tenant/listPendingRebookingApprovals", {})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)