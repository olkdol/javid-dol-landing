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

    // ── 구도메인 → 신규 도메인 301 (2026-08-19) ───────────────────────────
    // 이 워커가 서빙하는 javid-dol.uk / javidfuturebot.javid-dol.uk 는 **구 바이낸스 랜딩**이다.
    // 실측(2026-08-19): HTTP 200 으로 본문 전체를 그대로 서빙하면서
    //   · canonical 이 자기 자신(javid-dol.uk)을 가리키고
    //   · 본문에 javidtrading.com 링크가 **0개**
    //   · /api/download 는 이미 404 (기능은 죽어 있다)
    // 즉 **신규 bn.javidtrading.com 과 같은 키워드로 경쟁만 하고 랭크는 전달되지 않는** 상태였다.
    // (비트겟 구도메인 javidfuturebot2 는 별도 워커가 서빙하며 canonical→bg 로 이미 정상이다.)
    // 팀 방침(CLAUDE.md): 구도메인은 **301로만** 살려둔다.
    //
    // 이미지·스크린샷은 예전 블로그 글에서 핫링크될 수 있어 그대로 서빙한다.
    //
    // ⚠️ 2026-08-31: 이 워커에는 **세 개의 호스트**가 붙어 있다(실측 — 셋 다 같은 바이트를
    //    서빙했다). 전부 bn 으로 보내면 안 된다. 호스트별로 맞는 곳으로 나눈다:
    //      · javidfuturebot.javid-dol.uk → bn  (실제로 구 바이낸스 랜딩이므로 주제가 맞는다)
    //      · javid-dol.uk               → www (거래소 중립 허브)
    //      · bb.javidtrading.com        → bg  (바이비트 제품이 아직 없다. 잘못 붙어 있던
    //                                          것이라 주력인 비트겟으로 보낸다.)
    //    기본값은 bg — 주력 거래소이고, 모르는 호스트를 레거시 바이낸스로 보낼 이유가 없다.
    if (!pathname.startsWith("/images/") && !pathname.startsWith("/screenshots/")) {
      const host = url.hostname.toLowerCase();
      let target = "https://bg.javidtrading.com";
      if (host === "javidfuturebot.javid-dol.uk") target = "https://bn.javidtrading.com";
      else if (host === "javid-dol.uk" || host === "www.javid-dol.uk") target = "https://www.javidtrading.com";
      // 경로는 버린다 — 구 사이트의 파일명 구조가 신규 사이트와 다르다.
      // (경로를 이어붙이면 대부분 404 가 되어 301 의 랭크 전달이 오히려 끊긴다.)
      return Response.redirect(target + "/", 301);
    }

    // No API route matched — serve the static file.
    return env.ASSETS.fetch(request);
  },
};
