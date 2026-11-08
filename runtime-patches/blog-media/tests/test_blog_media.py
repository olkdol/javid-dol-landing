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
    CHECK_USER_AGENT,
    assert_deployed,
    card_name,
    image_plan,
    public_url,
    stage_outbox,
    stage_outbox_isolated,
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
            ua = req.get_header("User-agent")
            if ua != CHECK_USER_AGENT or "Python-urllib" in ua:
                raise AssertionError(ua)
            if req.get_header("Cookie") or req.get_header("Authorization"):
                raise AssertionError("unexpected credential header")
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

        def forbidden(req, timeout=0):
            self.assertEqual(req.get_header("User-agent"), CHECK_USER_AGENT)
            return _Resp(status=403, ctype="text/html", body=b"challenge", url=req.full_url)

        with self.assertRaises(RuntimeError):
            assert_deployed([EN_URL], opener=forbidden)


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


class Outbox(unittest.TestCase):
    def test_stage_is_local_idempotent_and_skips_non_cards(self):
        root = pathlib.Path(os_tmpdir())
        day = root / "2026-11-07"
        day.mkdir()
        png = minimal_png()
        (day / EN).write_bytes(png)
        (day / REPORT).write_bytes(png)
        (day / "post.md").write_text("x", encoding="utf-8")
        (day / "snapshot.json").write_text("{}", encoding="utf-8")
        (day / "acct_20261107_ko_1_calendar.png").write_bytes(png)
        out = root / "out"
        first = stage_outbox(day, out)
        self.assertEqual(sorted(p.name for p in out.glob("*.png")), [EN, REPORT])
        self.assertTrue((out / "_cards.json").is_file())
        second = stage_outbox(day, out)
        self.assertTrue(all(row["action"] == "unchanged" for row in second["actions"]))
        self.assertEqual(first["count"], 2)
        listing = (out / "_cards.json").read_text(encoding="utf-8")
        self.assertNotIn("snapshot", listing)
        self.assertNotIn("ko_", listing)

    def test_bad_png_fails_closed(self):
        root = pathlib.Path(os_tmpdir())
        day = root / "day"
        day.mkdir()
        (day / EN).write_bytes(minimal_png())
        (day / REPORT).write_bytes(b"not a png")
        with self.assertRaises(ValueError):
            stage_outbox(day, root / "out")

    def test_symlink_card_fails_closed(self):
        root = pathlib.Path(os_tmpdir())
        day = root / "day"
        day.mkdir()
        good = day / EN
        good.write_bytes(minimal_png())
        link = day / REPORT
        try:
            link.symlink_to(good)
        except OSError as exc:
            self.skipTest(f"symlink not permitted on this machine: {type(exc).__name__}: {exc}")
        with self.assertRaises(ValueError):
            stage_outbox(day, root / "out")

    def test_stage_failure_does_not_block_other_channels(self):
        """A corrupt card must not raise. Blogger stays fail-closed; other channels run."""
        root = pathlib.Path(os_tmpdir())
        day = root / "day"
        day.mkdir()
        (day / EN).write_bytes(b"corrupt")
        messages = []
        failed = stage_outbox_isolated(day, root / "out", log=messages.append)
        self.assertFalse(failed["ok"])
        self.assertTrue(messages)
        self.assertIn("other channels continue", messages[0])

        results = {}

        def step(name, fn):
            try:
                fn()
                results[name] = "ok"
            except (Exception, SystemExit):
                results[name] = "fail"

        step("wordpress", lambda: None)
        step("telegram", lambda: None)
        step("youtube", lambda: None)
        step("tiktok", lambda: None)
        step("blogger", lambda: assert_deployed(
            [EN_URL], opener=lambda *_a, **_k: (_ for _ in ()).throw(OSError("not deployed"))
        ))
        self.assertEqual(results["wordpress"], "ok")
        self.assertEqual(results["telegram"], "ok")
        self.assertEqual(results["youtube"], "ok")
        self.assertEqual(results["tiktok"], "ok")
        self.assertEqual(results["blogger"], "fail")

        (day / EN).write_bytes(minimal_png())
        (day / REPORT).write_bytes(minimal_png())
        recovered = stage_outbox_isolated(day, root / "out", log=messages.append)
        self.assertTrue(recovered["ok"])
        self.assertEqual(recovered["count"], 2)
        again = stage_outbox_isolated(day, root / "out", log=messages.append)
        self.assertTrue(again["ok"])
        self.assertTrue(all(row["action"] == "unchanged" for row in again["actions"]))


def minimal_png() -> bytes:
    buf = bytearray(24)
    buf[:8] = PNG
    buf[8:12] = (13).to_bytes(4, "big")
    buf[12:16] = b"IHDR"
    return bytes(buf)


def os_tmpdir() -> str:
    import tempfile
    return tempfile.mkdtemp(prefix="blog-media-")


if __name__ == "__main__":
    unittest.main()
