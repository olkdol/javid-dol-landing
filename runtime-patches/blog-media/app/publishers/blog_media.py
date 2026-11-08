"""Public card URLs for Blogger. Standard library only. No WordPress. No .env.

Copy this file to app/publishers/blog_media.py in the local marketing runtime.
Do not copy any other file from the sanitized snapshot over a live original.
"""
from __future__ import annotations

import re
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

ORIGIN = "https://www.javidtrading.com"
PREFIX = "/blog-media/"
CARD_FILENAME = re.compile(
    r"^acct_\d{8}_(en|ja|es|fr|vi|tr|pt)_(1_calendar|2_report)\.png$"
)
_BACKTICK_IMAGE = re.compile(r"`([^`]+\.(?:png|jpg|jpeg|webp|gif))`", re.I)
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _valid_date(yyyymmdd: str) -> bool:
    try:
        date(int(yyyymmdd[0:4]), int(yyyymmdd[4:6]), int(yyyymmdd[6:8]))
    except ValueError:
        return False
    return True


def card_name(value: object) -> str:
    """Basename of an allowlisted card. Rejects traversal, other types, and bad dates."""
    if isinstance(value, Path):
        raw = value.as_posix()
    else:
        raw = str(value).replace("\\", "/")
    if "\x00" in raw or "://" in raw or raw.startswith("//"):
        raise ValueError("rejected card path")
    parts = [p for p in raw.split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        raise ValueError("rejected card path")
    name = parts[-1]
    if not CARD_FILENAME.fullmatch(name) or not _valid_date(name[5:13]):
        raise ValueError(f"not an allowlisted card: {name}")
    return name


def public_url(value: object) -> str:
    return ORIGIN + PREFIX + card_name(value)


def image_plan(parts: list, markdown: str = "") -> list[str]:
    """Stable public URLs for one post. Offline. Raises if any image is not a card."""
    names: list[str] = []
    for part in parts:
        if isinstance(part, tuple) and part and part[0] == "__IMG__":
            names.append(card_name(part[1]))
    referenced = [card_name(raw) for raw in _BACKTICK_IMAGE.findall(markdown)]
    for name in referenced:
        if name not in names:
            raise ValueError(f"referenced card is not in the post body: {name}")
    for match in CARD_FILENAME.finditer(markdown):
        if match.group(0) not in names:
            raise ValueError(f"referenced card is not in the post body: {match.group(0)}")
    return [public_url(name) for name in names]


def _canonical(url: str) -> None:
    name = url[len(ORIGIN + PREFIX):] if url.startswith(ORIGIN + PREFIX) else ""
    if public_url(name) != url:
        raise ValueError(f"not a canonical card url: {url}")


def assert_deployed(urls: list[str], opener=None, timeout: float = 20) -> None:
    """GET each canonical URL. Require 200, image/png, and a PNG signature.

    Fail closed. Does not follow a redirect and does not call WordPress.
    """
    if opener is None:
        opener = urllib.request.urlopen
    missing: list[str] = []
    for url in urls:
        try:
            _canonical(url)
            req = urllib.request.Request(url, method="GET", headers={"Accept": "image/png"})
            with opener(req, timeout=timeout) as resp:
                status = getattr(resp, "status", None) or getattr(resp, "code", None) or 200
                final = resp.geturl() if hasattr(resp, "geturl") else url
                headers = getattr(resp, "headers", {}) or {}
                ctype = headers.get("Content-Type") or headers.get("content-type") or ""
                magic = resp.read(8)
                if status != 200 or "image/png" not in str(ctype).lower() or magic != PNG_MAGIC or final != url:
                    missing.append(url)
        except (ValueError, OSError, urllib.error.URLError):
            missing.append(url)
    if missing:
        raise RuntimeError("blog-media image is not deployed: " + ", ".join(missing))
