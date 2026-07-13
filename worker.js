// Cloudflare Workers entry point for javid-dol-landing.
//
// This project deploys as a Worker with static assets (the current unified
// Cloudflare product), NOT classic "Pages". That means files under
// /functions are not auto-routed the way Pages Functions used to be —
// this file manually wires those same handlers in so nothing else has to
// change inside /functions.
//
// Routing: requests to /api/* are handled below by importing the existing
// Pages-Functions-style handlers directly. Everything else (index.html,
// board.html, images, etc.) falls through to the static assets binding.

import { onRequestPost as downloadPost, onRequestGet as downloadGet } from "./functions/api/download.js";
import { onRequestGet as boardListGet, onRequestPost as boardListPost } from "./functions/api/board/posts.js";
import {
  onRequestGet as boardItemGet,
  onRequestDelete as boardItemDelete,
  onRequestPatch as boardItemPatch,
} from "./functions/api/board/posts/[id].js";

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
    } catch (err) {
      return new Response(JSON.stringify({ error: "server_error", detail: String(err) }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // No API route matched — serve the static file.
    return env.ASSETS.fetch(request);
  },
};
