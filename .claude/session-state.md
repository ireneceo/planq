# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-22
**작업 상태:** 완료
**운영 라이브 버전:** v1.16.2 (commit `7d7accc`, N+32~N+37 9 commit 풀세트)
**직전 라이브:** v1.16.1 (commit `8947504`, N+31 Q Talk 모바일 viewport 회귀 fix)

### N+32~N+37 사이클 라이브 (이번 세션)
- **N+32** (fa481f1+8e1722c+fab23ef): Focus 옵션 A 통합 동기 + 옵션 B 단순화 (담당자 본인 + status='in_progress' 일 때만 일시정지/재개) + "내 업무 설정" 신규 메뉴 (`/me/work-settings`) — ProfilePage 에서 타임존+Focus 분리
- **N+33** (f3ee2c7): Q Talk 채팅방 진입 마지막 메시지 안 보이는 회귀 — ResizeObserver distance 임계치를 진입 후 2.5초 force-stick 윈도우로 보호
- **N+34** (e238487): Drawer 작성자/요청자 chip 항상 표시 (컨펌자·관찰자 관점 포함) + description 라벨 동적 (created_by===assignee → "내가 적은 업무 메모" / 다름 → "요청 내용") + routes/tasks.js displayName helper 적용 (BusinessMember.name 우선)
- **N+35** (b3ff92b): 실시간 동기화 — MemoPopup save 시 window CustomEvent dispatch + QNotePage listen (Q note 가 별도 FastAPI 라 socket.io 없음) + TaskDetailDrawer workflow 액션 후 'inbox:refresh' window event + TodoPage listen (socket 안전망)
- **N+36** (a01f8de+a0f4613): 업무 후보 "반려" → "건너뛰기" + 버튼 라인 회색 outline (옛 #FECACA 옅은 빨강 가시성 X) + 옵션 D 만료 정책 (30일 hide / 90일 cron delete + "이전 후보 보기" 토글) + DB ALTER TABLE task_candidates.hidden_at
- **N+37** (7d7accc): 주간 진척 그래프 actual_hours 미입력 시 estimated*progress 추정 (사용자 운영 데이터 100% 완료 4건 actual='-' 라 그래프 빈 회귀)

### 30년차 박제 (이번 세션)
- **Focus 옵션 A 통합 동기**: task status `in_progress` 진입 시 자동 Focus start (담당자+focus_enabled=true), 이탈 시 자동 stop. micro state (paused) 는 status 변경 X. 사용자 멘탈모델 "단계 이동 같이 움직이게" 정합.
- **사용자 호소 30년차 답변 — "혼란의 원인"**: 시스템은 정합 (created_by=assignee 케이스). 사용자 멘탈모델 "요청 vs 자기 업무" 구분이 entity 에 없음 → UI 라벨 동적으로 명확화 (옛 entity 통합 시스템 그대로).
- **실시간 데이터 반영 강력 박제 (CLAUDE.md 16번)**: 신규 페이지/라우트 추가 시 socket broadcast + listener + visibility/focus 복귀 + 같은 탭 안전망 4 요소 강제. 누락 시 사용자 호소 회귀 반복.

---

## 다음 사이클 박제 (Phase 4 + 개선)

1. **실시간 데이터 반영 전수검사** — CLAUDE.md 16번 박제에 따라 모든 페이지·라우트 점검. 누락 페이지: Q docs / Q Project / Q Bill / Q File / Personal Vault / Knowledge / Calendar / Dashboard / Insights — backend broadcast + frontend listener 양쪽 매트릭스 분석 후 fix
2. **개인 보관함 Phase 4+5** — Notes/Memo 탭 분리 + Dashboard 강화 (정리하기 권장 카드)
3. **ProfilePage grid 정리** — 빈 열 차단, 기능 묶음 단위 통일
4. **i18n ko/en 키 정합** — N+32~N+37 신규 키 (`nav.myWorkSettings`, `bar.disabledTitle`, `detail.descriptionSelf/Request`, `detail.chip.creator*`, `right.candidates.showOld/hideOld`, `candidateModal.skip/skipping` 등)
5. **나머지 task GET 라우트 displayName** — my-week / my-month / my-year / backlog
6. **다른 라우트 displayName 전수** — dashboard.js / stats.js / calendar.js / invoices.js / docs.js / records.js
7. **Focus Phase 4** — Insights 통합 / 다중 디바이스 socket sync / push 알림 옵션
8. **Cue 답변 학습 적용** — cue_rating -1 모아 system prompt 에 "이런 답변 피하라" hint
9. **모바일 PWA Share Target Phase 2** — 추가 destination
10. **운영 nginx OG share bot proxy** — 사용자 SSH 직접 1회 sudo 명령 필요
11. **dev qnote PM2 재정비** — 현재 errored (irene uvicorn 수동 서빙)

---

## 이전 사이클 (참조)

**N+31 (2026-05-20):**

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)
- N+31 Q Talk 모바일 viewport 회귀 fix (v1.16.1 라이브)
  - 증상: 모바일 PWA 진입 시 입력란이 위로 붙거나 아래에 큰 빈 공간 노출
  - Root cause: N+29 가 LayoutContainer/#root 를 height:100% 로 바꾸며 body(정적 layout viewport) ≠ Layout(동적 vvh) 불일치
  - Fix: #root + LayoutContainer 도 var(--vvh, 100dvh) 단위로 일관화 + vvh sync 글로벌 (main.tsx) + ChatPanel 중복 sync 제거

---

## 다음 할 일

### 다음 사이클 박제 (Phase 4 + 개선)

1. **개인 보관함 풀세트** — 프로젝트 페이지처럼 등록·수정·관리 풀 가능하게
2. **입력란 외 클릭 영역 확장** — description/body wrapper 빈 공간 클릭 시 자동 커서 진입
3. **운영 nginx OG share bot proxy** — 사용자 SSH 직접 1회 sudo 명령 필요
4. **dev qnote PM2 재정비** — 현재 errored (irene uvicorn 수동 서빙)
5. **Focus Phase 4** — Insights 통합 / 다중 디바이스 socket sync / push 알림 옵션
6. **Cue 답변 학습 적용** — cue_rating -1 모아 system prompt 에 "이런 답변 피하라" hint
7. **모바일 PWA Share Target Phase 2** — 추가 destination

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```

`/개발시작` 명령 시 위 "다음 할 일" 섹션이 가장 먼저 안내됩니다.
