# PlanQ 세션 상태

**마지막 업데이트:** 2026-06-05 (사이클 N+87 — Q Mail 맥락통합 **Phase A 완료**)
**작업 상태:** Phase A + B 완료·dev 검증. **미배포** (확인 후 /배포).

---

## ✅ Phase A 완료 — Q Mail 맥락통합 (dev 검증, 미배포)
설계 `docs/QMAIL_CONTEXT_DESIGN.md`. memory `project_qmail_context_unified`.

- **Step 1 백엔드 척추:** `services/clientTimeline.js` + `routes/clients.js` GET `/:clientId/timeline`·`/channel-summary` (멤버전용 client 403, 메일 개인격리, before 페이지네이션). API 5/5. ※Sequelize underscored 타임스탬프=`createdAt` 버그 fix.
- **Step 2 메일 우측 컨텍스트 패널:** `pages/QMail/MailContextPanel.tsx` — 프로젝트·고객 연결 picker(PUT email-threads) + "이 고객" cross-channel(channel-summary) + 타임라인 링크. MailPage 4번째 Panel($hideTablet). E2E 7/7.
- **Step 3 Customer 360 페이지:** `pages/Clients/ClientTimelinePage.tsx` + 라우트 `/business/clients/:clientId/timeline` + ClientsPage 드로어 진입 버튼. 채널필터·무한스크롤·tz.

**검증:** 헬스 29/29 · 빌드 EXIT0 · 서빙200 · i18n ko/en 하드코딩0 · 멀티테넌트/권한(client403) · 레이아웃표준 준수. (Playwright MCP 미연결 → 브라우저 e2e 생략, API+TS빌드로 커버)

### 확인 경로 (dev)
- 메일 우측 맥락 패널: `dev.planq.kr/qmail` 스레드 열기 → 우측 "맥락" 패널(데스크탑)
- 고객 타임라인: `dev.planq.kr/business/clients/{id}/timeline` (또는 고객 드로어 "통합 타임라인 보기")

### 미배포 동봉 (다음 /배포에 함께)
- Phase A 전체 + OverviewTab.tsx i18n(N+87 소)

## ✅ Phase B 완료 (dev 검증, 미배포) — 메일 업무 추출 → Q Task 통합
- 스키마: `task_candidates`(conversation_id nullable + email_thread_id + source_email_message_ids), `tasks`(email_thread_id + source_email_message_id). sync 반영.
- `task_extractor.extractEmailTaskCandidates` (기존 파이프라인·프롬프트 재사용, 메일 inbound=고객/outbound=우리팀 프레이밍) + `registerCandidate` email 확장(business+client_id 해석, task에 email_thread_id+client_id+source 연결).
- `routes/email_threads.js`: extract-tasks / GET task-candidates / register / reject (qmail write, email_candidate:created+task:new broadcast).
- `MailContextPanel` 업무후보 섹션: "✨업무 추출" 버튼(automated/marketing 숨김) + 후보카드(제목·담당자·마감 편집) + 등록/무시.
- **E2E 9/9:** LLM 추출("웹사이트 리뉴얼 견적서 작성")→등록→task가 email_thread+client 연결→**고객 통합 타임라인 노출**(통합 증명)→dedup→reject→cross-biz 차단.

## ⬜ 다음 — Phase C (요약·이슈·노트)
- `summarizeThread()` 신규 LLM + `email_threads.ai_summary*` + `project_issues`/`project_notes`에 email_thread_id 스코프 + §8.5 고객 공개 serializer.
- 좀비필드 `EmailMessage.ai_summary/ai_intent/ai_processed_at` 정리.


## 직전 운영 라이브: v1.32.0 (N+86)
## 환경: dev 3003 / prod planq.kr 3004 (v1.32.0)
## 복구: `이전 세션 이어서. session-state 읽어줘. Q Mail Phase C 가자.`
