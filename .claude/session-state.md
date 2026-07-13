# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-13 (Opus, 1M) — 메일 답변 필요 판정 정합 + 보관함 노트 카운트 + Q Bill 탭 뱃지
**작업 상태:** 완료 (dev 검증 통과 · **미배포** — 배포하려면 `/배포`)

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

### 1. 메일 분류 규칙 학습 — 남은 부분
`mail_sender_rules` 테이블·라우트·설정 화면은 이미 있다(이번 세션에서 문구만 교정). 남은 것:
- 학습 트리거 실동작 검증 (같은 발신자 2회 "답변 불필요" → `no_reply` 규칙 자동 생성 → 기존 미처리 건 일괄 정리)
- 반대 신호(그 발신자에게 답장 → 규칙 즉시 해제) 실동작 검증
- 도메인 승격(같은 도메인 3개 no_reply → 도메인 규칙) 실동작 검증
- **헤더 미저장이 근본 문제** — `email_messages` 에 List-Unsubscribe·Precedence·Auto-Submitted 정도만 저장하면 재판정이 눈을 뜬다. 지금은 제목·발신자 패턴으로 우회 중.

### 2. LLM 게이트웨이 단일화 (2~3일, Fable 게이트)
raw fetch 13파일 · gpt-4o-mini 하드코딩 27곳 → 단일 모듈(모델 추상화·프롬프트 레지스트리·툴 호출·재시도·비용계량). costGuard·cue_usage 흡수하되 파괴 금지.

### 3. 행동 계층(Action Layer) 추출 (3일)
상태 전이가 12개 라우트에 인라인. `services/taskTransition.js` 가 첫 절단면 — 나머지 전이(approve/revision/complete/recalc)를 여기로 모은다.

### 4. #81 Cue 대화형 실행 (2일) — 2·3 선행 필수
### 5. KB 과잉 제거 (1일) — 운영 KB 총 527 bytes 인데 임베딩·청킹·하이브리드 완비
### 6. 잔여 부채 — god-file 분리(projects.js 3,071 · invoices.js 2,229 · QNotePage.tsx 4,464) · 이벤트 스트림 통합 · 검사 하니스 보강

### ⏸ Irene 몫
- 운영 task **#142 Stripe 활성화** · **#143 이메일 DKIM** · **#144 APNs 키**
- Google OAuth 검증 제출 (#126 캘린더 양방향 선행 조건)
- **admin role** — 2026-07-10 활성화 완료(dev). 운영 반영 시 수동 ALTER 선행 필요

---

## 🚀 배포 상태
이번 세션 **미배포**. dev 만 반영(재판정 8건 · 위키 시드 포함).
운영 배포하려면 `/배포` — 배포 시 운영에서도 `node scripts/retriage-mail.js --apply` + `node seed-wiki-content.js` 실행 필요.

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
