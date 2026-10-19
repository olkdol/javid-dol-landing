# 배포·롤백 절차 — javidtrading.com 개편 (브랜치 `renewal-2026-10`)

이 브랜치는 **로컬 커밋만** 되어 있다. push·배포는 하지 않았다.
`/api/download` 는 어떤 확인 단계에서도 호출하지 말 것(GET·HEAD 모두 집계 위험). 다운로드 확인은 R2 객체·워커 코드·페이지 HTML 의 링크로만 한다.

## 0. 먼저 (지금 운영 중인 결함 — 개편과 별개)
bb.javidtrading.com 워커가 정적 전용 빌드로 덮여 있어 바이비트 다운로드가 404 다(2026-10-19 확인: 활성 버전 76c5fffe, Handlers/바인딩 없음, `/api/status` 404).
```
cd bybit-site
npx wrangler deploy
# 확인: curl -s -o /dev/null -w "%{http_code}" https://bb.javidtrading.com/api/status   → 404 가 아니어야 함 (200 또는 D1 오류 500)
```
근본 해결: Cloudflare 대시보드 → Workers & Pages → javid-bybit-landing → Settings → Build → Git 연결 해제.

## 1. 사전 준비 (한 번만)
```
cd hub-site
npx wrangler whoami                                   # OAuth 갱신 (2시간 만료)
npx wrangler r2 bucket create javid-live-captures     # www 워커가 바인딩하는 버킷 — 없으면 deploy 실패
```

## 2. 순서
1. **www 먼저** (새 화면이 있어야 옛 도메인을 넘길 수 있다)
   ```
   cd hub-site
   node src/build.mjs                    # public/ 재생성 (커밋된 public 과 같아야 함 → git status 깨끗한지 확인)
   node tools/test_site.mjs              # PASS 확인
   npx wrangler deploy
   # 업로드 키: 값은 이 PC 의 파일에만 있다(화면에 출력하지 말 것)
   # PowerShell:  Get-Content "C:\Users\Doll\Documents\AI_agents\해외마케팅 agent\.secrets\live_capture_key" | npx wrangler secret put LIVE_CAPTURE_KEY
   ```
   확인: `https://www.javidtrading.com/` 200 · `/api/live-capture/latest` 가 JSON(`{"available":false}` 또는 true) · `/api/v1/exchanges` 200 · `/ko/download` 200.
   그리고 이 PC 에서 한 번 수동 실행: `py -3.13 scripts\live_capture_upload.py` (해외마케팅 agent 폴더) → 로그 `uploaded … ok:true` → `/api/live-capture/latest` 가 available:true.
2. **git push** (bg 는 Workers Builds 로만 배포된다)
   ```
   git push origin renewal-2026-10:main      # 또는 main 에 merge 후 push
   ```
   2분 뒤 확인: `curl -sI https://bg.javidtrading.com/ko` → `301` + `location: https://www.javidtrading.com/ko?exchange=bitget`
   `curl -s -o /dev/null -w "%{http_code}" https://bg.javidtrading.com/api/status` → 200 (API 는 그대로)
3. **CLI 배포 3곳** (push 직후 — 특히 bb 는 push 가 덮어쓰므로 반드시 push 뒤에)
   ```
   cd binance-site && npx wrangler deploy
   cd ../okx-site  && npx wrangler deploy
   cd ../bybit-site && npx wrangler deploy      # push 뒤에 실행
   ```
   각각 확인: `/` 301 → www, `/api/status` 404 아님, `/images/…` 200, `/robots.txt` 200.
4. (선택) 구도메인 워커 — javid-dol.uk 계열을 한 번에 www 로 보내기(지금은 bg/bn 경유 2단 301)
   ```
   cd _to_delete_legacy_javid-dol-uk && npx wrangler deploy
   ```
5. 검색 콘솔: www sitemap(`https://www.javidtrading.com/sitemap.xml`) 제출. 옛 서브도메인 sitemap 은 일부러 남겨 두었다(옛 URL 을 다시 크롤링해 301 을 처리하게).

## 3. 배포 후 확인 체크리스트
- [ ] www 8개 언어 홈 200, hreflang 8+x-default (로컬 테스트로 확인됨)
- [ ] 다운로드 버튼 href 가 `https://bg|bn|bb.javidtrading.com/api/download?platform=…` 인지 **HTML 소스로** 확인 (클릭·HEAD 금지)
- [ ] `/api/live-capture/latest` 의 captured_at 이 1시간 안
- [ ] 옛 주소 몇 개: bg `/results` → www `/exchange?exchange=bitget`, bn `/binance-signup-api-guide` → www `/api-guide/binance`
- [ ] 다음 날 데일리 리포트에서 landing_path 가 `/download`·`/ko/download` 등 www 경로로 찍히는지 (귀속 체인 동작 확인)

## 4. 롤백
- www: `npx wrangler rollback --name javid-hub-landing` (직전 버전으로) 또는 대시보드 Deployments 에서 이전 버전 선택.
- bn/okx/bb: 각 폴더에서 `npx wrangler rollback --name <worker>`.
- bg: `git revert` 후 push, 또는 `npx wrangler rollback --name javid-dol-landing2`(다음 push 에 다시 덮이므로 revert 가 정답).
- 롤백해도 D1·R2·KV 는 손대지 않았으므로 데이터 손실 없음. live-capture 버킷은 남겨 둬도 무해.
- 캡처 예약 작업 끄기: `Disable-ScheduledTask -TaskName JaviD_LiveCapture_Hourly`.

## 5. 이 개편에서 바뀐 파일
- `hub-site/` 전면 교체: `src/`(생성기·8개 언어 사전·설정·자산·가이드 원본), `public/`(생성물, assets 디렉터리), `worker.js`, `functions/api/{live_capture,v1}.js`, `functions/api/board/*`(bg 와 같은 코드), `wrangler.jsonc`(assets=./public, R2, D1), `tools/`(test_site, render_check, backtest_publish, test_backtest_publish).
- `shared/legacy_redirect.js` → 각 거래소 폴더에 복사(`tools/sync_redirect.mjs`), 각 `worker.js` 끝에 1줄, 각 `wrangler.jsonc` 에 `run_worker_first: true`.
- `_to_delete_legacy_javid-dol-uk/worker.js`: 옛 도메인을 www 로 직행.
- 해외마케팅 agent 쪽(이 저장소 밖): `scripts/live_capture_upload.py`, `해외마케팅 agent/run_live_capture.bat`, 예약 작업 `JaviD_LiveCapture_Hourly`(매시 07분), `.secrets/live_capture_key`(gitignore `*`), `scripts/live_proof_snapshot.py`(FUNDING 행 집계 수정).
