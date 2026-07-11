"""test_config.py — unit tests for the config/credential store."""
import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest

from cli_anything.hotelbyte.core.config import (
    DEFAULT_ENV,
    ENVIRONMENTS,
    Profile,
    load_profile,
    save_profile,
    clear_ticket,
)


@pytest.fixture
def temp_cred_store(tmp_path, monkeypatch):
    """Redirect credential store to a temp directory."""
    monkeypatch.setattr("cli_anything.hotelbyte.core.config.CRED_DIR", tmp_path)
    monkeypatch.setattr("cli_anything.hotelbyte.core.config.CRED_FILE", tmp_path / "credentials.json")
    return tmp_path


class TestProfile:
    def test_profile_defaults(self):
        p = Profile(name="openapi", env="uat", base_url=ENVIRONMENTS["uat"])
        assert p.app_key is None
        assert p.auth_header is None

    def test_auth_header_with_ticket(self):
        p = Profile(name="openapi", env="uat", base_url=ENVIRONMENTS["uat"], ticket="abc123")
        assert p.auth_header == "Bearer abc123"

    def test_environments_keys(self):
        assert set(ENVIRONMENTS.keys()) == {"dev", "uat", "prod"}
        assert ENVIRONMENTS["uat"] == "https://api-test.hotelbyte.com"
        assert ENVIRONMENTS["prod"] == "https://api.hotelbyte.com"


class TestCredentialStore:
    def test_save_and_load(self, temp_cred_store):
        p = Profile(
            name="openapi",
            env="uat",
            base_url=ENVIRONMENTS["uat"],
            app_key="key123",
            app_secret="secret123",
            ticket="tok456",
        )
        save_profile(p)
        loaded = load_profile("openapi", "uat")
        assert loaded.app_key == "key123"
        assert loaded.app_secret == "secret123"
        assert loaded.ticket == "tok456"

    def test_load_missing_profile_returns_empty(self, temp_cred_store):
        p = load_profile("openapi", "prod")
        assert p.app_key is None
        assert p.ticket is None

    def test_clear_ticket(self, temp_cred_store):
        p = Profile(
            name="portal", env="uat", base_url=ENVIRONMENTS["uat"],
            username="admin", password="pass", ticket="tok",
        )
        save_profile(p)
        clear_ticket("portal", "uat")
        loaded = load_profile("portal", "uat")
        assert loaded.ticket is None
        assert loaded.username == "admin"  # other fields preserved

    def test_env_var_fallback(self, temp_cred_store, monkeypatch):
        monkeypatch.setenv("HOTELBYTE_APP_KEY", "envkey")
        monkeypatch.setenv("HOTELBYTE_APP_SECRET", "envsecret")
        p = load_profile("openapi", "uat")
        assert p.app_key == "envkey"
        assert p.app_secret == "envsecret"