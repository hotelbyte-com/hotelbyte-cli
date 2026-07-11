"""test_cli.py — CLI smoke tests via Click's CliRunner."""
from unittest.mock import patch, MagicMock

import pytest
from click.testing import CliRunner

from cli_anything.hotelbyte.cli import cli
from cli_anything.hotelbyte.core.config import Profile, ENVIRONMENTS


@pytest.fixture
def runner():
    return CliRunner()


class TestTopLevel:
    def test_help(self, runner):
        result = runner.invoke(cli, ["--help"], prog_name="hotelbyte-cli")
        assert result.exit_code == 0
        assert "HotelByte CLI" in result.output
        assert "openapi" in result.output
        assert "portal" in result.output

    def test_version(self, runner):
        result = runner.invoke(cli, ["--version"])
        assert result.exit_code == 0

    def test_no_command_shows_help(self, runner):
        result = runner.invoke(cli, [])
        assert result.exit_code == 0
        assert "openapi" in result.output


class TestOpenAPIGroup:
    def test_openapi_help(self, runner):
        result = runner.invoke(cli, ["openapi", "--help"])
        assert result.exit_code == 0
        assert "search" in result.output
        assert "trade" in result.output
        assert "auth" in result.output

    def test_search_help(self, runner):
        result = runner.invoke(cli, ["openapi", "search", "--help"])
        assert result.exit_code == 0
        assert "hotel-list" in result.output
        assert "hotel-rates" in result.output
        assert "check-avail" in result.output

    def test_trade_help(self, runner):
        result = runner.invoke(cli, ["openapi", "trade", "--help"])
        assert result.exit_code == 0
        assert "book" in result.output
        assert "cancel" in result.output
        assert "query-orders" in result.output

    def test_set_credentials(self, runner, tmp_path, monkeypatch):
        monkeypatch.setattr("cli_anything.hotelbyte.core.config.CRED_DIR", tmp_path)
        monkeypatch.setattr("cli_anything.hotelbyte.core.config.CRED_FILE", tmp_path / "credentials.json")
        result = runner.invoke(cli, [
            "openapi", "auth", "set-credentials",
            "--app-key", "testkey",
            "--app-secret", "testsecret",
            "--env", "uat",
        ])
        assert result.exit_code == 0
        assert "saved" in result.output


class TestPortalGroup:
    def test_portal_help(self, runner):
        result = runner.invoke(cli, ["portal", "--help"])
        assert result.exit_code == 0
        assert "orders" in result.output
        assert "users" in result.output
        assert "entity" in result.output
        assert "subscriptions" in result.output
        assert "suppliers" in result.output
        assert "search" in result.output

    def test_orders_help(self, runner):
        result = runner.invoke(cli, ["portal", "orders", "--help"])
        assert result.exit_code == 0
        assert "list" in result.output
        assert "detail" in result.output

    def test_users_help(self, runner):
        result = runner.invoke(cli, ["portal", "users", "--help"])
        assert result.exit_code == 0
        assert "list" in result.output
        assert "invite" in result.output

    def test_entity_help(self, runner):
        result = runner.invoke(cli, ["portal", "entity", "--help"])
        assert result.exit_code == 0
        assert "list" in result.output
        assert "get" in result.output


class TestJSONOutput:
    def test_json_flag_emit(self, runner):
        """--json should produce compact JSON."""
        runner = CliRunner()
        result = runner.invoke(cli, [
            "--json",
            "openapi", "auth", "set-credentials",
            "--app-key", "k", "--app-secret", "s",
        ], env={"HOTELBYTE_HOME": "/tmp/test-hb-cli-json"})
        assert result.exit_code == 0
        # Output should be valid JSON
        import json
        data = json.loads(result.output.strip())
        assert data["status"] == "saved"