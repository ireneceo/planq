# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-11 (Opus, 1M) — 운영 피드백 백로그 전건 소진 + 돈·보안 사고 6건 근본수정 + AI-네이티브 전략 확정
**작업 상태:** 완료 (운영 배포 완료). 남은 것 = 아래 "다음 섹션" 개발 리스트.

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## ✅ 이번 세션 완료 (2026-07-11)

### 돈·보안 사고 6건 (전부 운영 배포)
1. **연체 독촉 자동발송 폐지** — 결제 마킹이 수동인데 cron 이 고객에게 독촉 메일을 자동 발송하고 프로젝트를 자동 정지시켰다. 입금했는데 마킹 전인 고객을 재촉하는 사고. → 담당자에게 "독촉 보낼까요?" 알림만, 발송은 사람이. 7일 간격 재질의, 청구서별 알림 끄기. (`overdue_handler.js` 재작성)
2. **정기청구 중복 발행** — 동시 실행 시 청구서 2장 발행(실증). invoice_number UNIQUE 가 유일 방어였는데 재시도 루프가 그걸 무력화. → `invoices.idempotency_key` UNIQUE (sub:{id}:{date} / proj:{id}:{YYYY-MM}). 크래시 후 청구 영구정지 자가치유 포함.
3. **Cue 정보 유출** — Cue 가 고객 채팅방에서 답할 때 남의 개인(L1) 일정·내부 업무·청구 내역을 권한 필터 없이 LLM 프롬프트에 넣었다. → `access_scope.calendarListWhere` 신설(사람 라우트와 AI 가 같은 규칙), cue_context 스냅샷 3종에 scope 관통, orchestrator 가 발화자 scope 전달.
4. **Webhook 없이 카드결제 버튼 켜짐** — Secret Key 만 넣어도 버튼이 켜져, 고객이 결제하면 돈은 들어오는데 청구서가 영영 미확정. → `isStripeEnabled = secret && webhookSecret`.
5. **입금 계좌를 일반 멤버가 변경 가능** — 청구서 발행은 owner 전용인데 계좌는 아니었다. → owner/admin 게이트 + 프론트 잠금.
6. **공개 페이지 XSS** — PublicKbDocument/Bundle 이 사용자 HTML 을 정화 없이 렌더(script/onerror 실행 가능). → `utils/sanitizeHtml.ts`(DOMPurify) 단일 원천, 공개 3페이지 적용.

### 조용히 죽어 있던 기능 3건
- 채팅방 청구서 카드가 **한 번도 갱신된 적 없음** (Sequelize 가 JSON path `$` 를 `$$` 로 이스케이프 → 쿼리 항상 실패, catch 가 삼킴)
- 통합보고서 전사 요약 자동저장 유실 (unit row 가 '확정' 시점에만 생성)
- 업무 첨부 이미지 410 (#134 — Drive 저장분을 로컬에서 찾음)

### 운영 피드백 19건 전건 소진 → **운영 DB done 135건, 남은 2건**(#81·#126, 아래 리스트)
#134(첨부 provider) · #85(통합보고서 SCR) · #112(승인 코멘트) · #131(월간뷰 일정추가) · #135(회의링크 복사) · #126c(날짜피커) · #99b(공개 업무 페이지) · #125a(네이티브 OAuth 복귀) · #138(이모지 리액션 신규) · #127(메모 풀블리드) · #130(Q Mail 사이드바 통일) · #136(프로젝트 설정탭 분리) · #128(보관함 대시보드) · #137(가격 39,000)

### 가격 인상
베이직 29,000 → **39,000원** (연 390,000). 근거: 한도 최대 사용 시 외부 원가(Q Note STT 스테레오 2배 + Cue 1,500)가 29,000의 절반 → 원가율 50%. 인당 7,800원(5명)으로 여전히 저렴. 프로(79,000)와 정확히 2배. 외부 유료고객 0 = 인상 저항 0. **기존 구독은 sub.price 로 자동 유예**(워프로랩 29,000 유지). ⚠️ Fable 구독 전과정 게이트 결과 확인 필요(미완이면 재실행).

### AI-네이티브 전략 확정 (Fable 3인 감사 + 통합 설계)
- `docs/FEEDBACK_BACKLOG_PLAN.md` · `docs/PLANQ_AI_READINESS_AUDIT.md`(13축 4.9/10) · `docs/AI_NATIVE_TRENDS_2026.md` · `docs/AI_NATIVE_IMPLEMENTATION_PLAN.md`
- **Irene 확정 결정 3건** (memory `project_ai_native_strategy`): ①Cue 재무 행동 **영구 봉쇄** ②MCP 외부 개방 **보류**(내부 정비 후) ③#81 Cue 툴 호출은 **게이트웨이·행동 계층 뒤에**
- 실측: 청구 동시실행 2장 · Cue 권한 우회 · **KB 총량 527 bytes**(임베딩 과잉) · MCP/API key/webhook/function-calling 전부 0 · 감사 6테이블 UNION

---

## 🔖 다음 섹션 — 개발 리스트 (우선순위 순)

### P0 — 보안·돈
1. **에이전트 권한 모델** (2~3일, Fable 게이트)
   - Cue 의 **쓰기**가 여전히 권한 계층 우회 (`cue_task_executor.js`·`cue_orchestrator.js` 에 access_scope/requireMenu 0건). 오늘 막은 건 읽기(컨텍스트)뿐.
   - 사람에게 걸린 reviewer 가드(`tasks.js:1084`)를 Cue 가 우회 (`cue_task_executor.js:212-216`)
   - **Cue 재무 행동 영구 봉쇄를 guard-invariants 에 불변식으로 박제** (Irene 확정)
   - on-behalf-of 위임: "누구 권한으로 행동하는가" 를 감사에 기록 (현재 audit_logs 로 재구성 불가 — acting_for 컬럼 부재)
   - Linear 식 delegate vs assignee 판정 (Cue 가 tasks.assignee_id 에 들어감 = 책임 주체가 AI)

### P1 — AI-네이티브 전환 (docs/AI_NATIVE_IMPLEMENTATION_PLAN.md D절)
2. **LLM 게이트웨이 단일화** (2~3일, Fable 게이트) — raw fetch 13파일 · gpt-4o-mini 하드코딩 27곳 → 단일 모듈(모델 추상화·프롬프트 레지스트리·툴 호출·재시도·비용계량·평가훅). costGuard·cue_usage 흡수하되 파괴 금지.
3. **행동 계층(Action Layer) 추출** (3일, 되돌리기 어려움 — 절단면 정교하게) — 상태 전이가 12개 라우트에 인라인. 이게 있어야 (a)Cue 툴 호출 (b)MCP 노출 (c)권한 검사 단일화.
4. **#81 Cue 대화형 실행** (2일) — 위 2·3 선행 필수. 지금 급조하면 14번째 raw 호출 + 권한 우회 쓰기 추가.
5. **KB 과잉 제거** (1일) — 운영 KB 총 527 bytes 인데 임베딩·청킹·하이브리드 검색 완비. 롱컨텍스트+프롬프트 캐싱으로 단순화 = **코드 삭제**. (`kb_service.js` 200청크 윈도우도 같이)
6. **#126 캘린더 양방향 동기화** — Google OAuth 검증 제출(Irene, 운영 task #142 아님 — 별도) 선행. 현재 개인 연동 scope=readonly.

### P2 — 부채·정비
7. god-file 분리 — `projects.js` 3,071 · `invoices.js` 2,229(생명선) · `QNotePage.tsx` 4,464
8. 죽은 컬럼·코드 제거 119건 (PortOne/Popbill 잔재, `Project.paused_at` 은 **죽지 않았음** — recurring_invoice 가 실제로 읽음. 단 수동 정지 UI 부재 = 설계 부채)
9. 이벤트 스트림 통합 — "30일간 모든 일" = 6테이블 UNION (actor 컬럼명 3종 이질)
10. durable execution 최소안 — 크래시 시 진행 중 AI 작업 유실. Temporal/BullMQ 전면 도입은 **과잉으로 배제**.
11. 검사 하니스 보강 — chrome-suppression 스위트 · canary-crawl 라우트 자동 인벤토리

### ⏸ Irene 몫 (운영 워프로랩에 업무 생성 완료 — 2026-07-11)
- **운영 task #142** Stripe 라이브 결제 활성화 (키·웹훅·소액 스모크)
- **운영 task #143** 이메일 DKIM 설정 (스팸 격리 위험)
- **운영 task #144** 네이티브 앱 APNs 키
- (업무 아님) Google OAuth 검증 제출 — #126 선행 조건

---

## 🚀 배포 상태
이번 세션 전부 운영 배포 완료 (마지막 `c5e32e9`). **가격 변경(39,000)은 미배포** — Fable 구독 게이트 통과 후 배포.

---

## 🔑 환경/인증 현황
- dev 백엔드 port 3003 (irene PM2 planq-dev-backend). q-note 8000/운영 8001.
- 운영: 87.106.78.146 port 3004. POS 공존(건드리지 말 것).
- 가드 3축: `node scripts/health-check.js`(30) + `node scripts/guard-invariants.js`(14) + `node scripts/e2e/run.js --suite tenant`
- 운영 DB 선행 마이그레이션 적용분: `invoices.idempotency_key` · `task_attachments.storage_provider` ENUM s3 · `message_reactions`(FK+utf8mb4_bin)
- Stripe 키: dev·운영 모두 미저장(휴면 — 운영 task #142)

## 📂 주요 문서
- 전략/설계: `docs/AI_NATIVE_IMPLEMENTATION_PLAN.md` · `docs/PLANQ_AI_READINESS_AUDIT.md` · `docs/AI_NATIVE_TRENDS_2026.md` · `docs/FEEDBACK_BACKLOG_PLAN.md`
- 메모리: `project_ai_native_strategy`(Irene 결정 3건) · `project_guard_invariants_depersonalization` · `project_cost_guard_audit`

## 복구 가이드
새 세션: `session-state.md 읽고 이어서 개발해.`
