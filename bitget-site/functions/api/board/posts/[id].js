// GET    /api/board/posts/:id            -> view one post (?password= for secret posts)
// DELETE /api/board/posts/:id             -> admin-only forced delete
// PATCH  /api/board/posts/:id { reply }   -> admin-only reply
//
// Admin requests must send header:  x-admin-key: <BOARD_ADMIN_KEY>

import { json, sha256Hex, isAdmin } from "../_shared.js";

export async function onRequestGet({ params, request, env }) {
  if (!env.BOARD_DB) return json({ error: "not_configured" }, 500);

  const id = Number(params.id);
  const post = await env.BOARD_DB.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first();
  if (!post) return json({ error: "not_found" }, 404);

  const admin = isAdmin(request, env);

  if (!post.is_secret || admin) {
    return json(toPublic(post));
  }

  const url = new URL(request.url);
  const password = url.searchParams.get("password") || "";
  if (!password) return json({ error: "password_required" }, 401);

  const hash = await sha256Hex((post.salt || "") + password);
  if (hash !== post.password_hash) return json({ error: "wrong_password" }, 403);

  return json(toPublic(post));
}

export async function onRequestDelete({ params, request, env }) {
  if (!env.BOARD_DB) return json({ error: "not_configured" }, 500);
  if (!isAdmin(request, env)) return json({ error: "forbidden" }, 403);

  const id = Number(params.id);
  await env.BOARD_DB.prepare("DELETE FROM posts WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

export async function onRequestPatch({ params, request, env }) {
  if (!env.BOARD_DB) return json({ error: "not_configured" }, 500);
  if (!isAdmin(request, env)) return json({ error: "forbidden" }, 403);

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "invalid_request" }, 400);
  }

  const reply = String(body.reply || "").trim().slice(0, 2000);
  if (!reply) return json({ error: "missing_reply" }, 400);

  const id = Number(params.id);
  const repliedAt = new Date().toISOString();
  await env.BOARD_DB.prepare("UPDATE posts SET reply = ?, replied_at = ? WHERE id = ?")
    .bind(reply, repliedAt, id)
    .run();

  return json({ ok: true });
}

function toPublic(post) {
  return {
    id: post.id,
    name: post.name,
    content: post.content,
    is_secret: !!post.is_secret,
    created_at: post.created_at,
    reply: post.reply || null,
    replied_at: post.replied_at || null,
  };
}
