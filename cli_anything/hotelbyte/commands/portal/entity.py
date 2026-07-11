"""commands/portal/entity.py — tenant entity, customers, subscriptions, suppliers, settings."""
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


# ── entity ─────────────────────────────────────────────────────────────

@click.group("entity")
def entity_group():
    """Tenant entity management (brands, groups, distribution config)."""


@entity_group.command("list")
@click.pass_context
def list_entities(ctx):
    """List entities accessible to the current user."""
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/listEntity", {})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@entity_group.command("get")
@click.option("--entity-id", help="Entity ID (omit for current)")
@click.pass_context
def get_entity(ctx, entity_id):
    """Get a single entity."""
    body: dict[str, Any] = {}
    if entity_id:
        body["entityId"] = entity_id
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/getEntity", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@entity_group.command("update")
@click.option("--entity-data", required=True, help="JSON entity update data, or @file.json")
@click.pass_context
def update_entity(ctx, entity_data):
    """Update an entity's configuration."""
    path = entity_data[1:] if entity_data.startswith("@") else entity_data
    try:
        body = json.loads(path)
    except json.JSONDecodeError:
        with open(path) as f:
            body = json.load(f)
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/updateEntity", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@entity_group.command("distribution-config")
@click.option("--entity-id", help="Entity ID")
@click.pass_context
def distribution_config(ctx, entity_id):
    """Get effective distribution config for an entity."""
    body: dict[str, Any] = {}
    if entity_id:
        body["entityId"] = entity_id
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/getEffectiveDistributionConfig", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@entity_group.command("policy-status")
@click.option("--entity-id", help="Entity ID")
@click.pass_context
def policy_status(ctx, entity_id):
    """Get entity policy status."""
    body: dict[str, Any] = {}
    if entity_id:
        body["entityId"] = entity_id
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/getEntityPolicyStatus", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


# ── customers ──────────────────────────────────────────────────────────

@click.group("customers")
def customers_group():
    """Customer lifecycle management."""


@customers_group.command("activate")
@click.option("--customer-id", required=True)
@click.pass_context
def activate_customer(ctx, customer_id):
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/activateCustomer", {"customerId": customer_id})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@customers_group.command("inactivate")
@click.option("--customer-id", required=True)
@click.pass_context
def inactivate_customer(ctx, customer_id):
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/inactivateCustomer", {"customerId": customer_id})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@customers_group.command("delete")
@click.option("--customer-id", required=True)
@click.pass_context
def delete_customer(ctx, customer_id):
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/deleteCustomer", {"customerId": customer_id})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


# ── subscriptions ───────────────────────────────────────────────────────

@click.group("subscriptions")
def subscriptions_group():
    """Subscription and billing management."""


@subscriptions_group.command("get")
@click.pass_context
def get_subscription(ctx):
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/getSubscription", {})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@subscriptions_group.command("catalog")
@click.pass_context
def catalog(ctx):
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/getSubscriptionCatalog", {})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@subscriptions_group.command("start")
@click.option("--plan-id", required=True)
@click.pass_context
def start_subscription(ctx, plan_id):
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/startSubscription", {"planId": plan_id})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@subscriptions_group.command("change-plan")
@click.option("--plan-id", required=True)
@click.pass_context
def change_plan(ctx, plan_id):
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/changeSubscriptionPlan", {"planId": plan_id})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@subscriptions_group.command("cancel")
@click.pass_context
def cancel_subscription(ctx):
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/cancelSubscription", {})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@subscriptions_group.command("billing-portal")
@click.pass_context
def billing_portal(ctx):
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/getBillingPortal", {})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@subscriptions_group.command("payment-methods")
@click.pass_context
def payment_methods(ctx):
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/listSubscriptionPaymentMethods", {})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@subscriptions_group.command("invoices")
@click.pass_context
def invoices(ctx):
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/listSubscriptionInvoices", {})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


# ── suppliers ───────────────────────────────────────────────────────────

@click.group("suppliers")
def suppliers_group():
    """Supplier connection and credentials."""


@suppliers_group.command("accessible")
@click.pass_context
def accessible_credentials(ctx):
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/getAccessibleCredentials", {})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


@suppliers_group.command("connect")
@click.option("--supplier-id", required=True)
@click.option("--credentials", help="JSON credentials, or @file.json")
@click.pass_context
def connect_supplier(ctx, supplier_id, credentials):
    body: dict[str, Any] = {"supplierId": supplier_id}
    if credentials:
        path = credentials[1:] if credentials.startswith("@") else credentials
        try:
            body["credentials"] = json.loads(path)
        except json.JSONDecodeError:
            with open(path) as f:
                body["credentials"] = json.load(f)
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/connectSupplier", body)
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)


# ── retail onboarding ──────────────────────────────────────────────────

@click.group("retail")
def retail_group():
    """Retail onboarding status."""


@retail_group.command("status")
@click.pass_context
def retail_status(ctx):
    try:
        c = _client(ctx)
        resp = c.post("/api/user/tenant/getRetailOnboardingStatus", {})
        emit(resp, ctx.obj.get("json", False))
    except HotelByteError as e:
        error(str(e), ctx.obj.get("json", False))
        ctx.exit(1)