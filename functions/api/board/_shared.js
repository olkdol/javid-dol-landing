// Shared helpers for the board API. Files starting with "_" are not routed
// by Cloudflare Pages Functions, so this is safe to import from elsewhere.

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function isAdmin(request, env) {
  const key = request.headers.get("x-admin-key");
  return !!(key && env.BOARD_ADMIN_KEY && key === env.BOARD_ADMIN_KEY);
}
