# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-04 (사이클 N+84)
**작업 상태:** **운영 라이브 v1.30.0** (deploy `20260604_081629`, commit `46a8e70`). 진단 인프라 제거 완료.

---

## 완료된 작업 (이번 세션 — 전부 dev)

### ① Q Task "Cue에게 말하기" 바 (신규 기능)
- 헤더/탭 아래 상시 입력 바. 캐주얼 한마디 → Cue 가 업무로 정리 → 인라인 미리보기(모달 아님) → [추가].
- 신규 `components/QTask/CueTaskBar.tsx` + `AiCandidateCard.tsx`(분해 모달과 공유 추출, DRY). QTaskPage 마운트(week/all/workspace-tasks 탭).
- 백엔드 재사용 `/api/tasks/ai-create`(+/confirm) + 신규 `mode:'quick'`(한마디=1업무, 나열 시만 다중). i18n ko/en `ai.bar.*`.

### ② iOS 채팅 입력란 위로 사라짐 — **확정 해결** (Irene 아이폰 "이제 해결됐어")
- 근본: `index.html` viewport 메타 `interactive-widget=resizes-content` 제거(iOS 가 innerHeight 줄이고 phantom scroll) + `main.tsx` scrollTo(0,0) 가드.
- 메모리 [[feedback_mobile_chat_input_offsettop]] 갱신 완료(offsetTop translate 가설 폐기).

### ③ 키보드 up 시 채팅 맨 아래 자동 스크롤
- `ChatPanel.tsx` 키보드 핸들러 `distance<240` 가드가 키보드 높이만큼 커진 distance에 걸려 스킵 → shrinkAmount 보정 + RAF.

### ④ Cue 고객전용 게이팅
- `routes/projects.js` 메시지 라우트 — sender 가 내부 스태프(business_member, owner 포함)면 Cue 응답 스킵. 고객(외부) 발화만. 메모리 [[feedback_cue_client_only]].

### ⑤ 진단 오버레이 정리
- ViewportDebug 모바일 전용(데스크탑 검정 박스 제거) + dev hostname 게이트(dev 계정 이메일 irene@irenecompany.com 보완).

**검증:** 헬스 29/29 · 빌드 8GB EXIT 0 · API 6/6(Cue 게이팅·quick·멀티테넌트 403) · 서빙 200.

---

## 다음 할 일

1. **Irene 운영(planq.kr) 재확인**: 기존 홈화면 앱에서 채팅 입력란/키보드 스크롤/Cue 고객전용 정상 동작 — 운영 라이브됨.
2. (후순위) 결제 자동화(PortOne/팝빌), 고객 온보딩 심화, Google OAuth 검증 제출(Irene 액션).

---

## 환경
- dev: dev.planq.kr / 87.106.11.184 / 3003 · prod: planq.kr / 87.106.78.146 / 3004 (v1.29.0)
- PM2: planq-dev-backend·planq-qnote (dev) / planq-prod-backend·planq-prod-qnote (prod)

## 복구 가이드
새 세션: `이전 세션 이어서. /opt/planq/.claude/session-state.md 읽어줘.`
