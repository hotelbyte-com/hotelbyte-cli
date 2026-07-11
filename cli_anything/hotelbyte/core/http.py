"""core/http.py — thin requests wrapper with auth injection.

All HotelByte endpoints are POST JSON.  This client:
  - injects ``Authorization: Bearer <ticket>`` when available
  - prefixes the configured base URL
  - raises :class:`HotelByteError` on non-2xx with the raw body for
    structured error reporting (``--json`` consumers).
"""
from __future__ import annotations

import json as _json
from typing import Any, Optional

import requests

from .config import Profile


class HotelByteError(Exception):
    """Raised when the backend returns a non-2xx response."""

    def __init__(self, status: int, body: str, path: str):
        self.status = status
        self.body = body
        self.path = path
        super().__init__(f"[{status}] {path}: {body[:500]}")


class HttpClient:
    """Minimal authenticated JSON client."""

    def __init__(self, profile: Profile, timeout: int = 30):
        self.profile = profile
        self.timeout = timeout

    # ── core request ───────────────────────────────────────────────────

    def post(self, path: str, body: Any = None, *, raw: bool = False) -> Any:
        url = f"{self.profile.base_url}{path}"
        headers = {"Content-Type": "application/json"}
        if self.profile.auth_header:
            headers["Authorization"] = self.profile.auth_header
        payload = _json.dumps(body) if body is not None else None
        resp = requests.post(url, data=payload, headers=headers, timeout=self.timeout)
        return self._handle(resp, path, raw)

    def get(self, path: str, *, params: Optional[dict] = None, raw: bool = False) -> Any:
        url = f"{self.profile.base_url}{path}"
        headers = {}
        if self.profile.auth_header:
            headers["Authorization"] = self.profile.auth_header
        resp = requests.get(url, headers=headers, params=params, timeout=self.timeout)
        return self._handle(resp, path, raw)

    # ── response handling ──────────────────────────────────────────────

    @staticmethod
    def _handle(resp: requests.Response, path: str, raw: bool) -> Any:
        if resp.status_code >= 400:
            raise HotelByteError(resp.status_code, resp.text, path)
        if raw:
            return resp.text
        text = resp.text
        if not text:
            return None
        try:
            return resp.json()
        except _json.JSONDecodeError:
            return text  # fall back to raw text