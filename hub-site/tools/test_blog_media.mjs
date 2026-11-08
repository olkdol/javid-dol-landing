// node tools/test_blog_media.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blogMediaResponse, CARD_FILENAME_SOURCE as GUARD_RE, validCardDate as guardDate } from "../src/blog-media-guard.js";
import {
  CARD_FILENAME_SOURCE,
  assertCardFilename,
  copyApprovedBlogMedia,
  listApprovedCards,
  stageBlogMedia,
  validCardDate,
} from "../src/blog-media-policy.mjs";
import { assetHash, buildManifest } from "./make_asset_manifest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];
const err = (m) => errors.push(m);
const EN = "acct_20261107_en_1_calendar.png";
const REPORT = "acct_20261107_en_2_report.png";

function minimalPng() {
  // Signature + IHDR (length 13) + 13 bytes + CRC placeholder. assertPng checks magic and IHDR only.
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  return buf;
}

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "blog-media-"));
}

if (CARD_FILENAME_SOURCE !== GUARD_RE) err("worker guard regex drifted from the admission policy");
if (guardDate("20261107") !== true || validCardDate("20260231") !== false || guardDate("20230229") !== false) err("date check");
if (validCardDate("20240229") !== true) err("leap day");

const py = fs.readFileSync(path.join(ROOT, "..", "runtime-patches", "blog-media", "app", "publishers", "blog_media.py"), "utf8");
if (!py.includes(CARD_FILENAME_SOURCE.replaceAll("\\\\", "\\"))) err("python allowlist drifted");

try { assertCardFilename("../" + EN); err("filename traversal accepted"); } catch { /* expected */ }
try { assertCardFilename("acct_20261107_ko_1_calendar.png"); err("korean card accepted"); } catch { /* expected */ }

const src = tmp();
const dest = tmp();
const day = path.join(src, "cardnews", "account", "2026-11-07");
fs.mkdirSync(day, { recursive: true });
fs.writeFileSync(path.join(day, EN), minimalPng());
fs.writeFileSync(path.join(day, REPORT), minimalPng());
fs.writeFileSync(path.join(day, "post.md"), "not a card");
fs.writeFileSync(path.join(day, "snapshot.json"), "{}");
fs.writeFileSync(path.join(day, "run.log"), "secret");
fs.symlinkSync(path.join(day, EN), path.join(day, "acct_20261107_ja_1_calendar.png"));
let threw = false;
try { stageBlogMedia({ input: day, destDir: dest }); } catch (e) { threw = /symlink/.test(e.message); }
if (!threw) err("symlink card was accepted");
fs.unlinkSync(path.join(day, "acct_20261107_ja_1_calendar.png"));

const first = stageBlogMedia({ input: day, destDir: dest });
if (first.map((r) => r.action + " " + r.name).join(",") !== `added ${EN},added ${REPORT}`) err(`first stage ${JSON.stringify(first)}`);
const second = stageBlogMedia({ input: day, destDir: dest });
if (second.some((r) => r.action !== "unchanged")) err(`not idempotent ${JSON.stringify(second)}`);
const changed = Buffer.concat([minimalPng(), Buffer.from([1])]);
fs.writeFileSync(path.join(day, EN), changed);
threw = false;
try { stageBlogMedia({ input: day, destDir: dest }); } catch (e) { threw = /--replace/.test(e.message); }
if (!threw) err("byte change without --replace was accepted");
if (!fs.readFileSync(path.join(dest, EN)).equals(minimalPng())) err("failed replace wrote anyway");
stageBlogMedia({ input: day, destDir: dest, replace: true });
if (!fs.readFileSync(path.join(dest, EN)).equals(changed)) err("replace did not update");

const outside = tmp();
fs.mkdirSync(path.join(outside, "sub"));
const linkFarm = tmp();
fs.symlinkSync(outside, path.join(linkFarm, "escape"));
fs.writeFileSync(path.join(outside, "sub", EN), minimalPng());
// The symlink directory is skipped only when the link itself is not a card name.
// A card file reached through a symlink directory must not be copied.
const viaLink = stageSafe(linkFarm);
if (viaLink !== "empty-or-throw") err(`traversal copy ${viaLink}`);

function stageSafe(input) {
  try {
    const rows = stageBlogMedia({ input, destDir: tmp() });
    return rows.map((r) => r.name).join(",");
  } catch (e) {
    return /no allowlisted|escapes|symlink/.test(e.message) ? "empty-or-throw" : e.message;
  }
}

const badName = path.join(tmp(), "notes.json");
fs.writeFileSync(badName, "{}");
try {
  stageBlogMedia({ input: badName, destDir: tmp() });
  err("explicit json file was accepted");
} catch { /* expected */ }

const built = tmp();
copyApprovedBlogMedia(dest, path.join(built, "blog-media"));
const names = listApprovedCards(path.join(built, "blog-media"));
if (names.join(",") !== [EN, REPORT].sort().join(",")) err(`copied ${names}`);

const tree = path.join(dest, "nested");
fs.mkdirSync(tree);
try { listApprovedCards(dest); err("directory entry accepted"); } catch { /* expected */ }

const env = {
  ASSETS: { fetch: async (request) => new Response("png", { status: 200, headers: { "Content-Type": "image/png", "X-From": "assets" } }) },
  LIVE_CAPTURES: new Proxy({}, { get() { throw new Error("LIVE_CAPTURES touched"); } }),
};
const ok = await blogMediaResponse(new Request("https://www.javidtrading.com/blog-media/" + EN), env, "/blog-media/" + EN);
if (ok.status !== 200 || ok.headers.get("X-From") !== "assets") err("allowlisted card was not passed to assets");
const post = await blogMediaResponse(new Request("https://www.javidtrading.com/blog-media/" + EN, { method: "POST" }), env, "/blog-media/" + EN);
if (post.status !== 405) err(`upload status ${post.status}`);
for (const bad of ["/blog-media/../robots.txt", "/blog-media/%2e%2e/robots.txt", "/blog-media/acct_20261107_ko_1_calendar.png", "/blog-media/acct_20260231_en_1_calendar.png", "/blog-media/" + EN + "/extra", "/blog-media/"]) {
  const pathname = new URL("https://www.javidtrading.com" + bad).pathname;
  const res = await blogMediaResponse(new Request("https://www.javidtrading.com" + bad), env, pathname);
  if (res.status !== 404) err(`${bad} -> ${pathname} status ${res.status}`);
}
const encoded = "/blog-media/%61cct_20261107_en_1_calendar.png";
const encPath = new URL("https://www.javidtrading.com" + encoded).pathname;
const encRes = await blogMediaResponse(new Request("https://www.javidtrading.com" + encoded), env, encPath);
if (encRes.status !== 404) err(`encoded name was accepted (${encPath})`);

const committed = listApprovedCards(path.join(ROOT, "src", "blog-media"));
if (committed.join(",") !== [EN, REPORT].join(",")) err(`committed cards ${committed}`);
for (const name of committed) {
  const a = fs.readFileSync(path.join(ROOT, "src", "blog-media", name));
  const b = fs.readFileSync(path.join(ROOT, "public", "blog-media", name));
  if (!a.equals(b)) err(`public copy drifted ${name}`);
}
const saved = JSON.parse(fs.readFileSync(path.join(ROOT, "deploy", "workers-assets-manifest.json"), "utf8")).manifest;
const rebuilt = buildManifest().manifest;
if (JSON.stringify(saved) !== JSON.stringify(rebuilt)) err("asset manifest does not match public/");
if (saved["/_headers"] || saved["/blog-media/snapshot.json"]) err("manifest contains a non-asset or non-card");
const calendar = saved["/blog-media/" + EN];
if (!calendar || calendar.hash !== assetHash(path.join(ROOT, "public", "blog-media", EN)) || calendar.size !== 282319) err("calendar manifest entry");
if (Object.keys(saved).filter((k) => k.startsWith("/blog-media/")).length !== 2) err("manifest card count");

if (errors.length) {
  console.log(errors.join("\n"));
  console.log(`FAIL: ${errors.length}`);
  process.exit(1);
}
console.log("PASS");
