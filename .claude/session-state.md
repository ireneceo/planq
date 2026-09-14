## 현재 작업 상태
**마지막 업데이트:** 2026-09-14 (UTC)
**작업 상태:** 완료 (운영 배포 `55c90dfa` · **v1.52.1** · 09:49 · 353초 · 백업 `/opt/planq/backups/20260914_094402`)
**Git:** 미커밋 변경 0건 · 마지막 배포 커밋 `55c90dfa`

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)

**★ 앱에서 알림을 눌러도 못 가던 것 — 원인이 세 겹이었다** (`9dbcc519`)
> Irene: *"모바일에서 알림이오면 눌러서 갈 수가 없어 커넥션 문제라고 나와 모든 알림 다."* · *"앱 다 체크해"*
> (아이폰 앱·안드로이드 앱 **양쪽**. 웹/PWA 는 이 경로를 안 타서 멀쩡했다.)

1. `stores/tabStore.ts` — 미러 모드에서 `navigateDelegate` 가 아직 없으면 `navigateActive` 가
   **조용히 no-op**. 앱 콜드 스타트(알림 탭의 대부분)가 정확히 그 순간이다 → `mirrorNavigate` 로
   한 건 보류했다가 `setTabNavigator` 가 붙을 때 보낸다(TTL 15초).
2. `components/NativeBridge.tsx` — 그래서 400ms 뒤 `location.assign(상대경로)` 로 **문서 전체를
   다시 로드**했다. 앱 기동 중의 그 로드가 실패하면 Capacitor 가 `errorPath` 로 떨어뜨린다
   → SPA 로 2.4초 기다리고(문서 로드 0회), 그래도 못 가면 **1회만 절대 URL**.
3. `www-placeholder/index.html` — 그 오프라인 화면의 [다시 시도]가 `location.reload()` 였다.
   그 문서는 **앱 번들 안의 로컬 파일**이라 다시 읽어도 같은 화면 — **한 번 떨어지면 영영 못 나왔다.**
   → 절대 서버 URL 이동 + 자동 복귀(online·visibilitychange·1.5초), 최소 간격 8초로 루프 차단.
   URL 은 `scripts/cap-offline-fallback.js` 가 플랫폼 `server.url` 에서 박는다(손으로 안 적는다).

원인 추적에 결정적이었던 것: **앱 UA 크래시 리포트가 0건**이었다 = 우리 JS 가 아예 안 돌고 있었다.
운영 실측으로 배제: 알림 링크 전부 정상 상대경로 · 그 경로 운영 200(iOS UA) · TLS 유효 ·
push 3일 실패 0(apns 25·fcm 25·webpush 25) · dev 서버엔 네이티브 세션 0(양쪽 앱 모두 운영을 가리킨다).

**★ 프로젝트 상세 12탭 레이아웃을 껍데기 2종으로 수렴** (`6d64d6dc`)
> Irene: *"프로젝트 상세 가로 레이아웃이 탭마다 달라. 헤더랑 다르면 안되는데 탭마다 다르고 헤더랑도 다르고."*

12탭 × 3폭 실측으로 갈린 축 셋: 좌우 여백(보고서만 +20px, **모든 폭**) · 시작점(파일만 20px 아래,
폰에선 얹는탭이 막대보다 2px 위) · 스크롤 주체(파일만 바깥 — 태블릿 20px·폰 398px 넘침).
→ `ProjectTabPane`(일반) / `ProjectTabFull`(문서·노트·**파일**) 둘만 쓰게 했다.
`ProjectReportTab` padding:20px 제거 · `HistoryTab` 상단 4px 제거 · `ProjectFilesWrap` 삭제 ·
폰 margin 16→14 · 읽는 곳이 없어진 `tabStickyTop` 삭제.
후: 일반탭 좌 `[240][20][14]` · 얹는탭 시작차 `[0][0][0]` · 바깥 스크롤 `0 0 0`.

**프로필 사진 매직바이트** (`ec4ffe25`, 앞 세션 커밋분이 이번 배포에 실림)

**배포** — v1.52.1 (버전을 **배포 전에** 올렸다), 릴리즈노트 ko/en 3항목 발행, 개발현황 id=95.

### ★ 이번 세션에서 검사기를 세 번 고쳤다 (전부 대조군이 잡아낸 것)
1. **하니스 mail-compose 거짓 FAIL** — "위로 밀림 top -61" 은 본문 에디터가 보이는 영역보다 커서
   (h 374 > vvh 337) **필연**이었다. 실제로 14줄을 쳐 보니 캐럿은 246/337 로 내내 보인다.
   검사기는 원래도 캐럿으로 재려 했는데 하니스가 `focus()` 만 하고 선택을 안 만들어 언제나
   요소 rect 로 떨어졌다 → 캐럿을 세워 재게 함. 대조군 2/2.
   ★ **내 변경 이전 빌드에서도 같았다** — 두 파일을 원복·재빌드해 확인했다(내 것이 아님을 증명).
2. **탭 레이아웃 검사기 1차** — 껍데기 rect 로 재서 **양성 대조군이 통과**했다(빨간불을 끈 것일 뿐).
3. **탭 레이아웃 검사기 2차** — "텍스트 있는 첫 잎" 으로 바꾸니 탭마다 다른 컨트롤이 잡혀 전부 거짓 실패.
→ 최종: **탭 루트 상자 + padding, 단 보이는 상자(카드)의 padding 은 더하지 않는다.**
  대조군에서 3폭 모두 `report` **하나만** 잡힘(오탐 0), 원복 후 0 실패.

### 신설한 가드·카나리
- `scripts/cap-offline-fallback.js` (+`--check`) — 앱 오프라인 화면의 서버 URL 을 플랫폼
  `server.url` 에서 박고 검사. `{ios,android}-beta-check.js` 에 물림. **깨뜨려 확인**(android 만
  어긋내니 exit 1, 원복 0).
- beta-check 에 "생성물이 capacitor.config.ts 보다 오래됐다" 경고 — 실제로 **iOS 생성물이 8/25 자**라
  그대로 아카이브하면 dev 서버를 가리키고 8/27 포그라운드 배너 수정이 되돌아간다.
- 카나리 `--suite pushdeeplink` (신규 8건) — 콜드스타트 딥링크 도착 + 문서로드 1회 ·
  양성 대조군(SPA 막으면 폴백 2회) · 오프라인 화면 서버 복귀 4건 · 음성 대조군(옛 reload 0건).
- `--suite projecttabs` 에 **12탭 × 3폭 레이아웃 계약** 추가 + 탭 순서 판정 선택자 조임
  (접두어만 보다 새 본문 testid 를 탭으로 세어 거짓 실패했다).

### 검증 (Fable 미검증 — 자체 검증)
**Fable 호출 오늘 9회 전부 429(한도 초과).** 대기열 37·38·39 등재 + `unavailable` 마커.
- 빌드 EXIT 0 / `error TS` 0 · health 44/44 · 불변식 53/54
- 카나리 `pushdeeplink` 8/8 · `projecttabs` 전건 · `sticky`·`mobile`·`tabs` 실패 0
- 얹는탭 overflow 위험 3종 실측: 이중 스크롤 0 · sticky 가림 0 · 내용 끝까지 닿음
  (files 태블릿 96/96 · 폰 475/475 · docs 폰 103/103)
- 배포 후 **운영 자산에서 직접** 확인: 메인 청크 해시 dev 와 동일 ·
  `ProjectReportTab-CTTFXJ63.js` 에 `padding:20px…` 0건 · `QProjectDetailPage` 에 `overflow-y:auto`
  있고 `--pq-tab-sticky-top` 부여는 없음 · 메인 청크에 `planq_pending_push_link` ·
  운영 `routes/users.js` 에 매직바이트 판정

### 주요 변경 파일
`dev-frontend/src/stores/tabStore.ts` · `src/components/NativeBridge.tsx` ·
`dev-frontend/www-placeholder/index.html` · `src/pages/QProject/{QProjectDetailPage.tsx,
QProjectDetailPage.styles.ts, ProjectReportTab.tsx, HistoryTab.tsx}` ·
`scripts/cap-offline-fallback.js`(신규) · `scripts/{ios,android}-beta-check.js` ·
`scripts/e2e/{canary-push-deeplink.js(신규), canary-project-tabs.js, lib/browser.js, run.js}` ·
`dev-frontend/package.json`(cap 스크립트 + 버전)

### 다음 할 일
- **★ 앱 빌드가 필요하다** — 오프라인 화면 수정은 **앱 번들 안**이라 이번 웹 배포로는 폰에 안 갔다.
  이미 그 화면에 좌초한 기기는 강제종료 후 재실행해야 한다.
  iOS `npm run cap:beta` → Xcode 아카이브 (★ 생성물이 8/25 자 — 그냥 아카이브하면 dev 를 가리킨다) ·
  Android `npm run cap:beta:android`.
- **Fable 대기열 35·36·37·38·39** — `/usage-credits` 로 풀리면 한 번에 올린다. 특히
  ①보류분이 엉뚱한 시점에 터지는지(실브라우저로 못 만들었다) ②데스크탑 탭 모드 무회귀
  ③`--pq-tab-sticky-top` 제거 판단(2026-09-09 에 **정반대 방향으로** 한 번 틀린 자리다)
  ④문서가 많은 워크스페이스에서 얹는탭 스크롤(내 픽스처는 자료가 거의 0건 — **빈 목록은 거짓 초록**)
  ⑤카드 padding 을 빼는 판정 규칙이 배경색 있는 래퍼를 놓치는 것.
- **탭 메뉴 추가**(사용자가 프로젝트 탭을 추가) — 범위·권한·게스트 노출을 먼저 정해야 한다. 지시 대기.
- **iOS 빌드 만료 알림은 존재하지 않는다** — 컬럼도 크론도 없다. 만들려면 만료일 칸 1개 +
  D-14/7/3/1 메일(`platformNotify` 재사용). 지시 대기.
- **안드로이드** — Google Play 조직 계정 서류 승인 여부만 알면 다음 단계로 간다(서버에서 확인 불가).
- 알림 메일 모양을 실제 메일 클라이언트로 확인(Gmail·Outlook·iOS Mail) — 아직 못 했다.
- 운영에 옛 청크가 누적된다(rsync 가 안 지운다) — 열어 둔 탭에는 이롭지만 한 번 판단 필요.

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
