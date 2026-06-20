# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-06-20 (5)
**작업 상태:** ✅ v1.44.0 운영 배포 완료 — #64 보고서 3-렌즈(프로젝트뷰+부서뷰). deploy `20260620_060545` · commit `12de4db` · 138초 · 운영 헬스 200 · 새 스키마 0.

### 완료된 작업 (2026-06-20 — #64 부서뷰)
- **#64 부서뷰 — dev 검증, 미배포. 순수 프론트(백엔드 0).** D1 조직 `/api/org/:biz/overview`(company/department scope) + `listDepartments` 재사용.
  - `DepartmentReportView`(전체회사=부서별 비교 카드 / 특정부서=멤버별 active·overdue 테이블 + 부서 KPI) + WeeklyReviewTab `departments` 렌즈(4번째 서브탭). i18n qtask weeklyReview.dept ko/en.
  - **검증:** 헬스 29/29 · 빌드 EXIT0 · company scope owner 200·member 403·익명 401 · **부서 drill E2E 6/6**(부서생성→배정→department scope byMember→company byDepartment→복원) · i18n 0 · raw-select 0 · qtask ko/en 653/653. **미배포.**

### 완료된 작업 (2026-06-20 — #64 프로젝트 보고서뷰)
- **#64 보고서 3-렌즈 중 프로젝트뷰 — dev 검증, 미배포.** 결정: 프로젝트뷰=**Live 파생**(새 테이블/cron 0), 이번 사이클 프로젝트뷰만(부서뷰 다음, 통합뷰 기존 유지).
  - **백엔드:** `GET /api/projects/:id/report?week_start=`(멤버전용 client 403) — `fetchProjectStats`(weeklyReviewSnapshot, health·진행델타 정규로직 export+재사용) + 캔버스 직렬화(전략·지표·워크스트림 rollup) + 금주완료/지연/차주·이슈·산출물·팀(부서)·stages 집계. 새 스키마 0.
  - **프론트:** `WeeklyReviewTab` workspace 서브탭에 **`projects` 렌즈 추가**(integrated/members 옆) → 프로젝트 선택 + `ProjectReportView`(KPI+health배지+델타 → 전략요약 → 워크스트림 진행바 → 금주완료/지연 → 차주 → 산출물/팀). `services/projectReport.ts`. i18n qtask weeklyReview.project ko/en.
  - **검증:** 헬스 29/29 · 빌드 EXIT0 · report 멤버 200(13키)·client 403·cross-tenant 403·익명 401 · i18n 0 · qtask ko/en 637/637 · /q-task 200. **미배포.**

### 이전 배포 (2026-06-20 (3))
- ✅ v1.43.0 운영 배포 — D2-a 유형 + D2-b 담당자 게이트 + D3 캔버스. deploy `20260620_052818` · commit `36c963c` · 137초 · DB 스키마 전량 자동생성.

### 진행 중인 작업
- 없음

### 완료된 작업 (2026-06-20 — D3 #65 프로젝트 캔버스)
- **D3 #65 프로젝트 캔버스 — dev 검증, 미배포.** 프로젝트 상세 `dashboard` 탭을 컨설팅 구조(SCQA·피라미드·MECE) "캔버스"로 격상.
  - **콘텐츠 3레이어:** 🔵프레이밍(추진배경·핵심과제·목표·성공지표) → 🟢전략(핵심메시지 governing thought·추진방식·핵심추진과제=워크스트림) → 🟠실행(로드맵 stages·금주/차주 포커스·산출물·이해관계자·리스크) + 업무연계도.
  - **DB:** `project_workstreams` 신규(MECE 추진과제) + `projects` 전략 6컬럼(strategy_context/key_question/goal/governing_thought/approach + success_metrics JSON) + `tasks.workstream_id`. sync 자동, 백필 불필요.
  - **API(routes/projects.js, 멤버전용 client 403):** GET `/:id/canvas`(집계) · PATCH `/:id/strategy` · PUT `/:id/success-metrics` · GET/POST/PATCH/DELETE `/:id/workstreams[/:wsId]` + `/reorder`. tasks.js PUT `workstream_id` 수용+검증(같은 프로젝트만). 모든 mutation broadcast §16.
  - **프론트:** `pages/QProject/canvas/`(ProjectCanvas·WorkstreamBoard·SuccessMetricsEditor) + `services/projectCanvas.ts`. AutoSaveField 전략필드, PartnerKindBadge(D2)·부서badge(D1) 재사용. dashboard 탭 교체(옛 dashboard 죽은코드 정리). i18n qproject canvas ko/en.
  - **검증:** 헬스 29/29 · 빌드 EXIT0 · 백엔드 E2E 20/21(1건 테스트 복원 stale 인스턴스 버그→수동 복원, 기능 정상) · cross-tenant/client 격리 OK · canvas 10키 응답 · i18n 0 · qproject ko/en 452/452 · 프론트 200. **테스트 데이터(project 35 전략·워크스트림) 전량 복원.**
  - **설계:** `docs/PROJECT_CANVAS_DESIGN.md`. **미배포.**

### 완료된 작업 (2026-06-20 — D2-b)
- **D2-b 외부 파트너 담당자/컨펌자 picker (보안민감) — dev 검증 E2E 23/23, 미배포**
  - 게이트키퍼 `assertAssignable(targetUserId, businessId, projectId)` 신설(`middleware/access_scope.js` 단일 출처): 멤버(AI Cue 포함)=전체 / 외부 파트너(active client+user 계정)=그 프로젝트 참여자만 / 그 외 user_id=차단. project 없는 업무는 외부인 배정 불가. **기존 assignee_id 무검증 취약점(타 워크스페이스·유령 배정) 동시 차단.**
  - 적용 3곳: `tasks.js` POST·PUT(담당자) + `task_workflow.js` POST `/:id/reviewers`. reviewer `is_client` 는 **서버 도출**(클라 입력 불신뢰). 자동 컨펌자 is_client 도 isClient 반영.
  - 신규 API: `GET /api/tasks/by-business/:biz/assignable-externals?project_id=`(멤버 전용, 프로젝트 참여 외부인 user 계정+kind).
  - UI: 공통 `components/Common/PartnerKindBadge.tsx` 추출 → ClientsPage 통일 + TaskDetailDrawer 담당자/컨펌자 picker(PlanQSelect icon 배지) + ProjectTaskList 인라인 picker + 컨펌자 행 is_client 배지. i18n qtask `detail.reviewers.external` ko/en.
  - 검증: 헬스 200·빌드 EXIT0·**E2E 23/23**(게이트 7케이스·is_client 도출·격리 증명[외부 user 본인 배정 업무만+내부 공수 stripped]·후보 누수 차단)·i18n 하드코딩 0·qtask ko/en 610/610.
  - **미배포: D2-a(clients.kind) + D2-b 함께 다음 `/배포`.**

### 완료된 작업 (이전 세션)
- **운영 피드백 #57~#70 전량 처리 + 운영 배포** (v1.42.0~): F6·F7·F8(Q위키 진입점)·#70(내 문의·피드백 master-detail+추가문의)·#69(미수금 배너 문구)·A1/A2(AdminWikiPage)·#61(Cue 전방위 검색·권한격리)·#66(프로젝트 고객 명단 연동버그)·#68(Q talk @멘션 프론트). #60(모바일 push)=기기측 진단(코드無).
- **D 클러스터 설계** — `docs/Q_ORG_DESIGN.md` 4페이즈 로드맵 + D1·D2 상세. 메모리 `project_d_cluster_org_design` 박제.
- **D1 #67 Q조직 — 운영 라이브**: `departments`/`teams` 테이블 + `business_members.department_id/team_id` + `routes/org.js`(CRUD·배정·overview, E2E 11/11) + `OrgPage`(/business/org) + 대시보드 3단 토글(`OrgScopeOverview`) + 사이드바 "조직" + 저장✓ 피드백.
- **D2-a #66 외부파트너 유형 — dev 검증(미배포)**: `clients.kind` ENUM(customer/vendor/freelancer/other) + clients 라우트 + ClientsPage 배지·초대선택·드로어편집 + 메뉴/제목 "고객·파트너". kind E2E 5/5.

### 다음 할 일
1. **미배포 #64 프로젝트뷰 `/배포`** — `GET /projects/:id/report` + WeeklyReviewTab projects 렌즈. 새 스키마 0(Live 파생) → sync 불필요. dev 검증 통과, 운영 push 대기. (D2·D3 는 v1.43.0 으로 이미 배포됨)
1b. **#64 잔여 렌즈:** 부서뷰(D1 org /overview 패턴 — 부서별 멤버 가동률·완료·이슈 롤업). 통합뷰는 기존 유지.
1b. **D3 #65 후속(선택):** 옛 dashboard 의 메모(ProjectNote) 카드가 캔버스에서 빠짐 — 필요 시 캔버스에 메모 섹션 추가. 업무연계도 인터랙티브 그래프(현재 레인+링크뱃지 v1)는 v2.
2. **D2-b 후속(선택):** QTaskPage 전역 리스트 인라인 quick-picker 는 멤버만 노출(프로젝트가 행마다 달라 외부 후보 fetch 복잡) — 외부 배정은 업무 드로어로. 필요 시 확장.
3. **D3:** #65 프로젝트 전략필드(목표·핵심메시지·추진배경·추진방식·실행방안)+종합 타임라인+금주/차주+산출물+업무연계도 / #64 통합보고서 통합뷰·프로젝트뷰 분리. (D1 조직 + D2 외부파트너 위에 얹힘)
4. **D4:** #62 자료 보안등급+외부공유/개인드라이브 제한 / #63 자료 일괄 export+워크스페이스 간 이동.
5. **D1 후속(선택):** 멤버 소속(`MemberAffiliation`) 표시를 업무리스트·채팅·프로필 전반 확산 (현재 OrgPage·대시보드만).
6. **기타 backlog:** AI 기능 전수검사(`docs/AI_FEATURE_AUDIT.md` 22기능), Q위키 스크린샷 캡처 env(`WIKI_CAPTURE_*`), Google OAuth 검증 제출, #60 iOS Capacitor 네이티브(대형 별도 트랙).

### 참고
- `planq-dev-backend`·`planq-qnote` 는 **irene** pm2. 운영 서버 `irene@87.106.78.146`(PROD_BE=/opt/planq/backend, port 3004), 운영 DB 읽기 ssh 경유.
- 배포: dev 검증 통과 후 `./scripts/deploy-planq.sh --auto` (인터랙티브 멈춤 방지). 미커밋이면 sync 스킵 — 커밋 필수.
- D 클러스터 결정 박제(재논의 금지): 평면 부서+선택 팀 · 단일 메뉴 "고객·파트너"+client.kind · 담당자화 B중간. (memory `project_d_cluster_org_design`)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
