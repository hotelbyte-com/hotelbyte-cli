"""core/state.py — session state for REPL mode.

Tracks the active profile, last response, and a simple undo stack of
the last N request/response pairs.  Mirrors the CLI-Anything
"Smart Session Management" pattern.
"""
from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Any, Deque, Optional

from .config import Profile


@dataclass
class SessionState:
    """Mutable session state shared across REPL commands."""

    profile: Optional[Profile] = None
    last_response: Any = None
    history: Deque[dict] = field(default_factory=lambda: deque(maxlen=20))

    def record(self, path: str, body: Any, response: Any) -> None:
        self.history.append({"path": path, "body": body, "response": response})
        self.last_response = response

    def undo(self) -> Optional[dict]:
        """Pop the last request entry (best-effort undo for inspection)."""
        if self.history:
            return self.history.pop()
        return None

    @property
    def prompt(self) -> str:
        """Contextual REPL prompt."""
        if self.profile is None:
            return "hotelbyte> "
        tag = self.profile.name
        if self.profile.env != "uat":
            tag += f"[{self.profile.env}]"
        return f"hotelbyte({tag})> "


# Singleton used by the CLI when running in REPL mode.
_state: Optional[SessionState] = None


def get_state() -> SessionState:
    global _state
    if _state is None:
        _state = SessionState()
    return _state


def reset_state() -> None:
    global _state
    _state = None