# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-16 — 워크스페이스 생성 드롭다운 + 초대 루트/그래프 시간계산 철저검증 운영 라이브.

## 현재 작업 상태
**작업 상태:** 완료 (운영 배포 `20260616_081004` · commit `ad044e8` · 헬스 29/29)

### 진행 중인 작업
- 없음 (다음 작업은 Irene 노트북에서 이어서 진행 예정)

### 완료된 작업 (이번 세션)
- **새 워크스페이스 만들기 드롭다운** — 좌측 상단 WorkspaceSwitcher 에 생성 항목+모달(role=dialog/aria-modal/body scroll lock). 백엔드 `POST /api/businesses` 전체 생성 트랜잭션(Business starter 14일 trial + owner member + Cue user/member + cue_user_id + active_business_id 전환 + slug 자동). commit-후-rollback / `undefined.catch` 버그 fix. (commit `997bda3`, `3449855`)
- **고객 초대 루트 완벽검증** — 실데이터 E2E 7/7(즉시 Client 생성·토큰=인증·프로젝트 고객채팅 자동참여·재수락400/무효404/만료410). **버그 fix:** 수락 알림 링크 `/q-project/:id`(없는 라우트 404) → `/projects/p/:id`. (commit `ad044e8`)
- **업무관리 그래프 시간계산 철저검증** — 백엔드 daily-progress = 수동 대조 정확 일치(예측=Σ예측×진행률, 실제=Σactual_hours만), 프론트/주간보고서 동일 공식·독립 라인·단조증가·미래 잘림. 코드 정확 → 변경 불필요.
- 헬스 정리: 깨진 push 구독(test.example) expired 마크 + E2E 인공물 push_log 제거.

### 다음 할 일 (DEVELOPMENT_PLAN.md backlog 기반)
- **[프로젝트·채팅]** 기존에 이미 수락한 프로젝트 고객을 고객채팅에 **일괄 합류 백필** (앞으로 수락분은 자동 — 이번 세션에 자동참여 로직 검증 완료, 과거분만 백필 남음)
- **[메일]** 푸터 샘플 2통 발송(워크스페이스/플랫폼 — 운영 경로) + 청구서 외 워크스페이스 메일(문서공유·서명요청) 회신처 연결
- **[AI]** #6 AI 생성물 재수정/재생성 UX 전 영역 통일
- **[lua]** #9 reviewing 13건 개발
- **[Q docs]** #10 문서 PDF 다운로드
- **[모바일]** 🔴 iOS OS push 미해결 — Capacitor 네이티브 앱 착수 대기 (`project_native_app_capacitor_plan`)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
