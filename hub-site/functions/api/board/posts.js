// GET  /api/board/posts  -> list posts (secret posts are masked unless admin)
// POST /api/board/posts  -> create a post, optionally secret (password-protected)
//
// Requires a D1 binding named BOARD_DB (see schema.sql) and, for admin
// features, an encrypted environment variable BOARD_ADMIN_KEY.

import { json, sha256Hex, isAdmin } from "./_shared.js";

export async function onRequestGet({ request, env }) {
  if (!env.BOARD_DB) return json({ error: "not_configured" }, 500);

  const admin = isAdmin(request, env);
  const { results } = await env.BOARD_DB.prepare(
    "SELECT id, name, is_secret, content, reply, replied_at, created_at FROM posts ORDER BY id DESC LIMIT 200"
  ).all();

  const posts = results.map((p) => ({
    id: p.id,
    name: p.name,
    created_at: p.created_at,
    is_secret: !!p.is_secret,
    content: !p.is_secret || admin ? p.content : null,
    reply: p.reply || null,
    replied_at: p.replied_at || null,
  }));

  return json({ posts });
}

export async function onRequestPost({ request, env }) {
  if (!env.BOARD_DB) return json({ error: "not_configured" }, 500);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "invalid_request" }, 400);
  }

  const name = String(body.name || "").trim().slice(0, 40);
  const content = String(body.content || "").trim().slice(0, 4000);
  const secret = !!body.secret;
  const password = String(body.password || "").slice(0, 100);

  if (!name || !content) return json({ error: "missing_fields" }, 400);
  if (secret && !password) return json({ error: "missing_password" }, 400);

  let salt = null;
  let passwordHash = null;
  if (secret) {
    salt = crypto.randomUUID().replace(/-/g, "");
    passwordHash = await sha256Hex(salt + password);
  }

  const createdAt = new Date().toISOString();
  const result = await env.BOARD_DB.prepare(
    "INSERT INTO posts (name, content, is_secret, salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(name, content, secret ? 1 : 0, salt, passwordHash, createdAt)
    .run();

  return json({ ok: true, id: result.meta.last_row_id });
}
