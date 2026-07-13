# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-13 (Opus, 1M) — 행동 계층 추출 (Fable D-3) · LLM 게이트웨이 (D-1) · 메일 판정 헤더 저장
**작업 상태:** 완료 (dev 검증 통과 · **미배포** — 배포하려면 `/배포`. ⚠️ 운영 배포 전 **수동 ALTER 선행 필요**)

---

## ✅ 이번 세션 완료 (3) — 행동 계층 추출 · Fable D-3 1사이클 (commit a9acd27)

업무 상태 전이가 12개 라우트에 인라인이라, **라우트를 안 지나는 실행자(Cue·cron)가 가드·이력·알림·broadcast·Focus 정리를 통째로 우회**할 수 있었다.

- **신규 `services/actions/task_actions.js`** — 11개 행동(ack·submit·cancel·complete·approve·revision·revert·revertStatus·reviewer 추가/제거·policy). 권한 검사는 **함수 진입부 1회** — 라우트와 Cue 가 같은 문.
- **`routes/task_workflow.js` 718 → 246줄** — 파싱·응답만. **에러 code 문자열도 계약**이라 그대로 유지(프론트가 분기).
- **가드 16→17** — `actionlayer`(라우트의 status 직접 쓰기·이력 기록·트랜잭션 차단) + **notify/broadcast 잠금 대상을 라우트 → 행동 계층으로 이동**(라우트만 잠그면 Cue 가 우회).
- **done_feedback 잔재 제거** — 대시보드의 항상 0건이던 죽은 쿼리 + 좀비 상태를 만들던 seed 3개. 모델 ENUM 은 **운영 잔존 행 확인 후 ALTER 필요**(dev 0건).

**★ 동작 무변경 증명 (이 리팩터의 유일한 합격 기준):** 12라우트 전수 시나리오를 실 HTTP 로 돌려 응답·상태·이력 순서·댓글·알림 건수를 박제 → 리팩터 후 재생 → **완전 일치**.

**Fable 게이트 CONDITIONAL(BLOCK 0)** — Fable 은 제출된 before 스냅샷을 믿지 않고 `git stash` 로 옛 코드를 복원해 **직접 다시 떠서 3자 대조**했다. 서버가 파일보다 오래된 코드를 물고 있던 것도 잡았다. socket 실수신·감사 IP·Cue 비대칭·운영 옛 task 전이 실증. 덤: 옛 policy_change 감사가 old_value 에 변경 '후' 값을 적던 버그가 정정됨.

---

## ✅ 이번 세션 완료 (2) — LLM 게이트웨이 단일화 · Fable D-1 (commit 48e9fae~8b5661a)

`services/llm.js` 는 이미 있었는데 **아무도 그 문을 지나가지 않았다** — 13곳이 각자 raw fetch 를 복붙. 그래서 429 를 아무도 재시도 안 했고(초안·번역 조용한 실패), 모델 교체는 13곳 수술이었고, 한 달에 몇 번 불렀는지 아무도 몰랐다.

- **호출부 11파일 이관 → raw fetch 0건.** 프롬프트 문구 변경 0, temperature·max_tokens·timeout 은 옛 실측값으로 레지스트리 교정 (동작 무변경 리팩터).
- **책임 경계** — costGuard·plan.can·recordUsage 는 흡수 안 함. 게이트웨이는 "어떻게 부르는가" 만 안다. 누가 부를 자격이 있는지는 도메인이 안다.
- **툴 호출 지원** (`tools` → `tool_calls`) — 게이트웨이는 **제안만 받고 실행하지 않는다**. #81 Cue 대화형 실행의 전제.
- **관측** — `/api/health.llm` (호출수·실패율·평균지연·토큰·용도별). 신규 테이블 0.
- **가드 15→16** — `llmgateway`: raw fetch 재유입 + 게이트웨이 공동화 차단. 반증실험 통과.
- **Fable 게이트: BLOCK 1건 → 수정 후 통과** — KB "AI 로 정리" 가 LLM **성공 후** 500 (`j.usage` 잔재 ReferenceError). 비용은 나가는데 사용자는 후보 0건. 실호출 재검증 200. 권고 3건 반영(kb_tags temp 근거 명시 · voice.js maxTokens 명시 · 커밋 5분할).
- **실호출 회귀 19/19** — Q helper·추정·번역·업무분해·자료정리 응답 형식 동일 + 용도별 통계 + cue_usage 증가 + tool_calls.

⚠️ **이관 함정 (다음에 또 만난다):** fetch 블록을 지우면 그 뒤에 남은 `data.usage` / `j.usage` 참조가 **try/catch 에 삼켜져 조용히 죽는다**. 나는 `data.usage` 만 grep 했고 `j.usage` 를 놓쳤다 — Fable 이 실호출로 잡았다. **이관 후에는 옛 응답 변수명(`data`·`j`·`r`)을 전수 grep 할 것.**

---

## ✅ 이번 세션 완료 (2026-07-13 후반) — commit 825e2b8

지난 세션이 남긴 1순위(메일 분류 규칙 학습 마무리)를 끝냈다. **릴리즈만 되고 아무도 실제로 돌려본 적 없던 학습 흐름**을 실 HTTP 로 전 경로 검증(29/29, 데이터 전량 원복)했고, 그 과정에서 조용히 죽어 있던 버그 2건과 dev 발송 사고 1건이 나왔다.

### ★ 광고 판정이 릴리즈 이후 한 번도 발동한 적 없었다
`isMarketing()` 의 1순위 신호는 `List-Unsubscribe` 인데 **mailparser 는 List-\* 를 `list` 키 하나로 접는다** → `headers.get('list-unsubscribe')` 는 **항상 undefined**. `Precedence: bulk` 를 붙이는 발송기만 걸렸고 **List-Unsubscribe 만 붙이는 가장 흔한 뉴스레터는 전부 빠져나갔다.**
→ 헤더 조회 단일 지점 `hget()` 이 접힌 객체(`{unsubscribe:{url,mail}, id:{...}}`)를 이해한다. **손으로 만든 Map 으로 테스트하면 이 버그는 절대 안 잡힌다 — 실 mailparser 출력으로만 드러난다.**

### ★ 판정용 헤더 저장 (지난 세션이 남긴 근본 문제 해결)
`email_messages.triage_headers` JSON (판정에 쓰는 키만 — List-\*·Precedence·Auto-Submitted·ESP). `headersFromMessage()` 단일 헬퍼로 복원. `retriageStored({headersComplete})` — 헤더 있으면 `triageInbound` 와 **같은 문**을 지나 처음부터 재판정 / 헤더 없는 옛 메일은 저장된 분류 신뢰(다시 계산하면 광고가 사람 메일로 뒤집힌다 — 실제 109건 사고). **dev 2,032건 재판정 → 재분류 0건** (옛 데이터 회귀 없음).

### ★ dev 에서 Q Mail 답장이 실제 고객에게 나가고 있었다
`.env` 는 `EMAIL_SENDING_ENABLED=false` 인데 **Q Mail 계정 발송(`emailSend.sendMail`)만 그 문을 비껴갔다**(outbound 4건 존재). 플랫폼 발송과 같은 게이트를 지나게 했다 — 발송만 멈추고 앱 흐름(outbound 기록·스레드 갱신·규칙 해제)은 유지(그래야 dev 에서 답장 흐름을 끝까지 검증할 수 있다).

### 상시 가드 신설 — `scripts/e2e/canary-mail-triage.js` (`node scripts/e2e/run.js --suite mail`)
실 mailparser 출력 검증 + **과잉 차단 카나리**(사람 문의가 살아 있는가) + 옛 메일 분류 유지. 반증실험: hget 의 list 대응을 되돌리면 3건 실패 → 원복 0.

### 가드 (전부 통과)
헬스 30/30 · guard-invariants 15/15 · e2e tenant·mail 0 · 위키 커버리지 exit 0 (프론트 변경 0 — 빌드 무관)

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## ✅ 이번 세션 완료 (2026-07-13)

전 세션이 SSH 끊김으로 중간에 멈춰 있었다 (커밋 안 된 변경 15파일). **이어받아 마무리 + 그 안에 있던 회귀 3건을 잡았다.**

### ★ 답변 필요 판정 — 순서가 곧 규칙 (`services/emailTriage.js`)
멈춰 있던 변경은 `needsReply` 를 "관계(아는 상대) 먼저" → "메일 성격 먼저" 로 바꾸는 중이었는데, **그 상태로 커밋했으면 회귀였다.** 실데이터 재판정 시뮬레이션(dev 400스레드)에서 오히려 **54건이 새로 답변 필요로 승격**됐다:

- **반송(bounce)** — mailer-daemon 은 **In-Reply-To 를 달고 온다** → "우리 대화 회신" 으로 통과. `isBounce()` 신설, 회신 판정보다 **먼저** 차단.
- **거래 알림** — 헤더를 DB 에 저장하지 않아 **재판정 경로에선 광고 판정(List-Unsubscribe)이 눈을 감는다**. 그래서 Shopee 배송/결제 알림이 그물을 빠져나갔고, 본문 상투구("Need help?" · "problems?")가 물음표·요청 신호에 걸려 **오히려 답변 필요로 올라왔다**. `isTransactionalNotice()`(제목 기반) 신설.
- **URL 물음표** — 추적 URL 의 `?` 가 질문으로 잡혔다 → `plainText()` 로 링크 제거 후 판정. 요청 신호 창도 앞 1200자로 축소(뒤쪽 상투구 배제).

**최종 판정 순서 (코드와 1:1):** 우리가 보낸 것 → 반송 → 대량 발송 → 거래 알림 → **회신(true)** → 자동 발송 → **아는 상대(true)** → 모르는 상대 + 직접 수신 + 명확한 요청/질문.

**실측 결과:** 오승격 **0건** · 노이즈 해제 8건(Shopee·WordPress 벌크 → 확인 권장). `scripts/retriage-mail.js --apply` dev 반영 완료(2025건 중 8건).

- **확인 완료 스레드 재개** — 처리(archived)한 대화에 새 메일이 오면 어느 폴더에도 안 나타나고 조용히 묻혔다 → `threadFieldsForInbound()` 로 신규/후속 규칙을 한 곳에 모으고, archived 는 새 메일 시 재개(스팸만 예외).

### 개인 보관함 노트 카운트 (죽어 있던 값)
요약 API 가 q-note 응답을 `jq.total` / `jq.sessions` 로 읽었는데 실제 형태는 `{ data, pagination: { total } }` → **항상 0**. 파싱 교정 + 대시보드 KPI 카드·빈 상태 조건·i18n(ko/en) 완결. 실 HTTP 검증: `counts.notes = 56` = q-note 원본 56 일치.
(Q Note 가 내려가 있으면 `notes` 필드 자체가 안 온다 → 그때는 카드도 안 그린다. 0 이라고 거짓말하지 않게.)

### 그 외
- **Q Bill 탭별 할 일 뱃지** — 좌측 메뉴에만 숫자가 뜨고 어느 탭에 할 일이 있는지는 알 수 없었다 → `/api/dashboard/todo.billTabCounts` + 탭 옆 숫자 (합계 = 메뉴 뱃지 검증).
- **프로젝트 → 소통 창구 바로가기** — 프로젝트 상세 헤더에 "프로젝트 채팅"·"프로젝트 메일" (Q Mail 이 `?project=` URL 필터 수신).
- **용어 교정** — "답변 완료" → **"답변 불필요"** (실제 동작은 '답장 안 해도 되는 메일을 내리는 문'). 보관함 첫 탭 "대시보드" → "개요". Q위키 아티클도 같이 갱신(옛 용어·옛 규칙 설명이 화면과 어긋나 있었다).

### 가드 (전부 통과)
헬스 30/30 · guard-invariants 15/15 · e2e tenant 0 실패 · 프론트 빌드 EXIT 0 / TS error 0 · 위키 커버리지 EXIT 0

---

## 🔖 다음 섹션 (우선순위)

> **메일 분류 규칙 학습 — 완료.** 학습·해제·도메인 승격·규칙 삭제 복구 전부 실 HTTP 실증. 헤더 저장으로 재판정이 눈을 떴다. 지난 세션의 제목 패턴 우회(`isTransactionalNotice`)는 **헤더 없는 옛 메일용 안전망으로 남긴다** — 새 메일은 헤더로 판정한다.

### 1. LLM 게이트웨이 단일화 (2~3일, Fable 게이트)
raw fetch 13파일 · gpt-4o-mini 하드코딩 27곳 → 단일 모듈(모델 추상화·프롬프트 레지스트리·툴 호출·재시도·비용계량). costGuard·cue_usage 흡수하되 파괴 금지.

### 2. 행동 계층 2사이클 — 생성 계열 (2일)
1사이클(task 전이) 완료. 남은 것: `task_create` / `comment_create` / `event_create` / `document_draft` — #81 이 필요로 하는 생성 계열. **invoice 는 의도적으로 카탈로그 제외**(재무 영구 봉쇄).

### 3. #81 Cue 대화형 실행 (2일) — 1·2 선행 완료되면 "행동 계층에 툴 시그니처 씌우기" 로 축소
### 4. KB 과잉 제거 (1일) — 운영 KB 총 527 bytes 인데 임베딩·청킹·하이브리드 완비
### 5. 잔여 부채 — god-file 분리(projects.js 3,071 · invoices.js 2,229 · QNotePage.tsx 4,464) · 이벤트 스트림 통합 · 검사 하니스 보강

### ⏸ Irene 몫
- 운영 task **#142 Stripe 활성화** · **#143 이메일 DKIM** · **#144 APNs 키**
- Google OAuth 검증 제출 (#126 캘린더 양방향 선행 조건)
- **admin role** — 2026-07-10 활성화 완료(dev). 운영 반영 시 수동 ALTER 선행 필요

---

## 🚀 배포 상태
**미배포 (2 사이클 누적)** — 앞 사이클(메일 판정 정합·보관함 노트 카운트·Q Bill 탭 뱃지) + 이번 사이클.

⚠️ **운영 배포 시 순서 (수동 ALTER 선행 — 안 하면 메일 수집이 전부 실패한다):**
1. `ALTER TABLE email_messages ADD COLUMN triage_headers JSON NULL AFTER references_chain;`
2. `/배포`
3. 운영에서 `node scripts/retriage-mail.js --apply` (옛 메일 재판정) + `node seed-wiki-content.js`

## 🔑 환경/인증
- dev 백엔드 3003 · q-note 8000 / 운영 3004 · 8001 (POS 공존 — 절대 건드리지 말 것)
- 가드 3축: `node scripts/health-check.js`(30) + `node scripts/guard-invariants.js`(15) + `node scripts/e2e/run.js --suite tenant`
- 위키 게이트: `node dev-backend/seed-wiki-content.js` + `node dev-backend/scripts/wiki-coverage-check.js`
- q-note 실 DB: `/opt/planq/q-note/data/qnote.db` (루트의 `qnote.db` 는 빈 껍데기 — 헷갈리지 말 것)
- 운영 메일 계정: help@irenewp.com(회사 공용, 발신명 "워프로랩") · irene@irenewp.com(Irene 개인)

## 📂 주요 문서
- `docs/AI_NATIVE_IMPLEMENTATION_PLAN.md` · `docs/PLANQ_AI_READINESS_AUDIT.md` · `docs/FEEDBACK_BACKLOG_PLAN.md`
- 메모리: `project_ai_native_strategy` · `project_guard_invariants_depersonalization` · `project_cost_guard_audit`

## 복구 가이드
새 세션: `session-state.md 읽고 이어서 개발해.`
