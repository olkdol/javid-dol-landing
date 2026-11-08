// Build the Workers static-asset manifest for hub-site/public.
// Hash algorithm is wrangler 4.158.0 deploy-helpers hashFile:
//   blake3(base64(file bytes) + extension without the dot).hex().slice(0, 32)
// _headers and _redirects are not manifest entries. Their text belongs in
// metadata.assets.config. This script does not upload anything.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import mime from "mime";

const require = createRequire(import.meta.url);
const { hash } = require("blake3-wasm");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const OUT = path.join(ROOT, "deploy");
const SKIP = new Set(["_headers", "_redirects", ".assetsignore"]);

export function assetHash(filepath) {
  const contents = fs.readFileSync(filepath);
  const extension = path.extname(filepath).substring(1);
  return hash(contents.toString("base64") + extension).toString("hex").slice(0, 32);
}

export function contentTypeFor(filepath) {
  let contentType = mime.getType(filepath);
  if (contentType && contentType.startsWith("text/") && !contentType.includes("charset")) {
    contentType = `${contentType}; charset=utf-8`;
  }
  return contentType || "application/null";
}

function walk(dir, prefix = "") {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full, rel));
    else if (ent.isFile() && !SKIP.has(ent.name)) out.push({ rel, full });
  }
  return out;
}

export function buildManifest(publicDir = PUBLIC) {
  const files = walk(publicDir).sort((a, b) => a.rel.localeCompare(b.rel));
  const manifest = {};
  const plan = [];
  for (const file of files) {
    const bytes = fs.statSync(file.full).size;
    const entry = { hash: assetHash(file.full), size: bytes };
    manifest["/" + file.rel] = entry;
    plan.push({ path: "/" + file.rel, ...entry, contentType: contentTypeFor(file.full) });
  }
  return { manifest, plan };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { manifest, plan } = buildManifest();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "workers-assets-manifest.json"), JSON.stringify({ manifest }, null, 2) + "\n");
  fs.writeFileSync(path.join(OUT, "workers-assets-upload-plan.json"), JSON.stringify({
    scriptName: "javid-hub-landing",
    note: "Strip contentType before the assets-upload-session call. The session body is { manifest }. Use contentType as the upload part type.",
    files: plan,
  }, null, 2) + "\n");
  const cards = plan.filter((row) => row.path.startsWith("/blog-media/"));
  console.log(`manifest ${plan.length} files; blog-media ${cards.length}`);
  for (const card of cards) console.log(`${card.hash} ${card.size} ${card.contentType} ${card.path}`);
}
