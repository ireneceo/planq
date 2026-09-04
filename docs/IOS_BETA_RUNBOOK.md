# iOS TestFlight 베타 — 실행 순서

> Irene 지시 2026-08-24 "네이티브앱 베타하자 바로".
> 설계는 `docs/NATIVE_APP_PLAN.md`(Fable 검수본)가 정본. 이 문서는 **실행 순서만** 담는다.
> 앱스토어 정식 출시는 하지 않는다 — TestFlight 외부 테스터(최대 10,000명)까지가 이번 범위.

## 0. 지금 상태 (2026-09-04 실측 — 아래 표는 **측정한 날짜의 사실**만 적는다)

> ★ 2026-09-04 사고: 이 표의 8/24 자 ❌ 3건이 그 뒤 해결됐는데 갱신되지 않아,
>   Opus 가 "iOS 푸시가 안 갑니다" 라고 **운영에 반해 보고**했다. Irene 이 바로잡았다.
>   런북은 한 번 쓰고 두는 문서가 아니다 — 상태 표는 **볼 때마다 실측으로 대조**한다.

| 항목 | 상태 |
|---|---|
| Capacitor + iOS 프로젝트 | ✅ 스캐폴드 완료, `cap sync` 리눅스에서 동작 |
| 앱 아이콘 · 스플래시 | ✅ PlanQ 마크로 교체 (알파 제거 — ITMS-90717 회피) |
| 결제 진입 숨김 (3.1.1) | ✅ `canPurchaseInApp()` — 구매 표면 7곳 차단 |
| APNs 발송 백엔드 | ✅ `services/apns_sender.js` (미설정이면 skip, 서버는 정상 기동) |
| 네이티브 푸시 등록 | ✅ `nativePush.ts` → `POST /api/push/subscribe-native` → `push_subscriptions.device_token` |
| **APNs `.p8` / 운영 env** | ✅ 설정 완료 (`/opt/planq/secrets/AuthKey_*.p8`, 2026-08-24) — **푸시 실제로 감**: `push_logs` host=`apns` sent 87건, 최근 2026-09-04 |
| **Apple Team ID** | ✅ 치환됨 — 운영 AASA `appIDs: ["H2HW8BHXNW.app.planq"]` |
| **AASA Content-Type** | ✅ 운영 `application/json` |

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

## 2. 빌드 — Codemagic 클라우드 (2026-08-25 전환)

**맥에 Xcode 를 설치하지 않는다.** 이유는 `codemagic.yaml` 상단 주석과 세션 상태에 박제.
요약: 우리 앱은 Remote URL 껍데기라 재빌드가 드물고, 맥북 여유가 28GB(94% 사용)라 40GB 짜리
Xcode 를 둘 자리가 없다. 클라우드면 아이맥·맥북·윈도우 **어디서든** 된다.

**비용**: 개인 계정 무료 500 macOS M2 분/월 (회당 10~15분 → 월 30회 이상 무료).
초과 시 분당 $0.095. ⚠️ **무료 분은 개인 계정에만 붙는다 — 가입 시 Team 을 만들면 사라진다.**

### 저장소에 준비된 것 (Claude 완료)
- `codemagic.yaml` — 6단계 + TestFlight 자동 업로드.
  `npm run cap:beta` 를 그대로 태워 **목표가 `https://planq.kr` 이 아니면 빌드가 멈춘다**
- `dev-frontend/ios/App/App.xcodeproj/xcshareddata/xcschemes/App.xcscheme` — 공유 스킴.
  Capacitor 기본 스킴은 `xcuserdata` 라 git 에 없었고, 없으면 CI 가 빌드 대상을 못 찾는다

### App Store Connect API 키 (2026-08-25 발급 완료)

| 항목 | 값 |
|---|---|
| 키 이름 | `Codemagic` (생성자 MIJUNGKIM) |
| 권한 | **앱 관리 / App Manager** (TestFlight 업로드에 필요 — Developer 로는 안 된다) |
| **Key ID** | **`A68786VG7D`** |
| **Issuer ID** | **`8bd97182-8787-43c3-b129-19257cebdf00`** |
| `.p8` 파일 | `AuthKey_A68786VG7D.p8` — Irene 로컬 보관. **한 번만 내려받힌다.** 서버에는 두지 않는다 |

⚠️ **APNs 키(`P8QD2K92HW`)와는 다른 키다.** 알림용이 아니라 업로드·인증용.
※ 팀에서 API 를 처음 쓰면 Integrations 화면에 키 목록 대신 **「액세스 요청」** 이 먼저 뜬다 —
   계정 보유자가 동의하면 즉시 목록이 열린다(애플의 심사 대기가 아니다).

### Irene 이 할 일 (브라우저만, 맥 불필요)
1. ~~App Store Connect API 키 발급~~ → **완료** (위 표)
2. **Codemagic 가입** — https://codemagic.io , GitHub 계정으로. **Team 만들지 말 것**
3. Teams > Integrations > App Store Connect 에 키 등록. **이름을 정확히 `PlanQ ASC`**
4. 저장소 `ireneceo/planq` 연결 → 워크플로 **`ios-testflight`** 실행

첫 빌드는 서명 프로파일 자동 생성 때문에 한 번 실패할 수 있다 — 로그를 보고 조정한다.

### (참고) 맥에서 직접 빌드하려면
Xcode 설치 후:
```bash
git clone git@github-planq:ireneceo/planq.git
cd planq/dev-frontend && npm install
npm run cap:beta        # ★ 목표가 https://planq.kr 인지 확인
cd ios/App && pod install && cd ../..
npm run cap:open:ios
```
Xcode 에서 Signing & Capabilities > Team 지정 → Any iOS Device → Product > Archive → Upload.

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

## 4-B. 90일마다 새 빌드 — **이것이 곧 운영이다** (2026-09-03 추가)

TestFlight 는 원래 베타 배포 수단이지만, 우리는 **정식 출시 전까지 이것으로 고객에게 앱을 준다**
(Irene: "우리 그냥 운영하듯이 고객이 사용하게 할건데"). 그래서 90일 만료는 베타의 사정이 아니라
**서비스 중단 사고**다. 만료되면 고객이 앱을 못 연다.

### 고객 입장에서 무슨 일이 일어나나

| | |
|---|---|
| 앱을 다시 설치해야 하나 | **아니다.** TestFlight 앱에서 **업데이트**만 받으면 된다. 아이콘·로그인·데이터 그대로 |
| 초대 링크가 바뀌나 | **아니다.** `https://testflight.apple.com/join/18aF7Ze5` 그대로 |
| 고객이 아무것도 안 해도 되나 | TestFlight 설정에서 **자동 업데이트**를 켜 두면 그렇다. 꺼져 있으면 한 번 눌러야 한다 |
| 만료된 뒤에는 | 업데이트하기 전까지 **앱이 안 열린다** |

### 왜 새 빌드가 코드 변경 없이도 되는가

이 앱은 **Remote URL(Capacitor)** 이라 화면은 `https://planq.kr` 을 그대로 띄운다.
기능 변경은 `/배포` 한 번으로 앱에도 즉시 반영된다 — **새 빌드는 오직 만료 시계를 되감기 위한 것**이다.
그래서 소스에 손댈 것이 없고, 워크플로만 한 번 돌리면 된다.

### 절차 (60~75일차에 시작 — 만료 직전에 하지 말 것)

1. **Codemagic** 에서 워크플로 **`ios-testflight`** 실행 (빌드 번호는 올려야 한다 — 같은 번호는 거부된다)
2. 업로드 후 처리 10~30분
3. App Store Connect > TestFlight > 새 빌드를 **외부 그룹 `Beta Customers`** 에 추가
4. **Beta App Review 를 다시 받는다.** 대개 빠르지만 하루 이틀 걸릴 수 있다 —
   **만료 직전에 올리면 심사 대기 중에 고객 앱이 멈춘다.** 이것이 여유를 두는 이유다
5. 승인되면 테스터에게 업데이트가 뜬다. 링크·그룹은 그대로라 고객에게 다시 안내할 것이 없다

### 이 시계를 누가 보는가

**현재 빌드 `1.0 (8)` 만료일 = 2026-11-29** (2026-09-03 에 "87일 후 만료" 로 확인).

놓치면 사고이므로 **Irene 의 PlanQ 캘린더(운영)에 종일 일정 3건을 넣어 두었다** — 사람 기억에 맡기지 않는다.

| 날짜 | 무엇 | 만료까지 |
|---|---|---|
| **2026-11-02** | 새 빌드 시작 (Codemagic 실행) | 27일 |
| **2026-11-17** | 마감선 — 아직이면 오늘 올린다 | 12일 |
| **2026-11-24** | 임박 — 승인 안 났으면 즉시 확인 | 5일 |

각 일정은 **하루 전 알림**이 뜬다. 다음 빌드를 올린 뒤에는 **이 세 일정을 지우고 새 만료일로 다시 만든다.**

> 정식 출시(App Store 공개)로 넘어가면 이 만료 자체가 없어진다. 90일 재빌드는 **그때까지의 임시 운영**이다.

## 5. 되돌리기

TestFlight 빌드는 **회수할 수 없다** — 대신 그 빌드를 만료(Expire) 시키면 테스터가 못 쓴다.
서버 쪽 문제면 앱을 건드릴 필요가 없다: Remote URL 이라 `/배포` 한 번으로 앱 화면이 같이 바뀐다.
