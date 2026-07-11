"""test_http.py — unit tests for the HTTP client."""
from unittest.mock import MagicMock, patch

import pytest

from cli_anything.hotelbyte.core.config import Profile, ENVIRONMENTS
from cli_anything.hotelbyte.core.http import HttpClient, HotelByteError


@pytest.fixture
def profile():
    return Profile(name="openapi", env="uat", base_url=ENVIRONMENTS["uat"], ticket="test-ticket")


class TestHttpClient:
    def test_post_injects_auth_header(self, profile):
        """Verify Authorization header is set from the profile ticket."""
        with patch("cli_anything.hotelbyte.core.http.requests.post") as mock_post:
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.text = '{"ok": true}'
            mock_resp.json.return_value = {"ok": True}
            mock_post.return_value = mock_resp

            client = HttpClient(profile)
            result = client.post("/api/search/destinations", {"countryCode": "US"})

            assert result == {"ok": True}
            call_args = mock_post.call_args
            assert call_args.kwargs["headers"]["Authorization"] == "Bearer test-ticket"
            assert call_args.kwargs["headers"]["Content-Type"] == "application/json"
            assert call_args.args[0] == "https://api-test.hotelbyte.com/api/search/destinations"

    def test_post_raises_on_error(self, profile):
        with patch("cli_anything.hotelbyte.core.http.requests.post") as mock_post:
            mock_resp = MagicMock()
            mock_resp.status_code = 401
            mock_resp.text = '{"error": "unauthorized"}'
            mock_post.return_value = mock_resp

            client = HttpClient(profile)
            with pytest.raises(HotelByteError) as exc_info:
                client.post("/api/auth/ticket", {})
            assert exc_info.value.status == 401

    def test_get_without_body(self, profile):
        with patch("cli_anything.hotelbyte.core.http.requests.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.text = '{"data": []}'
            mock_resp.json.return_value = {"data": []}
            mock_get.return_value = mock_resp

            client = HttpClient(profile)
            result = client.get("/health")
            assert result == {"data": []}