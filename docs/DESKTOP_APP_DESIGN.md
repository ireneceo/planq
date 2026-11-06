# PlanQ 데스크탑 앱(Windows·Mac) — 1단계 설계

> Irene 2026-11-06: *"우리 데스크탑용 윈도우, 맥 앱을 만드는 거 어때? 지금 PWA가 좀 불편한 부분들이 있는 거 맞지? 나만 느끼는 거 아닐텐데?"*
> → 질문 «1단계(팝아웃 고정·트레이·알림·로그인)부터 만들까요?» 에 «권고대로 진행해 줘».
> 설계 판정: Fable `design` 2026-11-06 **DESIGN-READY** (이 문서는 그 판정 그대로). 정찰 `.claude/plans/qmw4ke5f1.md`.
> 앞선 판단: `docs/POPOUT_PIN_DESIGN.md:60-70`(08-17 «Electron 이 유일한 경로 — 매일 필요하면 별도 안건»).

## 1. 방식
**Electron + 원격 껍데기** — 창은 운영 `https://planq.kr`(개발 빌드 `https://dev.planq.kr`)을 띄운다. 폰 앱(Capacitor `server.url`)과 같은 구조라 웹 배포로 앱 화면도 같이 고쳐진다.
Tauri 는 채택하지 않는다 — 맥에서 사파리 엔진이라 iOS PWA 버그를 데스크탑에 들이고, 지금 화면 검사(크롬)와 엔진이 갈린다.

## 2. 1단계 범위
**넣는다**
1. 껍데기 `desktop/`(main·preload·electron-builder, 출처 빌드 고정)
2. 단일 인스턴스 · 트레이 상주(닫기 = 숨김) · 로그인 시 자동 실행(기본 끔) · 독/작업표시줄 배지
3. 팝아웃 = 도구별 BrowserWindow · **창마다 핀(항상 위) 토글, 동시 여러 개** · 도구별 자리·크기 기억
4. 알림: 소켓 → OS 알림(보고 있으면 카드만 · 한 알림 = 한 번)
5. 로그인: 구글·애플 = 시스템 브라우저 + 짝 맞추기(기존 pair/claim) + `planq://` 복귀 가속
6. 서비스워커·웹 푸시 **안 함**
7. 자동 업데이트(electron-updater, planq.kr 정적 호스팅)
8. 다운로드 화면 Windows/Mac + platform_settings
9. e2e `desktop` 스위트(puppeteer CDP 연결)
10. `client_kind='desktop'`

**뺀다(다음 단계)**: Q Note 시스템 소리 · 창 밖 네이티브 메뉴 · 전역 단축키 · 윈도우 코드서명 · 앱이 꺼져 있을 때 알림(구조적으로 없음 — 트레이 상주가 대답) · 스토어 배포 · 오프라인 화면.
**안 풀리는 것**: 화면 «느림» 은 PWA 탓이 아니었다(706b1714) — 앱으로 바꿔도 같다.

## 3. 결정
1. **`desktop/` 은 별도 패키지** — 루트·`dev-frontend` 와 node_modules 를 섞지 않는다(electron ~300MB 가 tsc 메모리 몫을 흔든다). 출처는 빌드 시 `PLANQ_DESKTOP_ORIGIN` 한 값, 실행 중 바꿀 수 없다(탐색 잠금의 기준). UA 에 ` PlanQDesktop/<ver>` 를 덧붙인다(로그 식별용 — 판정에 쓰지 않는다).
2. **판정은 `window.planqDesktop` 존재** — `services/native.ts isDesktopApp()`. **`isNativeApp()` 을 데스크탑에 true 로 돌리지 않는다**(29파일 74곳이 Capacitor 플러그인을 부른다). 자리마다 `isDesktopApp()` 분기를 명시적으로 더한다.
   서버 `refresh_tokens.client_kind` ENUM 끝에 **`desktop`**(365일, LONG_KINDS). `pwa` 재사용 금지 — PWA 와 데스크탑 세션을 가를 수 없으면 도입 효과·장애를 못 잰다. 읽는 곳 전수(모델·authTokens VALID/LONG·onboarding APP_CLIENT_KINDS·감사·관리 화면). 마이그레이션 `dev-backend/scripts/migrate-desktop-client-kind.js`(멱등·배포 슬롯). **서버 먼저 배포**(옛 서버는 모르는 kind 를 web 30일로 떨군다 — 깨지진 않음).
3. **팝아웃·핀** — `openPopout` 은 그대로 `window.open(path,'pq-<tool>',features)`(웹 코드 무변경). main `setWindowOpenHandler` 가 `pq-*` + 같은 출처면 BrowserWindow(기억 자리 우선). **핀 분기는 `usePinHost` 맨 앞** — 데스크탑이면 `pin()` = `planqDesktop.setAlwaysOnTop(true)`, mode 는 늘 `normal`(홀더·PiP·선공지·축출 전부 안 탄다). `supportsPin()`·`pipApi()` 보다 앞에서 가른다 — 안 그러면 Electron 이 노출하는 Document PiP 로 옛 홀더가 다시 뜬다(최대 리스크). 자리·크기는 userData JSON(도구별 `{x,y,w,h}`), 재시작 때 핀은 복원하지 않는다. 같은 `frameName` 은 기존 창 재사용(도구당 창 1개).
4. **트레이·자동 실행·배지** — 닫기 = 숨김(맥 Cmd+Q·트레이 «종료» 만 진짜 종료) · `requestSingleInstanceLock` · 자동 실행 기본 끔(트레이 메뉴 + 설정) · **배지 = 사이드바 «확인 필요» + Q Talk 안읽음** (이미 있는 두 원천을 더하기만 — 새 공식 금지). 메인 창이 `setBadge(n)`.
5. **알림 — 서버 변경 0.** OS 알림을 쏘는 곳은 `NotificationToaster` 가 «카드를 띄우기로 결정한 지점» 하나. 보고 있으면(`visible && hasFocus`) 카드만, 아니면 `planqDesktop.notify`. **메인 창만 쏜다**(팝아웃도 같은 소켓 이벤트를 받는다) + main 이 id 로 60초 중복 차단. 클릭 → 메인 창 보이기 → `openNotificationTarget(link)`. 메인 창 `backgroundThrottling:false`. 끊긴 동안 온 알림은 다시 오지 않는다(기존 `socket:reconnected` → silentLoad, 배지가 보완). 설정의 «알림 켜기» 는 데스크탑에서 «앱이 켜져 있을 때 알림이 옵니다» + OS 알림 설정 열기.
6. **서비스워커·웹 푸시 안 함** — `main.tsx` 등록·`bindPermissionSync` 를 `!isNativeApp() && !isDesktopApp()`. `services/push.ts` 는 Electron 에서 `isSupported()` 가 거짓 참이므로 맨 앞에서 `{ok:false, reason:'desktop_app'}`(조용히 실패 금지 — 위 5 의 문구).
7. **로그인** — 정본 = 짝 맞추기(pair/start → 시스템 브라우저 → pair/status → 6자리 → `/google/claim` body `client_kind:'desktop'`). 가속 = `planq://` 프로토콜 등록 → 기존 `sendNativeReturn` 페이지가 앱을 깨움 → `/google/native-exchange`(`client_kind:'desktop'`). **새 서버 라우트 0.** 애플도 같은 두 길. `services/oauth.ts` 는 `openSystemBrowser(url)` 헬퍼로 Capacitor/데스크탑을 감싼다. 결제 복귀 `openExternalUrl` 도 데스크탑 분기. 로그인 버튼이 **먼저** 분기한다(창 안 accounts.google.com 은 탐색 잠금이 막는다 — «아무 일 없음» 금지).
8. **자동 업데이트를 1단계에 넣는다** — 첫 설치본에 업데이터가 없으면 이후 모든 껍데기 수정을 전원이 손으로 재설치해야 한다(되돌리기 어려운 결정). generic provider `https://planq.kr/desktop/` · 실행 시 + 6시간마다 · 조용히 받아 종료 때 설치 · 트레이 «새 버전 설치». 맥은 서명 없이는 자동 업데이트 불가(Irene 할 일 ①). 게시 `desktop/scripts/publish.sh` — **웹 /배포와 분리**, 껍데기 버전이 바뀐 때만 Irene 지시로.
9. **다운로드 화면** — `platform_settings.app_windows_url`·`app_mac_url`(NULL 허용) · `routes/app_download.js` `windows_url`·`mac_url` · 관리자 설정 칸 · `DownloadAppPage` 데스크탑 블록에 «Windows 앱 / Mac 앱 받기» 를 PWA 설치 위에(없으면 숨김) · SmartScreen 안내 한 줄 · 데스크탑 앱 안이면 «이미 앱 안».
10. **회귀** — 기존 puppeteer 로 Electron 에 CDP 연결(xvfb · `--remote-debugging-port` · 첫 줄 `require('./lib/mem-slot')`). 테스트 훅 `__test` 는 `!app.isPackaged && PLANQ_DESKTOP_TEST==='1'` 일 때만 — 패키지 빌드에 없어야 한다.

## 4. 서버/DB 변경 (이것뿐)
1. `refresh_tokens.client_kind` ENUM + `'desktop'` (마이그레이션 1 · 멱등 · 배포 슬롯) + 읽는 곳 전수
2. `platform_settings` + `app_windows_url`·`app_mac_url` · `routes/app_download.js` · 관리자 설정 칸
3. 운영 nginx `/desktop/` → `/opt/planq/desktop-releases/` (Irene 할 일 — sudo)
새 auth 라우트·push·알림·CSP/CORS 변경 없음.

## 5. 보안 계약
- 모든 창 `contextIsolation:true · sandbox:true · nodeIntegration:false · webSecurity:true · webviewTag:false`. 메뉴바 숨김, 패키지 빌드 devtools 끔.
- **탐색 잠금**: `will-navigate`·`will-redirect`·`setWindowOpenHandler` 에서 `origin === APP_ORIGIN` 만 창 안. 그 외 `http(s):` 는 `shell.openExternal` 후 deny, 다른 스킴은 deny. `pq-*` 아닌 같은 출처 window.open 은 보통 창.
- **preload 표면 정확히**: `version · platform · setAlwaysOnTop(bool) · notify({id,title,body,link,urgent,tag}) · setBadge(n) · openExternal(url) · getAutoLaunch()/setAutoLaunch(bool) · onNotificationClick(cb) · onDeepLink(cb)`. 그 밖 노출 금지. main 은 모든 IPC 에서 `senderFrame.url` 출처 검사 · `setAlwaysOnTop` 은 보낸 창 자신에만 · 문자열 캡(제목 120·본문 500) · `openExternal` 은 http(s) 만 · `link` 는 상대경로 또는 APP_ORIGIN 만.
- 권한: APP_ORIGIN 의 `notifications`·`media`·`clipboard-read` 만 허용.
- **토큰**: main 은 토큰을 보지도 받지도 않는다. refresh 는 httpOnly 쿠키(기본 세션 디스크 영속).
- `planq://` 는 `oauth/native-return` 만 처리, 나머지는 버린다.

## 6. Irene 할 일 (구현을 막지 않음)
① 맥 Developer ID Application 인증서 + 공증(Team H2HW8BHXNW → codemagic 업로드) ② 운영 nginx `/desktop/` + `/opt/planq/desktop-releases/`(sudo) ③ (나중·선택) 윈도우 코드서명 ④ 실기기 확인(윈도우·맥 각 1).

## 7. 구현 순서
1 서버 ENUM `desktop` → 2 프론트 분기 뼈대(웹 회귀 0) → 3 껍데기(창·탐색 잠금·preload·트레이·단일 인스턴스·자동 실행) → 4 팝아웃·핀 → 5 알림·배지 → 6 로그인 두 길 → 7 Q Note 웹 회의 모드 가림(Electron 에서 `getDisplayMedia` 가 실패하는 버튼이 되지 않게) → 8 자동 업데이트·electron-builder(Windows NSIS wine · mac codemagic `desktop_mac`)·publish → 9 다운로드 화면·platform_settings → 10 e2e `desktop` · 규칙 `.claude/rules/desktop-app.md`.

## 8. 검증 설계
기계(e2e `desktop`): A 다중 고정(팝아웃 2개 각각 핀 → 둘 다 alwaysOnTop · 홀더 0 · 해제 false · **대조군** `isDesktopApp` 끈 빌드에서 PiP 경로로 들어감) · B 도구당 창 1개 · C 자리 기억(±8) · D 외부 링크 → openExternal 1건·창 불변 · E 알림 1회(숨김 상태 notify 정확히 1, 팝아웃 열린 채 · 보고 있으면 0 + 카드 1 · 같은 id 두 번 → 1) · F 로그인 claim → refresh `client_kind='desktop'` · `planq://` 둘째 인스턴스 주입 → native-exchange 200 · 재사용 401 · G 패키지 asar 에 `__test` 0건 · H 웹 회귀(build·guard·tenant·pushdeeplink·wssync · 브라우저 핀은 여전히 PiP) · I 서버(desktop 365일 · 잘못된 kind → web · 마이그레이션 멱등).
실기기(Irene): 설치 → 트레이 상주 → 닫아도 알림 → 팝아웃 3개 동시 항상 위 → 재시작 후 같은 자리 → 구글 로그인 복귀 → 배지 = 사이드바 두 숫자 합 → 웹 배포 뒤 재시작만으로 새 화면.

## 9. 리스크
PiP 코드 재진입(최대 — 분기를 맨 앞에 · A 대조군) · 알림 중복(메인 창 단일 발신 + LRU · E) · 맥 서명 없음(Gatekeeper·자동 업데이트 불가) · 윈도우 SmartScreen(안내 문구) · 메모리(빌드·시험은 자리표 안 · 사용자 PC 팝아웃 3개 ~400MB) · 세션 공유(WorkspaceSyncGuard 가 창마다 · wssync) · PWA 와 앱 동시 설치 시 알림 양쪽(다운로드 화면 안내 한 줄, 구조 해결은 후속).

Fable: design 1회(이 판정). 완료 뒤 gate 1회(로그인 경로·`client_kind` 운영 마이그레이션·공개 `/desktop/`).
