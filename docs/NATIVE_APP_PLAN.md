# PlanQ 네이티브 앱 계획서 (Capacitor 하이브리드)

> 작성: 2026-07-02 (Fable 검수 세션). **Opus 실행용 작업 지시서.**
> 결정 박제: 기존 React 코드 100% 재사용 + Capacitor 컨테이너 + APNs/FCM 네이티브 푸시.
> 순서: **iOS 먼저 (TestFlight 팀 배포) → Android**. 공개 스토어 등록은 마지막.
> 배경: iOS PWA 푸시가 기기 상태에 따라 표시가 불안정한 문제의 근본 해결 (memory: project_native_app_capacitor_plan).

---

## 0. 핵심 아키텍처 결정 (변경 금지)

### 0.1 Remote URL 방식 (server.url = 운영 도메인)

Capacitor 컨테이너가 **번들된 웹자산이 아니라 https://planq.kr 을 직접 로드**한다.

```ts
// capacitor.config.ts
{
  appId: 'kr.planq.app',
  appName: 'PlanQ',
  webDir: 'www-placeholder',   // 사용 안 함 (빈 index 1장)
  server: { url: 'https://planq.kr', cleartext: false }
}
```

**이유 (트레이드오프 검토 완료):**
- 웹 배포 = 앱 즉시 반영. 앱 심사 재제출 없이 기능 업데이트 (기존 /배포 흐름 그대로)
- **인증 쿠키 안전**: 오리진이 planq.kr 그대로라 HttpOnly refresh cookie·CORS 무변경. 번들 방식(capacitor://localhost)은 크로스 도메인 쿠키(SameSite) 문제로 인증 전면 재작업 필요 — 금지
- 오프라인 미지원은 감수 (PlanQ는 온라인 SaaS)
- Apple 4.2(웹뷰 래퍼) 리젝 위험은 네이티브 기능(푸시·배지·공유·딥링크)으로 상쇄 + 초기엔 TestFlight 내부 배포라 심사 없음

### 0.2 서버는 dev 먼저

개발 중 앱 빌드는 `server.url = https://dev.planq.kr` 로 두고 검증 → 팀 TestFlight 배포 시점에 planq.kr 빌드. scheme 별 config 분리 (`capacitor.config.dev.ts`).

### 0.3 네이티브 분기 원칙

프론트 코드에서 네이티브 전용 분기는 전부 아래 헬퍼 하나로:

```ts
// src/services/native.ts (신규)
import { Capacitor } from '@capacitor/core';
export const isNativeApp = () => Capacitor.isNativePlatform();
export const nativePlatform = () => Capacitor.getPlatform(); // 'ios' | 'android' | 'web'
```

기존 웹/PWA 동작은 **절대 회귀시키지 않는다** — 모든 분기는 `isNativeApp()` 일 때만 다른 길로.

---

## 1. Phase 0 — 사전 준비 (Irene 액션 포함)

| 항목 | 담당 | 내용 |
|------|------|------|
| Apple Developer Program | **Irene** | $99/년. 개인 가입이 빠름(즉시). 법인(워프로랩)은 DUNS 번호 필요해 1~2주 소요 — 스토어 공개 전까지 개인으로 시작해도 됨 (나중에 양도 가능하나 번거로움 — 처음부터 법인 권장하면 일정 지연과 트레이드) |
| **macOS + Xcode** | 확인 필요 | **iOS 빌드는 Mac 이 물리적으로 필요.** Mac 없으면: Codemagic(월 무료 500분, Mac mini CI) 또는 Ionic Appflow 로 클라우드 빌드. **Opus 는 이 서버(Linux)에서 Xcode 빌드 불가 — Capacitor 프로젝트 생성·웹 측 코드·백엔드까지만 하고, Xcode 빌드/서명/TestFlight 업로드는 Mac 또는 CI 에서** |
| APNs 인증 키 (.p8) | Irene (개발자 계정 생성 후) | Apple Developer → Keys → APNs key 생성. Key ID + Team ID + .p8 파일 → 서버 .env 로 |
| Android (나중) | Irene | Google Play Console $25 (1회). FCM 은 Firebase 프로젝트 필요 |

---

## 2. Phase 1 — Capacitor 셋업 (Opus, 이 서버에서 가능)

1. `dev-frontend` 에 Capacitor 추가:
   ```bash
   npm i @capacitor/core && npm i -D @capacitor/cli
   npx cap init PlanQ kr.planq.app
   npm i @capacitor/ios @capacitor/android @capacitor/push-notifications @capacitor/app @capacitor/browser @capacitor/badge @capacitor/keyboard @capacitor/status-bar @capacitor/share @capacitor/filesystem
   npx cap add ios && npx cap add android
   ```
2. `ios/` `android/` 디렉토리는 git 에 커밋 (네이티브 설정 추적)
3. capacitor.config: 위 0.1. splash/아이콘: 기존 PWA 아이콘 재사용 (`@capacitor/assets` 로 생성)
4. Info.plist 권한 문구 (ko/en):
   - `NSMicrophoneUsageDescription` — **Q Note 녹음 필수**
   - `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription` — 파일 첨부
5. Universal Links (딥링크): apple-app-site-association 파일을 planq.kr 루트에 서빙 (nginx) + Associated Domains. 기존 Smart Routing(App-First Deep Linking, docs/SMART_ROUTING_DESIGN.md)과 연결

## 3. Phase 2 — 네이티브 푸시 (APNs) ★ 이번 개발의 존재 이유

### 3.1 DB (dev 먼저, 운영은 배포 시 수동 ALTER)

`push_subscriptions` 테이블 확장 (웹 구독과 한 테이블 — 발송 파이프라인 재사용):
```sql
ALTER TABLE push_subscriptions
  ADD COLUMN kind ENUM('webpush','apns','fcm') NOT NULL DEFAULT 'webpush',
  ADD COLUMN device_token VARCHAR(255) NULL,
  ADD COLUMN device_name VARCHAR(100) NULL;
```
- apns/fcm 행은 endpoint/p256dh/auth 대신 device_token 사용
- **같은 host 좀비 규칙 재사용** (memory: feedback_push_same_host_zombie): 한 user × 한 kind('apns') = active 1개 (기기별로는 device_token 다름 — user×device_token unique)

### 3.2 백엔드

1. `npm i @parse/node-apn` (또는 apn 유지보수 포크). env: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8`(파일경로), `APNS_BUNDLE_ID=kr.planq.app`, `APNS_PRODUCTION=true|false`
2. `POST /api/push/subscribe-native` — body `{ kind:'apns'|'fcm', device_token, device_name }` + authenticateToken. 재등록 시 옛 row expired 마크 (기존 subscribe 패턴 복제)
3. `services/push_service.js` `sendPushToUser` 분기: kind='webpush' → 기존 web-push / kind='apns' → node-apn (alert+badge+sound, `apns-priority: 10`, topic=bundle id) / 'fcm' → Phase 4
   - **badge 값**: 기존 unread 통합 소스(`/me/unread-total-all`, memory: project_unread_unified_arch) 숫자를 payload 에 포함
   - PushLog 에 동일하게 기록 (kind 컬럼 활용) — 발송 검증은 기존과 동일한 PushLog 패턴
4. 실패 처리: APNs `410 Unregistered` → 해당 row expired 마크 (웹 좀비 정리와 동일 원칙)

### 3.3 프론트

`src/services/push.ts` 진입부 분기:
- `isNativeApp()` 이면: web-push/serviceWorker 구독 로직 전부 skip → `PushNotifications.requestPermissions()` → `register()` → `registration` 이벤트의 토큰을 `/api/push/subscribe-native` 로 전송
- `pushNotificationReceived`(포그라운드): 기존 인앱 토스터(NotificationToaster)와 중복되지 않게 **포그라운드에선 OS 알림 표시 안 함** (인앱 토스터가 이미 처리)
- `pushNotificationActionPerformed`(알림 탭): payload 의 link 로 SPA 네비게이트 (알림 링크는 상대경로 규칙 — memory: feedback_notify_link_must_match_route)
- `@capacitor/badge` 로 앱 아이콘 배지 동기화 (기존 OS badge 코드의 native 분기)

### 3.4 검증 시나리오 (기존 채팅·알림 4종 + 네이티브)

1. 앱 백그라운드 → 다른 유저 메시지 → **iOS OS 알림 도착** + PushLog kind='apns' status='sent'
2. 알림 탭 → 해당 대화방 딥링크 정확 진입
3. 앱 아이콘 배지 = 사이드바 unread 총합 일치
4. 같은 유저 웹(데스크탑) + 앱 동시 — 양쪽 모두 수신, 읽음 동기화
5. 앱 삭제 후 재설치 → 옛 토큰 410 → 자동 expired 정리

## 4. Phase 3 — 네이티브 UX 보정 (함정 목록)

| # | 함정 | 대응 |
|---|------|------|
| 1 | **Google OAuth가 WebView 차단** (`disallowed_useragent`) — Drive/Calendar/Gmail 연결·구글 로그인 전부 | OAuth 시작 시 `isNativeApp()` 이면 `@capacitor/browser` (SFSafariViewController)로 열기 + 콜백을 Universal Link 로 복귀. **네이티브에서 window.location.href 로 구글 OAuth 열면 무조건 실패** |
| 2 | Q Note 마이크 녹음 | WKWebView getUserMedia 는 iOS 14.3+ OK. Info.plist 문구 + 실기기 검증 필수 (시뮬레이터 마이크 불안정) |
| 3 | 파일 다운로드 (blob/a[download] 웹뷰 미동작) | 다운로드 버튼 native 분기 → `Filesystem.downloadFile` + `Share.share` 또는 `Browser.open` |
| 4 | 키보드 ↔ 채팅 입력란 | 기존 visualViewport offsetTop 보정(memory: feedback_mobile_chat_input_offsettop)이 WKWebView 에서 이중 적용될 수 있음 — Capacitor Keyboard `resize: 'native'` 로 두고 기존 보정을 native 에서 skip 하는 분기 검증 |
| 5 | PWA 잔재 | install 배너·SW 등록·"홈 화면에 추가" 안내 → `isNativeApp()` 이면 전부 숨김/skip. `isReloadSafe()` 자동 리로드 가드는 유지 (remote URL 이라 웹 배포 시 그대로 갱신됨) |
| 6 | safe-area | 이미 env(safe-area-inset-*) 적용돼 있음 — StatusBar 스타일만 지정 (dark text / 흰 배경) |
| 7 | 외부 링크 | target=_blank 가 웹뷰 안에서 열림 → Capacitor 가 기본으로 시스템 브라우저로 넘기는지 확인, 아니면 `Browser.open` 분기 |
| 8 | Socket.IO 백그라운드 | 네이티브도 백그라운드에서 소켓 끊김 — 기존 useVisibilityRefresh + 푸시 보완 패턴 그대로 (App plugin `appStateChange` 이벤트를 visibilitychange 에 브리지) |
| 9 | 세션 | remote URL 이라 쿠키·refresh 흐름 무변경. `detectClientKind()` 에 'native' 추가해 refresh TTL 365일(PWA 와 동일 취급) 적용 |
| 10 | 앱 버전 강제 업데이트 | 웹은 자동 배포되므로 불필요. 단 Capacitor 플러그인 추가/변경 시에만 앱 재배포 필요 — 플러그인 추가는 신중히 |

## 5. Phase 4 — Android

1. FCM: Firebase 프로젝트 생성(Irene) → google-services.json → `@capacitor/push-notifications` 가 FCM 자동 사용. 백엔드 fcm 분기는 `firebase-admin` 대신 **FCM HTTP v1 API 직접 호출** (서비스 계정 키 1개, 의존성 최소)
2. Android 특이사항: 알림 채널 생성 (importance high), 배터리 최적화 화이트리스트 안내, back 버튼 → SPA history back 브리지 (`App.addListener('backButton')`)
3. 검증: Phase 3.4 시나리오 Android 반복

## 6. Phase 5 — 스토어 공개 (팀 사용 안정화 후)

- **TestFlight**: 내부 테스터(팀)는 심사 없음 — 팀 사용은 여기까지로 충분. 외부 테스터 초대 시 간이 심사
- App Store 공개 심사 대비: 4.2 minimum functionality (네이티브 푸시·배지·공유·딥링크 명시), 심사용 데모 계정 제공 (test 계정 재사용 금지 — 심사 전용 워크스페이스 신설), 개인정보처리방침 URL (planq.kr/privacy), 계정 삭제 기능 노출 필수(iOS 규정 — 기존 GDPR export/삭제 흐름 연결)
- Google Play: 데이터 안전 섹션 작성, 타겟 API 레벨 최신 유지

## 7. 작업 순서 요약 (Opus 체크리스트)

- [ ] P1: Capacitor init + ios/android 프로젝트 생성 + config(dev) + 아이콘/스플래시 + Info.plist 권한 문구
- [ ] P2-DB: push_subscriptions ALTER (dev) — kind/device_token/device_name
- [ ] P2-BE: subscribe-native 라우트 + push_service APNs 분기 + PushLog kind + 410 정리 + .env 키 (Irene 이 .p8 제공 후)
- [ ] P2-FE: services/native.ts + push.ts native 분기 + 알림 탭 딥링크 + badge 동기화
- [ ] P3: OAuth Browser 분기(★최우선 함정) + 다운로드 분기 + PWA 잔재 숨김 + 키보드 검증 + detectClientKind 'native'
- [ ] Mac/CI: Xcode 서명 + TestFlight 업로드 (Mac 없으면 Codemagic 설정)
- [ ] 검증: 3.4 시나리오 5종 + 기존 채팅·알림 4종 (웹 회귀 0 확인 — isNativeApp 분기가 웹에 영향 없는지)
- [ ] P4: Android FCM
- [ ] 이후: 스토어 공개 준비

**웹 회귀 0 원칙: 모든 커밋에서 웹(planq.kr) 동작 무변경. native 분기 누락으로 웹 push 가 깨지는 것이 최대 리스크.**

## 8. Irene 결정/액션 대기 목록

1. Apple Developer Program 가입 (개인 vs 법인 — 개인 권장, 즉시 시작 가능)
2. Mac 보유 여부 → 없으면 Codemagic 계정 (무료 시작)
3. APNs .p8 키 발급 (가입 후 5분 작업, 절차 안내 가능)
4. 앱 이름/아이콘 확정 ("PlanQ", 기존 PWA 아이콘 그대로 시작 권장)
