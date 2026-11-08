"""Landing-repo audit of the patch files. Not part of the live runtime.

If this file is copied onto the marketing PC without the patch files, it skips.
Runtime behavior is covered by test_blog_media.py, which does not read patches.
"""
from __future__ import annotations

import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class HandoffPatches(unittest.TestCase):
    def setUp(self):
        missing = [name for name in (
            "wordpress_poster.patch",
            "blogger_poster.patch",
            "account_daily_card.patch",
        ) if not (ROOT / name).is_file()]
        if missing:
            self.skipTest("patch files are handoff artifacts and are not installed on the runtime: " + ", ".join(missing))

    def test_publisher_patches_do_not_carry_secrets_or_drop_wordpress(self):
        wordpress = (ROOT / "wordpress_poster.patch").read_text(encoding="utf-8")
        blogger = (ROOT / "blogger_poster.patch").read_text(encoding="utf-8")
        account = (ROOT / "account_daily_card.patch").read_text(encoding="utf-8")
        for body in (wordpress, blogger, account):
            self.assertNotIn("REDACTED", body)
            self.assertNotIn("LIVE_CAPTURE", body)
            self.assertNotIn("BEGIN ", body)
        self.assertIn("resolve_image or _upload_media", wordpress)
        self.assertNotIn("from .blog_media", wordpress)
        self.assertIn("assert_deployed(plan)", blogger)
        self.assertIn("resolve_image=public_url", blogger)
        self.assertNotIn("_upload_media", blogger)
        self.assertNotIn("media/new", blogger)
        self.assertIn("stage_outbox_isolated", account)
        self.assertNotIn("stage_outbox(", account)
        self.assertNotIn("wordpress_poster.publish", account)
        self.assertNotIn("blogger_poster.publish", account)
