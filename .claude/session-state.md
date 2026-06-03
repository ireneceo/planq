# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-03 (사이클 N+83 — **운영 라이브 v1.29.0**)
**작업 상태:** 완료. 운영 배포 완료 (commit `bc6c947`, deploy 20260603_060501, 129s).

---

## 진행 중인 작업
- 없음

## 완료 (이번 세션, v1.29.0 운영 라이브)
- **Q Mail inbound 트리아지** — emailTriage(human/automated/marketing/spam), 자동·마케팅 폴더 분리, reply_needed 자동, AI 답변 게이트. dev 백필 779건(automated 562 분리). 운영은 메일 0건이라 신규부터 적용
- **모바일 채팅 입력란 사라짐 근본 fix** — visualViewport.offsetTop 미보정이 원인. #root translateY(키보드 up 시). ★ Irene 모바일 확인 대기
- **고객 첫 응대 보완** — 담당자 자동배정 + 환영 대화방·메시지 자동생성(멱등) + 초대 재발송
- **고객 정기 구독청구(ClientSubscription)** — 프로젝트 없이 client 단위 구독 → 자동 invoice. weekly/monthly/quarterly/yearly + daily cron + bill-now
- recurring_invoice 잠재버그 2건 fix (sequelize import / created_by notNull)

## ★ 배포 후 확인 필요 (Irene)
- **모바일에서 planq.kr 채팅 입력란 탭** → 위로 사라지지 않는지 확인. 이상하면 보이는 동작 글로 알려주기

## 다음 할 일 (후보 — 갭 분석)
- 결제 자동화: PortOne 빌링키 정기결제 / 팝빌 세금계산서 자동발행 (외부 계정·키 필요)
- 고객 온보딩 심화: 프로필 입력 / 온보딩 가이드 / 일괄 초대
- ⏳ Google OAuth 검증 제출 (Irene 액션)

---

## 환경
- dev: dev.planq.kr / 87.106.11.184 / 3003
- prod: planq.kr / 87.106.78.146 / 3004 (v1.29.0 라이브)
- PM2: planq-dev-backend·planq-qnote (dev) / planq-prod-backend·planq-prod-qnote (prod)

## 복구 가이드
새 세션: `이전 세션 이어서. /opt/planq/.claude/session-state.md 읽어줘.`
