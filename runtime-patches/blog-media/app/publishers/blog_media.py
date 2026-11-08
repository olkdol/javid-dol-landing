"""Public card URLs for Blogger. Standard library only. No WordPress. No .env.

Copy this file to app/publishers/blog_media.py in the local marketing runtime.
Do not copy any other file from the sanitized snapshot over a live original.
"""
from __future__ import annotations

import argparse
import hashlib
import os
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
MAX_CARD_BYTES = 8 * 1024 * 1024
# The live edge returns 403 for urllib's default Python-urllib User-Agent and
# 200 for an ordinary browser User-Agent. One explicit header only: no cookie,
# no Authorization, and no retry if the response is a challenge.
CHECK_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)


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
            req = urllib.request.Request(url, method="GET", headers={
                "User-Agent": CHECK_USER_AGENT,
                "Accept": "image/png",
            })
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


def _assert_png(data: bytes) -> None:
    if len(data) < 24 or len(data) > MAX_CARD_BYTES or data[:8] != PNG_MAGIC or data[12:16] != b"IHDR":
        raise ValueError("png rejected")


def stage_outbox(source: Path, dest: Path) -> dict:
    """Copy allowlisted PNGs into a flat outbox. Does not contact Cloudflare.

    Other files in the card directory (markdown, json, logs, snapshots) are
    skipped. A second run with the same bytes is unchanged. Existing outbox
    cards from earlier days are left in place.
    """
    source = Path(source)
    dest = Path(dest)
    if not source.is_dir() or source.is_symlink():
        raise ValueError("card directory missing")
    root = source.resolve()
    found: dict[str, bytes] = {}
    for dirpath, dirnames, filenames in os.walk(source, followlinks=False):
        dirnames[:] = [d for d in dirnames if d not in (".", "..")]
        for name in filenames:
            if not CARD_FILENAME.fullmatch(name):
                continue
            path = Path(dirpath) / name
            if path.is_symlink():
                raise ValueError(f"refusing symlink card: {name}")
            real = path.resolve()
            if root != real and root not in real.parents:
                raise ValueError(f"card path escapes the source directory: {name}")
            card_name(name)
            data = path.read_bytes()
            _assert_png(data)
            prev = found.get(name)
            if prev is not None and prev != data:
                raise ValueError(f"conflicting bytes for {name}")
            found[name] = data
    if not found:
        raise ValueError("no allowlisted cards found")
    dest.mkdir(parents=True, exist_ok=True)
    actions = []
    for name in sorted(found):
        target = dest / name
        if target.is_symlink() or (target.exists() and not target.is_file()):
            raise ValueError(f"refusing to replace {name}")
        data = found[name]
        if target.is_file() and target.read_bytes() == data:
            actions.append({"name": name, "action": "unchanged"})
            continue
        action = "replaced" if target.exists() else "added"
        target.write_bytes(data)
        actions.append({"name": name, "action": action})
    listing = {
        "files": [
            {
                "name": name,
                "size": len(found[name]),
                "sha256": hashlib.sha256(found[name]).hexdigest(),
                "url": public_url(name),
            }
            for name in sorted(found)
        ]
    }
    (dest / "_cards.json").write_text(
        __import__("json").dumps(listing, indent=2) + "\n", encoding="utf-8"
    )
    return {"count": len(found), "actions": actions, "dest": str(dest)}


def stage_outbox_isolated(source: Path, dest: Path, log=None) -> dict:
    """Stage cards without aborting the rest of the daily publish.

    A missing directory, corrupt PNG, or IO error is logged and returned.
    Blogger still fail-closes later, on its own, if the public URL is not live.
    Repeating a successful stage with the same bytes is unchanged.
    """
    write = log if log is not None else (lambda _message: None)
    try:
        report = stage_outbox(source, dest)
    except (Exception, SystemExit) as exc:
        try:
            write(
                "  blog-media outbox failed (other channels continue): "
                f"{type(exc).__name__}: {str(exc)[:160]}"
            )
        except (Exception, SystemExit):
            pass
        return {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
    try:
        write(f"  blog-media outbox {report['count']} png (Cloudflare upload is separate)")
    except (Exception, SystemExit):
        pass
    return {"ok": True, **report}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Stage allowlisted cards. Does not upload.")
    ap.add_argument("--stage", type=Path, required=True, help="cardnews/account/YYYY-MM-DD")
    ap.add_argument("--out", type=Path, required=True, help="flat outbox directory")
    args = ap.parse_args(argv)
    report = stage_outbox(args.stage, args.out)
    for row in report["actions"]:
        print(f"{row['action']} {row['name']}")
    print(f"staged {report['count']} {report['dest']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
