# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-20 (Opus 4.8, 1M) — 게스트 퀵메뉴·/wiki 네비 + 앱 심사 선제대응 (운영 배포 완료)
**작업 상태:** 완료 (배포·검증까지)

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션 · 운영 배포됨 — 커밋 9b82253·ebae4b2·2a8f8ba·4f9ab48)
- **게스트 퀵메뉴 · Q helper 공개 표면 · /wiki 네비** — 신규 `utils/publicSurface.ts` 단일 원천. App.tsx 가 CueHelpDrawer 만 hideAppChrome 예외로 마운트(#71 회귀 없이), /wiki 를 WikiShell(LandingLayout GNB/푸터)로 감쌈. 워크스페이스→위키는 새 탭. i18n qhelper 24키 ko/en 추가.
  - ★Fable 설계검증이 잡은 것: CueHelpDrawer 는 useChromeNav(tabStore)를 쓰는데 공개 표면엔 TabMirror 가 없어 navigate 가 **silent no-op** → App.tsx 가 RR navigate 를 prop 주입해 해결. 드로어 안 RR 훅 직접 호출은 ChromeOverlays router-less zone 크래시라 금지.
- **App Store 심사 선제 대응** — `App.entitlements`(+pbxproj Debug/Release 연결) · 결제 봉쇄 `utils/purchase.ts canPurchaseInApp()` 6곳(PlanSettings CTA·CheckoutModal·**AddonSection**·UsageWarningCard·LimitReachedDialog(+addonHint)·TrialStatusBanner·WorkspaceBillingBanner) · planq:// custom scheme(iOS+Android) · AASA/assetlinks + nginx location · ITSAppUsesNonExemptEncryption · deploy-planq.sh 에 migrate-push-native 단계.
- **신규 가드 2종** — `scripts/guard-native-release.js`(16항목, --release 엄격) · health-check `wiki` 카테고리(30→31, linked_route ↔ 실 라우트 대조).
- **위키 linked_route 18건 정정** — /qtask·/qbill·/qnote·/qdocs·/qfile·/qtalk·/clients 가 존재하지 않는 라우트라 "화면 열기"가 랜딩으로 축출됐다. seed + dev DB + **운영 DB** 정정.
- **선재 버그**: WikiArticlePage 가 인증 해소 전 fetch → visibility='authenticated' 문서 새로고침 시 401 화면. authLoading 대기로 수정.
- **isAppInitialPath 정렬** — insights 만 빠져 로그인 데스크탑이 /insights 에서 워크스페이스 셸을 보던 것.

### ★ 이번 세션 최대 교훈 (메모리 `feedback_guard_must_be_falsified`)
내가 만든 가드 2항목이 **없는 파일 경로를 읽어 영구 거짓 통과** 중이었다(16/16 초록인데 아무것도 검사 안 함). fail-closed 로 전환 + 새 가드는 반드시 일부러 깨뜨려 검출 확인 후 커밋. 반증 테스트에 셸 변수(`$1`) 쓰다가 dev DB 에 리터럴이 들어간 사고도 있었다 — 값은 스크립트에 직접 박을 것.

### 검증
가드 4축(health 31/31·invariants 21/21·app-routes 51·native-release 16/16) · 빌드 EXIT0/TS0 · dev 실브라우저 15/15 · **운영 배포 3점 실측**(PM2 uptime 리셋·청크해시 dev=운영 CsFz2BQ5 일치·헬스 200) · **운영 콘텐츠 7/7**(게스트 FAB·2탭·위키링크 실이동·GNB·RightDock 부재·화면열기 숨김·pageerror 0)

### 🔴 남은 것 — Irene 액션
1. **운영 nginx AASA content-type** — `https://planq.kr/.well-known/apple-app-site-association` 가 `application/octet-stream` 으로 나간다(iOS 는 application/json 필요). 운영 nginx 에 location 추가 필요. 저장소 템플릿(`scripts/nginx-planq.kr.conf:102`)엔 반영됨. 배포는 nginx 설정을 복사하지 않고, 운영은 passwordless sudo 가 reload 로 제한돼 Claude 가 못 고침. **앱 TestFlight 전까지만 하면 됨.**
2. **Apple Developer 등록** — 조직 권장(팀원 계정·판매자명·이전 비용). D-U-N-S 대기 중 무료 Apple ID 로 Phase 0 실기기 검증 가능. 이후 Team ID · APNs .p8(+Key ID) · Firebase(FCM_*, google-services.json) 전달 필요.
3. **계정 삭제 기능(Guideline 5.1.1(v))** — 별도 사이클. 탈퇴 시 워크스페이스 소유권·미수금·고객 데이터 처리 설계 필요. TestFlight 무관, 스토어 제출 전 필수.
4. 기존: Stripe Webhook Secret · SMTP DKIM/SPF/DMARC · Google OAuth 검증 제출(#126)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```

### 참조
- 설계: `docs/qa/GUEST_QUICKMENU_WIKI_DESIGN.md` · `docs/MOBILE_APP_DESIGN.md`
- 진행 히스토리: `DEVELOPMENT_PLAN.md` 최상단
- 메모리: `feedback_guard_must_be_falsified`(신규) · `project_native_app_capacitor_plan`
