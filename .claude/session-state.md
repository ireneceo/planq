# PlanQ 개발 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-05-20
**작업 상태:** 완료
**운영 라이브 버전:** v1.16.0 (commit `f32f134`, N+30 개인 보관함 Phase 1+2+3 + ImageLightbox + dashboard fix)

### 진행 중인 작업
- 없음

### 완료된 작업 (이번 세션)
- Q docs 모바일 UI 개선
  - [템플릿] 모달: Q Calendar 스타일 적용 (top: 70px; bottom: 20px; left/right: 16px)
  - [+] 드롭다운: position fixed로 화면 내 고정 (top: 68px; right: 16px)
  - 문서 상세: 사이드바 숨김 + 뒤로가기 버튼 (제목 앞 인라인) + 헤더+본문 함께 스크롤
- Profile 모바일 UI 개선
  - 이메일 영역: flex-wrap으로 버튼 줄바꿈 처리
  - 언어레벨 표: LevelTableWrap으로 가로 스크롤 추가

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
