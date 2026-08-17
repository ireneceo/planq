# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-08-17 (Opus 5, 1M) — 접속 끊김 복구 → 배포 → 관리자 화면 후속
**작업 상태:** ✅ `9d5e350` 운영 배포 완료(결제 면제 + 알림 정리). 🟡 관리자 화면 후속 수정 = Fable 재검증 중, 미커밋.

> ## ⚠️ 이 파일이 낡으면 Fable 이 오판한다
> 청크를 끝낼 때마다 갱신할 것.

---

## 🟢 이번 세션에 운영 반영 완료 (`9d5e350`, 2026-08-17 02:05)

- 결제 면제 시스템 + 워프로랩 2곳 internal(pro) 백필 → **결제 요구·강등 예정 소멸**
- 내부결제 6건 155,800원 `is_revenue=0` → **실매출 0 / 비매출 155,800 분리**
- 알림 제목 규약 통일(#281·#214) · 메일 자기수신 루프 차단 · 자기알림 필터 복구(#282·#278)
- 운영 피드백 9건 답변+상태 정리 (pending 72 → 63)

**운영 절차 (재현용):** `node /opt/planq/backend/migrate-billing-exemption.js` (멱등) →
`node /opt/planq/scripts/backfill-billing-exemption.js` (dry-run) → `--apply`.
★ ssh 기본 cwd 가 홈이라 **절대경로**로 실행할 것. 백필 스크립트는 `dev-backend`/`backend` 둘 다 인식.

---

## 🔴 미커밋 — 관리자 워크스페이스 관리 후속 (Irene 연속 신고 4건)

Irene 이 배포 직후 관리자 화면에서 연달아 발견:
1. *"플랜변경 팝업이 뒤로 뜨고 닫을 수도 없고, 패널 열 때마다 계속 나와"*
2. *"면제설정 눌러도 못 누르고 우측패널 닫혀버리고 팝업들이 줄지어 열려"*
3. *"왜 이거 강등으로 나와?"* (면제 워크스페이스인데)
4. *"워프로랩이 2개네?"*

**원인·조치**
- **z-index**: `adminModalKit.ModalOverlay` 90 < DetailDrawer 125/130 → 모달이 드로어 뒤에 깔려
  클릭이 드로어 백드롭에 닿아 드로어가 닫히고, 못 닫으니 open state 가 남아 계속 재출현. → **200**
- **state 잔류**: `closeDrawer()` 가 모달·픽커 open state 미리셋 → 전부 리셋 + 공용
  `closePlanModal`/`closeTrialModal` 로 **모든 닫기 경로**가 픽커까지 내리게
- **구독 화면이 면제를 모름**: 백엔드 집계 분리 + **프론트 뱃지/흐림/강등버튼 숨김** 까지
  (백엔드만 고치면 화면은 그대로 거짓말 — Fable C1)
- **god-file**: `routes/admin.js` 1183줄 → 구독·결제 419줄 `routes/admin_billing.js` 절출 → **761줄**
- **면제 술어 통일**: `services/billingExemptView.js` 신설(`isExemptNow`/`exemptWhere`/`exemptBusinessIds`)
- 입력검증(잘못된 날짜 → 400, SQL 원문 유출 차단) · 모달 focus trap · 슬러그 검색 · data-testid

**워프로랩 2개**: biz#1(irene, 데이터 전부) vs biz#2(루아, **전부 0건 · 활동 없음**).
biz#2 삭제는 되돌릴 수 없어 **Irene 결정 대기**.

---

## 참고 — 이번 사이클 상세

### 1. (A) 결제 면제 — 운영 #275 "테스터·내부는 계속 무료로"

**Irene 추가 지시**: *"이전 결제도 워크스페이스에서 한 거 다 실제 아니야. 매출로 잡히면 안 돼."*

설계 `docs/BILLING_EXEMPTION_DESIGN.md` (Fable 1차 FAIL → 개정 2 → 재심 PASS).

**핵심 절단면 2개 (되돌리지 말 것)**
- **면제 판정은 `services/plan.js getBusinessPlan()` 한 곳** — 면제면 `active=true` 확정 →
  `can()` 의 모든 게이트가 자동 통과. 라우트·컴포넌트가 따로 판정하면 갈라진다.
- **매출 여부는 결제 확정 시점에 `payments.is_revenue` 로 박제** — 조인 판정이면 면제를 끄는
  순간 과거 내부결제가 매출로 되살아난다(시점 오염). 박제 지점은
  `markPaymentPaid` **와** `markAddonPaid` **둘 다**.

**Fable 1차 FAIL 이 잡은 것 (재발 방지 가치 높음)**
- C1 `addonBilling.markAddonPaid` — `status:'paid'` 쓰기 **두 번째 지점** 누락
- C2 `services/trial.js` 가 `createPendingSubscription` 을 **서비스 직접 호출** → 라우트 게이트 우회.
  **그래서 게이트를 라우트가 아니라 서비스에 내렸다**
- C3 `payments.cancel_reason` 은 **존재하지 않는 컬럼**이었다(Subscription 것과 착각)
- C4 구독 복원이 중복 active 를 만들 수 있었다(2026-07-15 단일-active 사고 재현 직전)
- C5 백필 운영 id 하드코딩 → dev 검증이 dev 데이터를 오염시킴

**PASS 후에도 고친 것**: `restoreExemptSubscription` 의 `restored` 술어가 죽어 있었다 —
Sequelize `update()` 가 인스턴스를 먼저 변이시켜 뒤에서 `sub.status` 를 읽으면 항상 'active'
(memory `feedback_sequelize_update_mutation`). 통계·백필 로그가 거짓 보고. `wasActive` 선캡처로 수정.

**운영 반영에 필요한 것 (배포 시 순서)**
1. `cd /opt/planq/backend && node migrate-billing-exemption.js` (멱등, 9컬럼)
2. `node scripts/backfill-billing-exemption.js` **dry-run 으로 ★ 대상 5건 육안 대조**
3. `node scripts/backfill-billing-exemption.js --apply`

**백필 대상 (운영 slug 실측 2026-08-17) — 우리 소유만**
| slug | 구분 | 부여 플랜 |
|---|---|---|
| `워프로랩-mon3zaui` (biz1, irene) | internal | pro |
| `워프로랩-moqg29wi` (biz2, lua) | internal | pro |

> ★★ **테스터는 백필에 넣지 않는다** (Irene 2026-08-17):
> *"테스터는 솔루션 관리자가 지정을 해야지. 지금 가입해서 자동으로 스타터가 된 사람을
> 테스터라고 하면 어떻게 해?"* / *"내부 워크스페이스인지, 테스터인지 설정해야지."*
> 세일즈맵·withMIN lab·유피트를 테스터로 넣었다가 **뺐다** — 가입 상태에서 추론한 것이었다.
> 구분 지정은 platform_admin 이 `/admin/businesses` 상세 → "면제 설정" 에서 직접 한다.

**해소되는 운영 증상**: biz1 의 pending 39,000원 + 08-23 강등 · biz2 의 07-23 강등 상태 ·
테스터 3곳 잠금 · **매출로 잘못 잡힌 내부결제 155,800원(payment 1·2·3·5·7·8) 비매출 분리**.

### 2. (B) C2 알림 전수정리 — #278 · #281 · #282 · #214

- 신규 `services/notifyTitle.js` = 알림 제목 규약 **단일 원천**. `{기능} · {행위} · {대상}`,
  ko/en 표. **백엔드 문자열은 i18n 가드 사각지대**라 en 누락을 표에서 직접 지켜야 한다.
- `notify`/`notifyMany` 의 `titleSpec` → **수신자 언어로 발송 시점 해석**.
  `notifications.title` 은 DB 박제 + push payload 라 프론트 `t()` 로는 못 고친다.
- **빈 제목 결함(이번에 발견)**: `buildTitle` 은 미지 키에 **throw 하지 않고 빈 문자열**을 준다 →
  그대로 대입하면 오타 하나로 제목 없는 알림. `catch` 로는 못 잡는다. 비면 폴백 유지 + 오타 로그.
- `broadcastTask(task, event, actorUserId)` — payload `actor_user_id` (#282 자기알림 필터).
  **본문 전체 try/catch** — 호출부 13곳이 await 없이 부르므로 reject 하면 unhandled rejection.
- `mailNotify.isSelfSentPlatformMail` — 플랫폼 자기발신 메일이 되돌아와 알림이 되던 루프 차단.
  ★ 주소만 보면 안 된다: SMTP_FROM 은 noreply 가 아니라 **사람이 쓰는 사서함**이라
  `주소 정확일치 AND triage='automated'` 이중 조건.
- `NotificationToaster` 양방향 dedup (5초 창) — 진짜 연속 사건은 삼키지 않게.
- 신규 가드 `broadcastactor`.

### 3. ⚠️ 가드가 거짓 통과했던 사례 (이번 세션 최대 교훈)
신규 `broadcastactor` 가드가 **payload 에서 `actor_user_id` 를 지워도 통과**했다.
파일 전체에서 `actor_user_id: actorUserId` 를 찾았는데 그 키가 **같은 파일에 3번**
나온다 — 2번은 `TaskStatusHistory.create` 의 감사 필드다. **함수 본문으로 범위를 좁혀** 수정.
→ 3축(호출부 인자·payload 대입·시그니처) 전부 깨뜨려 EXIT=1 확인 후 원복.
**가드를 새로 만들면 반드시 깨뜨려 확인할 것** (memory `feedback_guard_must_be_falsified`).

### 4. Irene 결정 대기
- **테스터 3곳(세일즈맵·withMIN lab·유피트) 이 맞는지 확인** — 실고객이면 관리자 화면에서 OFF
- 팀 구글 연결: 재연결 vs 해제 (기존 안건)
- 운영 프로젝트 10번 "IRENE KIM Operating System" 대체/보존 · 월 루틴 "N주차" → 요일 지정 4건
- 피드백 장부 정리(platform_admin 만 가능): 해결·배포 완료인데 pending 다수
- 버전 **1.48.2 유지** (다음 배포 때 올릴 것)

### 5. ▶ 다음 세션 순서
1. C2 최종 게이트 결과 확인 → 커밋
2. **`/배포`** (Irene 명시 필요) → 마이그레이션 + 백필 dry-run → apply
3. 배포 후 운영 실측: biz1 결제 배너 소멸 · `/admin/overview` 비매출 분리 · 알림 제목 규약
4. 남은 운영 피드백 (#250 태그 · #252 문서 임시저장 · #254·#255 진척 그래프 · #256~#274)

---


### ⚠️ 베이스라인 갱신 함정 (이번 세션 실측)
`node scripts/guard-invariants.js --update-baseline` 을 **전체로 돌리면 무관한 파일까지 같이 완화된다** —
이번에 godfile 11개(calendar 1235→1277, tasks 2215→2289, QNotePage 4607→4628 …)가 한꺼번에 올라갔다.
그건 CLAUDE.md 가 금지하는 "베이스라인으로 삼키기" 다.
→ **백업 후 이번 변경분 키만 손으로 반영**할 것. 이번엔 3키만(전부 조이는 방향):
  `godfile.admin.js 1006→784` · `tenant.admin.js 5→2` · `tenant.admin_billing.js →1`

## 이번 세션에서 배운 것 (재발 방지)

1. **★ 게이트는 라우트가 아니라 서비스에 둔다.** 청구를 만드는 진입점이 라우트 하나가 아니었다 —
   cron 이 서비스를 직접 부른다. 라우트에만 걸면 cron 이 그대로 지나가 "면제인데 청구서가 나간다".
2. **★ 같은 일을 하는 지점이 하나인지 grep 으로 세어라.** `status:'paid'` 쓰기가 2곳이었고
   하나(애드온)를 놓칠 뻔했다. "단일 착지점" 은 주장이 아니라 전수 grep 으로 증명하는 것이다.
3. **★ 컬럼이 실재하는지 확인하고 쓴다.** `payments.cancel_reason` 은 없었다 — Subscription 것과
   착각했다 (memory `feedback_column_existence_verify`).
4. **★ 시점에 박제할 것과 조인할 것을 구분하라.** 매출 여부를 플래그 조인으로 두면 면제를 끄는
   순간 과거가 바뀐다. 사실이 확정되는 순간의 값을 그 행에 남겨야 한다.
5. **★ 대조군 없는 검증은 거짓 PASS 다.** 첫 cron 검증이 전부 PASS 였지만 `exempt_skipped:0` —
   면제 분기를 한 번도 안 탄 것이었다. 대조군(면제 없으면 실제로 강등)을 먼저 증명해야 한다.
6. **★ 가드를 새로 만들면 깨뜨려 확인한다.** 같은 키 이름이 파일에 여러 번 나와 감사 필드에
   걸려 거짓 통과했다. 범위(함수 본문)를 좁혀야 한다.
7. **★ throw 하지 않는 실패는 catch 로 못 잡는다.** `buildTitle` 이 빈 문자열을 돌려주는데
   `try/catch` 로 감싸고 "실패해도 폴백" 이라 주석을 달아뒀다 — 주석이 거짓이었다.
   **폴백은 반환값을 검사해야 성립한다.**
8. **★ 게이트가 깨지면 베이스라인을 올리지 말고 절출한다.** AdminBusinessesPage 921줄 →
   모달 절출 + 공용 `adminModalKit` → 713줄. 덤으로 모달 스타일 정본이 1벌이 됐다.
9. **★ fire-and-forget 함수는 본문 전체를 감싸야 한다.** 부분 try/catch 는 "절대 reject 안 함"
   보장을 만들지 못한다. await 없는 호출부가 13곳이면 reject = unhandled rejection.
10. **★ 운영 id 를 스크립트에 하드코딩하지 마라.** dev 와 운영은 id 매핑이 완전히 다르다
    (dev biz1 = 'Test Company'). 조건(slug)으로 고르고, 못 찾으면 **적용 없이 중단**.
11. **★ 백엔드만 고치면 화면은 그대로 거짓말한다.** 구독 화면 면제 반영을 백엔드만 하고
    프론트를 안 건드려, 집계에서만 빠지고 행에는 여전히 "강등됨" 이 떴다. 주석에 "프론트는
    이 값을 보고 뱃지를 띄운다" 라고 써놓고 프론트를 안 만든 것 — 기능은 **수신부까지**다.
12. **★ 신고가 연달아 나오는 화면은 한 겹 아래가 더 있다.** z-index 를 고쳤더니 같은 계열
    '잔류 상태' 가 날짜 픽커에 한 겹 더 있었다. 증상 하나를 고치고 끝내지 말고 같은 계열을 훑을 것.
13. **★ 문구가 계약이다.** 검색 placeholder 가 "이름 · 슬러그 검색" 인데 이름만 찾고 있었다.
    화면이 약속한 것을 코드가 지키는지 대조할 것.
