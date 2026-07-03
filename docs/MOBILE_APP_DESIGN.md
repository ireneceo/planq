# PlanQ 모바일 네이티브 앱 설계서 (Capacitor 하이브리드)

> 작성: 2026-07-03 (Fable 기획설계). **Opus 실행용 상세 설계 — 코드 착수 전 필독.**
> 상위 계획: `docs/NATIVE_APP_PLAN.md` (2026-07-02 Fable 검수, Irene 결정 박제) — 본 문서는 그 계획을 실제 코드 근거(파일:라인) 위에서 상세화한 실행 설계. 두 문서가 충돌하면 본 문서가 우선.
> 배경: iOS 26/WebKit PWA web push 가 "APNs 201 + apns-id 수신인데 기기가 화면에 안 그림" — 설정·구독·코드 전부 정상인데 표시만 불안정 (2026-06 종일 진단, memory: `feedback_ios_push_presentation_device_state`). 근본 해결 = 네이티브 APNs.

---

## TL;DR

- **결정: Remote URL 방식** — Capacitor WebView 가 `https://planq.kr`(dev 검증은 `https://dev.planq.kr`)을 직접 로드. 전 코드가 상대경로(`fetch('/api/...')` AuthContext.tsx:166, `io(window.location.origin)` socket.ts:40, `wss://${window.location.host}/qnote/ws/live` qnote.ts:705) + HttpOnly refresh cookie(path=/api/auth) 라 **웹 코드 0 변경으로 인증·소켓·Q Note WS 전부 동작**. 번들 방식은 origin 이 `capacitor://localhost` 가 되어 인증 전면 재작업 — 금지.
- **푸시: `push_subscriptions` 에 `kind ENUM('webpush','apns','fcm') + device_token` 확장**, `sendPushToUser`(push_service.js:94) 가 kind 별 fan-out. APNs 는 **.p8 token 인증 + 자체 HTTP/2 sender(신규 의존성 0, jsonwebtoken 재사용)** 권장. notify 트리거·payload(`{title,body,link,tag,badge}`)·PushLog·410 정리 전부 기존 재사용.
- **Irene 승인 필요:** ① Apple Developer Program 가입($99/년, 최우선 — APNs·TestFlight 선행조건) ② 번들 ID `kr.planq.app` 확정 ③ dev 검증용 별도 앱(kr.planq.app.dev) 분리 여부 ④ Q Note 백그라운드 녹음 제약 수용 여부(§8.3).
- **Phase 0 착수물(Opus, 이 서버에서 즉시 가능):** dev-frontend 에 Capacitor init + ios/android 프로젝트 생성 + `src/services/native.ts` 헬퍼 + dev.planq.kr 로드 확인 준비 → Irene Mac Xcode 에서 첫 빌드.
- 최대 리스크: **웹 회귀 0 원칙** — 모든 분기는 `isNativeApp()` 일 때만. 웹/PWA/데스크탑 web push 는 현행 그대로 병행 유지.

---

## 1. 목표 / 비목표

### 목표
1. **iOS/Android 네이티브 앱에서 푸시 알림이 OS 레벨로 안정 표시** — PWA web push 의 WebKit 렌더 단계를 아예 안 거침 (APNs/FCM 직접).
2. 기존 React+Vite 웹앱 **95~100% 재사용** — Capacitor WebView 껍데기. UI·로직·화면 재작성 없음.
3. 웹 배포 흐름 유지 — `/배포` 로 웹 갱신하면 앱도 즉시 반영 (remote URL 방식의 본질 효과).
4. TestFlight 로 Irene+팀 즉시 사용 (심사 없음, 초대 링크) → 제품 완성 후 App Store 정식 공개.
5. 앱 아이콘 배지·딥링크·알림 탭 네비게이션 등 네이티브 UX.

### 비목표 (하지 않는 것)
- **웹앱 재작성 X** — 네이티브 UI(SwiftUI/Compose) 안 만듦.
- **PWA 제거 X** — 데스크탑/웹 사용자는 현행 web push + SW 그대로. `dev-frontend/public/sw.js`, `services/push.ts` 의 웹 경로는 무변경.
- **오프라인 지원 X** — PlanQ 는 온라인 SaaS. remote URL 방식의 오프라인 미지원은 감수 (네트워크 없음 화면만 처리, §6.7).
- **백엔드 알림 트리거 변경 X** — `notify`/`notifyMany`(routes/notifications.js:96,227) 호출부 0 변경. 발송 말단(push_service)만 확장.
- **결제(IAP) X** — 구독 결제는 웹에서만. 앱 안에서 결제 유도 UI 노출 금지(Apple 3.1.1 리젝 사유 — App Store 공개 단계에서 별도 검토).

---

## 2. 현행 구조 조사 결과 (설계 근거)

### 2.1 네트워크 계층 — 전부 same-origin 상대경로
| 계층 | 근거 | 시사점 |
|------|------|--------|
| REST API | `AuthContext.tsx:166` `fetch('/api/auth/refresh', {credentials:'include'})`, `:217 apiFetch` — 전 서비스가 상대경로 | API_BASE env 없음. 번들 방식이면 100+ 호출부 리팩토링 필요 |
| Socket.IO | `services/socket.ts:40` `io(window.location.origin, { auth: cb })` — 세션당 소켓 1개 모듈 | remote URL 이면 무변경 동작 |
| Q Note live WS | `services/qnote.ts:701-706` `wss://${window.location.host}/qnote/ws/live?...&token=` | 동일 |
| refresh cookie | `routes/auth.js` refresh 라우트 — `res.cookie('refresh_token', ..., {httpOnly, sameSite:'lax', path:'/api/auth'})` | same-origin 이면 WKWebView 쿠키 저장소에 그대로 영속 |
| CORS | `server.js:39` `ALLOWED_ORIGINS` env 화이트리스트, `middleware/security.js:207-214` | remote URL 이면 origin=planq.kr 그대로 → CORS 무변경 |

### 2.2 웹 푸시 현행 (병행 유지 대상)
- **구독:** `services/push.ts:83-149 subscribe()` — SW 등록 → VAPID 키 → PushManager.subscribe → `POST /api/push/subscribe`. 24h 자동 재구독(push.ts:41-50), 3일 수신 0 stale 감지(:55-66), focus 시 권한 동기화 `bindPermissionSync`(:286-304, main.tsx:22 에서 호출).
- **백엔드:** `routes/push.js:96-152` subscribe (p256dh≥80 검증 :105, endpoint 화이트리스트 :57-75, 같은 host 좀비 만료 :32-53), `:157` GET /me (desync 검사용), `:175` DELETE, `:196` /test (per-user 분당 5회).
- **발송:** `services/push_service.js:94-151 sendPushToUser(userId, {title,body,link,tag,badge}, {category})` — active sub 전체 loop, `TTL 86400 + urgency 'high'`(:115), 410/404 → row destroy(:132-137), 전 시도 PushLog 기록, 5분 3회 실패 → platform_admin 알림(:66-90).
- **모델:** `models/PushSubscription.js:8-35` — endpoint(unique, VARCHAR 500), p256dh/auth NOT NULL, user_agent, last_used_at, expired_at. `models/PushLog.js:10-35` — status ENUM(sent/expired/failed/skipped), status_code, category, payload_title.
- **SW:** `public/sw.js:83-183` push 핸들러(showNotification + badge + ack), `:197-247` notificationclick(link 네비게이트). **WKWebView 는 Service Worker 미지원** → 네이티브 앱에서 `'serviceWorker' in navigator === false` → main.tsx:12 가드로 자동 skip (웹 푸시 경로가 네이티브에서 자연 비활성 — 회귀 위험 낮음).

### 2.3 알림 트리거 (재사용, 무변경)
`routes/notifications.js:96-224 notify()` — inbox(Notification row + socket `notification:new`) / email / push 3채널, `isAllowed`(:68-81) prefs 검사 후 `sendPushToUser` 호출(:211-217). badge 값은 채팅 unread + 인박스 합산(:173-209). link 는 `normalizeLink/buildLink` 로 상대경로 정규화(:105-107). **네이티브 푸시는 이 함수의 말단(push_service)만 갈아끼우므로 트리거 · 내용 · prefs · badge 계산 전부 동일.**

### 2.4 인증/세션
- Access token 은 **메모리에만**(AuthContext.tsx:102), refresh 는 HttpOnly cookie. 15m access / rotation refresh.
- `detectClientKind()`(AuthContext.tsx:107-117) — standalone 이면 'pwa'. login/register/refresh 에 header `X-Client-Kind` + body 로 전달(:164-170, :421-426).
- 백엔드 `routes/auth.js:24-41` — `TTL_MS_BY_KIND {pwa: 365d, web: 30d}`, `resolveClientKind` 는 'pwa'|'web' 만 인정. refresh rotate 시 옛 row 의 kind 상속(:635-637). `models/RefreshToken.js:36-39` — `client_kind ENUM('pwa','web')`.

### 2.5 Q Note 녹음 (리스크 영역)
- `services/audio/MicrophoneCapture.ts:16-20` — `navigator.mediaDevices.getUserMedia({audio})` (모노 16kHz). `qnoteLive.ts:100-115` — 캡처 → WebSocket 바이너리 스트리밍.
- `WebConferenceCapture.ts:47-69` — `getDisplayMedia` 탭 오디오 (Chrome/Edge 데스크탑 전용 주석 명시) → **모바일 앱 스코프 밖** (WKWebView getDisplayMedia 미지원, 원래도 데스크탑 기능).

### 2.6 빌드/PWA
- `vite.config.ts:78` outDir `../dev-frontend-build` (nginx 서빙). BUILD_ID + version.json(:8-20).
- `BuildVersionGuard.tsx` — `/api/build-version` 5분 폴링 → 새 빌드 시 SW update + safe reload. **remote URL 앱에서도 그대로 동작** (웹 배포 = 앱 자동 갱신의 실체).
- `manifest.json` — share_target POST(/share-receive, SW fetch 핸들러 sw.js:38-81 처리) → **네이티브에서 미동작** (SW 없음). 네이티브 공유 수신은 후순위(§11 미결정).
- `index.html:13` — `viewport-fit=cover` 이미 적용, safe-area CSS 기존재.
- main.tsx:28-76 — visualViewport 키보드 보정 (§6.4 에서 WKWebView 이중 적용 검증 필요).

---

## 3. 아키텍처 결정

### 3.1 Remote URL 방식 (확정 — NATIVE_APP_PLAN §0.1 동일)

```ts
// dev-frontend/capacitor.config.ts
import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'kr.planq.app',
  appName: 'PlanQ',
  webDir: 'www-placeholder',          // 미사용 — 오프라인 fallback index 1장만
  server: {
    url: process.env.CAP_SERVER_URL || 'https://planq.kr',  // dev 빌드: https://dev.planq.kr
    cleartext: false,
  },
  ios: { contentInset: 'automatic' },
  plugins: {
    PushNotifications: { presentationOptions: [] },  // 포그라운드 OS 알림 억제 — 인앱 토스터가 담당 (§5.4)
    Keyboard: { resize: 'native' },                  // §6.4
  },
};
export default config;
```

**근거 (bundled 대비):**

| 관점 | Remote URL (채택) | Bundled 정적자산 (기각) |
|------|------|------|
| 인증 | origin=planq.kr 그대로 — HttpOnly refresh cookie·CORS **0 변경** (§2.1) | origin=`capacitor://localhost` — cookie SameSite/cross-origin 재작업, CORS·소켓·WS 전면 수정 |
| 코드 재사용 | `/api` 상대경로 100+ 호출부 무변경 | API_BASE 도입 전면 리팩토링 |
| 업데이트 배포 | 웹 `/배포` = 앱 즉시 반영. 앱 재제출은 플러그인 변경 시만 | 기능 배포마다 스토어 재제출 (또는 CodePush 류 추가 인프라) |
| 오프라인 | 미지원 (감수 — 온라인 SaaS) | 셸 오프라인 가능 (그러나 데이터는 어차피 온라인) |
| 심사 | 4.2(웹뷰 래퍼) 리스크 존재 — 네이티브 푸시·배지·딥링크로 상쇄. TestFlight 내부 배포는 심사 없음 | 심사 유리하나 위 비용이 압도 |

> Capacitor 는 `server.url` 설정 시 네이티브 브리지를 remote 페이지에 주입한다 (공식 live-reload 개발 흐름과 동일 메커니즘). 따라서 remote 로드 상태에서도 `@capacitor/push-notifications` 등 플러그인 JS API 호출 가능. **미확인/검증필요:** Capacitor 8.x 에서 remote URL 브리지 주입의 allowNavigation 요건 — Phase 0 에서 실기기로 `Capacitor.isNativePlatform() === true` 를 최우선 확인한다.

### 3.2 웹/앱 동일코드 유지 전략

- 네이티브 분기는 **단일 헬퍼 경유** (직접 `Capacitor.` 호출 금지):
```ts
// dev-frontend/src/services/native.ts (신규)
import { Capacitor } from '@capacitor/core';
export const isNativeApp = (): boolean => Capacitor.isNativePlatform();
export const nativePlatform = (): 'ios' | 'android' | 'web' => Capacitor.getPlatform() as never;
```
- `@capacitor/core` 는 웹 번들에 포함되어도 무해 (native 아니면 no-op, ~10KB). vite manualChunks 에 vendor 분리 불필요.
- **웹 회귀 0 원칙:** 모든 커밋에서 planq.kr 웹 동작 무변경. 분기는 항상 `if (isNativeApp())` 쪽이 새 길, else 가 기존 코드 그대로.
- 웹 빌드는 지금처럼 `npm run build` → dev-frontend-build. Capacitor 는 웹 빌드 산출물을 쓰지 않으므로(remote) `npx cap sync` 는 플러그인/네이티브 설정 변경 시에만.

### 3.3 dev / 운영 앱 분리

- **채택(기본):** 단일 appId `kr.planq.app`. 개발 중엔 `capacitor.config.dev.ts`(server.url=dev.planq.kr) 로 Xcode 직접 설치(= APNs **sandbox** 환경, dev backend `APNS_PRODUCTION=false`) → TestFlight 배포 시 운영 config(planq.kr) 빌드(TestFlight = APNs **production**, 운영 backend `APNS_PRODUCTION=true`). .p8 키 1개가 sandbox/production 양쪽 커버.
- config 전환은 빌드 스크립트로: `CAP_SERVER_URL=https://dev.planq.kr npx cap sync ios` (package.json scripts `cap:sync:dev` / `cap:sync:prod` 추가).
- 한 기기에 dev·운영 앱 동시 설치가 필요해지면 `kr.planq.app.dev` 별도 번들 분리 (APNs 키는 Team 단위라 재사용, provisioning 만 추가) — **Irene 결정 대기(§11)**.

---

## 4. 디렉터리 / 파일 변화

```
dev-frontend/
├── capacitor.config.ts          # 신규 — 운영 (planq.kr)
├── capacitor.config.dev.ts      # 신규 — dev (dev.planq.kr) ※ 또는 CAP_SERVER_URL env 단일 config
├── www-placeholder/index.html   # 신규 — 네트워크 없음 안내 1장 (webDir 형식 요건)
├── ios/                         # 신규 — npx cap add ios (git 커밋: 네이티브 설정 추적)
│   └── App/App/Info.plist       # 권한 문구·Associated Domains·WKAppBoundDomains
├── android/                     # 신규 — npx cap add android
├── src/services/native.ts       # 신규 — isNativeApp 헬퍼 (§3.2)
├── src/services/nativePush.ts   # 신규 — APNs/FCM 토큰 등록 + 알림 탭 라우팅 (§5.4)
└── src/services/push.ts         # 수정 — 진입부 native 분기 (§5.4)

dev-backend/
├── services/push_service.js     # 수정 — kind 별 fan-out (§5.3)
├── services/apns_sender.js      # 신규 — HTTP/2 + p8 JWT (§5.2)
├── services/fcm_sender.js       # 신규 — FCM HTTP v1 (Phase 5)
├── routes/push.js               # 수정 — POST /subscribe-native 추가 (§5.3)
├── models/PushSubscription.js   # 수정 — kind/device_token/device_name 컬럼 (§5.1)
├── models/RefreshToken.js       # 수정 — client_kind ENUM 확장 (§7.1)
└── routes/auth.js               # 수정 — resolveClientKind/TTL 확장 (§7.1)

nginx (dev + 운영):
└── /.well-known/apple-app-site-association   # 신규 — Universal Links (§7.2)
```

- Capacitor npm 패키지는 dev-frontend/package.json 에 추가 (`@capacitor/core` dependencies, `@capacitor/cli` devDependencies, 플러그인들 dependencies). 웹 빌드 영향: core import 만 (§3.2).
- `ios/`, `android/` 는 git 커밋. 단 `ios/App/Pods/`, `android/.gradle/` 등 생성물은 Capacitor 기본 .gitignore 준수.

---

## 5. 푸시 설계 (핵심)

### 5.1 DB — push_subscriptions 확장 (멱등 ALTER)

> `sync-database.js` alter 는 "Too many keys" 함정 (memory: `feedback_sync_alter_too_many_keys`) — dev·운영 모두 **수동 ALTER** 로 적용. 아래는 idempotent 실행 가이드 (컬럼 존재 검사 후 실행하는 `scripts/migrate-push-native.js` 로 작성 권장).

```sql
ALTER TABLE push_subscriptions
  ADD COLUMN kind ENUM('webpush','apns','fcm') NOT NULL DEFAULT 'webpush' AFTER business_id,
  ADD COLUMN device_token VARCHAR(255) NULL AFTER auth,
  ADD COLUMN device_name VARCHAR(100) NULL AFTER user_agent,
  MODIFY p256dh VARCHAR(200) NULL,
  MODIFY auth VARCHAR(100) NULL;
-- 신규 인덱스는 1개만 (64키 한도 여유 확인 후):
ALTER TABLE push_subscriptions ADD INDEX push_subscriptions_kind_user (kind, user_id);
```

- 기존 row 는 DEFAULT 'webpush' 로 자동 커버 — 백필 불필요.
- **네이티브 row 의 endpoint 규약:** `endpoint = 'apns:<device_token>'` / `'fcm:<device_token>'` 로 저장. 이유:
  1. endpoint NOT NULL + unique(모델 :33) 제약을 그대로 활용 → 같은 토큰 중복 row 원천 차단 (스키마 변경 최소).
  2. `expireSameHostZombies`(routes/push.js:29-31) 의 `new URL()` 파싱이 비-URL 에서 null 반환 → 웹 좀비 로직이 네이티브 row 를 건드리지 않음 (자연 격리).
  3. `GET /api/push/me`(routes/push.js:157-172) 의 endpoint 목록에 섞여도 웹 desync 검사(push.ts:178-194 `list.includes(browserEndpoint)`)는 포함 여부만 보므로 무해.
- 모델 수정: `PushSubscription.init` 에 kind/device_token/device_name 추가, p256dh/auth `allowNull: true` 로.
- PushLog 는 **스키마 변경 없음** — 기존 `endpoint_host` 컬럼에 'apns'/'fcm' 기록, `status_code` 에 APNs/FCM HTTP status. (kind 전용 컬럼은 불필요 — endpoint_host 로 구분 조회 가능: `SELECT ... WHERE endpoint_host='apns'`.)

### 5.2 APNs 발송 구현 — 옵션 비교 + 추천

**인증 방식: .p8 token-based (확정 추천)** vs 인증서(.p12):

| | .p8 token auth (추천) | 인증서 (.p12) |
|---|---|---|
| 만료 | 없음 (revoke 전까지 영구) | 1년마다 갱신 (운영 사고 단골) |
| 환경 | 키 1개로 sandbox+production 모두 | 환경별 별도 인증서 |
| 앱 | Team 내 전 앱 공용 | 앱(topic)별 |
| 구현 | ES256 JWT (jsonwebtoken 이미 있음 — dev-backend/package.json:25) | TLS client cert |

**전송 구현:**

| | 자체 HTTP/2 sender (추천) | @parse/node-apn |
|---|---|---|
| 의존성 | **0 신규** — node:http2 + jsonwebtoken(기존) | 패키지 + 하위 deps |
| 유지보수 | ~120줄, 프로젝트 통제 하 | node-apn 계열은 유지보수 이력 불안정 (포크 전전) |
| 프로젝트 정합 | FCM 을 HTTP v1 직접 호출로 정한 결정(NATIVE_APP_PLAN §5.1)과 동일 노선 | — |

```js
// dev-backend/services/apns_sender.js (신규) — 스케치
const http2 = require('http2');
const fs = require('fs');
const jwt = require('jsonwebtoken');

const HOST_PROD = 'https://api.push.apple.com';
const HOST_SANDBOX = 'https://api.sandbox.push.apple.com';
// env: APNS_KEY_ID / APNS_TEAM_ID / APNS_KEY_P8_PATH / APNS_BUNDLE_ID / APNS_PRODUCTION ('true'|'false')

let cachedJwt = { token: null, iat: 0 };
function providerToken() {
  // APNs 규정: JWT 20분~60분 유효. 50분 캐시 후 재발급.
  if (cachedJwt.token && Date.now() - cachedJwt.iat < 50 * 60 * 1000) return cachedJwt.token;
  const key = fs.readFileSync(process.env.APNS_KEY_P8_PATH, 'utf8');
  const token = jwt.sign({}, key, {
    algorithm: 'ES256',
    issuer: process.env.APNS_TEAM_ID,
    keyid: process.env.APNS_KEY_ID,
    // jsonwebtoken 이 iat 자동 포함
  });
  cachedJwt = { token, iat: Date.now() };
  return token;
}

// payload: 기존 sendPushToUser 의 {title, body, link, tag, badge}
// return: { ok, status, reason } — 410 = Unregistered (row 정리 신호)
async function sendApns(deviceToken, payload) {
  const body = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
      ...(typeof payload.badge === 'number' ? { badge: payload.badge } : {}),
      ...(payload.tag ? { 'thread-id': String(payload.tag) } : {}),  // 알림 그룹핑 = 기존 tag 의미 보존
    },
    link: payload.link || '/',   // custom key — 앱의 pushNotificationActionPerformed 가 읽음
  });
  const host = process.env.APNS_PRODUCTION === 'true' ? HOST_PROD : HOST_SANDBOX;
  // http2 연결은 keep-alive 재사용 (연결 풀 1개, goaway 시 재생성) — 스케치 생략
  // headers:
  //   ':method': 'POST', ':path': `/3/device/${deviceToken}`
  //   authorization: `bearer ${providerToken()}`
  //   'apns-topic': process.env.APNS_BUNDLE_ID
  //   'apns-push-type': 'alert', 'apns-priority': '10'
  //   'apns-expiration': String(Math.floor(Date.now()/1000) + 86400)   // 기존 TTL 1일 정책 미러 (push_service.js:22)
  //   'apns-collapse-id': payload.tag ? String(payload.tag).slice(0,64) : undefined
}
module.exports = { sendApns };
```

- **HTTP/2 연결 재사용 필수** — 매 발송 새 연결은 APNs 가 rate-limit 함. 모듈 레벨 client 1개 + `close`/`goaway`/`error` 시 재생성.
- 실패 응답 매핑: `410 (reason: Unregistered)` → row expired 처리 (§5.3). `403 InvalidProviderToken` → JWT 캐시 무효화 후 1회 재시도. 그 외 → PushLog 'failed' + 기존 `maybeAlertOnFailure`(push_service.js:66) 재사용.

**FCM (Phase 5):** `firebase-admin` 대신 **FCM HTTP v1 직접 호출** — 서비스 계정 JSON 1개, `jsonwebtoken` RS256 으로 OAuth2 access token 발급(scope `https://www.googleapis.com/auth/firebase.messaging`, 55분 캐시) → `POST https://fcm.googleapis.com/v1/projects/{PROJECT_ID}/messages:send` body `{message: {token, notification: {title, body}, data: {link}, android: {priority: 'high', notification: {channel_id: 'planq_default'}}}}`. `404/UNREGISTERED` → row expired.

### 5.3 백엔드 — 구독 라우트 + fan-out

**신규 라우트** (routes/push.js 에 추가):

```js
// POST /api/push/subscribe-native  body: { kind:'apns'|'fcm', device_token, device_name? }
router.post('/subscribe-native', authenticateToken, async (req, res, next) => {
  try {
    const { kind, device_token, device_name } = req.body || {};
    if (!['apns', 'fcm'].includes(kind)) return errorResponse(res, 'invalid_kind', 400);
    // 토큰 형식 검증 — 외부 발송 입력 검증 표준 (운영 안정성 규칙 8)
    //   APNs: 64+ hex, FCM: 100+ chars. 깨진 토큰 DB 저장 = 발송 silent fail.
    if (kind === 'apns' && !/^[0-9a-fA-F]{64,200}$/.test(String(device_token || ''))) {
      return errorResponse(res, 'invalid_device_token', 400);
    }
    if (kind === 'fcm' && String(device_token || '').length < 100) {
      return errorResponse(res, 'invalid_device_token', 400);
    }
    const endpoint = `${kind}:${device_token}`;           // §5.1 규약 (unique 재활용)
    const existing = await PushSubscription.findOne({ where: { endpoint } });
    if (existing) {
      if (existing.user_id === req.user.id) {
        await existing.update({
          business_id: req.user.active_business_id || existing.business_id || null,
          device_name: device_name || existing.device_name,
          expired_at: null, last_used_at: new Date(),
        });
        return successResponse(res, { id: existing.id, updated: true });
      }
      // 다른 user 재등록(기기 양도) — 기존 웹 패턴 그대로 (routes/push.js:133-139)
      await existing.update({ endpoint: `expired:${existing.id}:${existing.endpoint}`.slice(0, 500), expired_at: new Date() });
    }
    const row = await PushSubscription.create({
      user_id: req.user.id, business_id: req.user.active_business_id || null,
      kind, endpoint, device_token,
      device_name: (device_name || '').slice(0, 100) || null,
      user_agent: (req.headers['user-agent'] || '').slice(0, 500) || null,
      last_used_at: new Date(),
    });
    // 좀비 정책 (네이티브 버전): 같은 user × 같은 kind × 같은 device_name 의 다른 active row 만료.
    //   iOS 재설치 시 새 토큰 발급 — 옛 토큰 row 는 APNs 410 이 1차 정리하지만, 발송 전 선제 정리.
    //   device_name 이 없으면 skip (다기기 사용자 보호 — iPhone+iPad 동시 active 허용).
    // ... expireNativeSiblings(req.user.id, kind, device_name, row.id)
    return successResponse(res, { id: row.id, created: true }, 'subscribed', 201);
  } catch (e) { next(e); }
});
```

**sendPushToUser fan-out 분기** (push_service.js:117 loop 내부):

```js
for (const s of subs) {
  try {
    if (s.kind === 'apns') {
      const r = await sendApns(s.device_token, payload);          // §5.2
      if (r.status === 410) { /* PushLog 'expired' + s.destroy() — 웹 410 정리와 동일 (:132-137) */ }
      else if (!r.ok) { /* PushLog 'failed' + maybeAlertOnFailure */ }
      else { /* last_used_at 갱신 + PushLog 'sent' status_code 200, endpoint_host 'apns' */ }
      continue;
    }
    if (s.kind === 'fcm') { /* sendFcm — 동일 패턴, UNREGISTERED → destroy */ continue; }
    // 기존 webpush 경로 그대로 (무변경)
    await webpush.sendNotification({ endpoint: s.endpoint, keys: {...} }, json, sendOpts);
    ...
```

- `ensureInit()`(VAPID 검사 :34-44) 가드는 **webpush 분기 안으로 이동** — VAPID 미설정이어도 APNs 발송은 가능해야 함 (운영 초기 네이티브 only 시나리오). APNs env 미설정 시 apns 분기가 `skipped('no_apns_key')` PushLog — 기존 `no_vapid` 패턴(:97) 미러.
- **payload·트리거·prefs·badge 계산 0 변경** — notify()(§2.3) 가 주는 `{title, body, link, tag, badge}` 를 kind 별 포맷으로 변환만.
- 검증은 기존 PushLog 패턴 그대로: node test 스크립트 login → 메시지 POST → sleep 3s → `SELECT FROM push_logs WHERE endpoint_host='apns' AND status='sent'` (운영 안정성 규칙 13).

### 5.4 프론트 — 런타임 분기

**진입 분기 (services/push.ts 수정, 4곳):**

```ts
// push.ts 상단
import { isNativeApp } from './native';
import * as nativePush from './nativePush';

export async function autoSubscribeIfPossible() {
  if (isNativeApp()) return nativePush.registerNative();     // ← 신규 분기
  // ... 기존 웹 경로 그대로 (:209-252)
}
// subscribe() / syncPermissionOnFocus() / bindPermissionSync() 진입부도 동일 가드.
// unsubscribe(): isNativeApp() 이면 저장된 device_token 으로 DELETE /api/push/subscribe-native.
```

```ts
// dev-frontend/src/services/nativePush.ts (신규) — 스케치
import { PushNotifications } from '@capacitor/push-notifications';
import { Device } from '@capacitor/device';
import { apiFetch, getAccessToken } from '../contexts/AuthContext';
import { nativePlatform } from './native';

let bound = false;
export async function registerNative(): Promise<{ ok: boolean; reason?: string }> {
  if (!getAccessToken()) return { ok: false, reason: 'not_authenticated' };  // push.ts:85 패턴 미러
  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === 'prompt') perm = await PushNotifications.requestPermissions();
  if (perm.receive !== 'granted') return { ok: false, reason: 'permission_denied' };

  if (!bound) {
    bound = true;
    PushNotifications.addListener('registration', async (token) => {
      const info = await Device.getInfo().catch(() => null);
      await apiFetch('/api/push/subscribe-native', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: nativePlatform() === 'ios' ? 'apns' : 'fcm',
          device_token: token.value,
          device_name: info ? `${info.manufacturer ?? ''} ${info.model}`.trim() : undefined,
        }),
      });
    });
    PushNotifications.addListener('registrationError', (e) => console.error('[nativePush] reg error', e));
    // 포그라운드 도착 — OS 알림 표시 안 함 (config presentationOptions: [], §3.1).
    //   인앱은 기존 NotificationToaster 가 socket 'notification:new' 로 이미 처리 — 중복 방지.
    PushNotifications.addListener('pushNotificationReceived', () => { /* no-op (토스터 담당) */ });
    // 알림 탭 — payload custom key 'link' (상대경로, §5.2) 로 SPA 네비게이트.
    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      const link = (action.notification.data?.link as string) || '/';
      // App.tsx 에 등록된 nav 브리지 사용 (window CustomEvent 'planq:navigate' — §7.2 와 공용)
      window.dispatchEvent(new CustomEvent('planq:navigate', { detail: { path: link } }));
    });
  }
  await PushNotifications.register();   // → registration 이벤트로 토큰 수신
  return { ok: true };
}
```

- **토큰 신선도:** iOS 는 앱 실행마다 `register()` 호출이 안전 (토큰 변동 시 registration 이벤트 재발화 → subscribe-native 가 upsert). 웹의 24h 재구독(push.ts:41-50)에 해당하는 별도 로직 불필요.
- **알림 링크 검증:** link 는 상대경로 + App.tsx Route 실존 대조 (memory: `feedback_notify_link_must_match_route`) — 기존 normalizeLink 파이프 재사용이라 신규 검증 불필요.
- **배지:** `useGlobalBadge`(hooks/useGlobalBadge.ts) 의 `applyBadge` 가 `navigator.setAppBadge` 사용 — WebView 미지원. native 분기 추가: `if (isNativeApp()) Badge.set({count})` (`@capacitor/badge`). 백그라운드/종료 상태는 APNs `aps.badge` 필드(§5.2)가 OS 가 직접 세팅 — SW badge race(sw.js:147-170 주석) 문제가 네이티브에선 구조적으로 해소.
- **isPushSupported()**(push.ts:19-21): 네이티브 WebView 에선 SW 부재로 자연 false → 웹 경로 이중 차단. `isStandalonePWA`/`isIOS` 기반 홈화면 안내 배너(PushPromptBanner/InstallPromptBanner/PwaInstallBanner/OpenInAppBanner)는 `isNativeApp()` 이면 렌더 skip (§6.6).

### 5.5 검증 시나리오 (Phase 3 게이트 — 기존 채팅·알림 4종 + 네이티브 5종)

1. 앱 **백그라운드** → 타 유저 메시지 → iOS OS 알림 표시 + `PushLog endpoint_host='apns' status='sent'`.
2. 앱 **완전 종료(스와이프 킬)** → 메시지 → OS 알림 표시 (PWA 대비 핵심 개선점 — 반드시 별도 확인).
3. 알림 탭 → 해당 대화방 딥링크 정확 진입 (`?task=` 등 URL 싱크 포함).
4. 앱 아이콘 배지 = notify badge 계산값(notifications.js:173-209) 일치, 앱 열고 읽으면 감소.
5. 같은 유저 데스크탑 웹 + 앱 동시 — 양쪽 수신, 한쪽 읽음 → 다른 쪽 배지 동기(user:N room).
6. 앱 삭제 → 재설치 → 옛 토큰으로 발송 시 410 → row 자동 destroy 확인 (PushLog 'expired').
7. **웹 회귀 0:** 데스크탑 Chrome web push 4 시나리오 (memory: `feedback_chat_notification_verification`) 전부 재통과.

---

## 6. 네이티브 통합 세부

### 6.1 iOS 권한 문구 (Info.plist — Phase 0 에서 추가)
```xml
<key>NSMicrophoneUsageDescription</key>
<string>Q Note 회의 녹음과 실시간 자막에 마이크를 사용합니다.</string>
<key>NSCameraUsageDescription</key>
<string>파일 첨부 시 사진 촬영에 카메라를 사용합니다.</string>
<key>NSPhotoLibraryUsageDescription</key>
<string>파일 첨부 시 사진 선택에 사진 보관함을 사용합니다.</string>
```
(en 은 InfoPlist.strings 로 병기 — i18n 원칙.)

### 6.2 상태바 / 세이프에어리어 / 스플래시 / 아이콘
- `index.html:13` viewport-fit=cover + 기존 `env(safe-area-inset-*)` CSS 그대로 → **추가 작업은 StatusBar 스타일만**: `StatusBar.setStyle({ style: Style.Light })` (흰 배경 + 어두운 글자), Android `setBackgroundColor('#FFFFFF')`.
- 아이콘/스플래시: 기존 PWA `icon-512.png`(public/) 원본으로 `@capacitor/assets` 생성 (`npx capacitor-assets generate`). 스플래시 = 흰 배경 + planQ_color.svg 렌더 PNG.

### 6.3 파일 업로드 / 다운로드 / 카메라
- **업로드:** `<input type="file">` 은 WKWebView/Android WebView 에서 네이티브 픽커(카메라 포함)로 동작 — 무변경. Android 는 MainActivity 의 file chooser 를 Capacitor 가 처리(기본 내장).
- **다운로드(함정):** blob URL + `a[download]` 는 WebView 미동작 (services/files.ts, invoices.ts, export.ts, docs.ts, posts.ts, qnote.ts, csvUtils.ts 등 8곳 — §2 grep). 공통 다운로드 헬퍼 1개 신설(`src/utils/download.ts`) 후 8곳 교체: 웹 = 기존 a[download], native = `Filesystem.writeFile(Directory.Cache)` → `Share.share({url})` (iOS 공유시트 = 파일 저장/공유 겸용). 서버 URL 직다운로드는 `Browser.open` 대안.

### 6.4 키보드 ↔ 채팅 입력란 (검증필요 ★)
- main.tsx:28-76 의 visualViewport `--vvh` + phantom scroll 보정(scrollTo(0,0))은 **iOS Safari/PWA 실측 기반**. WKWebView + Capacitor Keyboard `resize:'native'` 조합에서 이중 보정 가능성 — Phase 0 검증 항목:
  1. `resize:'native'`(WebView 프레임 리사이즈)로 두고 기존 로직이 그대로 정상인지 실기기 확인 (visualViewport 이벤트는 WKWebView 에서도 발화).
  2. 어긋나면 `isNativeApp()` 분기로 phantom-scroll 보정(:46-48)만 skip.
- 판정 기준: 채팅 입력란 focus 시 입력란이 키보드 위에 정확히 붙고, blur 시 원복, 위로 밀림/흰 여백 0 (memory: `feedback_mobile_chat_input_offsettop` 재발 방지).

### 6.5 백그라운드 소켓 / 실시간
- 네이티브도 백그라운드 진입 시 WebView JS suspend → 소켓 끊김. **기존 안전망 그대로 유효**: socket.ts:56-61 재연결 시 room 재join + `useVisibilityRefresh` server-fresh 복원 (운영 안정성 규칙 9·16).
- 보강 1건: `@capacitor/app` 의 `appStateChange` → `document` visibilitychange 로 브리지 (WKWebView 에서 visibilitychange 발화가 OS 버전별로 불안정한 케이스 대비 — 미확인/실기기 검증):
```ts
App.addListener('appStateChange', ({ isActive }) => {
  if (isActive) document.dispatchEvent(new Event('visibilitychange'));  // 기존 훅들이 그대로 반응
});
```
- 놓친 이벤트는 푸시(APNs)가 보완 — PWA 대비 오히려 개선.

### 6.6 PWA 잔재 숨김 (native 분기)
| 대상 | 처리 |
|------|------|
| `PwaInstallBanner` / `InstallPromptBanner` / `OpenInAppBanner` / `PushPromptBanner`(웹 push 안내) | 컴포넌트 최상단 `if (isNativeApp()) return null` |
| main.tsx:12-19 SW 등록 | WKWebView 는 `'serviceWorker' in navigator` false → 자연 skip. Android WebView 는 SW 지원 가능 — **명시 가드 추가**: `if (!isNativeApp() && 'serviceWorker' in navigator)` |
| `BuildVersionGuard` | 유지 (remote URL — 웹 배포 자동 반영의 실체) |
| manifest share_target | 네이티브 미동작 감수 — 네이티브 공유 수신(share extension)은 후순위(§11) |

### 6.7 오프라인 / 네트워크 오류
- remote URL 첫 로드 실패(비행기모드 등) 시 WebView 흰 화면 — Capacitor `errorPath` 또는 www-placeholder/index.html 에 "네트워크 연결 후 다시 시도" + 재시도 버튼 (ko/en). `@capacitor/network` 로 복귀 감지 시 자동 reload.

### 6.8 외부 링크 / OAuth (★최우선 함정)
- **Google OAuth 는 WebView 에서 차단됨** (`disallowed_useragent`) — `LoginPage.tsx:545` `window.location.href = '/api/auth/google/initiate'` 가 네이티브에서 무조건 실패. Google 로그인 + GDrive/GCal/Gmail 연결(ProfileIntegrationsPage, EmailAccountSettings, StorageSettings) 전부 해당.
- 대응: OAuth 시작 공통 헬퍼 신설 — native 면 `Browser.open({url})`(SFSafariViewController/Custom Tab) 으로 열고, 콜백은 Universal Link(§7.2)로 앱 복귀 → 복귀 후 연결 상태 refetch. 백엔드 redirect 흐름 무변경 (redirect_uri 는 planq.kr 그대로 — memory: `feedback_oauth_redirect_origin_reuse`).
- 일반 외부 링크(`target=_blank`): Capacitor iOS 기본이 시스템 브라우저 위임인지 확인(미확인) — 아니면 전역 click 인터셉트로 `Browser.open` 분기.

---

## 7. 인증 / 세션 / 딥링크

### 7.1 세션 — Secure Storage 불필요 (결정)
- Remote URL 이므로 **웹과 완전 동일**: access token 메모리(AuthContext.tsx:102) + refresh HttpOnly cookie. WKWebView 의 `WKWebsiteDataStore.default()` 는 영속 저장소 — 앱 재시작 시 cookie 유지 → 자동 로그인. **토큰을 네이티브 Secure Storage 로 옮기지 않는다** (이관 시 웹과 인증 코드가 갈라져 재사용 원칙 훼손).
- 안전핀: Info.plist 에 `WKAppBoundDomains` = [planq.kr, dev.planq.kr] 추가 검토 — App-Bound Domains 는 WebKit 의 저장소 영속 보장을 강화. **미확인/검증필요:** Capacitor 8 + remote URL 조합에서 `limitsNavigationsToAppBoundDomains` 활성 시 브리지 주입·OAuth Browser 복귀에 부작용 없는지 → Phase 3 에서 켜고 검증, 문제 시 미적용(기본 저장소도 영속).
- **client_kind 확장 (권장):**
```sql
ALTER TABLE refresh_tokens MODIFY client_kind ENUM('pwa','web','ios','android') NOT NULL DEFAULT 'web';
```
  - `routes/auth.js` `TTL_MS_BY_KIND` 에 `ios: 365d, android: 365d` 추가, `resolveClientKind`(:29-38) 화이트리스트에 'ios'/'android' 추가, `jwtExpiresInForKind` 도 365d 분기.
  - `models/RefreshToken.js:36-39` ENUM 동기.
  - 프론트 `detectClientKind()`(AuthContext.tsx:107) 반환 타입 확장: `if (isNativeApp()) return nativePlatform() as 'ios'|'android'`.
  - 효과: 앱 세션 365일(푸시 수신용 상시 세션 — PWA 정책과 동일) + admin 세션 목록에서 기기 종류 식별.
  - **배포 순서 주의:** DB ENUM ALTER → 백엔드 배포 → 프론트 배포 순 (프론트가 먼저 'ios' 보내면 옛 백엔드 resolveClientKind 가 'web' fallback — 동작은 하되 TTL 30일. 크래시 없음 → 순서 어겨도 안전, idempotent).

### 7.2 딥링크 (Universal Links / App Links)
- **iOS:** `https://planq.kr/.well-known/apple-app-site-association` (nginx location, `Content-Type: application/json`, redirect 없이 직서빙):
```json
{ "applinks": { "apps": [], "details": [
  { "appID": "<TEAM_ID>.kr.planq.app", "paths": [ "*" ],
    "components": [ { "/": "*" } ] } ] } }
```
  Xcode Associated Domains: `applinks:planq.kr` (+ dev 빌드는 `applinks:dev.planq.kr`).
- **Android:** `https://planq.kr/.well-known/assetlinks.json` (SHA-256 서명 지문) + intent-filter autoVerify.
- 앱 측: `@capacitor/app` `appUrlOpen` → path 추출 → SPA navigate:
```ts
App.addListener('appUrlOpen', ({ url }) => {
  try { const u = new URL(url);
    window.dispatchEvent(new CustomEvent('planq:navigate', { detail: { path: u.pathname + u.search + u.hash } }));
  } catch { /* noop */ }
});
```
  App.tsx 에 `planq:navigate` 리스너 1개(useNavigate) — 알림 탭(§5.4)과 공용 브리지.
- 기존 Smart Routing(App-First, memory: `project_smart_routing_appfirst`)과 정합: 이메일/공유 링크가 planq.kr 절대 URL 이므로 앱 설치 기기에선 OS 가 앱으로 라우팅 — 별도 redirect 코드 불필요. 단 **로그인 세션 없는 딥링크** 진입 시 기존 웹의 returnTo 흐름이 그대로 동작하는지 Phase 3 검증.

---

## 8. Q Note 마이크 (리스크 — 반드시 실기기 게이트)

### 8.1 동작 가능성 판단
- `MicrophoneCapture`(getUserMedia audio) + AudioContext + WebSocket 스트리밍(§2.5) 은 **WKWebView iOS 14.3+ 에서 지원** (secure context 필요 — remote https 충족). Android WebView 도 RECORD_AUDIO 권한 + WebChromeClient grant 로 지원.
- **미확인/검증필요 3건:**
  1. **권한 프롬프트 이중화** — iOS 15+ WKWebView 는 페이지의 getUserMedia 마다 자체 프롬프트를 띄울 수 있음. Capacitor 가 `WKUIDelegate.requestMediaCapturePermission` 을 grant 로 위임하는지 버전 확인 — 안 하면 매 세션 프롬프트(UX 저하, 동작은 함). 필요 시 ios/ 네이티브 delegate 1곳 패치.
  2. **AudioContext 샘플레이트/ScriptProcessor 동작** — `recordToWav.ts:4` ScriptProcessorNode 기반. WKWebView 에서 deprecated 경고는 있으나 동작 — 실기기에서 16kHz 다운샘플 품질 확인.
  3. **Android WebView getUserMedia** — Capacitor 의 `onPermissionRequest` 자동 grant 는 Manifest 에 `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` 선언 필요.

### 8.2 게이트 기준 (Phase 4)
- 실기기(iPhone + Android 각 1)에서: Q Note 라이브 세션 시작 → 마이크 프롬프트 1회 → 30분 연속 녹음 → Deepgram transcript 실시간 수신 → 종료 → 요약 정상. STT 과금(`qnote_usage_events`)이 웹과 동일 기록되는지 확인.

### 8.3 알려진 제약 (Irene 사전 공유)
- **백그라운드 녹음 중단:** WebView JS 는 백그라운드에서 suspend — 녹음 중 홈으로 나가면 캡처 끊김 (iOS PWA 도 동일했음 — 악화 아님). 완화: ① 녹음 중 `@capacitor-community/keep-awake` 로 화면 꺼짐 방지 ② UIBackgroundModes 'audio' 는 WebView getUserMedia 에 적용이 보장되지 않음(미확인) — Phase 4 에서 실측 후, 백그라운드 연속 녹음이 꼭 필요하면 네이티브 캡처 플러그인(별도 개발) 후속 과제로.
- `getDisplayMedia`(웹회의 탭 캡처)는 WebView 미지원 — 원래 데스크탑 전용(§2.5), 앱에선 마이크 모드만 노출 (captureMode selector 에서 native 분기 숨김).

---

## 9. 빌드·배포 파이프라인

### 9.1 역할 분담
- **Opus (이 Linux 서버):** Capacitor 프로젝트 생성, 웹 분기 코드, 백엔드 APNs/FCM, ios/·android/ 디렉토리 git 커밋까지 전부.
- **Irene Mac (Xcode):** pod install(cap sync 가 수행), 서명, 실기기 설치, Archive → TestFlight 업로드. 절차는 Phase 0 완료 시 단계별 콘솔 안내 1단계씩 (memory: `feedback_concise_sequential`).
- Mac 로컬 절차:
```bash
git pull
cd dev-frontend && npm install
npx cap sync ios          # dev: CAP_SERVER_URL=https://dev.planq.kr npx cap sync ios
npx cap open ios          # Xcode — Signing & Capabilities: Team 선택, Push Notifications capability 추가
# 실기기 Run → 검증 → Product > Archive → Distribute (TestFlight)
```

### 9.2 인증서 / 키 (Irene 액션)
1. Apple Developer Program 가입 (개인 $99/년 — 당일~2일. 법인은 DUNS 1~2주라 개인 시작 권장).
2. Certificates → Keys → **APNs Auth Key(.p8) 생성** → Key ID + Team ID + .p8 파일을 서버로 (dev-backend `.env`: `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_KEY_P8_PATH=/opt/planq/dev-backend/keys/AuthKey_XXXX.p8`(권한 640, planq 그룹), `APNS_BUNDLE_ID=kr.planq.app`, `APNS_PRODUCTION=false` — 운영은 true).
3. Identifiers → App ID `kr.planq.app` (Push Notifications + Associated Domains capability).
4. Xcode 자동 서명(Automatically manage signing) 사용 — 수동 프로비저닝 불필요.
5. (Phase 5) Google Play Console $25 + Firebase 프로젝트 → `google-services.json`(android/app/) + FCM 서비스 계정 JSON(서버).

### 9.3 TestFlight
- App Store Connect 에 앱 등록(번들 ID 매칭) → Archive 업로드 → **내부 테스터**(App Store Connect 사용자, 최대 100명): 심사 없음, 업로드 후 수 분 내 설치 가능, 빌드 90일 유효 → Irene+팀 즉시 사용.
- 외부 테스터(최대 1만명, 초대 링크): 첫 빌드만 간이 심사(보통 1일 내).
- remote URL 방식이라 **앱 재업로드는 플러그인/네이티브 설정 변경 시에만** — 기능 업데이트는 웹 `/배포` 로 끝.

---

## 10. 단계별 구현 계획 (Opus 실행 순서)

> 각 Phase 는 독립 검증 가능. 웹 회귀 0 을 매 Phase 게이트에 포함. 커밋 단위 = Phase.

### Phase 0 — Capacitor 통합 + "웹 그대로 뜨기" (의존성: 없음 — 즉시 착수)
**작업:**
1. `dev-frontend` 에 Capacitor 설치:
```bash
cd /opt/planq/dev-frontend
npm i @capacitor/core @capacitor/push-notifications @capacitor/app @capacitor/browser @capacitor/badge @capacitor/keyboard @capacitor/status-bar @capacitor/share @capacitor/filesystem @capacitor/device @capacitor/network
npm i -D @capacitor/cli @capacitor/assets
npx cap init PlanQ kr.planq.app --web-dir www-placeholder
npx cap add ios && npx cap add android
```
2. `capacitor.config.ts`(§3.1) + `www-placeholder/index.html`(오프라인 안내, ko/en) + `src/services/native.ts`(§3.2).
3. Info.plist 권한 문구(§6.1) + 아이콘/스플래시 생성(§6.2) + StatusBar 초기화 코드.
4. main.tsx SW 등록에 `!isNativeApp()` 가드(§6.6) + 배너 4종 native 숨김.
5. ios/ android/ git 커밋.

**산출물:** Irene Mac 에서 `npx cap open ios` → 실기기 Run → **dev.planq.kr 로그인·채팅·업무 화면이 앱 안에서 그대로 동작**.
**검증기준:** ① 실기기에서 로그인 → 새로고침 없이 소켓 실시간 수신(2탭 시나리오) ② 앱 재시작 후 자동 로그인(cookie 영속) ③ WebView 콘솔(사파리 inspect)에서 `Capacitor.isNativePlatform()===true` ④ 웹 `npm run build` EXIT 0 + planq.kr/dev 웹 동작 무변경 ⑤ 키보드 ↔ 채팅 입력란 정상(§6.4).

### Phase 1 — 네이티브 푸시 백엔드 (의존성: Phase 0 무관, 병행 가능. APNs 실발송만 Irene .p8 대기)
**작업:** §5.1 migrate 스크립트(dev 적용) + PushSubscription 모델 확장 + `subscribe-native` 라우트(§5.3) + `apns_sender.js`(§5.2) + `sendPushToUser` fan-out 분기 + .env 키 자리.
**검증기준:** ① node test — 로그인 → 가짜 apns 토큰(64 hex) subscribe-native 201 → 재등록 updated → 타 유저 재등록 시 옛 row expired ② APNs env 미설정 상태 발송 → PushLog `skipped('no_apns_key')` + **웹 push 발송은 정상**(회귀 0) ③ 기존 web push 4 시나리오 재통과 ④ .p8 수령 후: 실 device token 으로 `/api/push/test` → PushLog sent + 기기 표시.

### Phase 2 — 네이티브 푸시 프론트 + 배지 + 알림 탭 (의존성: Phase 0+1, Apple 가입 완료)
**작업:** `nativePush.ts`(§5.4) + push.ts 4곳 분기 + `useGlobalBadge` native 분기 + `planq:navigate` 브리지(App.tsx) + Xcode Push Notifications capability.
**검증기준:** §5.5 시나리오 1~7 전부 (백그라운드·완전종료 표시가 핵심 — PWA 미표시 문제의 해결 증명).

### Phase 3 — 인증 client_kind + 딥링크 + 함정 보정 (의존성: Phase 0)
**작업:** refresh_tokens ENUM ALTER + auth.js/모델/detectClientKind 확장(§7.1) + AASA/assetlinks nginx 서빙 + Associated Domains + appUrlOpen 브리지(§7.2) + **OAuth Browser 분기(§6.8 ★)** + 다운로드 헬퍼 8곳(§6.3) + 외부링크 처리.
**검증기준:** ① 앱 로그인 → refresh_tokens row client_kind='ios', expires_at≈365일 ② 웹 로그인 여전히 'web'/'pwa'(회귀 0) ③ 이메일 알림의 planq.kr 링크 탭 → 앱으로 열려 해당 화면 진입 ④ 앱에서 Google 로그인·GDrive 연결 성공(SFSafariViewController 경유) ⑤ 청구서 PDF 다운로드 → iOS 공유시트.

### Phase 4 — Q Note 마이크 게이트 (의존성: Phase 0, 실기기)
**작업:** §8.1 미확인 3건 실측 + 필요 시 네이티브 delegate 패치 + captureMode selector native 분기 + keep-awake.
**검증기준:** §8.2. 실패 시 제약을 문서화하고 Irene 에게 §8.3 옵션 보고 (앱 출시 블로커 아님 — Q Note 는 웹/데스크탑 병행).

### Phase 5 — Android / FCM (의존성: Phase 2 패턴 확립, Firebase 프로젝트)
**작업:** google-services.json + `fcm_sender.js`(HTTP v1, §5.2) + 알림 채널(importance high) + backButton 브리지(`App.addListener('backButton')` → history.back, 루트면 앱 종료) + 배터리 최적화 안내.
**검증기준:** §5.5 를 Android 로 반복 + back 버튼 SPA 뒤로가기.

### Phase 6 — TestFlight → 스토어 (의존성: 전체)
**작업:** 운영 config 빌드 + 운영 backend `.env` APNs(production) + 운영 DB ALTER(§5.1/§7.1 — Fable 검증 게이트 대상: 운영 마이그레이션+보안 경계) + TestFlight 내부 배포 → 팀 사용 피드백 → App Store 준비(4.2 대비 네이티브 기능 명세, 심사 전용 데모 워크스페이스 신설 — 기존 계정 재사용 금지, 계정 삭제 노출(기존 GDPR 흐름 연결), privacy URL).

---

## 11. 리스크 · 미결정 (Irene 승인 필요)

| # | 항목 | 내용 | 권장 |
|---|------|------|------|
| 1 | **Apple Developer 가입** | $99/년, 미가입 상태. Phase 2 이후 전부 종속 — 승인 1~2일 | 즉시 개인 가입 |
| 2 | **번들 ID / 앱 이름** | `kr.planq.app` / "PlanQ" (변경 시 APNs topic·AASA 연쇄) | 확정 요청 |
| 3 | dev 전용 앱 분리 | 한 기기에 dev+운영 앱 동시 필요 여부 → `kr.planq.app.dev` 분리 | 초기엔 단일 ID(§3.3), 필요 시 분리 |
| 4 | Q Note 백그라운드 녹음 | WebView 제약으로 화면 꺼짐/백그라운드 시 녹음 중단 가능(§8.3) — keep-awake 로 완화 | 제약 수용 + Phase 4 실측 후 재논의 |
| 5 | App Store 4.2 리젝 | remote URL 웹뷰 앱 — 네이티브 푸시·배지·딥링크·공유로 상쇄. TestFlight 는 무관 | 공개 심사 단계에서 대응, 리젝 시 근거 소명 |
| 6 | 심사 3.1.1 (IAP) | 앱 내 구독 결제 유도 노출 금지 | 공개 전 요금 안내 화면 native 숨김 검토 |
| 7 | (기술) remote URL 브리지 주입 | Capacitor 8 에서 server.url 페이지에 플러그인 브리지 정상 주입 — Phase 0 첫 검증 항목 | 실패 시에만 bundled 재검토(가능성 낮음) |
| 8 | (기술) WKAppBoundDomains | 저장소 영속 강화 vs OAuth/브리지 부작용(§7.1) | Phase 3 에서 켜고 검증 |
| 9 | (기술) 키보드 이중 보정 | main.tsx visualViewport 로직 × Keyboard resize native(§6.4) | Phase 0 검증 항목 |
| 10 | 네이티브 공유 수신 | PWA share_target 대체(share extension) — 별도 네이티브 작업 | 후순위 (앱 출시 범위 밖) |

---

## 12. 비용 · 계정 체크리스트

| 항목 | 비용 | 담당 | 시점 |
|------|------|------|------|
| Apple Developer Program | $99/년 | Irene | **즉시 (Phase 2 선행조건)** |
| APNs Auth Key (.p8) | 무료 (가입 후 5분) | Irene → 서버 .env | Phase 1 말 |
| App ID + Associated Domains | 무료 | Irene(콘솔) 안내대로 | Phase 0~3 |
| Mac + Xcode | 보유 ✅ / 무료 | Irene | Phase 0 (Xcode 미리 설치 — 용량 큼) |
| Google Play Console | $25 (1회) | Irene | Phase 5 |
| Firebase 프로젝트(FCM) | 무료 | Irene 생성 → 서비스계정 JSON 서버로 | Phase 5 |
| TestFlight / App Store 등록 | 가입비에 포함 | — | Phase 6 |
| 서버 .env 신규 키 | `APNS_KEY_ID` `APNS_TEAM_ID` `APNS_KEY_P8_PATH` `APNS_BUNDLE_ID` `APNS_PRODUCTION` (+Phase 5: `FCM_PROJECT_ID` `FCM_SERVICE_ACCOUNT_PATH`) | Opus 자리 마련 / Irene 값 제공 | Phase 1 |
