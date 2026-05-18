# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-18
**작업 상태:** 완료
**운영 라이브 버전:** v1.16.0 (commit `ae96c30`, 채팅 점프 hotfix 포함)
**직전 라이브:** v1.15.0 (commit `64ace71`)

### 진행 중인 작업
- 없음

---

## 완료된 작업 (이번 세션 — N+26~N+27, v1.16.0)

### N+26 (8f66cc9)
- **업무 흐름 (Focus) MVP** — focus_sessions 테이블 + users 5컬럼 + /api/focus/* 10 라우트 + FocusWidget 4-상태 사이드바 + TaskFocusBar drawer + FocusSettingsCard /profile
- **DailyStartModal + 유휴 감지** — useActivityTracker hook + 60s 무활동 prompt + auto_pause_min 자동 일시정지
- **주간 보고 자동 확정** — businesses 3컬럼 + assertWorkspaceWeeklyTeam helper + 워크스페이스 "업무 관리" 페이지 + 안내 띠
- **weekly_team 메뉴 권한** — default 'none' (멤버끼리 자동 공유 X) + READ_ONLY 분류
- **Image Lightbox 통일** — 갤러리 모드 + useImageLightbox hook + 5 사이트 통합 + Signature 자체 Lightbox 교체
- **인박스 후보 권한 가드** — owner/admin 만 미지정 후보 + QTaskPage candidate not found 안내 띠 + context 중복 제거
- **"박제" → "확정"** — 사용자 노출 5건 정리

### N+27 (ab113a6)
- **인박스 task_candidate inline 모달** — CandidateActionModal — 카드 클릭 시 즉시 등록/반려 (이동 X)
- **채팅 자동 업무 추출 디바운스** — taskExtractorScheduler — 60s 무활동 / 5+ burst / 3+ msg threshold + cron 1분 fallback
- **Cue 주고받음 양방향** — revision_note 자동 재실행 (A) + 댓글 trigger task.body 업데이트 + 답글 댓글 (B). executeForTask(opts) feedbackBlock prompt 주입
- **Cue 답변 thumbs** — messages 3컬럼 + cue-rating 라우트 + ChatPanel 👍/👎 버튼
- **Cue smart mode 명세 확인** — confidence ≥0.5 auto / <0.5 draft (코드 변경 없음)

### N+27 hotfix (ae96c30)
- **채팅방 진입 점프 회귀 fix** — activeConv.id reset effect 를 useEffect → useLayoutEffect 로. paint phase 일치

### 운영 배포 (이번 세션 4건)
- `8f66cc9` (N+26 통합 — 107s)
- `19c1b5a` (v1.16.0 버전 업 — 100s)
- `ab113a6` (N+27 — 105s)
- `ae96c30` (채팅 hotfix — 113s)

### 신규 memory 박제 (3건)
- `project_focus_system.md` — Focus 시간 추적 시스템 (4-state · DB · API · UI · zero overhead)
- `project_cue_two_way.md` — Cue task revision+댓글 양방향 + 무한 루프 방지
- `feedback_uselayoutEffect_phase.md` — 같은 paint phase 통일 (useEffect 섞으면 점프)

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
