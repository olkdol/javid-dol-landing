// Local-only Korean preview. The public site has no Korean pages (2026-10-31); this builds the
// full site incl. /ko into ./preview-ko (not deployed, gitignored) and serves it on localhost.
//   node tools/preview_ko.mjs [port]      (or double-click preview_ko.bat)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawnSync, exec } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "preview-ko");
const PORT = Number(process.argv[2]) || 8790;
const r = spawnSync(process.execPath, [path.join(ROOT, "src/build.mjs"), "--preview-ko"], { stdio: "inherit" });
if (r.status !== 0) process.exit(r.status || 1);

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml", ".ico": "image/x-icon" };
function resolve(p) {
  p = decodeURIComponent(p.split("?")[0]).replace(/\/+$/, "") || "/";
  for (const c of [p, p + ".html", p + "/index.html", p === "/" ? "/index.html" : null]) {
    if (!c) continue;
    const f = path.join(DIR, c);
    if (f.startsWith(DIR) && fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
}
http.createServer((req, res) => {
  const f = resolve(req.url);
  if (!f) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("not found (preview only serves static pages; /api/* is not available)"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}/ko`;
  console.log(`Korean preview: ${url}   (Ctrl+C to stop)`);
  if (!process.env.NO_OPEN) exec(`start "" "${url}"`);
});
