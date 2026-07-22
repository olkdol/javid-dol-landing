// Cloudflare Workers entry point for javidfuturebot2 (Bitget edition).
// Same pattern as the main javid-dol-landing worker: /api/* is handled here
// by importing the Pages-Functions-style handlers directly; everything else
// falls through to the static assets binding.

import { onRequestPost as downloadPost, onRequestGet as downloadGet } from "./functions/api/download.js";
import { onRequestGet as boardListGet, onRequestPost as boardListPost } from "./functions/api/board/posts.js";
import {
  onRequestGet as boardItemGet,
  onRequestDelete as boardItemDelete,
  onRequestPatch as boardItemPatch,
} from "./functions/api/board/posts/[id].js";
import { onRequestGet as statusGet, onRequestPost as statusPost } from "./functions/api/status.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const base = { request, env, ctx, params: {} };

    try {
      if (pathname === "/api/download") {
        return request.method === "POST" ? await downloadPost(base) : await downloadGet(base);
      }

      if (pathname === "/api/board/posts") {
        if (request.method === "GET") return await boardListGet(base);
        if (request.method === "POST") return await boardListPost(base);
      }

      const postMatch = pathname.match(/^\/api\/board\/posts\/(\d+)$/);
      if (postMatch) {
        base.params = { id: postMatch[1] };
        if (request.method === "GET") return await boardItemGet(base);
        if (request.method === "DELETE") return await boardItemDelete(base);
        if (request.method === "PATCH") return await boardItemPatch(base);
      }

      if (pathname === "/api/status") {
        if (request.method === "GET") return await statusGet(base);
        if (request.method === "POST") return await statusPost(base);
      }
    } catch (err) {
      return new Response(JSON.stringify({ error: "server_error", detail: String(err) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
