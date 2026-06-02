# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-02 (사이클 N+79 — 채팅 "완벽화" 3기능 + IDOR 보안 fix)
**작업 상태:** 완료 (dev 검증 완료 · **운영 미배포**). 직전 운영 라이브 v1.25.1 (commit `cb3a4ed`, deploy 20260602_091006).

---

## 진행 중인 작업
- 없음

## 완료된 작업 (이번 세션 N+79, dev 검증 완료 · 미배포)
- **작성 중 메시지 임시저장** — 대화별 localStorage, 전환·재진입 복원, 전송 시 삭제. 브라우저 e2e 저장+복원 실증
- **"여기까지 읽음" 구분선** — conv 리스트 `my_last_read_at` 노출 + 진입 시 freeze + 첫 안읽은 타인 메시지 앞 Coral 구분선
- **과거 메시지 무한 로드** — 백엔드 최신-N + `?before=<msgId>` 페이지네이션(API PASS) / 프론트 위로 스크롤 prepend + anchor 보존 + 로딩 인디케이터 + RO/MO yank 가드(800ms)
- **오래된-200 버그 수정** — 옛 ASC limit 200 → 최신-N
- **🔴 cross-tenant IDOR fix** — 메시지 GET standalone 대화(project_id null) 접근검사 누락 → `canAccessConversation` 가드. memory `feedback_standalone_conv_access_check`

### 이번 세션 앞부분 (이미 운영 라이브)
- N+78 v1.25.1: 채팅 모바일 정밀 수정(iOS줌·터치타겟·overflow-wrap·스크롤 임계값 통일·키보드 scroll·IME onBlur) + 자동읽음 차단(viewing 게이트)
- N+77 v1.25.0: 알림 숫자 실시간 회귀 근본 fix(socket auto-join + health-check `realtime` 영구 가드) + 문서 표 + Q Task 컨펌 + PanelLayout 통일

## 다음 할 일
- **N+79 운영 배포** (`/배포`) — IDOR 보안 fix 포함이라 가급적 빠르게. 백엔드 projects.js·conversations.js + 프론트 변경
- 채팅 후속(선택): 구분선/무한로드를 미읽음·50+메시지 실데이터 시나리오로 실기기 확인
- 보류: Q Mail M4(FAQ 자동 클러스터링 — EmailFaqSuggestion 모델 존재) / 다른 메뉴 PanelLayout 통일 / AdminAuditLogs

---

## 환경
- dev: dev.planq.kr / 87.106.11.184 / port 3003
- prod: planq.kr / 87.106.78.146 / port 3004 (v1.25.1 라이브)
- DB: planq_dev_db (dev) / planq_admin (prod)
- PM2: planq-dev-backend / planq-qnote (dev) · planq-prod-backend / planq-prod-qnote (prod)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
