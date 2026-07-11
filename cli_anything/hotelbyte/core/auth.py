"""core/auth.py — authentication flows for both profiles.

OpenAPI profile:
  POST /api/auth/ticket  {appKey, appSecret} → {ticket}

Portal profile:
  POST /api/auth/login    {username, password} → {ticket, ...}

Both flows cache the returned JWT ticket in the credential store so
subsequent commands reuse the session.
"""
from __future__ import annotations

from typing import Any

from .config import Profile, save_profile
from .http import HttpClient, HotelByteError


def authenticate_openapi(profile: Profile) -> str:
    """Exchange appKey/appSecret for a JWT ticket (OpenAPI profile)."""
    if profile.ticket:
        return profile.ticket  # reuse cached
    if not profile.app_key or not profile.app_secret:
        raise HotelByteError(
            401,
            "Missing appKey/appSecret. Set via --app-key/--app-secret, "
            "env HOTELBYTE_APP_KEY/HOTELBYTE_APP_SECRET, or 'hotelbyte-cli openapi auth set-credentials'.",
            "/api/auth/ticket",
        )
    client = HttpClient(profile)
    body: dict[str, Any] = {"appKey": profile.app_key, "appSecret": profile.app_secret}
    resp = client.post("/api/auth/ticket", body)
    ticket = _extract_ticket(resp)
    profile.ticket = ticket
    save_profile(profile)
    return ticket


def authenticate_portal(profile: Profile) -> str:
    """Login with username/password and cache the JWT ticket (portal profile)."""
    if profile.ticket:
        return profile.ticket
    if not profile.username or not profile.password:
        raise HotelByteError(
            401,
            "Missing username/password. Set via --username/--password, "
            "env HOTELBYTE_USERNAME/HOTELBYTE_PASSWORD, or 'hotelbyte-cli portal auth login'.",
            "/api/auth/login",
        )
    client = HttpClient(profile)
    body: dict[str, Any] = {"username": profile.username, "password": profile.password}
    resp = client.post("/api/auth/login", body)
    ticket = _extract_ticket(resp)
    profile.ticket = ticket
    save_profile(profile)
    return ticket


def _extract_ticket(resp: Any) -> str:
    """Best-effort extraction of the ticket field from various response shapes."""
    if isinstance(resp, dict):
        for key in ("ticket", "Ticket", "token", "access_token", "accessToken"):
            val = resp.get(key)
            if isinstance(val, str) and val:
                return val
        # nested under 'data'
        data = resp.get("data")
        if isinstance(data, dict):
            for key in ("ticket", "token", "access_token"):
                val = data.get(key)
                if isinstance(val, str) and val:
                    return val
    raise HotelByteError(500, f"Could not extract ticket from response: {resp}", "auth")