// Admission rules for public Blogger cards. Node only — the Worker imports
// blog-media-guard.js so this file's filesystem code is not bundled there.
import fs from "node:fs";
import path from "node:path";

export const CARD_FILENAME_SOURCE =
  "^acct_\\d{8}_(en|ja|es|fr|vi|tr|pt)_(1_calendar|2_report)\\.png$";
export const CARD_FILENAME = new RegExp(CARD_FILENAME_SOURCE);
export const MAX_CARD_BYTES = 8 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function validCardDate(yyyymmdd) {
  if (!/^\d{8}$/.test(yyyymmdd)) return false;
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function assertCardFilename(name) {
  if (typeof name !== "string" || name !== path.basename(name) || !CARD_FILENAME.test(name)) {
    throw new Error(`not an allowlisted card: ${name}`);
  }
  if (!validCardDate(name.slice(5, 13))) throw new Error(`invalid card date: ${name}`);
  return name;
}

export function assertPng(buf) {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (bytes.length < 24 || bytes.length > MAX_CARD_BYTES) throw new Error("png size rejected");
  if (!bytes.subarray(0, 8).equals(PNG_MAGIC)) throw new Error("png magic rejected");
  if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") throw new Error("png ihdr rejected");
  return bytes;
}

function inside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function listApprovedCards(dir) {
  if (!fs.existsSync(dir)) return [];
  const names = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    const st = fs.lstatSync(full);
    if (st.isSymbolicLink() || !st.isFile()) throw new Error(`blog-media entry is not a regular file: ${ent.name}`);
    assertCardFilename(ent.name);
    assertPng(fs.readFileSync(full));
    names.push(ent.name);
  }
  return names.sort();
}

export function copyApprovedBlogMedia(srcDir, destDir) {
  const names = fs.existsSync(srcDir) ? listApprovedCards(srcDir) : [];
  fs.rmSync(destDir, { recursive: true, force: true });
  if (!names.length) return [];
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of names) fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
  return names;
}

function collect(input) {
  const st = fs.lstatSync(input);
  if (st.isSymbolicLink()) throw new Error("refusing symlink");
  if (st.isFile()) {
    assertCardFilename(path.basename(input));
    return [input];
  }
  if (!st.isDirectory()) throw new Error("not a file or directory");
  const root = fs.realpathSync(input);
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
  walk(input);
  return found;
}

export function stageBlogMedia({ input, destDir, replace = false }) {
  if (typeof input !== "string" || input.includes("\0")) throw new Error("invalid input path");
  const files = collect(path.resolve(input));
  const groups = new Map();
  for (const file of files) {
    const name = assertCardFilename(path.basename(file));
    const buf = assertPng(fs.readFileSync(file));
    const prev = groups.get(name);
    if (prev && !prev.equals(buf)) throw new Error(`conflicting bytes for ${name}`);
    groups.set(name, buf);
  }
  if (groups.size === 0) throw new Error("no allowlisted cards found");
  fs.mkdirSync(destDir, { recursive: true });
  const destRoot = fs.realpathSync(destDir);
  const plan = [];
  for (const name of [...groups.keys()].sort()) {
    const target = path.join(destRoot, name);
    if (!inside(destRoot, target) || path.basename(target) !== name) throw new Error("destination escapes blog-media");
    const buf = groups.get(name);
    if (fs.existsSync(target)) {
      const cur = fs.readFileSync(target);
      if (cur.equals(buf)) plan.push({ name, action: "unchanged", target, buf });
      else if (!replace) throw new Error(`${name} already exists with different bytes; pass --replace`);
      else plan.push({ name, action: "replaced", target, buf });
    } else {
      plan.push({ name, action: "added", target, buf });
    }
  }
  for (const step of plan) {
    if (step.action !== "unchanged") fs.writeFileSync(step.target, step.buf);
  }
  return plan.map(({ name, action }) => ({ name, action }));
}
