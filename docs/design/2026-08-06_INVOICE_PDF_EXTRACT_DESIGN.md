# 설계서 — ③ 정기청구 PDF 첨부 복구(공용 서비스 추출) + ④ health-check PDF 실호출 항목

- 작성: Opus (2026-08-06)
- 게이트: **Fable 설계 게이트** (돈·발송 영역 + 가드 신설 → 고위험 2·5 해당)
- 배경: `.claude/session-state.md` ③④ / Irene 지시 "③④ 해. 다음 섹션에."

---

## 0. 문제 (실측 확인 완료)

```
services/recurring_invoice.js:195         require('./pdfBuilder')   ← git 이력 전체에 존재한 적 없음
services/clientSubscriptionBilling.js:257 require('./pdfBuilder')   ← 동일
routes/invoices.js:91  async function buildInvoicePdf(invoiceId)    ← 진짜 구현
                       module.exports = router 뿐 — export 안 됨
                       라우트 내부 호출부 5곳: 632 · 1047 · 1382 · 1467 · 1627 (정상 동작 중)
```

두 엔진 모두 아래 형태:

```js
let attachments = null;
try {
  const { buildInvoicePdf } = require('./pdfBuilder');
  if (typeof buildInvoicePdf === 'function') { ... }
} catch { /* pdf 미지원 — 이메일만 */ }
```

`require` 가 `MODULE_NOT_FOUND` 로 던지는데 **빈 catch 가 삼킨다.** 로그 0.
→ **정기청구 자동 발송 메일에 청구서 PDF 가 한 번도 첨부된 적 없다.** 무증상.
(메일 본문의 `shareUrl` 링크는 정상 포함되므로 고객이 청구서에 도달은 했다.)

계열: memory `feedback_completed_but_dead_features` · `feedback_apifetch_no_throw_silent_save`.

---

## ③ 절단면

### A. `services/invoicePdf.js` 신설 — **순수 이동**

`routes/invoices.js:91-107` 을 그대로 옮긴다. **로직 변경 0.**

- 반환 시그니처 `{ pdf, invoice }` 유지 (호출부 632·1047 이 `invoice` 를 함께 쓴다)
- `invoice` 없으면 `throw new Error('not_found')` 유지
- require 방향: `invoicePdf → models · pdfTemplates · pdfService`. `routes/invoices → invoicePdf`.
  **순환참조 없음** (invoicePdf 는 routes 를 참조하지 않음)

### B. `routes/invoices.js`

- 상단에 `const { buildInvoicePdf } = require('../services/invoicePdf');`
- 로컬 함수 정의 삭제
- **호출부 5곳 무변경** (이름 동일)

### C. 두 엔진

- `require('./pdfBuilder')` → `require('./invoicePdf')`
- `typeof buildInvoicePdf === 'function'` 가드 **제거** — 모듈이 실존하므로 죽은 방어.
  남겨두면 다음 사고 때 또 조용히 통과한다.
- 빈 `catch {}` → 로그 필수:
  ```js
  } catch (e) {
    console.warn('[recurring_invoice pdf] inv', invoice.id, e.message);
  }
  ```
  (`clientSubscriptionBilling` 은 `[clientSub pdf] sub`, `inv`)

### D. 실패 정책 — **PDF 실패해도 메일은 발송** (현행 유지)

근거: 본문 `shareUrl` 로 고객이 청구서에 도달 가능. PDF 실패로 청구 메일 자체를 막으면
**수금이 멈춘다** = 더 큰 피해. 단 실패는 반드시 로그.

→ **Fable 판정 요청 항목 1.** 돈 영역이므로 이 정책이 맞는지 독립 검토.
   대안: 실패 시 `notifyPlatformAdmins` 또는 워크스페이스 owner 알림까지 갈지.

### E. 범위 밖 (건드리지 않음)

- `services/billing.js:buildReceiptPdf` — **SaaS 구독 영수증**. Q Bill 청구서와 별개(memory
  `project_subscription_payment_plan` 5불변식). 이번 추출과 무관.
- `services/pdfService.js` · `pdfTemplates.js` — 무접촉

---

## ④ health-check 에 실제 PDF 1바이트 생성 항목

### 왜 필요한가

#253 은 **운영에만 없던 시스템 의존성**(헤드리스 Chrome 공유 라이브러리 12개)이라
코드 검증·가드 3축 어디서도 안 잡혔다. dev 는 e2e 하니스 때문에 라이브러리가 있어 통과.
단일 착지점 `pdfService.js` 하나가 죽어 **PDF 6개 기능이 동시에 500** 이었다.

### A. `GET /api/internal/health/pdf` 신설 (`routes/internal.js`)

```js
// 고정 최소 HTML → renderPdfFromHtml → %PDF- 매직 + 바이트 확인
router.get('/health/pdf', async (req, res, next) => { ... });
// 응답: { success:true, data:{ bytes: 12345, magic_ok: true } }
```

- **인증**: `routes/internal.js:37` 의 `router.use(requireInternalKey)` 가 신규 라우트에도 자동 적용
  (`x-internal-api-key`). 공개 라우트 추가 아님 → 보안 경계 변경 최소
- **노출**: nginx `location /api/internal { deny all; }` (dev·운영 동일) → 외부 도달 불가
- **DoS**: chrome 렌더는 비싸다 → 라우트 자체에 `perUserLimiter` 계열 또는 단순 분당 5회 캡

**왜 HTTP 인가 (중요):** 별도 `node -e` 프로세스로 재면 **환경이 다르다.**
운영의 `LD_LIBRARY_PATH` 는 `/opt/planq/backend/.env` 에 있고 dotenv 가 `process.env` 에 넣어야
puppeteer 가 띄우는 chrome **자식 프로세스가 상속**한다. 실제로 PDF 를 서빙하는
**백엔드 프로세스 자신이 렌더해야** 진짜 운영 상태를 잰다. 별도 프로세스는 거짓 PASS/FAIL 을 만든다.

### B. `scripts/health-check.js` — `defineInfraTests()` 에 항목 추가

- `/opt/planq/dev-backend/.env` 에서 `INTERNAL_API_KEY` 를 읽어 헤더로 전송
- **원격 `--host=` 실행 시**: nginx 가 deny 하므로 도달 불가 → 기존 `isLocal` 게이트 패턴 준용
- **fail-closed**: 키를 못 읽거나 응답이 이상하면 **skip 이 아니라 FAIL**
  (memory `feedback_guard_must_be_falsified` — 안 잡는 가드는 없는 것보다 나쁨)
- 판정: HTTP 200 AND `magic_ok === true` AND `bytes > 1000`

→ **Fable 판정 요청 항목 2.** `isLocal` 게이트를 두면 원격 운영 검증에서 이 항목이 조용히
   사라진다. 그런데 #253 은 정확히 **운영에서만** 나는 계열이다. 게이트 설계가 목적을 배반하지
   않는지 검토 필요. (아래 C 가 이를 보완하는 구조)

### C. `scripts/deploy-planq.sh` — 배포 직후 운영 실측

기존 `ssh PROD_HOST "curl -sf localhost:$PROD_PORT/api/health"`(428행) **직후**에 추가:

- 운영 호스트 **내부에서** `localhost:$PROD_PORT/api/internal/health/pdf` 호출
- 키는 운영 `.env` 에서 **서버 내부에서만** 추출 (dev 로 키가 넘어오지 않게)
- 이것이 "배포 직후 자동 검출" 의 실체. B 의 `isLocal` 한계를 여기서 메운다

**실패 시 처리 — Fable 판정 요청 항목 3:**
`error`(배포 중단) vs `warn`(명시 출력 후 계속). 제안은 **warn**:
이 시점은 코드가 이미 착지한 뒤이고, PDF 파손은 배포와 무관한 시스템 의존성 계열이라
배포 스크립트를 중단시켜도 되돌릴 게 없다. 다만 **눈에 띄게** 출력해야 한다.

### D. 반증 (필수 — 채택 조건)

dev 에는 라이브러리가 정상이라 `LD_LIBRARY_PATH` 제거로는 FAIL 재현이 **안 된다**.
→ `services/pdfService.js` 의 `launch()` 에 존재하지 않는 `executablePath` 를 일시 주입 →
   health-check 이 **FAIL 하는지 실측** → 복원.

- 백업은 **`cp`**, 복원 후 **md5 일치 확인**
- **`git checkout --` 금지** (memory `feedback_no_git_checkout_uncommitted` — 미커밋 구현 소실 전례)

---

## 검증 계획 (Fable 구현·테스트 게이트에서 수행)

1. **diff 범위 대조** — 설계 외 변경 0
2. **가드 3축** — `health-check.js`(신규 항목 포함) · `guard-invariants.js` 22/22 · tenant 0 · `npm run build` REAL_EXIT 0 / TS 0
3. **실호출 — 추출이 회귀를 만들지 않았는지**
   - 라우트 5개 호출부 중 최소 2개를 실 HTTP 로: 청구서 PDF 다운로드 200 + `%PDF-` + 바이트수
   - **추출 전/후 동일 invoice 의 PDF 바이트 비교** (순수 이동이므로 동일해야 함 — 또는 최소 동일 크기대)
4. **실호출 — 정기청구 엔진 2개 직접 실행** (Opus 미검증 지점, 직전 사이클에서도 여기서 결함이 나왔다)
   - `recurring_invoice` · `clientSubscriptionBilling` 을 실제로 돌려 **발송 메일에 PDF 첨부가 실제로 붙는지**
   - dev 는 메일 발송 게이트가 있으므로(memory `feedback_email_send_gate`) `attachments` 배열이
     실제로 채워지는지 + `content` 가 `%PDF-` 로 시작하는지를 착지점에서 확인
   - 발송 억제 상태에서도 **첨부 생성 자체는 일어나야 한다**
5. **반증 2건**
   - `require('./invoicePdf')` 를 다시 `./pdfBuilder` 로 되돌리면 → 새 `console.warn` 이 실제로 찍히는지
     (= 여태 무증상이던 것이 이제 보이는지)
   - ④D 의 executablePath 파손 → health-check FAIL 실측
6. **옛 데이터 sample 1건** — 운영에서 넘어온 옛 invoice 로 PDF 생성 (memory `feedback_legacy_data_sample_verify`)
7. **배포 안전성** — 마이그레이션 없음(스키마 무변경) · 롤백은 `backups/{TIMESTAMP}` · 프론트 무변경

---

## 영향 파일

| 파일 | 변경 |
|---|---|
| `dev-backend/services/invoicePdf.js` | **신규** — routes/invoices.js:91-107 순수 이동 |
| `dev-backend/routes/invoices.js` | 정의 삭제 + 상단 import (호출부 5곳 무변경) |
| `dev-backend/services/recurring_invoice.js` | require 경로 + typeof 가드 제거 + catch 로그 |
| `dev-backend/services/clientSubscriptionBilling.js` | 동일 |
| `dev-backend/routes/internal.js` | `GET /health/pdf` 신규 + rate-limit |
| `scripts/health-check.js` | infra 카테고리 항목 1개 추가 |
| `scripts/deploy-planq.sh` | 배포 후 운영 PDF 실측 1단계 추가 |

프론트엔드 변경 **0** · DB 스키마 변경 **0** · i18n 변경 **0**

---

## Fable 판정 요청 3건 (요약)

1. **PDF 실패 시 메일 발송 정책** — 첨부 없이 발송(제안) vs 발송 보류. 돈·수금 영향
2. **health-check `isLocal` 게이트** — 원격 운영 검증에서 항목이 사라지는 구조가 목적을 배반하는지
3. **배포 스크립트 PDF 실패** — `error`(중단) vs `warn`(제안)

그 외 절단면 자체의 누락·리스크·과다범위 독립 검토.
