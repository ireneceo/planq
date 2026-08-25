# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-08-25 (KST) — `/개발완료` 처리
**작업 상태:** 완료 · 작업트리 clean · 소스(dev-backend/dev-frontend/q-note) 변경 0 → **`/배포` 불필요**

### 진행 중인 작업
- 없음 (서버 쪽 할 일 없음)

### 완료된 작업 (이번 세션 — 2026-08-25)
- **iOS TestFlight 빌드를 Codemagic 클라우드로 전환** (커밋 `72cbbe39`, push 완료)
  - 맥에 Xcode 를 깔지 않는다. 맥북 실측 Xcode·Node 미설치 · 데이터 볼륨 94%(여유 28GB) vs Xcode 40GB 요구
  - 판단 근거: 우리 앱은 Remote URL 껍데기라 서버 배포만으로 화면이 바뀐다 → **앱 재빌드가 드물다.** 어느 기기에서든 빌드 가능해짐
  - 비용: 개인 계정 **무료 500 macOS M2 분/월**(회당 10~15분) · 초과 시 분당 $0.095. ⚠️ 가입 시 **Team 만들면 무료 분 소멸**
  - 신규 `codemagic.yaml`(6단계 + TestFlight 자동 업로드) · 신규 공유 스킴 `App.xcscheme` · `IOS_BETA_RUNBOOK §2` 재작성
- `/개발완료` — 가드 3축 EXIT 0 · Q위키 커버리지 EXIT 0 · DEVELOPMENT_PLAN 히스토리 박제 · memory 갱신

### 가드 3축 결과 (2026-08-25)
| 가드 | 결과 |
|---|---|
| `scripts/health-check.js` | ✅ 37/37 (EXIT 0) |
| `scripts/guard-invariants.js` | ✅ 26/26 (EXIT 0) |
| `scripts/e2e/run.js --suite tenant` | ✅ 실패 0 (EXIT 0) |
| `dev-backend/scripts/wiki-coverage-check.js` | ✅ 통과 (이번 변경은 사용자 대면 화면 변경 없음 → 아티클 불요) |

> Fable 게이트: **소스 변경 0** 이라 해당 없음 (`git status --porcelain -- dev-backend dev-frontend q-note` 빈 값).

---

## 📱 iOS 베타 — 클라우드 빌드 (Codemagic)

### 애플 쪽 완료 (다시 안 해도 됨)
| 항목 | 값 |
|---|---|
| Apple ID | **`help@wor-pro.com`** (MIJUNGKIM) — 인증 6자리 코드는 **이 메일함으로만** 온다 |
| Team ID | **`H2HW8BHXNW`** (조직 `irene&company`) |
| Bundle ID | **`app.planq`** (Push Notifications + Associated Domains) |
| APNs Key ID | **`P8QD2K92HW`** — 키는 양 서버 `/opt/planq/secrets/` 에 640 권한 |
| App Store Connect | 앱 레코드 `PlanQ` 생성됨 |
| 운영 Universal Links | 완료 (`application/json` + `appIDs H2HW8BHXNW.app.planq`) |

APNs 검증 완료: 가짜 토큰에 `BadDeviceToken`(400) = 애플이 우리 인증을 수락.
운영 `APNS_PRODUCTION=true`(TestFlight용) / dev `false`.

### Claude 가 끝낸 것
- **`codemagic.yaml`** — npm ci → `cap:beta` → pod install → 빌드번호 → 서명 → IPA → TestFlight 자동 업로드
  - `npm run cap:beta` 를 그대로 태워 **목표 서버가 `https://planq.kr` 이 아니면 빌드가 멈춘다**(기본값이 dev 라 이게 유일한 안전장치)
  - `webDir: www-placeholder` 라 **웹 빌드(vite) 없이 sync** 된다 — CI 가 가볍다
- **`App.xcscheme` 공유 스킴** — Capacitor 기본 스킴은 `xcuserdata` 라 git 에 없다. 없으면 클라우드가 빌드 대상을 못 찾는다 (target `504EC3031FED79650016851F`)

### ▶ Irene 이 할 일 (브라우저만, 맥 불필요)
1. **App Store Connect API 키 발급** — Users and Access > Integrations > App Store Connect > **+**
   - Role: **App Manager** / 받을 것: `.p8` 파일 · **Key ID** · **Issuer ID**
   - ⚠️ `.p8` 는 **한 번만** 내려받을 수 있다. APNs 키와는 **다른 키**다
2. **Codemagic 가입** — https://codemagic.io , **GitHub 계정으로** (⚠️ **Team 만들지 말 것** — 무료 분이 사라진다)
3. Codemagic > Teams > Integrations > App Store Connect 에 위 키 등록. **이름을 정확히 `PlanQ ASC`** (yaml 이 이 이름을 찾는다)
4. 저장소 `ireneceo/planq` 연결 → 워크플로 `ios-testflight` 실행
5. App Store Connect > PlanQ > **TestFlight** > 내부 테스터 추가 (심사 없음, 100명)

### 남은 확인 사항
- `APP_STORE_APP_ID`(앱 숫자 ID) 를 Codemagic 환경변수에 넣으면 빌드번호가 TestFlight 최신+1 로 자동. 없으면 Codemagic `BUILD_NUMBER` 사용
- 첫 빌드는 서명 프로파일 자동 생성 때문에 한 번 실패할 수 있다 — 로그 보고 조정

절차 상세: `docs/IOS_BETA_RUNBOOK.md`

---

## 다음 할 일
1. **iOS 베타 — Codemagic** (§📱 의 Irene 4단계) → 첫 빌드 로그 확인 → 내부 테스터로 실기기 검증 6항목
2. Fable 큐 `docs/FABLE_VERIFY_QUEUE.md` — §6 Gmail 스팸함 수집(커서 스키마), §5 메일 전달 기능(차단 중)
3. 오늘의 업무 리뷰 — 요약 층 (재료 수집·UI 는 배포 완료, Fable 큐 이관분)

### Irene 조치 대기
- Google Drive 재연동 (`invalid_grant`)

---

## 지난 세션 참고

### 🔴 2026-08-24 마지막에 잡은 회귀 (배포 완료)
**업무 저장이 매번 50초** — `afterSave` 스냅샷 훅이 `options.transaction` 을 넘기지 않아
별도 커넥션으로 같은 행을 잠그려 했고, 바깥 트랜잭션이 쥔 락을 기다리다
`innodb_lock_wait_timeout`(50초)를 매번 꽉 채웠다.
- 운영 실측 **50,107ms → 82ms** (커밋 `2b7b2fa9`, 배포 18:43)
- 두 겹으로 숨었다: 훅 `catch` 가 삼켜 로그에만 남고, 저장은 성공해 "그냥 느림" 으로만 보였다
- 교훈 박제: memory `feedback_hook_must_join_transaction`

### 2026-08-24 세션 완료분
- 랜딩 **서비스 페이지 `/service`** + 견적문의(`/contact?type=quote`) — ko/en
- **문의 폼 전건 실패 수정** — 필드명 불일치로 역대 접수 0건이던 것
- **외부 API 크레딧 경보** — Deepgram/OpenAI 잔액·소진 예상일·일 1회 메일 + 단가 자동 보정
- **Q Task 체크박스 권한 규칙** · **팝아웃 체크 즉시 반응** · **카운트 정의 통일**
- **iOS**: 아이콘·스플래시 PlanQ 마크 교체(알파 제거) · 베타 런북 · 빌드 목표 서버 안전장치

---

## Git 상태 (2026-08-25 `/개발완료` 시점)

| 항목 | 값 |
|---|---|
| 브랜치 | `main` |
| 마지막 코드 커밋 | `72cbbe39` build(ios): TestFlight 빌드를 Codemagic 클라우드로 전환 |
| HEAD | 이 문서를 담은 `/개발완료` 커밋 (`git log -1` 로 확인) — push 완료 |
| 작업트리 | **clean** |
| 미배포 | 없음 — 이번 사이클은 CI 설정·문서뿐이라 `/배포` 불필요 |

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```

노트북에서 이어가려면 개발 서버에 접속해 `claude --continue` 하면 이 대화가 그대로 이어집니다.
