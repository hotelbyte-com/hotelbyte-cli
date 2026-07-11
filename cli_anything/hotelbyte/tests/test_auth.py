"""test_auth.py — unit tests for authentication flows."""
from unittest.mock import MagicMock, patch

import pytest

from cli_anything.hotelbyte.core.config import Profile, ENVIRONMENTS
from cli_anything.hotelbyte.core.auth import authenticate_openapi, authenticate_portal, _extract_ticket
from cli_anything.hotelbyte.core.http import HotelByteError


@pytest.fixture
def temp_cred_store(tmp_path, monkeypatch):
    monkeypatch.setattr("cli_anything.hotelbyte.core.config.CRED_DIR", tmp_path)
    monkeypatch.setattr("cli_anything.hotelbyte.core.config.CRED_FILE", tmp_path / "credentials.json")
    return tmp_path


class TestExtractTicket:
    def test_flat_ticket(self):
        assert _extract_ticket({"ticket": "abc"}) == "abc"

    def test_nested_data(self):
        assert _extract_ticket({"data": {"ticket": "xyz"}}) == "xyz"

    def test_access_token(self):
        assert _extract_ticket({"access_token": "tok"}) == "tok"

    def test_missing_raises(self):
        with pytest.raises(HotelByteError):
            _extract_ticket({"unrelated": "field"})


class TestAuthenticateOpenAPI:
    def test_reuses_cached_ticket(self, temp_cred_store):
        p = Profile(name="openapi", env="uat", base_url=ENVIRONMENTS["uat"], ticket="cached")
        result = authenticate_openapi(p)
        assert result == "cached"

    def test_missing_credentials_raises(self, temp_cred_store):
        p = Profile(name="openapi", env="uat", base_url=ENVIRONMENTS["uat"])
        with pytest.raises(HotelByteError) as exc_info:
            authenticate_openapi(p)
        assert "Missing appKey/appSecret" in str(exc_info.value)

    def test_successful_auth(self, temp_cred_store):
        p = Profile(
            name="openapi", env="uat", base_url=ENVIRONMENTS["uat"],
            app_key="key", app_secret="secret",
        )
        with patch("cli_anything.hotelbyte.core.http.requests.post") as mock_post:
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.text = '{"ticket": "new-token"}'
            mock_resp.json.return_value = {"ticket": "new-token"}
            mock_post.return_value = mock_resp

            token = authenticate_openapi(p)
            assert token == "new-token"
            assert p.ticket == "new-token"