# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-20
**작업 상태:** 완료
**운영 라이브 버전:** v1.16.1 (commit `8947504`, N+31 Q Talk 모바일 viewport 회귀 fix)

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
