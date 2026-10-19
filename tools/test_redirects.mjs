// Redirect map test for the old exchange sites -> www. Pure function test (no network).
//   node tools/test_redirects.mjs
import { legacyTarget } from "../shared/legacy_redirect.js";

const W = "https://www.javidtrading.com";
const cases = [
  // [exchange, old URL, expected target or null (= served as before)]
  ["bitget", "https://bg.javidtrading.com/", W + "/?exchange=bitget"],
  ["bitget", "https://bg.javidtrading.com/index.html", W + "/?exchange=bitget"],
  ["bitget", "https://bg.javidtrading.com/ko", W + "/ko?exchange=bitget"],
  ["bitget", "https://bg.javidtrading.com/ko.html", W + "/ko?exchange=bitget"],
  ["bitget", "https://bg.javidtrading.com/pt?utm_source=youtube&utm_medium=live", W + "/pt?utm_source=youtube&utm_medium=live&exchange=bitget"],
  ["bitget", "https://bg.javidtrading.com/results", W + "/exchange?exchange=bitget"],
  ["bitget", "https://bg.javidtrading.com/manual", W + "/guide?exchange=bitget"],
  ["bitget", "https://bg.javidtrading.com/board", W + "/board"],
  ["bitget", "https://bg.javidtrading.com/install-help?lang=ko", W + "/ko/download?exchange=bitget#install"],
  ["bitget", "https://bg.javidtrading.com/install-help", W + "/download?exchange=bitget#install"],
  ["bitget", "https://bg.javidtrading.com/bitget-signup-api-guide", W + "/api-guide/bitget"],
  ["binance", "https://bn.javidtrading.com/binance-signup-api-guide.html", W + "/api-guide/binance"],
  ["binance", "https://bn.javidtrading.com/", W + "/?exchange=binance"],
  ["binance", "https://bn.javidtrading.com/ja", W + "/ja?exchange=binance"],
  ["bybit", "https://bb.javidtrading.com/vi", W + "/vi?exchange=bybit"],
  ["bybit", "https://bb.javidtrading.com/results.html", W + "/exchange?exchange=bybit"],
  ["okx", "https://okx.javidtrading.com/okx-signup-api-guide", W + "/api-guide/okx"],
  ["okx", "https://okx.javidtrading.com/some-old-page", W + "/?exchange=okx"],
  ["okx", "https://okx.javidtrading.com/llms.txt", W + "/llms.txt"],
  // served as before (null)
  ["bitget", "https://bg.javidtrading.com/api/download?platform=windows", null],
  ["bitget", "https://bg.javidtrading.com/api/status", null],
  ["bitget", "https://bg.javidtrading.com/api/board/posts", null],
  ["bitget", "https://bg.javidtrading.com/api/download-stats?key=x", null],
  ["bitget", "https://bg.javidtrading.com/download-stats", null],
  ["bitget", "https://bg.javidtrading.com/images/hero-bg.webp", null],
  ["bitget", "https://bg.javidtrading.com/screenshots/shot1.png", null],
  ["bitget", "https://bg.javidtrading.com/results/daily-returns.png", null],
  ["bitget", "https://bg.javidtrading.com/downloads/JaviD_Future_Bot_Bitget_Windows.zip", null],
  ["bitget", "https://bg.javidtrading.com/robots.txt", null],
  ["bitget", "https://bg.javidtrading.com/sitemap.xml", null],
  ["bitget", "https://bg.javidtrading.com/6281d0d1caf1a9f2f851f96fd26c4b2e.txt", null],
  ["bitget", "https://bg.javidtrading.com/data/account-series.json", null],
];
let fail = 0;
for (const [ex, from, want] of cases) {
  const got = legacyTarget(ex, from);
  if (got !== want) { fail++; console.log(`FAIL ${from}\n  want ${want}\n  got  ${got}`); }
}
console.log(`${cases.length - fail}/${cases.length} redirect cases pass`);
process.exit(fail ? 1 : 0);
