// Merge already-generated allowlisted PNGs onto a full live asset manifest.
// Does not rebuild the site, does not upload, and does not read the private
// capture bucket. The base manifest must be the one deployed at 100%. A
// manifest of only the new cards is rejected because it would replace the site.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetHash } from "./make_asset_manifest.mjs";
import { assertCardFilename, assertPng, CARD_FILENAME } from "../src/blog-media-policy.mjs";

function inside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function collectCards(cardDir) {
  const root = fs.realpathSync(cardDir);
  const found = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      const lst = fs.lstatSync(full);
      if (lst.isSymbolicLink()) {
        if (CARD_FILENAME.test(ent.name)) throw new Error(`refusing symlink card: ${ent.name}`);
        continue;
      }
      if (lst.isDirectory()) {
        walk(full);
        continue;
      }
      if (!lst.isFile() || !CARD_FILENAME.test(ent.name)) continue;
      const real = fs.realpathSync(full);
      if (!inside(root, real)) throw new Error(`card path escapes the source directory: ${ent.name}`);
      found.push(full);
    }
  };
  walk(cardDir);
  return found;
}

export function mergeBlogMedia({ baseManifest, cardDir }) {
  if (!baseManifest || typeof baseManifest !== "object" || Array.isArray(baseManifest)) {
    throw new Error("base manifest must be the full live site manifest");
  }
  if (!baseManifest["/index.html"]) {
    throw new Error("base manifest is not a full site (missing /index.html); refusing to replace the site");
  }
  const merged = {};
  for (const [key, value] of Object.entries(baseManifest)) {
    if (!value || typeof value.hash !== "string" || typeof value.size !== "number") {
      throw new Error(`bad manifest entry ${key}`);
    }
    merged[key] = { hash: value.hash, size: value.size };
  }
  const groups = new Map();
  for (const file of collectCards(cardDir)) {
    const name = assertCardFilename(path.basename(file));
    const buf = assertPng(fs.readFileSync(file));
    const prev = groups.get(name);
    if (prev && !prev.buf.equals(buf)) throw new Error(`conflicting bytes for ${name}`);
    groups.set(name, { file, buf });
  }
  if (groups.size === 0) throw new Error("no allowlisted cards found");
  const uploads = [];
  for (const name of [...groups.keys()].sort()) {
    const { file, buf } = groups.get(name);
    const key = "/blog-media/" + name;
    const hash = assetHash(file);
    const size = buf.length;
    const prev = merged[key];
    merged[key] = { hash, size };
    if (!prev || prev.hash !== hash || prev.size !== size) {
      uploads.push({ path: key, hash, size, contentType: "image/png", source: path.resolve(file) });
    }
  }
  for (const key of Object.keys(baseManifest)) {
    if (!Object.prototype.hasOwnProperty.call(merged, key)) throw new Error(`refusing to drop ${key}`);
    if (!key.startsWith("/blog-media/") && (merged[key].hash !== baseManifest[key].hash || merged[key].size !== baseManifest[key].size)) {
      throw new Error(`refusing to replace non-card ${key}`);
    }
  }
  return { manifest: merged, uploads };
}

function usage() {
  console.error("usage: node tools/merge_blog_media_upload.mjs --base <live-manifest.json> --cards <outbox> --out <dir>");
  process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : "";
  };
  const basePath = value("--base");
  const cardDir = value("--cards");
  const outDir = value("--out");
  if (!basePath || !cardDir || !outDir) usage();
  const raw = JSON.parse(fs.readFileSync(basePath, "utf8"));
  const baseManifest = raw.manifest && typeof raw.manifest === "object" ? raw.manifest : raw;
  const { manifest, uploads } = mergeBlogMedia({ baseManifest, cardDir });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "merged-manifest.json"), JSON.stringify({ manifest }, null, 2) + "\n");
  const plan = uploads.map(({ source, ...rest }) => rest);
  fs.writeFileSync(path.join(outDir, "card-upload-plan.json"), JSON.stringify({
    note: "Upload only these changed cards. Every other manifest key is unchanged and its bytes are already stored. Do not rebuild public/ and do not submit a manifest that omits /index.html.",
    uploads: plan,
  }, null, 2) + "\n");
  const bytesDir = path.join(outDir, "bytes");
  fs.mkdirSync(bytesDir, { recursive: true });
  for (const row of uploads) fs.copyFileSync(row.source, path.join(bytesDir, path.posix.basename(row.path)));
  console.log(`merged ${Object.keys(manifest).length} assets; upload ${uploads.length} card(s)`);
  for (const row of uploads) console.log(`${row.hash} ${row.size} ${row.path}`);
}
