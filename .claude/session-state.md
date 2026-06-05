# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-05 (사이클 N+87 기획)
**작업 상태:** Q Mail 맥락 통합 **설계 확정 → Phase A 착수 대기**. + 미배포 소건 1.

---

## ★ 다음 세션 — Q Mail 맥락 지능 + 채팅·메일 고객 통합 (Phase A)
**설계문서:** `docs/QMAIL_CONTEXT_DESIGN.md` (확정). memory `project_qmail_context_unified`.
**Irene 매우 만족** ("너무 마음에 든다 최고야"). 고객 통합 타임라인을 Phase A로 당김.

**확정 결정:** AI 추출/요약 = 버튼 기본(자동X) · 통합 테이블(email_thread_id 추가) · client_id 허브(직접링크X) · A→B→C.

**Phase A 범위 (저비용·AI 최소, 여기부터 구현):**
1. 메일 상세 우측 컨텍스트 패널 셸 (⌘/ 토글) — `pages/QMail/MailPage.tsx`
2. 프로젝트/고객 연결 UI(picker) + 규칙 기반 추천
3. cross-channel 양방향 표시 (채팅↔메일, client_id 조인)
4. **고객 통합 타임라인(Customer 360)** — messages+email+tasks+invoices를 client_id로 merge 시간순 (신규 페이지)
- DB 신규 최소(index 정도). 재사용: RightPanel.tsx 패턴, EmailThread 기존 컬럼

**Phase B:** 업무추출(task_extractor 재사용, task_candidates.email_thread_id). **Phase C:** 요약·이슈·노트.

---

## 미배포 (dev 검증 완료, /배포 대기)
- **OverviewTab.tsx i18n 정리** (N+87 소) — Q Bill Overview 하드코딩 9곳(`어제`/`N일 전`/`N월`/`건`/KPI부제) → `overview.relative.*`/`unit.count`/`monthLabel`/`kpi.outstandingSub`. ko/en 추가. 빌드 EXIT 0·`/bills` 200. **다음 배포에 묶기** (단독 배포 불필요)

## 직전 완료 (운영 라이브)
- v1.32.0 (N+86) Q Bill 결제 독촉 / v1.31.0 (N+85) 입금 확인 대기 + 자동청구 검증 / N+84 iOS 채팅 fix 확정+진단제거

## 환경
- dev: dev.planq.kr / 87.106.11.184 / 3003 · prod: planq.kr / 87.106.78.146 / 3004 (v1.32.0)
- PM2: planq-dev-backend·planq-qnote (dev) / planq-prod-backend·planq-prod-qnote (prod)

## 복구 가이드
새 세션: `이전 세션 이어서. /opt/planq/.claude/session-state.md 읽어줘. Q Mail 맥락통합 Phase A 가자.`
