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
