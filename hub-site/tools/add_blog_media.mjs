// Copy allowlisted public PNG cards into src/blog-media.
//   node tools/add_blog_media.mjs <file-or-directory> [--replace]
//   node tools/add_blog_media.mjs --check
// A directory may contain the day's other publisher files (markdown, json,
// captions). Only acct_YYYYMMDD_<lang>_<1_calendar|2_report>.png is copied.
// Identical bytes are a no-op. Different bytes require --replace.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listApprovedCards, stageBlogMedia } from "../src/blog-media-policy.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEST = path.join(ROOT, "src", "blog-media");
const args = process.argv.slice(2);
const replace = args.includes("--replace");
const check = args.includes("--check");
const input = args.find((a) => !a.startsWith("--"));

try {
  if (check) {
    const names = listApprovedCards(DEST);
    console.log(names.length ? names.join("\n") : "(no cards)");
    console.log(`ok: ${names.length} card(s)`);
    process.exit(0);
  }
  if (!input) {
    console.error("usage: node tools/add_blog_media.mjs <file-or-directory> [--replace]");
    process.exit(1);
  }
  const actions = stageBlogMedia({ input, destDir: DEST, replace });
  for (const row of actions) console.log(`${row.action} ${row.name}`);
  console.log("ok");
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
