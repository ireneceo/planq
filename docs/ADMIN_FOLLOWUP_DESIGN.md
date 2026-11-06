# 신규 고객 팔로업 — 설계 (Fable 판정 DESIGN-FIX 정본 · 2026-11-06)

> Irene 2026-11-06: *"신규고객 팔로잉하는 히스토리 한번에 보는 화면 만들어달라고 했었는데 없어? 누가 누가 들어왔고 지금 어떤 상태이고
> 어떤 도움을 전하면 될지, 메시지도 직접 보내게 해줘서 밀착마크하게."*
> «고객» = PlanQ 를 쓰는 워크스페이스. 바탕: `docs/PLANQ_GUIDE_ROOM_DESIGN.md`(1단계 여정 · 3단계 안내방). 이 화면은 그 둘을 한 줄로 묶는다 —
> 5단계(제안 메시지·support_nudges·크론) 없이 «지금 있는 데이터 + 사람이 보냄».

## 범위·정렬
- 포함: `deleted_at IS NULL` ∧ (가입 N일 이내 ∨ `subscription_status='trialing'`). N ∈ {7, 30, 90}, 기본 30, 그 밖 400.
- 제외: 면제 중 ∧ `billing_exempt_kind='internal'`(우리 것). tester·partner 면제는 포함 + 칩.
- 정렬: `recent`(가입 최신, 기본) · `help`(도울 일 수 ↓ → 최상 우선순위 → 가입 최신). 검색 = 이름·대표 이메일(`businessSearchOr`).

## API (platform_admin)
- `GET /api/admin/followup?days&sort&q&limit(기본 25·최대 50)&offset` — `routes/admin_followup.js`.
- `GET /api/admin/followup/:businessId/draft?key=` → `{key, lang, text}` — 대표 언어 틀(`services/followupRules.TEMPLATES`). 보내지 않는다.
- 보내기 = 기존 `POST /api/admin/support/rooms/:businessId/messages` + `rule_key`(선택, 규칙표 키만 · 아니면 400) → `meta.followup_rule` · 감사 `support.admin_send` newValue.rule_key.
- 요약 `services/followupSummary.summarize(businesses)` — 묶음 쿼리 ≤10 + 대표 단계(사람 1명 ~13 쿼리, 5곳씩).
- **막힘 신호는 `computeSignals` 한 함수** — `routes/admin_journey.js` 도 이것을 부른다(복제 금지).
- 사용 모양만 — 업무·대화방·문서·파일 이름 0.

## «도울 일» 규칙표 (`services/followupRules.js` — 5단계 supportNudgeRules 의 1차 묶음, 키 이름 고정)
| P | key | 조건 |
|---|---|---|
| 1 | trial_ended | 신호 trial_ended |
| 1 | trial_ending | 신호 trial_ending (D≤3) |
| 2 | mail_error | 신호 mail_error |
| 2 | inactive | 신호 inactive (≥5일) |
| 3 | stage_stalled | 신호 stage_stalled |
| 3 | solo | 신호 solo |
| 4 | no_app | 앱 없음 ∧ 가입 ≥7일 |
| 5 | welcome | 가입 ≤2일 ∧ PlanQ 팀 발언 없음 ∧ 다른 도울 일 0 |
- 줄에는 상위 2개, 드로어에는 전부. 그 규칙 초안으로 보낸 적 있으면 회색 «n일 전 보냄»(막지 않음). 알림·캘린더·AI 앱 미연결은 칩만(규칙 아님).

## 화면 `/admin/followup` (메뉴 «신규 고객» — 안내방 바로 아래)
- 줄: 이름·대표 · 가입일·체험 D-n·대표 단계·마지막 접속·멤버 수 · 빠진 설정 회색 칩 · 막힘 신호 · 도울 일 2 · 안내방 안 읽음/마지막 대화 · [메시지].
- [메시지] 드로어(`?business=`): 도울 일 칩(누르면 초안이 입력칸에) · 여정(`AdminBusinessJourney` 그대로) · 안내방 대화·답 쓰기(`AdminSupportThread` — 안내방 받은편지함과 같은 부품).
- 확인창 없음(안내방 보내기와 같은 행동 한 모양) — 대신 입력칸 위 «{워크스페이스} 안내방 · N명에게 앱 알림» 고정 줄. 못 채운 `{{…}}` 가 남으면 보내기 비활성.
- 실시간: `support:updated` → 목록·열린 방 재조회(250ms 묶기) + 탭 복귀 재조회.

## 이 단계에서 하지 않는 것
자동 발송·예약·크론·support_nudges 표·«처리함» 상태 · AI 초안 · 발자국(2단계) · 멤버별 단계(대표만) · 목록에 메시지 본문 · 내보내기 ·
platform_admin 통과 범위 변경 · 신호 기준치 변경 · 시험 잡음 코드 필터 · 새 표/ENUM/마이그레이션.

## 구현 (2026-11-06 · [Opus] · Fable 설계 1회 · 완료 검증은 자체 — gate 대상 아님: 새 표·권한·공개 라우트·발송 트리거 변경 0)
- 실HTTP 22+6항목 실패 0 · journey 응답 리팩터 전후 diff 0(3곳) · 신호·요약 journey 와 6곳 완전 일치 · 25곳 5회 182~211ms(첫 호출 1.3s) · 90일 help 정렬 50곳 343ms.
- 브라우저 390·820·1440: 45줄·첫 줄 보임·가로 넘침 0 · 드로어 여정·대화·받는 사람 줄 · 초안 칩 → 입력칸 · `{{x}}` → 보내기 비활성 · 정렬·기간 · 실시간(다른 세션 글 → 새로고침 없이 줄 갱신) · 안내방 받은편지함 동작 동일.
