"""test_e2e.py — end-to-end test stubs.

These tests require a live HotelByte backend. They are skipped unless
the HOTELBYTE_E2E_URL env var is set, OR the --e2e flag is passed to pytest.

To run against UAT:
    HOTELBYTE_E2E_URL=https://api-test.hotelbyte.com pytest -m e2e

To run against local dev:
    HOTELBYTE_E2E_URL=http://localhost:8888 pytest -m e2e
"""
import os
from unittest.mock import patch, MagicMock

import pytest
from click.testing import CliRunner

from cli_anything.hotelbyte.cli import cli

E2E_URL = os.environ.get("HOTELBYTE_E2E_URL")
SKIP_REASON = "Set HOTELBYTE_E2E_URL to run E2E tests"


@pytest.fixture
def runner():
    return CliRunner()


@pytest.mark.skipif(not E2E_URL, reason=SKIP_REASON)
class TestOpenAPIE2E:
    """Live tests against the OpenAPI profile."""

    def test_ticket(self, runner):
        """Obtain a JWT ticket via appKey/appSecret."""
        app_key = os.environ.get("HOTELBYTE_APP_KEY")
        app_secret = os.environ.get("HOTELBYTE_APP_SECRET")
        if not app_key or not app_secret:
            pytest.skip("HOTELBYTE_APP_KEY/SECRET required for E2E")
        result = runner.invoke(cli, [
            "--env", "uat",
            "openapi", "auth", "ticket",
            "--app-key", app_key,
            "--app-secret", app_secret,
        ])
        assert result.exit_code == 0

    def test_destinations(self, runner):
        """Search for destinations in the US."""
        app_key = os.environ.get("HOTELBYTE_APP_KEY")
        app_secret = os.environ.get("HOTELBYTE_APP_SECRET")
        if not app_key or not app_secret:
            pytest.skip("HOTELBYTE_APP_KEY/SECRET required for E2E")
        result = runner.invoke(cli, [
            "--env", "uat", "--json",
            "openapi", "search", "destinations",
            "--country-code", "US",
            "--app-key", app_key,
            "--app-secret", app_secret,
        ])
        assert result.exit_code == 0


@pytest.mark.skipif(not E2E_URL, reason=SKIP_REASON)
class TestPortalE2E:
    """Live tests against the tenant-portal profile."""

    def test_login(self, runner):
        username = os.environ.get("HOTELBYTE_USERNAME")
        password = os.environ.get("HOTELBYTE_PASSWORD")
        if not username or not password:
            pytest.skip("HOTELBYTE_USERNAME/PASSWORD required for E2E")
        result = runner.invoke(cli, [
            "--env", "uat", "--json",
            "portal", "auth", "login",
            "--username", username,
            "--password", password,
        ], input=f"{password}\n")
        assert result.exit_code == 0