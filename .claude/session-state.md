# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-02 (사이클 N+82 — **운영 라이브 v1.28.0**)
**작업 상태:** 완료. 운영 배포 완료 (commit `ec493af`, deploy 20260602_182341, 128s). 검색 코드 운영 반영 확인.

---

## 진행 중인 작업
- 없음

## 완료된 작업 (이번 긴 세션, 전부 운영 라이브)
- **v1.28.0 (N+82):** Q Mail 메일 검색(제목·미리보기·본문 subquery) + 무한스크롤 pagination
- **v1.27.0 (N+80~81):** Q Mail M4(FAQ 자동 클러스터링 cron + 자동답변 AI주입 + insights team 통계) + M5(스팸/Uncertain 자동분류)
- **v1.26.0 (N+79):** 채팅 임시저장·"여기까지 읽음" 구분선·무한로드 + cross-tenant IDOR fix(standalone 대화)
- **v1.25.1 (N+78):** 채팅 모바일 정밀 수정 + 자동읽음 차단
- **v1.25.0 (N+77):** 알림 숫자 실시간 회귀 근본 fix(socket auto-join + health-check realtime 가드) + 문서 표 + Q Task 컨펌 + PanelLayout 통일

## Q Mail 현황 (핵심 완결)
- ✅ 인박스·읽기·답장·라벨·스타·할당·팔로우·AI답변·새메일·FAQ(M4)·스팸분류(M5)·검색·무한스크롤
- ⬜ 선택 확장(미구현): 메일→할일 자동추출(spec 1.3) · 포워드(1.6) · 실 계정 발송 E2E(데모 SMTP 한계)

## 다음 할 일 (후보)
- Q Mail 확장: 메일→할일 추출(차별화) / 포워드 / 실계정 발송 E2E
- 다른 메뉴 PanelLayout 통일 / AdminAuditLogs
- ⏳ Google OAuth 검증 제출 (Irene 액션 — memory project_google_oauth_verification_pending)

---

## 환경
- dev: dev.planq.kr / 87.106.11.184 / port 3003
- prod: planq.kr / 87.106.78.146 / port 3004 (v1.28.0 라이브)
- DB: planq_dev_db (dev) / planq_admin (prod)
- PM2: planq-dev-backend / planq-qnote (dev) · planq-prod-backend / planq-prod-qnote (prod)

---

## 복구 가이드
새 세션 시작 시:
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
