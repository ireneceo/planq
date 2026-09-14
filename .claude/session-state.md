## 현재 작업 상태
**마지막 업데이트:** 2026-09-14 (UTC)
**작업 상태:** 완료 (운영 배포 2회 — `f16a7768` **v1.52.2** 17:11 · `9aeeb117` **v1.52.3** 17:28 · 347초 · 백업 `/opt/planq/backups/20260914_171156`, `/opt/planq/backups/20260914_172848`)
**Git:** 미커밋 변경 0건 · HEAD `01aa7a78` · **미배포 1건** (아래)

### ★ 미배포 — 다음 배포에 실린다
- `01aa7a78` **Q info 저장 조건 수정**. 운영은 아직 v1.52.3(`9aeeb117`)이다.
  Irene 이 `/배포` 라고 해야 나간다.

### 완료된 작업 (이번 세션)

**★ 안드로이드 앱 — Play 프로덕션 심사 제출까지 완료**
- Codemagic 빌드가 **두 번, 같은 로그로** 실패했다. 첫 번째는 `cap sync` 단계가 오프라인 폴백을
  박는 스크립트를 건너뛴 것(`648d59d1` — `npm run cap:beta:android` 로 교체).
  **두 번째 원인은 코드가 아니라 푸시를 안 한 것**이었다 — CI 는 rsync 가 아니라 **GitHub 에서** 당겨간다.
  내가 그 사이에 *"고쳤습니다, 다시 돌려주세요"* 라고 말한 것은 근거가 없었다.
  → 메모리 `feedback_ci_pulls_from_github_not_rsync`
- 내부 테스트 업로드(version code 28. *"no deobfuscation file"* 경고는 출시를 막지 않는다) →
  App content · Health apps · 국가(**모든 국가**) → `Submit 11 changes for review`. **심사 수일 대기.**
- ★ **심사 화면 안내를 두 번 틀렸다.** 화면에 없는 메뉴를 있다고 말했다.
  Irene: *"1번부터 화면에 없어. 내가 주는 화면 보고 하는 거 맞아?"* · *"하나씩 좀 하자. 하나씩"*
  → 그 뒤로는 **받은 화면에 보이는 것만** 근거로 한 단계씩 안내했다.

**★ Stripe 실연결 + 카드 결제 사용 스위치** (`ea85d433` · `f16a7768`)
- restricted key(`rk_live`) 발급 → 웹훅 등록 → **결제 0건으로** 실동작 확인
  (정상 서명 200 / 위조 서명 400 · `rk_live` LIVE 모드 확인). Products 권한이 없어
  `price_data` 인라인만 쓴다.
- 관리자 화면 신고 4건 수리 — 저장하면 값이 사라짐 · 자동완성 오염 · "비우면 유지" 문구 ·
  **사용 여부 스위치가 없음**(`platform_settings.stripe_card_enabled` 신설, 마이그레이션 멱등).
- ★ **그 스위치가 화면만 가리고 있었다** — 껐는데도 `POST …/stripe-checkout`(구독)과
  워크스페이스 청구서 체크아웃은 **그대로 열려 있었다**. `isStripeEnabled('platform')` 한 술어에
  스위치를 넣고 **서버 문 두 곳**(`routes/plan.js` · `routes/invoices.js`)에 게이트를 걸었다.
  **버튼을 숨기는 것은 보안이 아니다.**

**★ 법인이 둘이라는 것 — 미해결**
- Stripe 가입 법인은 **말레이시아 법인**, 서비스 제공자는 **아이린앤컴퍼니**.
  내가 처음 *"상관없다"* 고 답한 것은 **틀렸다** — 청구 주체가 둘이면 고지해야 한다.
- 개정 대상: 약관 제3조 · 개인정보처리방침 **국외이전** · 푸터 사업자 정보 · 청구서/영수증 양식.
  필요한 것 = 말레이시아 법인 **정식 상호·등록번호·주소**(Irene). 세무·최종 문구는 전문가 영역.
- **그때까지 [카드 결제 사용] 스위치를 꺼 둘 것을 권고**했다. → 메모리 `project_billing_entity_two_companies`

**★ Q info 가 파일 없이는 저장이 안 됐다** (`01aa7a78`, **미배포**)
- 서버(`routes/kb.js`)는 **본문 · 첨부 · 항목값** 셋 중 하나면 이미 받고 있었는데
  화면(`KnowledgePage.submit`)만 본문·첨부를 요구했다. **화면이 서버보다 엄격했다.**
- 클라이언트 검증 **14곳**을 훑어 어긋난 것은 이 한 곳뿐임을 확인했다
  (Irene: *"이런 말도 안되는 형국이 여기 저기 있는 거 아니야?"* 에 대한 답).
- → 메모리 `feedback_client_stricter_than_server_kills_feature`

**배포 게이트가 두 번 제대로 막았다** (`be5353d0`) — 빠뜨린 문구 12개(ko/en) · 낡은 스키마 스냅샷.
그 뒤 i18n 파일별 래칫도 한 번 걸렸다(두 줄짜리 `t()` 폴백 → 한 줄로).

### 검증 (Fable 미검증 — 자체 검증)
**Fable 호출 오늘 10회 전부 429(한도 초과).** 대기열 **40** 등재 + `unavailable` 마커
(기준 커밋은 `f8fdc510` 그대로 — HEAD 로 올리면 미검증 커밋 4개가 검증된 것처럼 지워진다).
- 결제 게이트 **3/3 양방향** — OFF→403 `card_payment_disabled` / ON→통과 / **실 결제·세션 생성 0**
- 스위치 저장 4/4 · 운영 Stripe 실동작(결제 0건) · Q info **4/4 실 HTTP**
  (항목값만 201 · 음성 대조군 제목만 → 400 · **secret 항목 값이 색인 본문에 안 샘** · 일반 항목은 색인)
- 가드 EXIT 0 · health 44/44 · 멀티테넌트 0 · 빌드 EXIT 0 / `error TS` 0 · Q위키 커버리지 통과
- 운영 확인: `planq.kr/api/health` ok · PM2 `planq-prod-backend` **1.52.3**

### 주요 변경 파일
`dev-backend/{models/PlatformSetting.js, routes/admin.js, routes/plan.js, routes/invoices.js,
services/stripeService.js, scripts/migrate-stripe-card-toggle.js}` ·
`dev-frontend/src/pages/Admin/AdminBillingSettingsPage.tsx` ·
`dev-frontend/src/pages/Knowledge/KnowledgePage.tsx` ·
`dev-frontend/public/locales/{ko,en}/{admin,knowledge}.json` ·
`codemagic.yaml`(안드로이드 단계) · `scripts/schema-snapshot.json`

### 다음 할 일
- **배포 대기** — `01aa7a78`(Q info). 지시 대기.
- **법인 2개 문서 개정** — 위 항목. Irene 의 법인 정보가 있어야 시작한다. **그 전까지 카드 결제 OFF 권고.**
- **Play 심사 결과 대기**(수일). 승인되면 **운영** 관리자 화면에
  `platform_settings.app_android_url` 을 넣는다(dev 에 넣으면 운영에 안 간다).
- **iOS 알림 속도** — 분석만 했고 구현 안 했다. ①알림으로 열렸을 때 확인필요 화면을 건너뛰고
  바로 대상으로 ②서비스워커가 앱 자산을 캐시. (화면이 두 번 마운트되고 JS 129개를 받는다)
- **iOS 빌드 만료 알림은 존재하지 않는다** — 만들려면 만료일 칸 1개 + D-14/7/3/1 메일. 지시 대기.
- **프로젝트 탭 메뉴 추가**(사용자가 탭을 추가) — 범위·권한·게스트 노출을 먼저 정해야 한다. 지시 대기.
- **Fable 대기열 35~40** — `/usage-credits` 로 풀리면 한 번에 올린다. 특히 **40 의 A**
  (스위치가 꺼진 채 결제 세션을 만들 수 있는 경로가 더 없는지 전수).
- 알림 메일 모양을 실제 메일 클라이언트로 확인(Gmail·Outlook·iOS Mail) — 아직 못 했다.
- 운영에 옛 청크가 누적된다(rsync 가 안 지운다) — 한 번 판단 필요.

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
