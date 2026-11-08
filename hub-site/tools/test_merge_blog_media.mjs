// node tools/test_merge_blog_media.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { mergeBlogMedia } from "./merge_blog_media_upload.mjs";

const errors = [];
const err = (m) => errors.push(m);
const EN = "acct_20261107_en_1_calendar.png";
const JA = "acct_20261107_ja_1_calendar.png";

function png() {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  return buf;
}
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "merge-cards-")); }

const base = {
  "/index.html": { hash: "indexhashindexhashindexhashindex", size: 10 },
  "/assets/css/site.css": { hash: "csshashcsshashcsshashcsshashcssha", size: 20 },
  ["/blog-media/" + EN]: { hash: "oldhasholdhasholdhasholdhasholdh", size: 1 },
};
const cards = tmp();
fs.writeFileSync(path.join(cards, EN), Buffer.concat([png(), Buffer.from([1])]));
fs.writeFileSync(path.join(cards, JA), png());
fs.writeFileSync(path.join(cards, "snapshot.json"), "{}");
fs.writeFileSync(path.join(cards, "acct_20261107_ko_1_calendar.png"), png());

const first = mergeBlogMedia({ baseManifest: base, cardDir: cards });
if (first.manifest["/index.html"].hash !== base["/index.html"].hash) err("index.html changed");
if (first.manifest["/assets/css/site.css"].hash !== base["/assets/css/site.css"].hash) err("css changed");
if (!first.manifest["/blog-media/" + JA]) err("ja card missing");
if (first.uploads.length !== 2) err(`upload count ${first.uploads.length}`);
if (Object.keys(first.manifest).some((k) => k.endsWith(".json") || k.includes("_ko_"))) err("non-card entered manifest");
const second = mergeBlogMedia({ baseManifest: first.manifest, cardDir: cards });
if (second.uploads.length !== 0) err("unchanged cards were queued again");
if (JSON.stringify(second.manifest["/index.html"]) !== JSON.stringify(base["/index.html"])) err("second merge touched index");
let threw = false;
try { mergeBlogMedia({ baseManifest: { ["/blog-media/" + EN]: base["/blog-media/" + EN] }, cardDir: cards }); }
catch (e) { threw = /index\.html/.test(e.message); }
if (!threw) err("card-only manifest was accepted");

if (errors.length) {
  console.log(errors.join("\n"));
  console.log(`FAIL: ${errors.length}`);
  process.exit(1);
}
console.log("PASS");
