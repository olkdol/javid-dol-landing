# 2026-08-16 · 랜딩 24개 언어 페이지에 라이브 방송 배지 추가

**작업 주체**: 해외마케팅 에이전트 (마케팅팀)
**대상**: `hub-site` / `binance-site` / `bitget-site` 의 언어 페이지 8개씩 = 24개
  (index, ko, ja, es, fr, vi, tr, pt) — board/manual/results/guide 등 보조 페이지는 제외

## 무엇을
각 페이지 `</body>` 직전에 우하단 고정 배지(`#jfb-live-badge-link`)를 넣었습니다.
언어별 문구(LIVE / EN VIVO / EN DIRECT / TRỰC TIẾP / CANLI / AO VIVO)로 현지화했습니다.

## 왜 이 형태인가
- 페이지 구조가 서로 달라(손으로 쓴 다크 테마 ko.html / 프리렌더 / vi·tr·pt) 본문에 끼워넣으면
  깨질 위험이 있어, **레이아웃에 영향이 없는 `position:fixed` 배지**로 넣었습니다.
- 모바일에서는 부제를 숨기고 배지만 남깁니다. `prefers-reduced-motion` 도 존중합니다.

## ⚠️ 링크 주소 주의
```
https://www.youtube.com/@JaviDFuture/live
```
**영상 ID를 직접 박으면 안 됩니다.** 방송이 끊겼다 재생성되면 ID가 바뀝니다
(2026-08-14 에 실제로 발생: sFVWbM2SE9A → V48kCWG7APk).
위 채널 주소는 항상 현재 진행 중인 라이브로 이동하므로 안 깨집니다.

## 검증
로컬 파일을 실제 브라우저(headless Chrome)로 열어 6개 표본에서
렌더·클릭 가능 여부·다국어 글자 깨짐 없음을 확인한 뒤 배포했습니다.

## 되돌리려면
각 파일에서 `jfb-live-badge-css` 스타일 블록과 `jfb-live-badge-link` 앵커를 지우면 됩니다.
