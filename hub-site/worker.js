// Cloudflare Workers entry point for the javidtrading.com welcome hub.
//
// This is a pure static site (no API routes, no DB/KV/R2) — every request
// just falls through to the static assets binding.

export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
