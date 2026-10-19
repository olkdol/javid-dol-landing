// Copies shared/legacy_redirect.js into every exchange site folder and checks that each
// worker.js calls it right before falling through to static assets, and that each
// wrangler.jsonc has run_worker_first (otherwise assets answer first and the 301 never runs).
//   node tools/sync_redirect.mjs          (sync + check)
//   node tools/sync_redirect.mjs --check  (check only, non-zero exit on drift)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "shared/legacy_redirect.js");
const SITES = { "bitget-site": "bitget", "binance-site": "binance", "bybit-site": "bybit", "okx-site": "okx" };
const checkOnly = process.argv.includes("--check");
const canonical = fs.readFileSync(SRC, "utf8");
let bad = 0;
const legacyDst = path.join(ROOT, "_to_delete_legacy_javid-dol-uk", "legacy_redirect.js");
if (!checkOnly) fs.writeFileSync(legacyDst, canonical);
if (fs.readFileSync(legacyDst, "utf8") !== canonical) { console.error("legacy: legacy_redirect.js differs"); bad++; }
for (const [dir, ex] of Object.entries(SITES)) {
  const dst = path.join(ROOT, dir, "legacy_redirect.js");
  if (!checkOnly) fs.writeFileSync(dst, canonical);
  if (fs.readFileSync(dst, "utf8") !== canonical) { console.error(`${dir}: legacy_redirect.js differs from shared/`); bad++; }
  const w = fs.readFileSync(path.join(ROOT, dir, "worker.js"), "utf8");
  if (!w.includes('import { legacyRedirect } from "./legacy_redirect.js"')) { console.error(`${dir}: worker.js does not import legacyRedirect`); bad++; }
  if (!w.includes(`legacyRedirect("${ex}", request)`)) { console.error(`${dir}: worker.js does not call legacyRedirect("${ex}")`); bad++; }
  const cfg = fs.readFileSync(path.join(ROOT, dir, "wrangler.jsonc"), "utf8");
  if (!/"run_worker_first"\s*:\s*true/.test(cfg)) { console.error(`${dir}: wrangler.jsonc lacks run_worker_first: true`); bad++; }
}
console.log(bad ? `FAIL (${bad})` : "ok: redirect module in sync, workers wired, run_worker_first set");
process.exit(bad ? 1 : 0);
