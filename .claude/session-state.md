# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-12 (Opus, 1M) — P0 에이전트 권한 모델 + 업무추출 보안 3건 + Q Mail 발신자·답변필요
**작업 상태:** 완료 (운영 배포 3회 완료). 다음 = 아래 "다음 섹션".

---

## ⚡ 빠른 재개 (새 세션에서 이것만 붙여넣기)

```
session-state.md 읽고 이어서 개발해.
```

---

## ✅ 이번 세션 완료 (2026-07-12) — 전부 운영 배포

### P0 에이전트 권한 모델 (Fable 게이트 CONDITIONAL → 권고 3건 반영)
Cue 가 담당자로 지정되면 자동 실행되는데 **권한 계층을 통째로 우회**하고 있었다.
- **위임 주체(principal)** — Cue 는 업무 요청자의 권한으로만 행동. fail-closed. 위임자가 AI 면 거부(권한 세탁 차단). 트리거한 사람이 아니라 위임자 기준(escalation 차단).
- **읽기 IDOR** — `execDraftReply` 가 business_id 만 비교 → 참여하지도 않은 대화방을 Cue 가 요약해 적어줬다. `canAccessConversation` 필수.
- **쓰기** — 신규 `services/taskTransition.js` 상태 전이 **단일 착지점**. 옛 코드는 status 직접 써서 reviewer 가드·이력·notify·broadcast·focus 전부 건너뜀. 컨펌자 0명이면 위임자 자동 등록(옛 코드는 approve 403 나는 **죽은 업무** 생성).
- **guard-invariants 14→16** — `cuefinance`(Cue 재무 영구 봉쇄를 게이트로 박제) + `cueauth`. 반증실험으로 유효성 증명.
- **감사** — `audit_logs.acting_for_user_id` (운영 ALTER **선행** 후 배포).

### 업무 자동추출 — Fable BLOCK 해제 (Irene: "이거 정말 중요")
- **F1** 외부 고객이 내부 업무후보 7건 조회(내부 대화 원문 포함) → 멤버 이상 강제
- **F2** 후보→업무 승격이 `assertAssignable` 우회 → 외부인 담당자화 + 타 워크스페이스 알림 발송(크로스테넌트 유출) → 게이트 추가
- **F3** 채팅 추출이 **고객을 담당자로 지정** → 담당자 풀에서 외부인·AI 코드 배제 + 프롬프트 가드(메일 경로와 동일)
- **F4** 업무명 "완료" 접미사 → `sanitizeTitle()`  **F5** Cue 담당 = 좀비 업무 → 등록자로 대체  **F6** pending 후보 중복 → 제목 dedup
- 담당자 결정 **설계는 옳았다** (LLM 은 이름만 제안, 코드가 확정). 풀에 고객이 섞인 게 문제였음.

### Q Mail
- **발신자 표시 오류** — 화면이 발신자 자리에 **내 메일함 이름**을 그렸다(PlanQ 알림이 "IRENE WP"로 보임). 데이터는 멀쩡, 화면이 틀림 → `counterpart`(마지막 inbound from_name) 추가. 운영 정상 확인.
- **발신 이름 원래 기준** — Gmail 연결 시 구글 프로필명이 박혔다 → `businesses.mail_from_name` 이 단일 원천. 운영 데이터 교정("워프로랩").
- **"답변 필요" 자가 오염** — PlanQ 알림이 Auto-Submitted 헤더 없이 나가 자기 알림을 "답장할 메일"로 분류. 오탐 93%. → RFC 3834 헤더 + `buildOwnEmailSet` + 백필. **운영 116 → 20건**. "답변 완료" 버튼 + 3일 경과 칩.
- **확인 필요 불침범(Fable C안)** — 메일은 확인 필요 total 에 미합산. Q Bill 과 같은 **Q Mail 메뉴 자체 배지**.
- **UI 표준** — 경계선 화살표 핸들(공통 `PanelEdgeHandle.tsx` 신규 추출), 공통 `EmptyState`, 업무 추출 버튼 Q Talk 통일, 계정 칩(회사/개인 + 주소), 탭 카운트 계정 필터 버그 fix, i18n 누락 채움.
- **메일 계정 관리자 교정 경로 복구** — 회사 대표 메일이 한 멤버 개인 메일로 등록(회사 메일 191건이 그 사람만 봄). admin 전환 버튼이 백엔드 404 로 **한 번도 동작한 적 없던 죽은 기능** → 최소 권한 교정 경로 신설.

---

## 🔖 다음 섹션 (우선순위)

### 1. 메일 분류 규칙 학습 (Irene 승인 완료 — 최우선)
운영하면서 클릭으로 학습해 조건을 구체화한다. **LLM 0.**
- 신규 `mail_sender_rules` (business_id · pattern(주소|도메인) · verdict(no_reply/always_reply/marketing/spam) · source(learned/manual) · hit_count · evidence)
- 학습: 같은 발신자 **2회 "답변 완료"** → `no_reply` 규칙 자동 생성 + **그 발신자의 기존 미처리 건 일괄 정리** + 앞으로 애초에 안 들어옴
- 반대 신호: 그 발신자에게 **답장하면 규칙 즉시 해제**(사람이 대응한다는 강한 신호 우선)
- 스팸 2회 → 도메인 단위 spam 규칙. 같은 도메인 주소 3개가 no_reply → **도메인 승격**
- **투명성 필수**: 설정에 "메일 분류 규칙" 화면(학습된 규칙·근거·삭제). 사용자 모르게 메일이 사라지면 안 됨. 규칙 적용 스레드에 "규칙으로 자동 분류됨" 표시
- 워크스페이스별 격리 (한 고객사가 배운 규칙이 다른 곳에 새지 않음)
- 규모 중 (테이블 1 + 라우트 3 + 설정 화면 1). 되돌리기 쉬움(규칙 삭제 = 원상복구, 원본 메일 무손상)

### 2. LLM 게이트웨이 단일화 (2~3일, Fable 게이트)
raw fetch 13파일 · gpt-4o-mini 하드코딩 27곳 → 단일 모듈(모델 추상화·프롬프트 레지스트리·툴 호출·재시도·비용계량). costGuard·cue_usage 흡수하되 파괴 금지.

### 3. 행동 계층(Action Layer) 추출 (3일)
상태 전이가 12개 라우트에 인라인. **`services/taskTransition.js` 가 첫 절단면** — 나머지 전이(approve/revision/complete/recalc)를 여기로 모은다. 이게 있어야 (a)Cue 툴 호출 (b)MCP 노출 (c)권한 검사 단일화.

### 4. #81 Cue 대화형 실행 (2일) — 2·3 선행 필수
### 5. KB 과잉 제거 (1일) — 운영 KB 총 527 bytes 인데 임베딩·청킹·하이브리드 완비. 롱컨텍스트+캐싱으로 단순화 = 코드 삭제
### 6. 잔여 부채 — god-file 분리(projects.js 3,071 · invoices.js 2,229 · QNotePage.tsx 4,464) · 이벤트 스트림 통합(6테이블 UNION) · 검사 하니스 보강(chrome-suppression · canary-crawl)

### ⏸ Irene 몫
- 운영 task **#142 Stripe 활성화** · **#143 이메일 DKIM** · **#144 APNs 키**
- Google OAuth 검증 제출 (#126 캘린더 양방향 선행 조건)
- 안 쓴 앱 비밀번호(`johq…`) 구글에서 취소 — 저장하지 않았음

---

## 🚀 배포 상태
이번 세션 **전부 운영 배포 완료**. 마지막 커밋 `1e194b2` · deploy 20260712_101401.
운영 백필 실행 완료: `backfill-mail-selfnotify.js --apply` (95건 재분류).
운영 DB 선행 ALTER 적용: `audit_logs.acting_for_user_id`.

## 🔑 환경/인증
- dev 백엔드 3003 · q-note 8000 / 운영 3004 · 8001 (POS 공존 — 절대 건드리지 말 것)
- 가드 3축: `node scripts/health-check.js`(30) + `node scripts/guard-invariants.js`(16) + `node scripts/e2e/run.js --suite tenant`
- 위키 게이트: `node dev-backend/seed-wiki-content.js` + `node dev-backend/scripts/wiki-coverage-check.js`
- 운영 메일 계정: help@irenewp.com(회사 공용, 발신명 "워프로랩") · irene@irenewp.com(Irene 개인)

## 📂 주요 문서
- `docs/AI_NATIVE_IMPLEMENTATION_PLAN.md` · `docs/PLANQ_AI_READINESS_AUDIT.md` · `docs/FEEDBACK_BACKLOG_PLAN.md`
- 메모리: `project_ai_native_strategy` · `project_guard_invariants_depersonalization` · `project_cost_guard_audit`

## 복구 가이드
새 세션: `session-state.md 읽고 이어서 개발해.`
