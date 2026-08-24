# iOS TestFlight 베타 — 실행 순서

> Irene 지시 2026-08-24 "네이티브앱 베타하자 바로".
> 설계는 `docs/NATIVE_APP_PLAN.md`(Fable 검수본)가 정본. 이 문서는 **실행 순서만** 담는다.
> 앱스토어 정식 출시는 하지 않는다 — TestFlight 외부 테스터(최대 10,000명)까지가 이번 범위.

## 0. 지금 상태 (2026-08-24 실측)

| 항목 | 상태 |
|---|---|
| Capacitor + iOS 프로젝트 | ✅ 스캐폴드 완료, `cap sync` 리눅스에서 동작 |
| 앱 아이콘 · 스플래시 | ✅ PlanQ 마크로 교체 (알파 제거 — ITMS-90717 회피) |
| 결제 진입 숨김 (3.1.1) | ✅ `canPurchaseInApp()` — 구매 표면 7곳 차단 |
| APNs 발송 백엔드 | ✅ `services/apns_sender.js` (미설정이면 skip, 서버는 정상 기동) |
| 네이티브 푸시 등록 | ✅ `nativePush.ts` → `POST /api/push/subscribe-native` → `push_subscriptions.device_token` |
| **APNs `.p8` / 운영 env** | ❌ 미설정 (`APNS_*` 0건) — **푸시 안 감** |
| **Apple Team ID** | ❌ AASA 2곳 미치환 — **Universal Links 안 됨** |
| **AASA Content-Type** | ❌ 운영 nginx 가 `application/octet-stream` (dev 는 정상) |

**베타 자체는 위 3개 없이도 가능하다.** 없으면 푸시와 링크-앱-열기만 빠진 앱이 된다.

## 1. Irene 만 할 수 있는 것

### (1) Apple Team ID 확보 → 알려주기
App Store Connect → Membership → **Team ID** (대문자·숫자 10자리).
받으면 Claude 가 실행:
```bash
node scripts/ios-set-team-id.js <TEAM_ID>   # AASA 2곳 치환
cd dev-frontend && npm run build            # 그리고 /배포
```

### (2) APNs `.p8` 키 발급 → 파일로 전달
Certificates, Identifiers & Profiles → Keys → **+** → Apple Push Notifications service (APNs) 체크.
- **한 번만 내려받을 수 있다.** 잃어버리면 폐기하고 새로 만들어야 한다
- 필요한 값: `.p8` 파일 · **Key ID**(10자리) · Team ID
- **채팅에 붙이지 말 것** — 파일로 주면 Claude 가 운영 서버 `.env` 에 넣는다

### (3) App Store Connect 앱 레코드
- Bundle ID: **`app.planq`** (Identifiers 에 먼저 등록. Push Notifications · Associated Domains 체크)
- 앱 이름: PlanQ / 기본 언어: 한국어 / 카테고리: Business
- 개인정보처리방침 URL: `https://planq.kr/privacy`

### (4) 운영 nginx 한 줄 (Universal Links 용)
```bash
sudo bash /tmp/planq-aasa-nginx.sh
```
백업 → 멱등 → `nginx -t` 실패 시 자동 원복 → reload → 검증 출력까지 한다.

## 2. 아이맥에서 빌드 (Irene)

```bash
git clone git@github-planq:ireneceo/planq.git    # 이미 있으면 git pull
cd planq/dev-frontend && npm install

npm run cap:beta        # ★ 운영(planq.kr)을 가리키게 sync + 자동 점검
npm run cap:open:ios    # Xcode 열림
```

`cap:beta` 가 **목표 서버를 화면에 찍고**, 운영이 아니면 `exit 1` 로 멈춘다.
기본값이 `dev.planq.kr` 이라(의도적 dev-first) 그냥 Xcode 를 열면 **테스터가 개발 서버를 쓰게 된다** —
이 스크립트가 그 사고를 막는 유일한 장치다. 아카이브 전에 반드시 통과시킬 것.

Xcode 안에서:
1. **Signing & Capabilities** → Team 을 본인 계정으로. Bundle Identifier `app.planq` 확인
2. Capabilities 에 **Push Notifications**, **Associated Domains** 가 있는지 확인
   (`App.entitlements` 에 이미 적혀 있지만 프로비저닝 프로파일에도 켜져 있어야 한다)
3. 대상 기기를 **Any iOS Device (arm64)** 로
4. **Product → Archive** → Distribute App → **TestFlight & App Store** → Upload

`pod install` 이 필요하다는 경고가 뜨면:
```bash
cd planq/dev-frontend/ios/App && pod install
```
(리눅스에서는 CocoaPods 가 없어 이 단계만 건너뛴다 — 맥에서 한 번 돌리면 된다.)

## 3. TestFlight 배포

- **내부 테스터** (App Store Connect 사용자, 최대 100명): **심사 없음.** 업로드 후 처리(10~30분)되면 바로
- **외부 테스터** (최대 10,000명): **Beta App Review 필요.** 정식 심사보다 느슨하지만
  3.1.1(외부 결제 유도 금지)은 같이 본다 → 우리는 이미 A안으로 막아둬서 걸릴 것이 없다
- **빌드는 90일 후 만료** — 베타를 계속 유지하려면 새 빌드를 올려야 한다

**베타 시작은 내부 테스터로.** 심사 없이 즉시 실기기 검증이 되고, 거기서 문제를 다 잡은 뒤 외부로 넓힌다.

## 4. 실기기에서 확인할 것 (내부 테스터 단계)

1. 로그인 → 워크스페이스 진입 (Remote URL 이라 웹과 같은 화면이어야 한다)
2. **결제 화면에 구매 버튼이 없는지** — 플랜 설정에서 업그레이드/체험 버튼이 보이면 3.1.1 리젝 사유
3. Q Note 녹음 — 마이크 권한 요청 문구가 뜨는지
4. 파일 첨부 — 사진/카메라 권한
5. 푸시 (APNs 설정 후) — 알림 권한 → 다른 사용자가 메시지 → OS 알림 도착 + `push_logs` 에 `sent`
6. 키보드가 입력창을 가리지 않는지 (`visualViewport` 보정)

## 5. 되돌리기

TestFlight 빌드는 **회수할 수 없다** — 대신 그 빌드를 만료(Expire) 시키면 테스터가 못 쓴다.
서버 쪽 문제면 앱을 건드릴 필요가 없다: Remote URL 이라 `/배포` 한 번으로 앱 화면이 같이 바뀐다.
