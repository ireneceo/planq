# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-02 (사이클 N+80~81 — **운영 라이브 v1.27.0**)
**작업 상태:** 운영 배포 완료 (commit `92ae47f`, deploy 20260602_171551, 128s). 운영 DB faq_embedding 컬럼 + email_faq_suggestions 테이블 생성 확인. M4 cron·M5 분류 코드 반영 확인.

---

## 진행 중인 작업
- 없음

## 완료된 작업 (이번 세션, 운영 라이브)
- **v1.27.0 (N+80~81):** Q Mail M4 — FAQ 자동 클러스터링(cron 매일04:10 + 제안 API + 등록→KbDocument) + ③ 자동답변(등록 FAQ를 AI 답변 제안에 hybridSearch≥0.55 주입) + ② insights team 탭 FAQ 통계(신규 등록 수·시간 절감). M5 — 자동 스팸/Uncertain 분류(emailSpamFilter 룰+IMAP헤더, inbox에서 uncertain 분리 + "확인 권장" 폴더 + 사유 배지)
- **v1.26.0 (N+79):** 채팅 임시저장·"여기까지 읽음" 구분선·과거 메시지 무한로드 + cross-tenant IDOR 보안 fix(standalone 대화)
- **v1.25.1 (N+78):** 채팅 모바일 정밀 수정 + 자동읽음 차단
- **v1.25.0 (N+77):** 알림 숫자 실시간 회귀 근본 fix(socket auto-join + health-check realtime 가드) + 문서 표 + Q Task 컨펌 + PanelLayout 통일

## 다음 할 일
- Q Mail 후속: 메일 검색, pagination, M5 분류 정확도 튜닝(실데이터 관찰)
- 다른 메뉴 PanelLayout 통일 / AdminAuditLogs
- ⏳ Google OAuth 검증 제출 (Irene 액션 — memory project_google_oauth_verification_pending)

---

## 환경
- dev: dev.planq.kr / 87.106.11.184 / port 3003
- prod: planq.kr / 87.106.78.146 / port 3004 (v1.27.0 라이브)
- DB: planq_dev_db (dev) / planq_admin (prod)
- PM2: planq-dev-backend / planq-qnote (dev) · planq-prod-backend / planq-prod-qnote (prod)

---

## 복구 가이드
새 세션 시작 시:
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
