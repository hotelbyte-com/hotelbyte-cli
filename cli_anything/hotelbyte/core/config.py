"""core/config.py — environment profiles and credential management.

The HotelByte backend exposes three environments; the CLI mirrors them
via ``--env`` flags or the ``HOTELBYTE_ENV`` env var.

Profiles (command routing):
  openapi  — public OpenAPI surface (appKey/appSecret → JWT ticket)
  portal   — tenant-portal BFF (login → JWT ticket, cookie or Bearer)

The credential store is a simple JSON file at
``~/.hotelbyte-cli/credentials.json`` (mode 0600).  Tokens are cached
per-environment with their expiry so repeated commands reuse the
session.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

# ── environment base URLs ──────────────────────────────────────────────

ENVIRONMENTS = {
    "dev": "http://localhost:8888",
    "uat": "https://api-test.hotelbyte.com",
    "prod": "https://api.hotelbyte.com",
}

DEFAULT_ENV = os.environ.get("HOTELBYTE_ENV", "uat")


@dataclass
class Profile:
    """A CLI profile bundles environment + base URL + active credential."""

    name: str          # "openapi" | "portal"
    env: str           # "dev" | "uat" | "prod"
    base_url: str
    # OpenAPI credentials
    app_key: Optional[str] = None
    app_secret: Optional[str] = None
    # Portal credentials
    username: Optional[str] = None
    password: Optional[str] = None
    # Cached JWT ticket
    ticket: Optional[str] = None

    @property
    def auth_header(self) -> Optional[str]:
        return f"Bearer {self.ticket}" if self.ticket else None


# ── credential store ────────────────────────────────────────────────────

CRED_DIR = Path(os.environ.get("HOTELBYTE_HOME", str(Path.home() / ".hotelbyte-cli")))
CRED_FILE = CRED_DIR / "credentials.json"


def _load_store() -> dict:
    if not CRED_FILE.exists():
        return {}
    try:
        return json.loads(CRED_FILE.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


def _save_store(data: dict) -> None:
    CRED_DIR.mkdir(parents=True, exist_ok=True)
    CRED_FILE.write_text(json.dumps(data, indent=2, sort_keys=True))
    try:
        CRED_FILE.chmod(0o600)
    except OSError:
        pass  # non-POSIX FS


def save_profile(profile: Profile) -> None:
    """Persist (or update) a profile in the credential store."""
    store = _load_store()
    key = f"{profile.name}:{profile.env}"
    store[key] = {
        "app_key": profile.app_key,
        "app_secret": profile.app_secret,
        "username": profile.username,
        "password": profile.password,
        "ticket": profile.ticket,
    }
    _save_store(store)


def load_profile(name: str, env: str = DEFAULT_ENV) -> Profile:
    """Load a profile from the store, falling back to env vars."""
    store = _load_store()
    key = f"{name}:{env}"
    saved = store.get(key, {})
    base_url = ENVIRONMENTS.get(env, ENVIRONMENTS[DEFAULT_ENV])
    return Profile(
        name=name,
        env=env,
        base_url=os.environ.get("HOTELBYTE_BASE_URL", base_url),
        app_key=saved.get("app_key") or os.environ.get("HOTELBYTE_APP_KEY"),
        app_secret=saved.get("app_secret") or os.environ.get("HOTELBYTE_APP_SECRET"),
        username=saved.get("username") or os.environ.get("HOTELBYTE_USERNAME"),
        password=saved.get("password") or os.environ.get("HOTELBYTE_PASSWORD"),
        ticket=saved.get("ticket"),
    )


def clear_ticket(name: str, env: str = DEFAULT_ENV) -> None:
    """Remove the cached ticket (force re-auth on next call)."""
    store = _load_store()
    key = f"{name}:{env}"
    if key in store:
        store[key]["ticket"] = None
        _save_store(store)