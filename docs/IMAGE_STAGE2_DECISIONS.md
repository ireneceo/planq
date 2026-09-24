# 이미지 보안 Stage 2 — 결정문 (Fable 판정 2026-09-24, 구현 Opus)

대상 `GET /api/files/public-image/:storedName` · `GET /api/posts/editor-image/:filename` (무인증 `<img>` 서빙).

## 결론
**Stage 2a = 개인(L1) 이미지만, 지금, 기존 파일 포함, 두 라우트가 같은 함수로.** L2/L3(2b)·서명 URL 전환은 하지 않는다.

## 근거 — 운영 실측(읽기 전용)
- Stage 1 계측(`[imageGate:would-deny]`) 30일 130줄. 익명 123줄 = dev 검증 트래픽 한 덩어리(사용자 아님).
- 로그인 타인 3쌍: platform_admin(허용됨 — 같은 술어) · 수신 메일 인라인 사본 2건(L1, 떠난 URL — 막히는 것이 목록 술어와 같은 결과).
- 대상: L1 이미지 173 · L2 125 · L3 125 · L4 0. 본문에 박힌 L1 URL = 보낸 메일 초안 2건(작성자 본인이 봄).
- **깨지는 화면 0.** 게스트 `/g/` 는 L4 만 썸네일, 공개 공유·위키는 L2/L3(범위 밖), 메일 수신자는 CID.

## 계약
1. 판정은 한 함수 `middleware/imageViewer.isImageViewable(file, req, route)` — L1 이면 올린 사람 또는 `canAccessFileByLevel`(목록·다운로드와 같은 술어, platform_role 은 DB 에서 읽어 넘긴다). L1 외 통과.
2. 두 라우트가 같은 함수. 거부 = 404(존재 은닉) + `Cache-Control: no-store`.
3. 게이트는 리사이즈 캐시(`serveCachedIfPresent`/`maybeServeResized`) **앞**.
4. 판정 오류는 막는다(fail-closed).
5. 옛 URL·경로·쿠키 TTL 불변, 마이그레이션은 킬스위치 컬럼 1개(additive).

## 킬스위치 · 관측
- `platform_settings.image_gate_l1_off_until` DATETIME — NULL/과거 = 켬, 미래 = 그때까지 끔(24h 자동 복귀용). 못 읽으면 켬. 30초 캐시(재시작 불필요).
  운영 적용: `dev-backend/scripts/migrate-image-gate-flag.js`(멱등). 코드는 컬럼이 없어도 켬으로 동작 — 순서 제약 없음.
- 로그 `[imageGate:deny] … referer=<경로, 긴 조각 가림> flag=on|off` (file,viewer 당 1줄) · 세션 있는 사용자가 신원 없이 막히면 `[imageGate:ALERT]` 24h 1회.
- (Fable 권고 중 미구현, 후속) 관리자 메일 경보 · `health-check --category=imagegate` 카운터 — 카운터는 서버 프로세스 안(`imageGateStats`)에 있다.

## 2b 선결 조건 (보류)
위키 L3 스크린샷 · 공개 공유 문서 본문(L2/L3 editor-image) · 게스트 «자리는 보이되» 계약이 전부 익명이다 — 무엇이 옳은 동작인지부터 별도 설계.

## 검증
`node scripts/e2e/run.js --suite imagegate` — 익명 L1 404 · 올린 사람 200 · 다른 멤버 404 · platform_admin 200 · L3/L4 불변 · 캐시 앞 게이트 ·
만료 쿠키 404 · pq_img Bearer 401 · editor-image 같은 함수 · 킬스위치 왕복(양성 대조군).
