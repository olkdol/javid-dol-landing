# implementation_audit.md — javidtrading.com 개편 전 현황 분석

작성: 2026-10-19 · 브랜치 `renewal-2026-10` · 근거는 전부 이 날 실측(저장소 파일 · `wrangler` · Cloudflare API 조회 · 공개 HTTP 응답).
`/api/download` 는 어떤 메서드로도 호출하지 않았다(다운로드 집계 보호). 파일 크기는 R2 관리 API 로 확인했다.

---

## 1. 저장소 구조

`Landing_Page/` (git, remote `olkdol/javid-dol-landing`, 기본 브랜치 `main`)

| 디렉터리 | 도메인 | 워커(실제 연결, Cloudflare API `GET /workers/domains`) | 바인딩(활성 버전) |
|---|---|---|---|
| `hub-site/` | www.javidtrading.com, javidtrading.com | `javid-hub-landing` | ASSETS 만 (정적 허브) |
| `bitget-site/` | bg.javidtrading.com | `javid-dol-landing2` (저장소 `wrangler.jsonc` 의 `javidfuturebot2-landing` 은 다른 워커) | D1 `javid-board-db-bitget`, KV, R2 `javid-downloads-bitget`, secrets `BOARD_ADMIN_KEY` `STATS_KEY` `STATUS_PUSH_KEY` |
| `binance-site/` | bn.javidtrading.com | `javid-bn-landing` | D1 `javid-board-db`, KV, R2 `javid-downloads`, secret `STATS_KEY` |
| `bybit-site/` | bb.javidtrading.com | `javid-bybit-landing` | **⚠️ 없음 — 아래 4절** |
| `okx-site/` | okx.javidtrading.com | `javid-okx-landing` | D1 `javid-board-db-okx`, KV, R2 `javid-downloads-okx`(비어 있음) |
| `_to_delete_legacy_javid-dol-uk/` | javid-dol.uk, javidfuturebot.javid-dol.uk, javidfuturebot2.javid-dol.uk | `javid-dol-landing` | 구도메인 301 전용 |

모든 사이트는 Cloudflare **Workers + Static Assets** 다(Pages 아님). `functions/` 는 자동 라우팅되지 않고 각 `worker.js` 가 import 해서 붙인다.

## 2. 사이트별 라우트 (현행)

### hub-site (www)
`/`(en) `/ko` `/ja` `/es` `/fr` `/vi` `/tr` `/pt` · `/install-help` · `/llms.txt` · `robots.txt` · `sitemap.xml` · `images/*` · 구글 인증 txt.
API 없음. 거래소 카드가 각 서브도메인으로 보내는 **스플리터**이고, UTM 을 서브도메인 링크에 이어붙이는 스크립트가 있다.

### 거래소 사이트 (bg · bn · bb · okx 공통 골격)
HTML: `/` `/ko` `/ja` `/es` `/fr` `/vi` `/tr` `/pt` · `/results` · `/manual` · `/board` · `/install-help` · `/<거래소>-signup-api-guide` · `/download-stats`(운영용).
자산: `images/*` `screenshots/*` `results/*.png` `downloads/*`(R2 폴백) `data/*`(bg) · `llms.txt`(bg·bn) · robots · sitemap.
API(`worker.js`):
- `GET/POST/HEAD /api/download?platform=windows|mac|android` — R2 → 자산 폴백. **GET·POST 는 D1 `download_events` 에 1행 기록**(bg·bn·bb·okx 모두 HEAD 는 비집계 분기 존재). 귀속 파라미터 `r`(참조 호스트) `us` `um` `uc`(UTM) `lp`(랜딩 경로) + `ua_class` · `fetch_site` · 국가.
- `GET /api/download-stats?key=` — 집계 조회(사람 확정 = landing_path 있고 bot/script 아님).
- `GET/POST /api/board/posts`, `GET/PATCH/DELETE /api/board/posts/:id`(관리자 `x-admin-key`).
- `GET/POST /api/status` — 운영 계좌 스냅샷(D1 `live_status`).

### 귀속 체인(현행)
1. 각 거래소 페이지 `<head>` 첫 스크립트가 첫 진입 시 `sessionStorage.jfb_src = {r, us, um, uc, lp}` 저장.
2. 문서 캡처 단계 클릭 위임으로 `a[href^="/api/download"]` 클릭 시 위 값을 쿼리에 붙임.
3. 허브는 자기 쿼리(+참조 호스트를 utm 으로 변환)를 거래소 링크에 이어붙임.

## 3. 배포 방식 (현행)

| 사이트 | 방식 | 근거 |
|---|---|---|
| bg | `main` push → Workers Builds | 메모리 기록(9/3·10/13), `bitget-site` 에서 wrangler deploy 는 bg 에 안 감 |
| bn · okx · www | `npx wrangler deploy` (각 폴더) | 활성 버전 compat date 2026-07-13 = 저장소 설정과 일치 |
| bb | `npx wrangler deploy` (bybit-site) — **단, push 하면 Workers Builds 가 정적 전용 빌드로 덮어씀** | 아래 4절 |
| 레거시 | `npx wrangler deploy` (`_to_delete_legacy_javid-dol-uk`) | 9/7 메모 |

Workers Builds 연결 상태는 API 권한(`builds`) 부족으로 조회 불가 — 대시보드에서만 보인다.

## 4. ⚠️ 지금 운영 중인 결함 (이번 분석에서 발견)

**bb.javidtrading.com 의 워커 코드가 돌고 있지 않다 → 바이비트 다운로드 버튼이 404.**
- 활성 버전 `76c5fffe…`(2026-10-13 05:22 UTC): **Handlers 없음 · 바인딩 없음 · compat date 2026-10-06** — 저장소 `bybit-site/wrangler.jsonc`(2026-07-13, D1·KV·R2) 로 만든 버전이 아니다. Workers Builds 의 정적 전용 빌드가 CLI 배포를 덮은 것으로 보인다(10/7 에 두 번 있었던 일과 같은 증상).
- 실측: `GET bb/api/status` 404, `GET bb/api/board/posts` 404, workers.dev 도 404 (bg·bn·okx 는 200).
- R2 `javid-downloads-bybit` 에 b12 Win/mac 두 객체는 그대로 있다. 즉 파일은 있고 워커만 죽어 있다.
- 조치(코디네이터): `cd bybit-site && npx wrangler deploy` → `/api/status` 가 404 가 아닌지 확인. 근본 해결은 대시보드에서 javid-bybit-landing 의 Git 연결 해제.

그 밖에(기존 메모에 있던 것, 상태 유지): bn `/api/status` 는 200(10/13 메모의 500 은 해소된 상태), OKX 다운로드는 R2 비어 있음(의도된 중단).

## 5. 데이터

| 데이터 | 위치 | 비고 |
|---|---|---|
| 설치 파일 | R2 `javid-downloads-bitget` Win 23,904,206 B / mac 73,841,532 B · `javid-downloads` Win 19,856,003 / mac 66,112,222 · `javid-downloads-bybit` Win 23,967,335 / mac 73,941,216 (모두 2026-10-13 업로드) · okx 비어 있음 | 안드로이드 APK 객체는 bg·bn 에 남아 있으나 고장 빌드라 버튼 숨김 유지 |
| SHA-256 | 각 사이트 `install-help.html` | bg b566d6df…/083c4525… · bn db70a5ed…/c44bc5ff… · bb 0a55c311…/4ff15760… |
| 다운로드 집계 | D1 각 사이트 `download_events` | 손대지 않음 |
| 게시판 | D1 각 사이트 `posts` | bg·bn 은 팀 공지만, 외부 문의 0건(8/30 기준) |
| 실계좌 | 미니PC 8001(가족1, 바이낸스 V19.7 — 화면 제목만 V18.4) → 이 PC `app/live/dashboard_proxy.py` 127.0.0.1:8099(자격증명 마스킹·뷰전환) → OBS → 유튜브 라이브 | 8001 `/api/records` 392행 중 **73행이 FUNDING(펀딩비 정산)**, 청산 거래는 319건 |
| 실계좌 집계 | `해외마케팅 agent/scripts/live_proof_snapshot.py` → `AGENT_TEAM/live_proof/snapshot.json` | **결함: FUNDING 행을 거래 수·승수에 넣고 있었다**(391 '거래' 중 73 이 펀딩) — 이번에 수정 |
| 백테스트 | 공개 수치(2,023회·−64%·+96%)는 겹친 창 중복합산 오류 | bg 8개 언어 페이지·bg llms.txt 에 남아 있음 → 새 사이트에 싣지 않고, 옛 페이지는 301 로 내린다 |

## 6. 카피 층(정정 대상)

- "operator's own live account / 운영자 본인 계좌" — bg index · bn index · bg/bn/hub llms.txt. 8001 은 포트표상 **가족1** 이라 사실과 다름 → 새 사이트는 "실제 운용 중인 계좌(1개)"로만 표기.
- "Past results do not predict future ones" — hub index 의 수익구조 절. 금지 문구 계열 → 새 사이트에선 손실 문장으로 대체.
- 거래소 사이트의 가입 링크 다수가 **레퍼럴 링크**(`partner.bitget.com/bg/javid003` 11곳 등) — 새 사이트는 일반 가입 링크만.

## 7. 유지 / 리다이렉트 / 삭제 결정

| 대상 | 결정 | 이유 |
|---|---|---|
| 거래소 사이트 `/api/*` 전부 | **유지(변경 없음)** | 다운로드 R2 서빙·D1 집계·귀속·게시판·status·stats |
| 거래소 사이트 HTML(홈·언어판·results·manual·install-help·board·가이드) | **301 → www 대응 페이지**(언어·거래소 보존) | 사용자 결정 "화면만 없애고 연결" |
| `/download-stats` | 유지 | 운영 도구(noindex), 공개 화면 아님 |
| `images/` `screenshots/` `results/*.png` `downloads/` `data/` 인증 txt | 유지 | 옛 블로그·카드뉴스 핫링크 보호 |
| 거래소 사이트 `robots.txt` · `sitemap.xml` | 유지 | 검색엔진이 옛 URL 을 재크롤링해 301 을 처리하도록 |
| 거래소 사이트 `llms.txt` | 301 → www `/llms.txt` | AI 가 옛 수치·옛 문구를 계속 인용하지 않게 |
| API 가입 가이드 4종 | **www `/api-guide/<거래소>` 로 이전**(내용 보존, 밝은 테마 덮어씀) | bn 가이드가 검색 노출의 대부분 — 버리면 유일한 비브랜드 유입이 끊긴다 |
| 게시판 | www `/board` 로 이전, bg D1(`javid-board-db-bitget`)을 www 워커에 바인딩 | 기존 글·감시기(watch.py, bg API) 그대로 동작. bn/bb/okx 게시판 D1 은 보존만 |
| hub 허브 페이지(스플리터) | 새 메인으로 교체 | 사용자 지시 |

## 8. 새 구조(요약)

- `hub-site/` 를 새 메인으로 쓴다. 소스 `hub-site/src/`(빌드 스크립트·8개 언어 사전·설정·자산) → 생성물 `hub-site/public/`(정적 자산 디렉터리).
  `wrangler.jsonc` 의 `assets.directory` 를 `./public` 으로 바꿔 소스·설정 파일이 공개되지 않게 한다(10/7 메모의 `.wrangler/` 노출 문제 해소).
- www 워커 API: `/api/live-capture`(POST 업로드, 공유 비밀 헤더) · `/api/live-capture/latest` · `/api/live-capture/img/*` · `/api/v1/*`(조회 전용) · `/api/board/*`.
- 실성과: 이 PC 에서 1시간마다 프록시(8099) 화면 캡처 → www 워커로 업로드(R2 `javid-live-captures`). wrangler OAuth 에 의존하지 않는다.
- 다운로드 버튼: 각 거래소 워커의 기존 `/api/download?platform=…` 로 교차 링크(+ `r/us/um/uc/lp` 부착) — 집계·귀속 그대로.

## 9. 위험

| 위험 | 대응 |
|---|---|
| bg 는 git push 로만 배포되고 bb 는 push 때마다 덮인다 | 배포 순서 문서화(push → bb 재배포 → 라이브 상태코드 확인) |
| `run_worker_first` 없이 리다이렉트 코드를 넣으면 자산이 먼저 응답해 301 이 안 된다 | 거래소 워커 4개에 `run_worker_first: true` + 자산 예외 경로는 워커가 `env.ASSETS` 로 넘김 |
| Cloudflare `.html` 정규화(307) | canonical·sitemap·내부링크 전부 확장자 없는 주소 |
| hreflang 은 상호 선언이어야 함 | 빌드 스크립트가 8개 언어 전 페이지에 동일 세트를 생성, 테스트로 검사 |
| 교차 서브도메인 다운로드는 `Sec-Fetch-Site: same-site` 가 된다 | `human_*` 판정은 landing_path·ua_class 만 보므로 영향 없음 |
| 캡처에 자격증명이 찍힐 위험 | 프록시 마스킹 + 업로드 전 DOM 검사(보이는 키·토큰 입력칸에 값이 있으면 업로드 중단) |
| 백테스트 옛 수치가 AI 답변에 남음 | 옛 페이지 301 · www llms.txt 재작성 · 사이트 어디에도 옛 수치 없음(테스트로 grep) |
