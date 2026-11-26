---
paths:
  - desktop/**
  - dev-frontend/src/services/native.ts
  - dev-frontend/src/utils/pinHost.ts
  - dev-frontend/src/components/DesktopBridge.tsx
  - dev-frontend/src/components/Common/NotificationToaster.tsx
  - scripts/e2e/canary-desktop.js
---

# 데스크탑 앱(윈도우·맥) — Electron 원격 껍데기 (2026-11-07 박제)

> Irene: *"우리 데스크탑용 윈도우, 맥 앱을 만드는 거 어때? 지금 PWA가 좀 불편한 부분들이 있는 거 맞지?"* → «권고대로».
> 설계 정본 `docs/DESKTOP_APP_DESIGN.md`(Fable DESIGN-READY). 회귀 `node scripts/e2e/run.js --suite desktop`.

- **창은 planq.kr 을 띄우는 껍데기다**(폰 앱과 같은 구조). 화면은 웹 배포로 바뀐다. 껍데기(`desktop/`)가 바뀐 때만 새 설치본 — `desktop/scripts/build.js` → `publish.sh`(웹 /배포 와 분리, Irene 지시 때만).
- **판정은 `services/native.isDesktopApp()` 하나**(창에 `window.planqDesktop` 이 있는가). `isNativeApp()` 을 데스크탑에 true 로 돌리지 않는다 — Capacitor 플러그인 길이라 죽는다. 데스크탑이 달라야 하는 자리는 `isDesktopApp()` 으로 **따로** 가른다. 외부 로그인·연동처럼 폰 앱과 같이 가는 자리만 `usesSystemBrowserAuth()`.
- **preload 표면은 `PlanqDesktopBridge` 타입이 전부**(native.ts). 늘리면 main 의 IPC(보낸 프레임 출처 검사)·preload·타입을 같이 고치고 설계 §5 에 적는다. main 은 토큰을 보지도 받지도 않는다.
- **탐색 잠금** — 창 안은 같은 출처만. 바깥 http(s) 는 OS 브라우저. 새 «바깥으로 나가는» 기능(결제·외부 로그인)은 `openSystemBrowser`/`openExternalUrl` 을 쓴다 — `location.href` 로 나가면 잠금에 막혀 «아무 일 없음» 이 된다.
- **핀(항상 위)** — `usePinHost` 맨 앞 분기. Electron 도 Document PiP 를 내놓으므로 그 분기보다 뒤에서 가르면 옛 홀더가 다시 뜬다. 회귀 A + 대조군 A′(보통 크롬은 PiP 길).
- **알림** — 웹 푸시·서비스워커는 데스크탑에서 끈다. OS 알림은 `NotificationToaster` 가 «안 보고 있을 때» 메인 창에서만 쏜다(main 이 같은 id 60초 한 번). 새 알림 경로를 만들면 이 한 지점을 지난다.
- **시험 표면은 패키지에 없다** — 시험 코드는 `// @test-only-start` … `// @test-only-end` 구역 또는 `desktop/test/` 에만. `scripts/check.js` 가 만든 asar 를 읽어 막는다(첫 빌드에서 main.js 시험 줄을 실제로 잡았다). 자체 시험은 `node scripts/check.js --self-test`.
- **리눅스(xvfb) 실측 함정** — 창 안 `window.close()` 는 `close` 없이 바로 `closed`, 이동 끝(`moved`·`resized`)도 안 온다. 창 자리는 `move`·`resize` 로 들고 있다가 저장한다(`trackBounds`). 단일 실행 잠금 때문에 남은 시험 앱이 있으면 새 실행이 조용히 꺼진다 — 시험은 끝에 프로세스 묶음째 정리한다.
- 운영 DB: `migrate-desktop-client-kind.js`(refresh_tokens.client_kind 'desktop' 365일) · `migrate-desktop-app-urls.js`(platform_settings 받기 주소) — 둘 다 배포 슬롯, PM2 reload 전.
- **2단계 C·E (2026-11-10, `docs/DESKTOP_APP_PHASE2.md` §6)** — 전역 단축키 검증은 main(`desktop/src/shortcut.js`) 한 곳: Ctrl/Cmd/Alt 필수(렌더러 값을 믿지 않는다) · 바꾸기는 메인 창만. 빠른 추가 창은 새 화면이 아니라 `/task-popout?quick=1`(웹 `useDesktopQuickMode`). 점프 목록·맥 메뉴 인자는 `--pq-action=` 허용 목록만 — 새 동작은 `ACTIONS`·preload `onAction` 거름·웹 `DesktopBridge` 셋을 같이. 회귀 `--suite desktopquick`.
- **윈도우 배포 경로 (2026-11-15 Fable 결정 B)** — 공개는 Microsoft Store(MS 서명, MSIX · Store 빌드는 electron-updater 끔). 무서명 NSIS + `/desktop/` 는 비공개 파일럿 직접 링크만. 인증서 구입은 Store 를 막는 고객이 실제로 나올 때. → **2026-11-26 Irene 결정 ②로 바뀜: 공개 = 서명된 NSIS 를 사이트에서 직접**(클라우드 서명 SSL.com eSigner · `desktop/scripts/sign-win.js` · 값 없으면 무서명 · `PLANQ_WIN_SIGN=1` 이면 멈춤 · 시험 `node desktop/test/sign-win.test.js`, §6-3). Store 는 뒤에. 서명 빌드를 만들게 되면 `publisherName` 명시 · 갱신 때 CN 표기 유지(바뀌면 업데이트가 조용히 거절). 정본 `docs/DESKTOP_APP_PHASE2.md` §6-2.
- **회의 소리 녹음·Store 제출본 (2026-11-18, `docs/DESKTOP_APP_PHASE2.md` §7)** — getDisplayMedia 판정은 `desktop/src/capture.js` 한 곳(윈도우·앱 출처·메인 창 최상위·제스처·소리) + main 네이티브 확인창 매번 → 자기 프레임 영상 + loopback. 다른 화면(desktopCapturer 소스)을 넘기는 길을 만들지 않는다. 판정을 고치면 `node desktop/test/capture.test.js`. 웹은 `capabilities.systemAudio` 로만 «지원» 을 그린다(맥은 Electron loopback 없음 → false). Store 빌드(`build.js win-store`, 윈도우 기계)는 `process.windowsStore` → electron-updater 끔 · 자동 실행은 StartupTask + `ms-settings:startupapps`.
- **떠나기 전에 묻기 (2026-11-19, Q note 녹음 이탈 보호 G)** — 페이지가 beforeunload 로 막으면 Electron 은 대화창 없이 **조용히** 종료·새로고침을 취소한다. main `guardUnload`(모든 webContents, `will-prevent-unload`)가 네이티브 대화창 [계속 사용]/[그래도 닫기] — 계속이면 `quitting=false` 되돌림. 껍데기가 `--planq-unload-prompt` → preload `capabilities.unloadPrompt` 를 줄 때만 웹이 데스크탑에서 beforeunload 를 건다(옛 앱은 안 묻는다). 새 설치본이 나가야 데스크탑에 반영된다.
- **PlanQ 링크를 데스크탑 앱에서 열기 (2026-11-25, Irene «로그인한 화면 링크는 전용 앱으로» · Fable 설계 DESIGN-CHANGE 반영, `docs/DESKTOP_APP_PHASE2.md` §8)** — OS 가 https 를 Electron 에 못 넘기므로 브라우저 웹이 `planq://open?url=<전체 주소>&u=<사용자>` 로 넘긴다.
  판정은 껍데기 `desktop/src/openLink.js` 한 곳(같은 출처 · 앱 경로 접두어만 · 정규화 우회 버림 · oauth 복귀 아님) → `planq:open-link` → 웹 `DesktopBridge`(다른 계정이면 이동 안 함 + 까닭 띠). 시험 `node desktop/test/openLink.test.js`.
  브라우저 쪽은 `utils/desktopHandoff` + `DesktopHandoffBand` — **자동으로 쏘지 않는다**(서버 표시는 «이 사람에게 받을 앱이 어딘가 있다» 일 뿐) · 브라우저별 선택 3상태(localStorage) · 새 탭 첫 로드만 · 폰·팝업·iframe·PWA·OAuth 복귀 제외.
  «받을 수 있는 껍데기» 는 토큰 행 표시 `refresh_tokens.open_links`(껍데기 안 웹이 `capabilities.openLinks` 를 보고 `POST /api/auth/desktop-open-links` · 회전이 물려받음) → `getUserWithBusiness.desktop_open_links`. 옛 1.1.0 껍데기는 표시가 없어 띠가 안 뜬다.
  앱 경로 목록 복사본 두 개(`desktop/src/link-paths.json`·`desktopHandoff.ts`)는 정본 `scripts/native-link-paths.js` 와 가드 `--category=applinks` 가 대조한다. 운영 DB `migrate-desktop-open-links.js`(배포 슬롯, PM2 reload 전).
