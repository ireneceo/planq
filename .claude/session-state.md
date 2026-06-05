# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-05 (사이클 N+87 — Q Mail 맥락통합 **Phase A 진행 중**)
**작업 상태:** Phase A — Step 1·3 완료(dev 검증). Step 2(메일 우측 패널) 남음. 미배포.

---

## ★ 진행 중 — Q Mail 맥락통합 Phase A
**설계:** `docs/QMAIL_CONTEXT_DESIGN.md` (§8.5 고객 공개 범위 포함). memory `project_qmail_context_unified`.
**확정:** AI 추출=버튼 트리거 · 통합 테이블(email_thread_id) · client_id 허브 · 타임라인 **내부 전용**.
**고객 공개 §8.5:** 화이트리스트 serializer. 예측/실제시간·내부댓글 🔒하드차단. 중간지대 토글 3개(진행률%·담당자·완료일) 기본 OFF.

### ✅ 완료 (dev 검증, 미배포)
- **Step 1 — 백엔드 척추:** `services/clientTimeline.js`(getClientTimeline/getClientChannelSummary — 채팅·메일·업무·청구 client_id merge, before 페이지네이션, 메일 개인격리) + `routes/clients.js` GET `/:clientId/timeline`·`/channel-summary`(멤버전용 client 403). **API 5/5 + 멀티테넌트/권한 검증.** ※버그fix: Sequelize underscored 타임스탬프 속성=`createdAt`(컬럼만 created_at), `.created_at` 접근은 undefined
- **Step 3 — Customer 360 페이지:** `pages/Clients/ClientTimelinePage.tsx`(PageShell+채널필터+무한스크롤+useTimeFormat tz) + App.tsx 라우트 `/business/clients/:clientId/timeline` + ClientsPage 드로어 "통합 타임라인 보기" 진입 + i18n ko/en. 빌드 EXIT0·서빙200·i18n0.

### ⬜ 남음 — Step 2: 메일 우측 컨텍스트 패널
- MailPage 상세에 우측 패널(요약/업무후보/이슈/노트 자리 + **프로젝트·고객 연결 UI** + **"이 고객" cross-channel** = channel-summary API 사용)
- 그 다음 Phase B(업무추출 task_extractor 재사용) → Phase C(요약·이슈·노트)

### 미배포 동봉
- OverviewTab.tsx i18n 정리(N+87 소) — 다음 배포에 묶기

## 직전 운영 라이브: v1.32.0 (N+86)

## 환경
- dev: dev.planq.kr / 3003 · prod: planq.kr / 3004 (v1.32.0)

## 복구 가이드
새 세션: `이전 세션 이어서. /opt/planq/.claude/session-state.md 읽어줘. Q Mail Phase A Step 2(메일 우측 패널) 가자.`
