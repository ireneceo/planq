# App Store 등록 준비 — PlanQ iOS

> 계정 생성 직후 **바로 채워 넣을 수 있게** 미리 정리한 문서. 코드 기준 사실만 적었다(추정 없음).
> 앱 코드는 이미 완성돼 있다(Capacitor Phase 0~5, Fable 게이트 통과). 남은 것은 애플 쪽 관문뿐이다.
> 작성 2026-08-22.

## 0. Irene 손이 필요한 것 (Claude 불가)

| 항목 | 왜 못 하나 |
|---|---|
| Apple Developer Program $99/년 | 본인 명의·본인 결제. **법인 명의면 D-U-N-S 번호 필요(발급 1~2주)** |
| Mac + Xcode 에서 빌드 | `.ipa` 는 macOS 전용. 갖고 계신 아이맥·맥북이면 충분하다(추가 장비 불필요) |
| APNs `.p8` 키 발급 | 애플 계정 안에서만. **한 번만 내려받을 수 있다** |
| App Store Connect 앱 레코드 생성 | 계정 소유자만 |

**서버는 하나도 더 필요 없다.** 앱은 `planq.kr` 을 그대로 띄우는 방식(Remote URL)이고,
푸시도 우리 백엔드가 APNs 로 직접 쏜다. 중계 서버 없음, 서버 비용 증가 0.

> **베타(TestFlight) 실행 순서는 `docs/IOS_BETA_RUNBOOK.md` 를 따른다.** 이 문서는 정식 등록 준비용이다.

### 맥에서 첫 실행
```bash
git clone git@github-planq:ireneceo/planq.git
cd planq/dev-frontend && npm install
npm run cap:sync:dev      # 앱이 dev.planq.kr 을 보게 (운영은 cap:sync:prod)
npm run cap:open:ios      # Xcode 열림 → 기기 선택 → ▶︎ Run
```
서명 경고가 뜨면 Xcode `Signing & Capabilities` 에서 팀을 본인 계정으로 지정.

### 서버에 넣을 값 (주시면 Claude 가 반영)
`.p8` 파일 · Key ID(10자리) · Team ID(10자리) → 운영 `.env` 의 `APNS_*`.
`.p8` 은 채팅에 붙이지 말고 파일로 전달. Team ID 는 나중에 Universal Links(카톡 링크를 앱으로 열기)에도 쓴다.

---

## 1. ⚠️ 심사 리스크 — 먼저 정하고 올려야 한다

**3.1.1 (In-App Purchase).** 앱 안에서 디지털 구독을 외부 결제로 팔면 리젝된다.

**→ 해소됨 (A안 구현 완료).** `utils/purchase.ts` 의 `canPurchaseInApp()` 가 단일 판정이고,
네이티브에서는 구매 표면을 아예 렌더하지 않는다. 적용처 7곳(실측):
`PlanSettings`(3) · `TrialStatusBanner` · `WorkspaceBillingBanner` · `UsageWarningCard` · `LimitReachedDialog`.
현재 플랜·사용량은 그대로 보인다(읽기 전용은 위반이 아니다). **구매를 웹으로 안내하는 문구·링크도
두지 않는다** — 외부 구매 유도로 읽힐 수 있어서다.
Q Bill 고객 청구서 결제(`PublicInvoicePage`)는 대상이 아니다 — 실물 용역 대금이라 3.1.3(e) 범위.

⚠️ **승인 후 다시 열면 안 된다** (Irene 확정 2026-08-24). 재심사·리젝·앱 제거 대상이다.
정상적으로 여는 길은 3.1.3(e) Enterprise Services 예외를 인정받거나 인앱결제를 붙이는 것뿐이다.

△ 남은 회색지대: 플랜 비교표의 **가격은 앱에서도 보인다**(구매 버튼만 숨김). 규정상 대상은
구매 유도 CTA 라 문제없다고 보지만 심사관에 따라 지적받을 수 있다 — 걸리면 가격 열도 숨긴다.

---

## 2. App Privacy 설문 답안 (코드 기준)

App Store Connect 가 묻는 "수집하는 데이터" 항목. **실제 코드에 있는 것만** 적었다.

| 데이터 | 수집 | 용도 | 사용자 식별 연결 | 추적(ATT) |
|---|:---:|---|:---:|:---:|
| 이메일 주소 | ● | 계정·로그인·알림 | 예 | 아니오 |
| 이름 | ● | 계정·표시명 | 예 | 아니오 |
| 전화번호 | ○ 선택 | 연락처(`users.phone`, 비필수) | 예 | 아니오 |
| 사용자 콘텐츠 (문서·메시지·파일·메일) | ● | 앱 기능 제공 | 예 | 아니오 |
| 오디오 (Q Note 녹음) | ● | 회의 기록·요약 | 예 | 아니오 |
| 결제 정보 | ✕ | **직접 저장하지 않음** — Stripe 가 처리, 우리는 참조 ID 만 | – | – |
| 위치 | ✕ | 코드에 geolocation 호출 0건(실측) | – | – |
| 광고 식별자 | ✕ | 광고 SDK 없음 | – | – |
| 사용 통계·분석 | ✕ | 외부 분석 도구 미사용(자체 감사 로그만) | – | – |

**Tracking: 아니오.** 다른 회사 앱·사이트에 걸쳐 추적하지 않는다 → ATT 프롬프트 불필요.

### 제3자 처리자 (개인정보처리방침에 명시 필요)
| 대상 | 무엇이 나가나 |
|---|---|
| Stripe | 결제 처리 (카드 정보는 우리 서버를 거치지 않는다) |
| OpenAI (`services/llm.js`) | Cue·요약·임베딩에 쓰이는 텍스트 |
| Deepgram (`q-note`) | Q Note 음성 → 텍스트 변환 |
| Apple APNs / Google FCM | 푸시 알림 전달 |
| Google (선택 연동) | 캘린더·드라이브·Gmail — 사용자가 직접 연결했을 때만 |

---

## 3. 스토어 등록 정보

| 항목 | 값 |
|---|---|
| 번들 ID | `app.planq` (확정) |
| 앱 이름 | PlanQ |
| 부제 (30자) | 요청은 Queue로, 실행은 Cue로 |
| 카테고리 | 비즈니스 (2차: 생산성) |
| 연령 등급 | 4+ (부적절 콘텐츠 없음) |
| 지원 URL | https://planq.kr (문의 폼 존재) |
| 개인정보 처리방침 URL | **확인 필요** — `/legal` 경로에 있는지 점검 후 확정 |
| 저작권 | © 2026 워프로랩 |

### 설명 (ko)
> PlanQ 는 고객 요청이 흩어지지 않게 모으고, 그것이 실제 실행으로 이어지게 돕는 업무 OS 입니다.
> 대화(Q Talk) · 할일(Q Task) · 회의 기록(Q Note) · 자료(Q File) · 청구(Q Bill) 가 하나로 연결됩니다.
> 메일과 채팅에서 할 일이 자동으로 뽑히고, 근무 시간과 업무 시간이 함께 기록되며,
> 계약부터 청구까지 한 흐름으로 이어집니다.

### 설명 (en)
> PlanQ keeps client requests from scattering and turns them into work that actually gets done.
> Chat, tasks, meeting notes, files, and billing live in one connected place.
> Work items are pulled out of mail and chat automatically, work hours and task time are recorded together,
> and everything from contract to invoice flows in one line.

### 키워드 (100자 이내, 쉼표 구분)
`업무관리,협업,고객관리,프로젝트,할일,청구서,회의록,근태,B2B,워크스페이스`

---

## 4. 스크린샷 (필수 규격)

| 기기 | 해상도 | 장수 |
|---|---|---|
| iPhone 6.9" (15 Pro Max 등) | 1320×2868 | 최소 1, 권장 3~5 |
| iPhone 6.5" (11 Pro Max 등) | 1242×2688 | 위 것으로 대체 가능 |
| iPad 13" (선택) | 2064×2752 | 아이패드 지원 표시할 때만 |

찍을 화면 제안: ① 대화+할일 연결 ② 내 업무 주간 ③ Q Note 회의 기록 ④ 청구서 ⑤ 근태.
**실제 데이터가 보이면 안 된다** — 고객사 이름·금액이 스크린샷에 남으면 그대로 공개된다.

---

## 5. 제출 시 체크

- [ ] 수출 규정: `ITSAppUsesNonExemptEncryption` — HTTPS 표준 암호화만 사용 → **면제(false)**
- [ ] 심사 계정 제공: 심사관이 로그인할 데모 계정 + 비밀번호 (필수 — 로그인 벽이 있는 앱)
- [ ] 데모 워크스페이스에 샘플 데이터 (빈 화면만 보이면 "기능 확인 불가" 로 리젝된다)
- [ ] 3.1.1 결제 진입 처리 여부 (§1)
- [ ] 푸시 권한 요청 문구가 맥락과 함께 뜨는지 (권한만 먼저 묻는 앱은 지적받는다)
- [ ] `NSMicrophoneUsageDescription` — Q Note 녹음. Info.plist 문구가 "왜" 를 말하는지 확인

## 6. TestFlight (심사 전 내부 배포)

유료 계정이면 바로 된다. **내부 테스터 100명까지는 심사 없이** 초대 즉시 설치.
외부 테스터(최대 10,000명)는 간단한 베타 심사를 거친다.
정식 출시 전에 팀이 실제로 써보는 단계로 쓰면 된다 — App Store 심사와 별개다.
