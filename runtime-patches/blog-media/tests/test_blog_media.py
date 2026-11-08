"""Blogger card URL contract. Does not import the marketing runtime or touch .env."""
from __future__ import annotations

import io
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.publishers.blog_media import (  # noqa: E402
    CARD_FILENAME,
    assert_deployed,
    card_name,
    image_plan,
    public_url,
)

PNG = b"\x89PNG\r\n\x1a\n"
EN = "acct_20261107_en_1_calendar.png"
EN_URL = "https://www.javidtrading.com/blog-media/" + EN
REPORT = "acct_20261107_en_2_report.png"


class _Resp:
    def __init__(self, status=200, ctype="image/png", body=PNG, final=None, url=""):
        self.status = status
        self.headers = {"Content-Type": ctype}
        self._body = body
        self._final = final if final is not None else url
        self.url = url

    def read(self, n=8):
        return self._body[:n]

    def geturl(self):
        return self._final

    def __enter__(self):
        return self

    def __exit__(self, *_a):
        return False


class CardNames(unittest.TestCase):
    def test_stable_mapping_ignores_day_directory(self):
        a = public_url(EN)
        b = public_url("cardnews/account/2026-11-07/" + EN)
        c = public_url(pathlib.Path("cardnews/account/2026-11-07") / EN)
        self.assertEqual(a, b)
        self.assertEqual(a, c)
        self.assertEqual(a, EN_URL)
        self.assertEqual(card_name(pathlib.Path("C:/cardnews/account/2026-11-07") / EN), EN)

    def test_allowlist_and_traversal(self):
        self.assertEqual(card_name(REPORT), REPORT)
        rejected = [
            "../" + EN,
            EN + "/../../etc/passwd",
            "/etc/passwd",
            "..\\" + EN,
            "https://evil.example/" + EN,
            "acct_20261107_ko_1_calendar.png",
            "acct_20261107_EN_1_calendar.png",
            "acct_20261107_en_3_dashboard.png",
            "acct_20261107_en_1_calendar.png.txt",
            "acct_20261107_en_1_calendar.PNG",
            "acct_20260231_en_1_calendar.png",
            "acct_20261107_en_1_calendar.png\x00.png",
            "snapshot.json",
            "live.log",
            "",
        ]
        for raw in rejected:
            with self.subTest(raw=raw):
                with self.assertRaises(ValueError):
                    card_name(raw)
        self.assertIsNone(CARD_FILENAME.fullmatch("acct_20261107_ko_2_report.png"))

    def test_referenced_card_must_be_in_the_body(self):
        parts = [("__IMG__", "cardnews/account/2026-11-07/" + EN), "<p>x</p>"]
        md = f"🖼️ 사진: `{EN}`\n🖼️ 사진: `{REPORT}`\n"
        with self.assertRaises(ValueError):
            image_plan(parts, md)
        parts.append(("__IMG__", REPORT))
        urls = image_plan(parts, md)
        self.assertEqual(urls, [EN_URL, "https://www.javidtrading.com/blog-media/" + REPORT])

    def test_non_card_image_fails_closed(self):
        with self.assertRaises(ValueError):
            image_plan([("__IMG__", "images/hero.jpg")], "`hero.jpg`")


class Deployed(unittest.TestCase):
    def test_fail_closed_and_offline_plan_makes_no_request(self):
        calls = []

        def opener(req, timeout=0):
            calls.append(req.full_url)
            raise OSError("offline")

        self.assertEqual(image_plan([("__IMG__", EN)], f"`{EN}`"), [EN_URL])
        self.assertEqual(calls, [])
        with self.assertRaises(RuntimeError):
            assert_deployed([EN_URL], opener=opener)
        self.assertEqual(calls, [EN_URL])

    def test_rejects_html_wrong_host_and_accepts_png(self):
        def html_opener(req, timeout=0):
            return _Resp(status=200, ctype="text/html", body=b"<!doctype", url=req.full_url)

        with self.assertRaises(RuntimeError):
            assert_deployed([EN_URL], opener=html_opener)

        def redirect_opener(req, timeout=0):
            return _Resp(url=req.full_url, final="https://evil.example/x", body=PNG)

        with self.assertRaises(RuntimeError):
            assert_deployed([EN_URL], opener=redirect_opener)

        def ok_opener(req, timeout=0):
            return _Resp(url=req.full_url, body=PNG + b"rest")

        assert_deployed([EN_URL], opener=ok_opener)


class PublisherIsolation(unittest.TestCase):
    def test_wordpress_failure_does_not_stop_later_platforms(self):
        """Same isolation publish_all already uses: catch Exception and SystemExit per platform."""
        results = {}

        def step(name, fn):
            try:
                fn()
                results[name] = "ok"
            except (Exception, SystemExit):
                results[name] = "fail"

        def wordpress():
            raise SystemExit("wordpress suspended")

        def blogger():
            assert_deployed([EN_URL], opener=lambda *_a, **_k: (_ for _ in ()).throw(OSError("missing")))

        step("wordpress", wordpress)
        step("blogger", blogger)
        step("telegram", lambda: None)
        self.assertEqual([results["wordpress"], results["blogger"], results["telegram"]], ["fail", "fail", "ok"])


    def test_blogger_resolver_does_not_call_wordpress_upload(self):
        """Mirrors the one-line build_html hook: default uploads, Blogger passes public_url."""
        wordpress_calls = []

        def upload_media(path):
            wordpress_calls.append(("media/new", path))
            return "https://public-api.wordpress.com/rest/v1.1/sites/example/media"

        def build_html(parts, resolve_image=None):
            resolve = resolve_image or upload_media
            out = []
            for part in parts:
                if isinstance(part, tuple) and part[0] == "__IMG__":
                    out.append(resolve(part[1]))
            return out

        parts = [("__IMG__", "cardnews/account/2026-11-07/" + EN)]
        blogger_html = build_html(parts, resolve_image=public_url)
        self.assertEqual(wordpress_calls, [])
        self.assertEqual(blogger_html, [EN_URL])
        wordpress_html = build_html([("__IMG__", "images/keep.png")])
        self.assertEqual(len(wordpress_calls), 1)
        self.assertIn("media/new", wordpress_calls[0])
        self.assertNotEqual(wordpress_html, blogger_html)

    def test_patches_do_not_touch_live_runtime_or_drop_wordpress(self):
        patch_dir = ROOT
        texts = []
        for name in ("wordpress_poster.patch", "blogger_poster.patch"):
            body = (patch_dir / name).read_text(encoding="utf-8")
            texts.append(body)
            self.assertNotIn("REDACTED", body)
            self.assertNotIn("account_daily_card", body)
            self.assertNotIn("LIVE_CAPTURE", body)
        wordpress, blogger = texts
        self.assertIn("resolve_image or _upload_media", wordpress)
        self.assertIn("def build_html", wordpress)
        self.assertNotIn("from .blog_media", wordpress)
        self.assertNotIn("assert_deployed", wordpress)
        self.assertIn("assert_deployed(plan)", blogger)
        self.assertIn("resolve_image=public_url", blogger)
        self.assertIn("from .blog_media import", blogger)
        self.assertNotIn("_upload_media", blogger)
        self.assertNotIn("media/new", blogger)
        self.assertIn("if dry_run:", blogger)
        self.assertNotIn("-        assert_quality", blogger)
        self.assertNotIn("-    if not dry_run:", blogger)
        joined = "\n".join(texts)
        self.assertNotIn("wordpress_poster.publish", joined)


if __name__ == "__main__":
    unittest.main()
