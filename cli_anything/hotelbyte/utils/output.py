"""utils/output.py — structured output helpers.

Handles the ``--json`` flag consistently: when set, emit compact JSON
to stdout for agent consumption; otherwise pretty-print or summarise
for humans.
"""
from __future__ import annotations

import json
import sys
from typing import Any

import click


def emit(data: Any, json_mode: bool, *, pretty: bool = True) -> None:
    """Emit ``data`` in the appropriate format.

    Args:
        data: the response payload (dict/list/str).
        json_mode: when True, emit ``--json`` structured output.
        pretty: when True (human mode), pretty-print with indentation.
    """
    if json_mode:
        click.echo(json.dumps(data, ensure_ascii=False, default=str))
    elif isinstance(data, (dict, list)):
        click.echo(json.dumps(data, ensure_ascii=False, indent=2 if pretty else None, default=str))
    elif data is None:
        click.echo("(no output)")
    else:
        click.echo(str(data))


def error(msg: str, json_mode: bool = False) -> None:
    """Emit an error message in the appropriate format."""
    if json_mode:
        click.echo(json.dumps({"error": msg}, ensure_ascii=False), err=True)
    else:
        click.echo(f"✗ {msg}", err=True)