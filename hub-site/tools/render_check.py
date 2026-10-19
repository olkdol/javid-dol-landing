# -*- coding: utf-8 -*-
"""Headless render check of the built site served by `npx wrangler dev` (default http://127.0.0.1:8787).

  py -3.13 tools/render_check.py [--base URL] [--langs en,ko,ja] [--out ../docs/screens]

For every page x language x width (375, 768, 1280) it loads the page, waits for the live block /
board to settle, records console errors, horizontal overflow (page wider than the viewport),
images that failed to load, and download links without attribution, and saves a full-page PNG.
Clicks are never sent to /api/download: every navigation to it is aborted at the network layer.
"""
import argparse
import asyncio
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")
from playwright.async_api import async_playwright

PAGES = ["", "how-it-works", "exchange", "download", "guide", "copy-trading", "risk-disclosure", "faq", "board", "contact", "privacy", "terms"]
WIDTHS = [375, 768, 1280]


def url_for(base, lang, page):
    if lang == "en":
        return f"{base}/{page}" if page else f"{base}/"
    return f"{base}/{lang}/{page}" if page else f"{base}/{lang}"


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8787")
    ap.add_argument("--langs", default="en,ko")
    ap.add_argument("--pages", default=",".join(p or "home" for p in PAGES))
    ap.add_argument("--out", default=str(pathlib.Path(__file__).resolve().parents[2] / "docs" / "screens"))
    ap.add_argument("--no-shots", action="store_true")
    a = ap.parse_args()
    out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
    pages = ["" if p == "home" else p for p in a.pages.split(",")]
    report = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for lang in a.langs.split(","):
            for w in WIDTHS:
                ctx = await b.new_context(viewport={"width": w, "height": 900}, device_scale_factor=1)
                async def block_dl(route):
                    await route.abort()
                await ctx.route("**/api/download**", block_dl)
                for page in pages:
                    pg = await ctx.new_page()
                    errs = []
                    pg.on("console", lambda m, errs=errs: errs.append(m.text) if m.type == "error" else None)
                    pg.on("pageerror", lambda e, errs=errs: errs.append(str(e)))
                    u = url_for(a.base, lang, page)
                    resp = await pg.goto(u, wait_until="networkidle", timeout=60000)
                    await pg.wait_for_timeout(1500)
                    # scroll through so lazy images load before the full-page shot
                    await pg.evaluate("async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } window.scrollTo(0, 0); }")
                    try:
                        await pg.wait_for_function("Array.from(document.images).every(i => i.complete)", timeout=10000)
                    except Exception:
                        pass
                    await pg.wait_for_timeout(500)
                    info = await pg.evaluate("""() => ({
                      sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
                      broken: Array.from(document.images).filter(i => i.complete && i.naturalWidth === 0 && !i.closest('[hidden]')).map(i => i.src),
                      noattr: Array.from(document.querySelectorAll('a[href*="/api/download"]')).filter(a => !a.hasAttribute('data-dl')).length,
                      h1: (document.querySelector('h1')||{}).textContent || '',
                      live: (document.querySelector('[data-live-status]')||{}).textContent || ''
                    })""")
                    status = resp.status if resp else None
                    problems = []
                    if status != 200: problems.append(f"HTTP {status}")
                    if info["sw"] > info["cw"] + 1: problems.append(f"horizontal overflow {info['sw']}>{info['cw']}")
                    if info["broken"]: problems.append(f"broken images {info['broken'][:3]}")
                    if info["noattr"]: problems.append(f"{info['noattr']} download links without attribution")
                    errs2 = [e for e in errs if "favicon" not in e]
                    if errs2: problems.append(f"console errors {errs2[:3]}")
                    name = f"{lang}-{page or 'home'}-{w}.png"
                    if not a.no_shots:
                        await pg.screenshot(path=str(out / name), full_page=True)
                    report.append({"lang": lang, "page": page or "home", "width": w, "status": status, "problems": problems, "h1": info["h1"].strip()[:60]})
                    print(f"{lang:2} {page or 'home':16} {w:5}  {'OK' if not problems else ' | '.join(problems)}")
                    await pg.close()
                await ctx.close()
        await b.close()
    (out / "render_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    bad = [r for r in report if r["problems"]]
    print(f"{len(report) - len(bad)}/{len(report)} renders clean")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
