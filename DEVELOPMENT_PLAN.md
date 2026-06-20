# PlanQ - 개발 진행 현황

> **최종 업데이트:** 2026-06-20 (6) — **✅ v1.44.0 운영 배포 (deploy `20260620_060545` · 138초 · commit `12de4db` · planq.kr 헬스 200).** #64 보고서 3-렌즈(프로젝트뷰 Live파생 + 부서뷰 org재사용) 운영 라이브. 신규 `GET /projects/:id/report` 라우트 401 스모크. 새 스키마 0(sync 불필요). **다음:** D4 #62 자료 보안등급·#63 export.
>
> **이전:** 2026-06-20 (5) — **#64 부서뷰 — dev 검증 완료 (순수 프론트, 백엔드 0).** D1 조직 `/api/org/:biz/overview`(company/department scope)+`listDepartments` 재사용. `DepartmentReportView`(전체회사=부서별 비교 / 특정부서=멤버별 active·overdue+부서 KPI) + WeeklyReviewTab `departments` 렌즈(4번째 서브탭). i18n qtask weeklyReview.dept ko/en. **검증:** 헬스 29/29 · 빌드 EXIT0 · company owner 200·member 403·익명 401 · 부서 drill E2E 6/6(생성→배정→dept scope byMember→company byDepartment→복원) · i18n 0 · qtask ko/en 653/653. **#64 3-렌즈: 통합뷰(기존)+프로젝트뷰+부서뷰 완성.** 미배포(#64 프로젝트뷰+부서뷰 함께 다음 `/배포`). **다음:** D4 #62 자료 보안등급·#63 export.\n>\n> **이전:** 2026-06-20 (4) — **#64 보고서 프로젝트뷰 (Live 파생) — dev 검증 완료, 미배포.** "통합보고서 통합뷰·프로젝트뷰 분리"의 프로젝트뷰. 결정: Live 파생(새 테이블·cron 0, GET 1콜), 이번 사이클 프로젝트뷰만(부서뷰 다음). **백엔드** `GET /api/projects/:id/report?week_start=`(멤버전용·client 403) — `weeklyReviewSnapshot.fetchProjectStats`(health·진행델타 정규로직 export 재사용) + 캔버스 직렬화(전략·지표·워크스트림 rollup) + 금주완료/지연·차주·이슈·산출물·팀(부서)·stages. **프론트** WeeklyReviewTab workspace 서브탭에 `projects` 렌즈(integrated/members 옆) → 프로젝트 선택 + `ProjectReportView`(KPI+health+델타 → 전략 → 워크스트림 진행 → 금주/지연/차주 → 산출물/팀). `services/projectReport.ts` · i18n qtask weeklyReview.project ko/en. **검증:** 헬스 29/29 · 빌드 EXIT0 · report 멤버 200(13키)·client 403·cross-tenant 403·익명 401 · i18n 0 · qtask ko/en 637/637 · /q-task 200. **미배포.** **다음:** #64 부서뷰 → D4 #62 보안등급·#63 export.
>
> **이전:** 2026-06-20 (3) — **✅ v1.43.0 운영 배포 (deploy `20260620_052818` · 137초 · commit `36c963c` · planq.kr 헬스 200).** D2-a 외부파트너 유형(clients.kind) + D2-b 담당자/컨펌자 배정 게이트·picker + D3 #65 프로젝트 캔버스 한 번에 운영 라이브. **운영 DB 자동생성 확인:** project_workstreams 테이블 · projects strategy 5컬럼+success_metrics(json) · tasks.workstream_id(bigint) · clients.kind ENUM(customer/vendor/freelancer/other). 운영 신규 라우트 스모크 401(존재+인증가드). 검증 2회(8-F type=button 발견·수정 포함) 통과. **다음:** D3 #64 통합/프로젝트 보고서뷰 → D4 #62 자료 보안등급·#63 export.
>
> **이전:** 2026-06-20 (2) — **D3 #65 프로젝트 캔버스 — dev 검증 완료.** 프로젝트 상세 `dashboard` 탭을 최고 수준 경영 컨설팅이 engagement 를 구조화하는 논리(SCQA·피라미드 원칙·MECE·OKR·RACI·리스크 레지스터)로 **"캔버스"로 격상**. 콘텐츠 3레이어: 🔵프레이밍(추진배경·핵심과제·목표·성공지표 정량) → 🟢전략(핵심메시지=Governing Thought·추진방식·핵심추진과제=워크스트림) → 🟠실행(로드맵 stages·금주/차주 포커스·산출물·이해관계자·리스크) + 업무연계도. **DB:** `project_workstreams` 신규(MECE 추진과제, 업무의 상위 골격) + `projects` 전략 6컬럼(strategy_context/key_question/goal/governing_thought/approach TEXT + success_metrics JSON) + `tasks.workstream_id`(nullable FK) — 전부 sync 자동, 백필 불필요. **API(routes/projects.js, 멤버전용 client 403):** GET `/:id/canvas`(전략·지표·워크스트림+rollup·금주/차주·산출물·이해관계자·리스크·tasks·task_links 단일 집계) · PATCH `/:id/strategy`(AutoSave) · PUT `/:id/success-metrics` · 워크스트림 CRUD+reorder. tasks.js PUT `workstream_id` 수용+검증(같은 프로젝트만). 전 mutation broadcast §16. **프론트:** `pages/QProject/canvas/`(ProjectCanvas·WorkstreamBoard·SuccessMetricsEditor) + `services/projectCanvas.ts`. AutoSaveField 전략필드 + PartnerKindBadge(D2)·부서badge(D1) 재사용. dashboard 탭 교체(옛 죽은코드 정리). i18n qproject canvas ko/en. **검증:** 헬스 29/29 · 빌드 EXIT0 · 백엔드 E2E 20/21(1건 테스트 stale-instance 복원버그→수동복원, 기능정상) · cross-tenant·client 격리 OK · canvas 10키 응답 · i18n 0 · qproject ko/en 452/452 · 프론트 200 · **테스트데이터(project 35) 전량복원.** 설계 `docs/PROJECT_CANVAS_DESIGN.md`. **미배포(D2-a+D2-b+D3 함께 다음 `/배포`).**
>
> **이전:** 2026-06-20 — **D2-b 외부 파트너 담당자/컨펌자 picker (보안민감) — dev 검증 완료, 미배포.** B중간 결정(외부인 업무 배정+client 격리)을 구현. **단일 게이트키퍼 `assertAssignable(targetUserId, businessId, projectId)`**(`middleware/access_scope.js`): 멤버(AI Cue 포함)=전체 / 외부 파트너(active client+user 계정)=그 프로젝트 참여자만 / 그 외 user_id=차단. project 없는 업무는 외부인 배정 불가. **검증 부재였던 assignee_id 임의 배정(타 워크스페이스·유령 user) 취약점 동시 차단.** 적용 3곳: `tasks.js` POST(생성)·PUT(담당자 변경) + `task_workflow.js` POST `/:id/reviewers`(컨펌자) — reviewer `is_client` 는 클라 입력 불신뢰, **서버 도출**. 신규 후보 API `GET /api/tasks/by-business/:biz/assignable-externals?project_id=`(멤버 전용, 프로젝트 참여 외부인 user 계정+kind). UI: 공통 `components/Common/PartnerKindBadge.tsx` 추출(ClientsPage 통일) → TaskDetailDrawer 담당자/컨펌자 picker(PlanQSelect icon 배지) + ProjectTaskList 인라인 picker + 컨펌자 행 is_client 배지. i18n qtask `detail.reviewers.external` ko/en. 격리는 기존 `taskListWhere`(배정 업무만)+`serializeTaskForClient`(내부 공수·AI·internal 댓글 차단) 유지. **검증:** 헬스 200·빌드 EXIT0·**E2E 23/23**(게이트 7케이스·is_client 도출 override·외부 user 격리 증명[본인 배정 업무만+내부 공수 stripped]·후보 누수 차단)·i18n 하드코딩 0·qtask ko/en 610/610. **미배포:** D2-a(clients.kind)+D2-b → 다음 `/배포`(sync 가 kind ENUM 자동). **다음:** D3 #65 프로젝트 캔버스+#64 보고서뷰.
>
> **이전:** 2026-06-19 (2) — **D 클러스터 착수: D1 Q조직 완성·운영 라이브 + D2-a 외부파트너 유형(dev).** 운영 피드백 #57~#70 전량 처리 후 대형 재설계 D 클러스터를 4페이즈 로드맵(`docs/Q_ORG_DESIGN.md`)으로 착수. **D1 #67 조직 골격(운영 배포 완료):** `departments`/`teams` 2테이블 + `business_members`(department_id·team_id) + `routes/org.js`(부서/팀 CRUD·멤버배정·3단 overview, owner/admin 가드·멀티테넌트·broadcast) + `OrgPage`(/business/org — 부서 카드·팀·멤버배정 AutoSave✓) + **대시보드 3단 토글**(회사/내부서/개인 + 부서별·멤버별 롤업 `OrgScopeOverview`) + 사이드바 "조직". 평면 부서+선택 팀(다단계 트리 비범위), 부서=표시·집계 단위(권한 4-Layer 무변경). E2E 11/11. **D2-a #66 외부파트너 유형(dev 검증, 미배포):** `clients.kind` ENUM(customer/vendor/freelancer/other) + clients 라우트 + ClientsPage 유형 배지·초대선택·드로어편집 + 메뉴/제목 "고객·파트너". kind E2E 5/5. **D2-b(외부인 담당자 picker)·D3(#65 프로젝트캔버스+#64 보고서뷰)·D4(#62 보안등급+#63 export) 미착수.** 결정박제: D2 담당자화=B중간(외부인 업무배정+client격리), 조직=평면+팀, kind 4종.
>
> **이전:** 2026-06-19 — **v1.42.0 운영 배포 (deploy `20260619_045541` · 144초 · commit `6e42ed4` · planq.kr 헬스 OK).** F6·F7·F8(Q위키 진입점) + #70(내 문의·피드백 master-detail+추가문의) + #69(미수금 배너 문구) 운영 라이브. ① **#70** `feedback_items.parent_id` self-FK(운영 DB 추가 확인) + `POST /` 추가문의(본인·답변완료·1단계 검증) + `GET /mine` 부모기준 스레드 그룹핑(replies[]·last_activity_at·awaiting_reply) + `MyFeedbackPage` 좌/우 master-detail(`?item` 싱크·재클릭 토글·≤1024 드릴다운) + 추가문의 컴포저(답변 후만·Ctrl/⌘+Enter·중복가드). 드로어 myhistory 후방호환. ② **#69** `services/insights.js` overdue 카드를 **미수금(고객 미입금) 관점**으로 재작성 — 운영 실데이터 검증 "최정우 님에게 청구한 429,000원이 결제 기한(2026-06-10)을 지났는데… (워크스페이스 구독료가 아니라 고객에게 청구한 금액이에요)". notify_paid_at·완납 제외, 고객명/금액/기한, DATEONLY 포맷 fix. owner/admin 전용. ③ **F6·F7·F8** HelpDot askTab(기본 wiki)→Q위키 탭, 진입점 6곳+Dashboard, 랜딩 도움말→/wiki. 검증: 헬스 29/29 · 빌드 EXIT0 · #70 API 18/18 · #69 E2E 9/9 · 운영 parent_id 컬럼·/me/feedback 200·실데이터 카드 확인. **다음:** #61(Cue 권한범위 전방위 검색, AI감사 중첩) → A1·A2(AdminWikiPage) → C #60 모바일 push → D 대형재설계(#62~#68).
>
> **이전:** 2026-06-18 — **Q위키 진입점 연결 F6·F7·F8 + 운영 피드백 14건 정리 (dev 검증 완료 · 미배포).** Q위키 백엔드(v1.41.0)는 운영 라이브지만 사용자가 닿는 입구가 비어 있던 것을 연결. ① **F6** `HelpDot` 에 `askTab` prop(기본 `'wiki'`) 추가 → ⓘ "Q helper 에 묻기" 클릭 시 `cue:ask` detail.tab='wiki' 전달, 드로어가 **Q위키 탭**으로 진입(드로어는 이미 tab 분기 처리됨). ② **F8** 기존 진입점 6곳(QTask·QTalk·QNote·Knowledge·QDocs·Todo)은 askTab 미지정→기본 wiki 로 자동 라우팅 + **Dashboard `PageShell.helpDot` 신규 추가**(dashboard.help ko/en). ③ **F7** 랜딩 헤더 nav + 푸터 PRODUCT 에 "도움말"→`/wiki`(landing `nav.help` ko/en). 순수 프론트 배선(DB·API·실시간 변경 0). 검증: 헬스 **29/29** · 빌드 EXIT0(index 12:02) · dev `/`·`/wiki`·`/dashboard` 200 · i18n 하드코딩 0(t() 경유 ko/en 키 존재) · HelpDot 사용처 8곳 후방호환 · 레이아웃 표준 위반 0. **운영 피드백 14건(#57~#70) 정리** — A:이미수정(#57·#58·#59 v1.40.3, 상태정리만) · **B:Q helper 허브(F6·F7·F8 + #61 Cue답변범위 + #70 내문의·피드백)** · C:빠른버그(#69 Q bill 연체배너 오표시·#60 모바일 push) · D:대형재설계(#62~#67 조직/고객/프로젝트/보고서/보안·#68 @멘션). **다음 섹션:** #70(`feedback_items.parent_id` 추가문의 스레드 + master-detail) → #61(Cue 권한범위 전방위 검색, AI감사 중첩) → A1·A2(AdminWikiPage). **미배포:** F6·F7·F8 → 다음 `/배포`.
>
> **이전:** 2026-06-18 — **Q위키(Q Wiki) 핵심 운영 배포 (v1.41.0 · deploy `20260618_053527` 129초 · commit `5a399f7` · planq.kr 헬스 OK).** PlanQ 제품 사용법 도움말 시스템. ① **DB:** `help_categories`/`help_articles` 2모델 + FULLTEXT(ngram, 한글검색) + **kb_chunks 재사용**(source_type 'kb'/'wiki' + source_id + business_id nullable — 플랫폼 공통이라 NULL, 워크스페이스 KB 검색에 비오염 검증됨). 운영은 sync-database가 FULLTEXT/ALTER 미처리 → `setup-wiki-schema.js`(멱등) 명시 실행. ② **Backend:** `routes/wiki.js`(공개+로그인 read, optionalAuth, lang fallback, pagination, `/image/:fileId` IDOR가드) · `services/wikiSearch.js`(FULLTEXT+임베딩 하이브리드, SEM_THRESHOLD 0.30) · `cue.js` qhelper→Q위키 article RAG 승격(sources[] 반환). ③ **Admin:** `routes/admin_wiki.js`(CRUD+캡처+재임베딩, platform_admin) · `services/wikiScreenshot.js`(Puppeteer 재사용, env-gated 비활성). ④ **콘텐츠:** 카테고리 8 + 실사용법 article 20(ko/en, public 3·authenticated 17) + 임베딩 — dev/운영 시드 완료(`seed-wiki-content.js` 멱등). ⑤ **Frontend:** `WikiPage`(/wiki, 오버뷰/검색/카테고리/카드) + `WikiArticlePage`(/wiki/a/:slug, 블록렌더+관련글) 게스트허용 · `services/wiki.ts` · locales wiki ko/en(28/28). ⑥ **드로어 F1:** 타이틀 "Q helper" 유지 + 탭 **Cue/Q위키/문의** 재라벨 + Q위키 탭("이 화면에서" 맥락카드 + 카테고리칩 + sources칩 + "전체 Q위키 열기"). **검증:** 헬스 29/29 · 빌드 EXIT0(8GB) · API 10/10(격리·검색·맥락·RAG·권한403·KB비오염) · 운영 /wiki·/wiki/a/:slug 200·게스트 격리. **남은 프론트(다음·미배포):** F6 HelpDot tab='wiki' 분기 · F8 진입점 9곳 · F7 랜딩 "도움말"→/wiki · A1/A2 AdminWikiPage. **결정대기:** 스크린샷 캡처 env 계정(WIKI_CAPTURE_*).
>
> **이전:** 2026-06-18 — **포커스 주간그래프 운영 배포(v1.40.3) + 알림소리 톤다운(dev) + Q위키 설계확정 + AI 전수검사 문서화.** ① **운영피드백 #57·#58·#59(포커스/주간업무진척 그래프) 수정·배포완료**(deploy 134초, index.html 00:42 갱신, 헬스 OK). 근본원인: 그래프 actual 라인이 task_daily_progress 스냅샷(cron 아침)만 사용 → 진행중 업무 포커스 측정시간이 그날짜에 안잡힘(스냅샷 없으면 빈 그래프), 오늘도 actual_hours 합만 써 active 포커스 미반영. 수정: `routes/tasks.js` daily-progress가 `FocusSession.computeActualSeconds()` 일별귀속 누적 + act_used=max(스냅샷,포커스), 프론트 오늘 actual=max(라이브,포커스누적). E2E 6/6. ② **알림소리 톤다운(`NotificationToaster.tsx`):** 맥북 귀아픔 호소 — 원인은 mp3 에셋 부재로 항상 합성음(G5 784Hz+D6 1174Hz, gain0.45, lowpass無)→고역 날카로움. C5 523Hz+E5 659Hz(장3도)+lowpass 2kHz+볼륨 0.16으로 교체(dev만, 운영 미반영). ③ **Q위키 설계확정** `docs/Q_WIKI_DESIGN.md` — IA: "Q helper"=허브 버튼·타이틀 유지, 그 아래 Cue(내 워크스페이스)+Q위키(PlanQ 사용법)+문의. 변경 전수지도+DB 2테이블+API+검증 V1~V11. ④ **AI 전수검사 체크리스트** `docs/AI_FEATURE_AUDIT.md` — 22개 AI기능 A~E, 실 API 동작증명. → **둘 다 다음 섹션 구현/실행 예정** (유료고객 테스트 진입, 고급기능 우선).
>
> **이전:** 2026-06-16 — **워크스페이스 생성 드롭다운 + 초대 루트/그래프 시간계산 철저검증 운영 라이브 (deploy `20260616_081004` · commit `ad044e8` · 헬스 29/29).** ① **새 워크스페이스 만들기:** 좌측 상단 WorkspaceSwitcher 드롭다운에 생성 항목+모달(이름 입력, role=dialog/aria-modal/scroll lock). 백엔드 `POST /api/businesses` 전체 워크스페이스 생성 트랜잭션화(Business starter 14일 trial + owner BusinessMember + Cue user/member + cue_user_id + active_business_id 전환 + slug 자동) + commit-후-rollback/`undefined.catch` 버그 fix(committed 가드 + audit try/catch). E2E: 생성201·정합(cue/owner/ai/active)·목록포함·**cross-tenant 403**·경계400·미인증401. ② **고객 초대 루트 완벽검증:** 실데이터 E2E 7/7(초대생성 시 Client 즉시 invited 생성+client_id 연결·공개조회·토큰=인증 수락·Client active+프로젝트 고객채팅 자동참여·재수락400·무효404·만료410). **버그 fix:** 수락 알림 링크가 존재하지 않는 `/q-project/:id`(클릭 시 404) → 상대경로 `/projects/p/:id`로 수정(notify normalizeLink 정합). ③ **업무관리 그래프 시간계산 철저검증(코드 정확, 변경불필요):** 백엔드 daily-progress 값이 수동 대조와 정확 일치(예측=Σ예측×진행률, 실제=Σactual_hours만·fallback 없음), 프론트 computedBurndown 두 라인 독립출처+단조증가+미래 잘림+점선종점=weekTotalEst, 주간보고서 스냅샷 동일공식+dayKey 정규화(빈화면 fix 유지). 헬스 정리: 깨진 push 구독(test.example p256dh 3바이트) expired 마크 + E2E 인공물 push_log 제거.
>
> **이전:** 2026-06-16 — **청구·메일·프로젝트·채팅 대규모 운영 라이브 (deploy `20260616_041736`, 139초, 헬스 OK · commit `3aae6c3`).** 운영 사용자(Irene) 실시간 피드백 집중 사이클. 그룹별 정리:
> - **[청구서]** 세금계산서 토글 KRW면 항상 활성(사업자정보는 결제 후 고객이 공개페이지 입력) · **임시저장(draft) 재편집**(PUT `/:biz/:id`, 모달 edit 모드, 드로어 "편집" 버튼) · **취소 청구서 편집·재발행**(canceled→draft 되살림) · **삭제 FK fix**(invoice_status_history/receipt_corrections 먼저 삭제 — 발송/취소 청구서 삭제가 막히던 것) · 거래 배너 버튼명 action_kind별 · 증빙 알림 링크 tab=invoices.
> - **[공개 청구서]** 기한 한국어 YYYY/M/D · 수신자 "—"→외부수신명 · 증빙 "제출함" 오표시 fix(고객 실제 제출 receipt_requested_at 기준).
> - **[메일]** 푸터 2모드(워크스페이스 vs PlanQ 플랫폼) · 회색 "PlanQ에 문의하기" · copyright 정돈 · **푸터 도메인 planq.kr 고정**(dev.planq.kr 노출 fix) · 미확인 알림 다이제스트 제목에 실제 내용 · **발송 게이트**(dev EMAIL_SENDING_ENABLED=false 발송정지 + 예약TLD/.invalid/example 가짜주소 차단).
> - **[프로젝트↔고객]** 프로젝트 고객 초대 = 워크스페이스 Client 즉시 생성+백필 · 청구서 project_id 연결+모달 표시 · 채팅방 탐색 project fallback · **초대 수락 시 프로젝트 고객채팅 자동참여**.
> - **[채팅방]** 참여자 "없음" 오표시 fix(신규 GET `/conversations/:biz/:id/participants` — 참여자+멤버/고객 후보+미수락 안내) · **채팅에 고객 연결**(role=client) · 참여자 역할 배지 · 헤더 Q helper(?) 제거 · 헤더 프로젝트명 중복 정리(channelLabel).
> - **[업무후보]** "거절"→"삭제"(전역 제거 명확화) · 기존고객 연결 드롭다운 중복 제외(client_id 기준).
> - **[운영정리]** 가짜 테스트 고객(help@purplehere.com) 보관처리.
> - **🔜 구현해야 할 히스토리(그룹별 backlog):** **[메일]** 푸터 샘플 2통 발송(워크스페이스/플랫폼 — 운영 경로) + 청구서 외 워크스페이스 메일(문서공유·서명요청) 회신처 연결. **[프로젝트·채팅]** 기존 수락 고객 고객채팅 일괄 합류 백필(앞으로 수락분은 자동). **[AI]** #6 생성물 재수정/재생성 UX 통일. **[lua]** #9 reviewing 13건. **[Q docs]** #10 PDF 다운로드. **[모바일]** 🔴 iOS OS push 미해결(Capacitor 네이티브 착수 대기).
>
> **이전:** 2026-06-15 — **🔴 모바일 OS push 미해결(다음 섹션 이어서) + 구독결제 세금계산서 보완 + 데스크탑 push 회귀 fix + 이메일 에스컬레이션 안전망.** ① **모바일 알림 위기:** 아이린 아이폰(iOS18.7, PWA)만 OS 배너·배지·알림센터 전부 미표시. 데스크탑 정상, **직원(user3, iOS18.6)은 동일 푸시 정상 수신.** 운영 DB·PushLog 로 전 구간 증명 — 구독 sub92 활성·발송 매번 `sent 201`·SW ack 수신·showNotification 성공(count++→5,perm=granted)·중복/좀비 없음·재구독 새 endpoint 정상·**직원과 endpoint 형식 100% 동일.** push/sw/manifest/notify 코드는 목요일(6/10)→월요일아침(6/13) **변경 0건**(같은 코드+같은 18.7로 금요일엔 작동). **→ 실패 지점 = 아이린 기기의 iOS "화면 표시" 단계 단 하나(서버/코드/구독 아님).** 유력: 오늘 테스트 폭주로 iOS가 PlanQ를 "조용히 전달" 자동 강등/토글 OFF. **다음 섹션 첫 액션:** 아이폰 설정→알림→PlanQ 토글 확인 + 알림센터 적재 여부 + nuclear reset(삭제→재부팅→재설치) + 알림톡/SMS 대안 검토. ② **세금계산서:** 구독결제 한국 필수항목(업태/종목/담당자명/연락처/신청금액 prefill) — `229b8a6`·`e5c862d`. ③ **데스크탑 push 회귀 fix:** focused-skip 제거(`59cdf47`)+update() 제거(`67ba7dc`) → 데스크탑 정상화 확인. sw.js 풀옵션 복원(`bc1e5d8`)+icon-72.png 생성(`30ad10b`, badge가 HTML 404였음). ④ **이메일 에스컬레이션:** 미읽음 알림 5분 후 이메일(push silent-drop 안전망, `97281c3`/`c5b7772`) — 현재 모바일 구멍 메우는 중. ⚠️ sw.js 측정용 ack/diag 코드 잔존(해결 후 제거). ⑤ 프로젝트 없이 만든 본인 업무 첫 배정 허용(운영 #37, `20d74a3`). 헬스 29/29.
>
> **이전:** 2026-06-13 — **정기업무 점검·완성 + 드로어 정정이력 운영 라이브 (deploy `20260613_191904`, commit `3c3b735` · 운영 백필 prod 고아 16→0).** 30년차 감사로 정기업무(recurringTaskGenerator)에서 **인스턴스 project_id 누락 버그** 발견(프로젝트 정기업무 인스턴스가 project_id=NULL→프로젝트 목록서 사라짐, prod 16건·dev 11건) → `project_id: parent.project_id` 추가 + reviewer 복사(state=pending 리셋) + 양 환경 백필. 청구서 상세 드로어에 증빙 정정 이력 표시(GET /corrections 재사용)도 동봉. E2E 정기업무 4/4·드로어 2/2. **미배포 0.**
>
> **이전:** 2026-06-13 — **수정세금계산서·증빙 취소 흐름 Phase 1 운영 라이브 (deploy `20260613_182837`, commit `0906a5c` · receipt_corrections 테이블 16컬럼 자동생성).** 부가세법 §70 6수정사유 마킹추적(홈택스 자동발행 X). `receipt_corrections` 테이블(원발행 보존+정정 참조이벤트) · corrections 라우트(단건/회차/GET, owner_only+audit+broadcast+고객통지) · receiptsDue 유효상태 파생(corrected/amended/canceled, 취소+발행+미정정→correction_pending) · CorrectionModal(사유별 안내) + 큐/드로어 표시. E2E 13/13. 설계: docs/RECEIPT_CORRECTION_DESIGN.md.
>
> **이전:** 2026-06-13 — **청구서 PDF 401 + Puppeteer 자가복구 fix 운영 라이브 (deploy `20260613_165308`, commit `990c5cc`).** ① InvoiceDetailDrawer 멤버 PDF window.open(인증헤더 미전달)→401 → 인증 blob fetch. ② getBrowser 싱글톤이 chrome 크래시 후 죽은 browser 영구재사용→모든 PDF 30s 행→500. disconnected 리셋+connected 체크+1회 재launch 재시도. chrome kill 후 렌더 200/2.5s 실증.
>
> **이전:** 2026-06-13 — **문서 PDF 다운로드 운영 라이브 (deploy `20260613_163008`, commit `e9cbc16`).** Document(계약/공식문서) PDF 라우트 신설 + posts 서버PDF 격상(청구서 Puppeteer 엔진 재사용, DB 0). `documentPdfHtml` 템플릿 · docs.js GET `/documents/:id/pdf`(멤버 접근검사)+`/public/:token/pdf`(공유) · 프론트 인증 blob fetch(`downloadDocumentPdf`/`downloadPostPdf` — authenticateToken Authorization 헤더 전용이라 window.open 불가) · DocumentEditorPage PDF 버튼 + ProjectPostsTab window.print→서버PDF. E2E 문서 PDF 7/7(멤버·멀티테넌트 403·익명 401·공개·유효 바이너리). **미배포 → 다음 `/배포`.**
>
> **이전:** 2026-06-13 — **v1.36.0 회차별 현금영수증 운영 라이브 (deploy `20260613_155838`, 138초, commit `1478c7f` · 운영 DB cash_receipt 3컬럼 자동추가 확인).** 버전 1.35.0→1.36.0. 분할 결제 회차마다 입금 시점 현금영수증 발급(세금계산서 회차 패턴 미러). DB `invoice_installments` + cash_receipt_no/at/marked_by 3컬럼(sync 자동) · `POST /:biz/:id/installments/:instId/mark-cash-receipt`(owner_only+audit+broadcast+통지) · `receiptsDue` 분할 시 세금/현금 모두 회차별 산출 · 프론트 `markInstallmentCashReceipt`+IssueModal 4-way 라우팅. E2E 10/10(회차별 산출·발행·status 전이·고객메일·owner_only). **미배포 → 다음 `/배포`(sync_database 자동 컬럼).**
>
> **이전:** 2026-06-13 — **증빙 루프 완성 (dev 검증 9/9 + 헬스 29/29) → 운영 라이브 (deploy `20260613_154506`, commit `cc6a4bf`, v1.35.0).** v1.35.0 증빙 큐의 끝단 마무리(백엔드 2파일, DB·프론트 0). ① **발행완료 고객 통지** — `sendReceiptIssuedEmail`(emailWrap+발신전용+공개링크) 3 mark 라우트에서 발행 직후 고객 메일(수신자 우선순위 receipt_profile.tax_email>Client 세금/청구/초대>recipient_email, 형식검증+명시수신자만). ② **취소 후 증빙 정리** — PATCH canceled 시 발행된 증빙 있으면 owner/admin "취소·수정 필요" 알림+AuditLog `invoice.receipt_correction_needed`(자동발행/취소 X, 미발행 취소는 noise 0). 검증 함정 박제: `&&` 체인 node -e DB 미종료로 pm2 restart 누락→구코드 검증, 클린 재시작 후 통과. **미배포:** 이번 루프 → 다음 `/배포`.
>
> **이전:** 2026-06-13 — **v1.35.0 증빙 발행 큐 통합 → 컴플라이언스 큐 운영 라이브 (deploy `20260613_152008`, 134초, commit `3c40db0` · Changed 9 · 운영 헬스 200·PM2 prod online·신규 /receipts-due 익명 401).** 버전 1.34.0→1.35.0(minor, package.json — 다음 deploy 시 prod 반영). 30년차 기획 검증에서 기존 "세금계산서 큐 UI 확장" 계획이 핵심을 놓침을 진단: ① 법정 발행기한(세금계산서 익월10일) 신호 부재 ② 증빙 큐와 대시보드 인박스가 각자 `client.is_business` 로 따로 계산(숫자 불일치 회귀 소지) ③ 현금영수증·단건·외부수신자 누락. → **컴플라이언스 큐**로 재정의해 구현: **`services/receiptsDue.js` 단일 진실 원천**(buildReceiptRows/fetchReceiptRows — receipt_type 기반 세금계산서·현금영수증·단건·분할·외부수신자·레거시 fallback + 법정기한 + urgency, `iso()` 날짜 정규화) → **`GET /api/invoices/:biz/receipts-due`** + **대시보드 `collectTaxInvoices` 동일 헬퍼로 교체**(숫자 일치) + **사업자번호 체크섬**(`isValidKrBizNo`, public receipt-request) + **`TaxInvoicesTab` 통합 큐 재작성**(구분 배지·기한 임박/초과 뱃지·overdueBanner·단건/분할 인라인 발행·3-way IssueModal·socket §16) + 탭 라벨 세금계산서→증빙. **입금후발행 정책 박제**(memory `project_receipt_compliance_queue`). 검증: 빌드 EXIT0 · E2E **18/18**(단일원천·3-way 발행·status 전이·owner_only 403·멀티테넌트 403·체크섬 400/200·미결제 제외) · 대시보드 todo 200 · i18n 하드코딩 0 · ko/en 554/554 · 테스트 오염 seed client 10 복원. **의도적 보류(다음 사이클):** 회차별 현금영수증(DB 컬럼)·수정세금계산서/취소·발행완료 고객 메일·팝빌 실발행. **미배포 누적:** `454c54a`(QBill i18n) + 이번 증빙 큐 → 다음 `/배포`.
>
> **이전:** 2026-06-13 — **v1.33.4 운영 라이브 (deploy `20260613_043842`, 134초, 헬스 200·PM2 prod online·DB 컬럼 자동반영) + 청구서 철저 검증 + QBill i18n 정리.** ① **배포:** #14(업무 삭제 fix)·#26(팝아웃 PiP Pin)·#32(세금계산서 업태/종목)·#33(공개 알림 숨김) 운영 반영. `businesses.biz_type/biz_item` sync 자동 추가 확인. 운영 피드백 #14·#26·#28·#32·#33 → done + 회신(#14 lua 알림, Irene 본인 항목 자가 push 생략). ② **신규 운영 피드백 3건 접수**(다음 사이클): #34 결제배너 데스크탑 레이아웃 이탈·#35 포커스 타이머 실제시간 미입력+주간그래프 누적 안 됨·#36 기존 업무 프로젝트명 변경 저장 실패. ③ **청구서 철저 검증** — 백엔드 E2E **24/24 PASS**(생성·외부수신자·항목 detail·통화·PDF 업태종목·발송 owner_only·공개뷰·입금알림·분할·mark-paid), 재무 mutation 7곳 모두 owner_only 가드(PATCH status 인라인 포함), 멀티테넌트 403/404, 익명 401. ④ **QBill i18n 정리(커밋 `454c54a`)** — 검증 중 발견: 고객 결제 페이지(PublicInvoicePage)는 이미 언어설정 따름(public.* ko/en 37키 완비, 처음 t() 기본값을 하드코딩으로 오판한 것 정정), 내부 발행 화면 ~31건만 t() 전환(KIND_LABEL→kind.*, 취소 다이얼로그, 분할 프리셋, N차, placeholder, 통화 (원)→(₩)). qbill.json ko/en 각 494키 정합. 빌드 EXIT0. ⑤ **예시 청구서 발행** — Irene 요청, dev biz5(예시 발신자 "워프로랩")에서 INV-2026-0021(₩3,300,000) 발행→irene@irenewp.com 메일 발송(status sent)+공개 결제링크. **다음 세션:** QBill i18n(454c54a) 미배포 → 다음 `/배포` 시 포함. 신규 버그 #36→#35→#34 개발. (예시 청구서·biz5 데모설정 정리는 Irene 열람 후.)
>
> **이전:** 2026-06-12 — **운영 피드백 4건 처리 (dev 검증·커밋 완료 · 운영 미배포 — `/배포` 대기).** ① **세금계산서 공급자 업태/종목(#32)** — 한국 세금계산서 필수항목 보완. `businesses.biz_type/biz_item` 컬럼 + `PUT /:id/legal` + 워크스페이스 설정 법인정보 AutoSaveField(`settings.json` ko/en `legal.bizType/bizItem`) + 청구서 PDF 공급자 영역 표기(`pdfTemplates.js` senderTypeLine/senderItemLine, 한국 청구서 `!isForeign` 만). legal 왕복 E2E PASS, 빌드 EXIT0. ② **공개/팝아웃 미리보기 알림 숨김(#33)** — `App.tsx isPopout` 에 `/public/` 추가 → NotificationToaster·CueHelpDrawer·MemoFab·RightDock 게이팅. ③ **업무 삭제 안 됨(#14)** — 진짜 원인: 작성자 삭제 조건이 "전체 활동 0건"이라 **본인이 만든 자동 status_history 가 스스로를 영구 차단**(reviewer 지워도 안 풀린 이유). → "타인의 관여(다른 user 댓글·리뷰어·상태변경)"가 있을 때만 차단하도록 정교화(책임선 보호 유지) + `businesses.owner_id` 본인도 owner 인정 + `documents.task_id` NO ACTION FK → 트랜잭션에서 `task_id=null` detach(문서 보존, owner 삭제 FK 에러 차단). E2E: 자기활동만 task 삭제가능 / 타인관여 차단유지 / 문서연결 owner 삭제 detach HTTP200. ④ **팝아웃 항상-위 Pin(#26)** — Q Talk/Note/helper 팝아웃을 Document Picture-in-Picture 창(항상 위)으로. PiP 는 URL 네비 불가 → 빈 PiP 문서에 같은 팝아웃 라우트를 iframe(allow=mic/camera/display-capture)으로 로드해 기존 코드 100% 재사용. Chrome/Edge 116+ 데스크탑만, 미지원/취소 시 `window.open` fallback. 빌드 EXIT0, 3 라우트 200. 커밋 `65067d9`(#32·#33)·`fa2e95f`(#14)·`b0558d5`(#26). 헬스 29/29. **#28 탭 기능:** lua 의견요청 — PlanQ 는 웹앱이라 브라우저 탭 2개로 이미 메뉴 동시 사용 가능(세션·소켓 탭별 독립), 인앱 탭바는 대형 작업이라 네이티브 탭 부족 시 별도 사이클. **다음 세션 시작점:** `/배포`(sync-database 가 biz_type/biz_item 컬럼 자동 추가 — ENUM 아님, 수동 ALTER 불필요) → 운영 피드백 #14·#26·#28·#32·#33 해결 회신 + lua 알림.
>
> **이전:** 2026-06-10 — **운영 라이브 다수 배포 (deploy11~13, 운영 피드백 집중 사이클).** 운영 사용자(Irene·lua) 실시간 피드백 연속 처리. ① **포커스 측정시간 SSOT(#17)** — `focus.js` `task_accumulated_seconds`(종료 세션 합)+현재 세션, FocusWidget/TaskFocusBar 동일 baseline 통일(이중계산 제거), 재개 시 0리셋 차단. E2E 4/4. ② **Q task 실시간(#19/#11)** — `PATCH /:id/time` task:updated broadcast 누락 fix(진행률·시간 즉시 반영). ③ **채팅 토스터 중복(#25)** — message:new 가 conv+business room 양쪽 도착 → msg.id 10초 dedup(NotificationToaster). ④ **유예 기간 구독 비활성 오판정(파일 업로드 차단)** — `plan.js active = !expired && [...]` 가 grace 무시 → `code==='free'?true:(!expired||inGrace)&&[...]`. 전수 감사: subscription_inactive 판정은 plan.can() 1곳뿐, 다른 곳 없음. E2E 3/3. ⑤ **KB 미리보기 메타** — 개인 프로필명·source 제거 → 작성/수정일(createdAt accessor 버그 fix) + 커스텀 항목(url 링크) + 번들 리스트. ⑥ **Q Task 상세** — 작성/요청일 표시, 되돌리기 하단 이동, 단계 직접변경 owner/admin 한정. ⑦ **외부 고객 청구서(#1)** — NewInvoiceModal '외부 직접 입력' 모드(초대 없이 이름+이메일 청구, 백엔드 recipient_email 이미 지원). E2E 5/5. ⑧ **업무 타임라인 표시명** — `projects /:id/tasks` applyMemberDisplayName 누락 → User.name(한수정) 대신 워크스페이스 표시명(루아). ⑨ **내 문의·피드백(#21/#14)** — 좌측 개인 그룹 정식 메뉴 + `/me/feedback` 페이지 + feedback respond 시 보고자 알림(link `/me/feedback`, buildLink가 /admin/feedback로 덮어쓰던 것 fix). E2E 7/7·4/4. ⑩ **모바일 키보드 가림(#23)** — StandardModal·NewChatModal `100vh→var(--vvh)`. ⑪ **피드백 12건 일괄 완료처리+답변+알림**(done 3→15). 헬스 29/29. **배포 함정 박제:** 미커밋이면 deploy가 "Changed files:0"으로 sync 스킵 → 커밋 후 배포 필수(memory `feedback_deploy_requires_commit`).
>
> **이전:** 2026-06-09 — **운영 라이브** (deploy `20260609_175356`, commit `a145e37`, 132초, 검증 3/3 OK). **Q docs(프로젝트 문서) 버그 클러스터 + 통화/청구서/인박스/메모장/빌링.** ① **Q docs(ProjectPostsTab)** — AI 생성(PostAiModal `intent="ai"` 누락 fix) / 첨부 저장(edit·view orphan → `uploadProjectFile`(project_id+L2)+attach 통일, 문서·프로젝트파일·Q File 3곳 노출, E2E 8/9) / **admin role 권한**(`access_scope.js` 미매핑 → owner급 전권 `isAdmin`+`fullView`, owner-only 재무 제외, E2E 10/10) / 표 행/열 플로팅 BubbleMenu(qdocs.editor.table.* ko·en 14키). ② **원화 '원' 표기** 통일(인앱 11+PDF+메일+dashboard fmtAmt+stats, ₩ 잔재 0). ③ **청구서 발행일** 하드코딩(`'2026-04-27'`) → `todayInTz(workspace)` 실제 오늘. ④ **메모장 스크롤**(PostEditor compact Body `flex:1;min-height:0;overflow-y:auto`). ⑤ **인박스 3버그** — `resolveName` name_localized 객체→문자열([object Object] fix) / 컨펌대기 카운트 Task join+business_id 정합(5≠4) / `InsightCards` 순환 CTA 숨김(E2E 10/10). ⑥ **빌링 관리자 입금확인 방식**(owner notify-paid 통보만, platform_admin 활성화, E2E 21/21). **운영 DB ALTER 선적용:** payments notify 2컬럼 + `business_members.role` ENUM `'admin'` 추가 — **N+21 이후 dev·운영 둘 다 ENUM 누락이라 admin role 자체가 작동 불가였음.** 헬스 29/29. **남은 백로그(다음 사이클·독립 기능):** 청구서 외부수신자 직접입력/항목 상세내용/공유·다운로드·미연동 표시, 문서 PDF 다운로드, AI 재생성 통일(전 영역), lua 피드백 13건.
>
> **이전:** 2026-06-08 — **v1.33.3 운영 라이브** (deploy `20260608_195139`, commit `55b5e23`). **빌링 갱신 청구 자동 생성 fix** — cron 이 만료 구독을 past_due/grace 로 상태만 바꾸고 결제할 pending Payment 를 안 만들어, 유예 배너 "결제하러 가기" 가 플랜 선택으로만 빠지던 회귀. `ensureRenewalPayment` 멱등 헬퍼 + cron 백필 sweep + 입금안내 메일 인증 owner 한정. 운영 grace 구독(biz1 sub#2) 백필 → pending #4 생성, 실 API 노출 검증. (구독·청구·결제는 **설정 → 구독 플랜** 한 메뉴 / 고객용 "청구 설정" 과 별개.)
>
> **이전:** 2026-06-08 — **v1.33.2 운영 라이브** (deploy `20260608_190800`, commit `2227a01`). N+92(Focus 배너 실시간/Q helper 엔터/미결제 청구 결제 UI) + **설정 메뉴 개인/워크스페이스 분리**(개인 설정에 내 프로필·외부 연동·내 업무 설정 진입로 신설, Q Mail 계정 노출 — 기존엔 메뉴 없어 "찾을 수 없음") + 통합 런처·팝아웃·tap-to-reveal 동봉. 검증: 운영 헬스 내부/외부 OK · PM2 prod 정상 · 빌드 EXIT 0.
>
> **이전:** 2026-06-08 사이클 N+92 — **운영 고객 피드백 처리 (dev 검증 완료 · 운영 미배포)**. 운영(planq.kr) 플랫폼 피드백 16건 중 미답변 11건(ID 6~16) 전수 검토 → 전부 답변 작성 + 상태 reviewing 운영 DB 반영(platform_admin). **이번 세션 실수정:** ① **Focus 좌측 [포커스 중] 배너 (ID 15·16#1·#2·#4)** — 핵심 원인 2개: (a) `task_workflow.js`(complete/submit-review/cancel-review)가 FocusSession 을 안 건드려 워크플로 완료해도 세션 잔존 → 신규 `services/focusSync.js syncFocusOnTaskStatus()` 로 단일화 (E2E 6/6). (b) `FocusWidget` 30s 폴링만 → `inbox:refresh`/`focus:refresh` window 이벤트 실시간 listen + `QTaskPage.saveField` dispatch. (c) `?task=` URL→state sync useEffect 로 배너 업무명 클릭 이동. ② **Q helper 엔터 통일 (ID 12#1)** — `CueHelpDrawer` 입력 Q Talk 과 동일(Enter 전송/Shift+Enter 줄바꿈/IME 가드). ③ **결제 배너 → 미결제 청구 결제 UI** — 배너 "결제하러 가기" 가 플랜 재선택만 되던 것 → grace/past_due 시 `?pay=1` 로 진입해 결제 모달 자동 오픈 + `PlanSettings` 상단 "결제가 필요한 청구" 카드(금액·결제 버튼). 검증: 헬스 29/29 · 빌드 EXIT 0 · focus E2E 6/6 · DB 스키마 변경 0. **답변+진행중(개발 예정):** 16#3 재개 / 14 업무삭제 / 13 Qdocs·Qinfo / 12#2 입력란 흔들림 / 11 Qtask 실시간·프로젝트명 / 10 단계되돌리기 / 9 Qtalk 팝아웃 / 8 토스터·스크롤 / 7 모바일채팅 / 6 인포 공유.
>
> **이전:** 2026-06-08 사이클 N+91 — **v1.33.1 운영 라이브** (deploy `20260608_075511`, commit `84c5d7a`). **§8.5 고객용 task 직렬화(내부 운영 데이터 격리, 보안) + 공개뷰 폴리시(로고 120px·터치타겟 44px 통일).** §8.5: `utils/taskClientView.js` 신규 — 고객(Client) 조회 시 공수 예측/실제 시간·AI 예측 출처·일별 진행 스냅샷·internal 댓글 차단(진행률은 유지, Irene 결정). `routes/tasks.js`(detail·list) + `routes/task_workflow.js`(reviewers·policy·workflow 3라우트) 적용. 실 API E2E 23/23. 공개뷰: 문서뷰어 5종 로고 88/120 혼재→120 통일, 모든 공개 CTA min-height 44px(인라인 마이크로 버튼 36px), SharePasswordPrompt 입력행 정렬, 10파일. 검증: dev 빌드 EXIT 0 · 운영 헬스 내부/외부 OK · PM2 prod 정상. N+90 모바일 UI/UX 동봉.
>
> **이전:** 2026-06-08 사이클 N+90 — 모바일 UI/UX 개선 (Q Talk 채널 전환 버튼 + 결제 유예 배너 + 헤더 겹침 fix).
> - **Q Note 재설계(Phase 1~3):** ① 슬로우 종료 fix(`getSession` 백그라운드, review 즉시 전환) ② 요약 DB 영속(qnote `sessions` +`summary_key_points`/`summary_full`, `/api/llm/summary` 영속) ③ 메모 body 요약(`docToPlainText`) ④ 요약→Q docs 문서저장(`utils/qnoteSummaryDoc.ts`, L1 사적) ⑤ **Q Note↔Q Task 브릿지**(`routes/qnote_bridge.js` extract/list/register/reject, `task_candidates` +`qnote_session_id`/+`business_id`, `tasks` +`qnote_session_id`, `extractNoteTaskCandidates` 재사용, tenant 격리) ⑥ **재요약 instruction**(`generate_summary(instruction)` 주입 — 불만족 시 "어떻게 고칠지") ⑦ review 3블록(요약/업무/공유) + 참여자바 이동(업무 아래) + 공유 훅 `hooks/useNoteTaskExtraction.ts`(음성·메모 1구현).
> - **상단 UI 통일:** `components/Common/VisibilityChip.tsx`(공개:팀 칩) — Q Note 리뷰·메모를 Q docs 상세 상단과 통일 + 공유 PrimaryBtn(아이콘) + IconBtn 클러스터. "정리하기" 모달(raw-prefill) 제거. 메모에도 공개칩+공유(QNoteShareModal 재사용).
> - **🔴 프록시 경로 회귀 fix(2건, 같은 계열):** `qnote.ts` 요약/공유/visibility + `PublicQNoteSessionPage` 공개뷰 — bare `/api`(Node→HTML 404 "Unexpected token '<'") → **`/qnote/api`**(FastAPI). 메모리 `feedback_qnote_frontend_api_base` 박제.
> - **KB fix:** SQLi 미들웨어 산문 오탐(마크다운 `---`·"select from") 정밀화(`middleware/security.js`) + 상세패널 카테고리 셀렉트 union(`KnowledgePage.tsx`).
> - **공개 "웹에서 보기" 9종 전수 검증**(posts/docs/tasks/files/kb/calendar/invoice/qnote/sign, 실데이터) + 반응형(KB nested-scroll 제거, 가로 오버플로우 0).
> - **N+87~88(Q Mail 맥락통합 A·B·C + 우측패널/후보카드 통일)도 이번 배포에 동봉.**
> - 검증: 헬스 29/29 · 빌드 EXIT 0 · API E2E(요약영속·instruction·브릿지·멀티테넌트403·공개뷰9종) · 운영 스키마 5컬럼 + `/qnote` 프록시 스모크 통과.
>
> **이전:** 2026-06-05 사이클 N+87~88 — Q Mail 맥락통합(A+B+C) + 우측패널 통일 + 업무후보카드 통일(`components/Common/TaskCandidateCard.tsx`). 설계 `docs/QMAIL_CONTEXT_DESIGN.md`. v1.33.0 에 동봉 배포.
>
> **이전:** 2026-06-04 사이클 N+86 — **v1.32.0 운영 라이브** (deploy `20260604_111416`, commit `1d48770`). **Q Bill 결제 독촉 보내기 — 미결제 청구서 수동 리마인더.** 방금 만든 "입금 확인 대기"의 반대쪽(은행계좌·수동 결제 운영 루프 완성). `POST /api/invoices/:biz/:id/send-reminder`(sent/partially_paid/overdue 만, qbill write) + **per-user rate-limit 30/h + invoice별 6시간 쿨다운**(운영안정성 1번) + AuditLog + `invoice:updated` broadcast + `meta.last_reminder_at/reminder_count`. `emailService.sendPaymentReminderEmail`(emailWrap 일관, 연체 강조). `InvoiceDetailDrawer` "결제 독촉 보내기" 액션 + 인라인 피드백(토스트 금지). **백엔드 메일 함수+라우트 / 프론트 3파일, DB 스키마 0**. 검증: 헬스 29/29 · 빌드 EXIT 0 · E2E 12/12(멀티테넌트 403·익명 401·쿨다운 429·draft/paid 400·EmailLog) · 운영 smoke 401.
>
> **이전:** 2026-06-04 사이클 N+85 — **v1.31.0 운영 라이브** (deploy `20260604_100933`, commit `0dd7af3`). **Q Bill 결제 자동화 검증 + "입금 확인 대기" 보강.** ① 기존 자동청구(프로젝트 월정액 `recurring_invoice` + 고객 정기구독 `clientSubscriptionBilling`)·은행계좌 계좌이체·공개 결제페이지·입금확인 흐름을 실 API E2E **22/22** 로 검증 (이미 ~80% 구현됨 확인) ② **신규 "입금 확인 대기" 섹션** — 고객이 송금완료를 알린(`notify_paid_at`) 미확인 청구서를 Q Bill Overview 상단에 모아 표시 + owner 원클릭 입금확인(단건 PATCH status / 분할 mark-paid), 비owner는 drawer. 실시간 §16(socket invoice:*+inbox:refresh + useVisibilityRefresh). 백엔드 0 변경, 데이터흐름 E2E **12/12**. **카드결제(PortOne)·오픈뱅킹 자동입금확인은 "운영 실제 시작 때"로 보류** (Irene 결정). 검증: 헬스 29/29 · 빌드 EXIT 0 · API 34건 PASS · i18n 0 하드코딩.
>
> **이전:** 2026-06-04 사이클 N+84 — **v1.30.0 운영 라이브** (deploy `20260604_081629`, commit `46a8e70`). **Q Task "Cue에게 말하기" 바 + iOS 채팅 입력 fix(확정) + 키보드 스크롤 + Cue 고객전용 게이팅** (진단 인프라 제거 포함). 4종: ① Q Task 상단 상시 "Cue에게 말하기" 바(캐주얼 한마디→AI 업무 즉시 생성, quick 모드, AiCandidateCard 공통화) ② iOS PWA 채팅 입력란 위로 사라짐 **확정 해결**(`interactive-widget=resizes-content` 제거 + main.tsx phantom scroll 가드, Irene 아이폰 확인) ③ 키보드 up 시 채팅 맨 아래 자동 스크롤(shrinkAmount 보정) ④ Cue 자동응답을 **고객(외부) 발화로 한정**(내부 스태프=business_member 발화 스킵). 검증: 헬스 29/29 · 빌드 0 · API 6/6(Cue 게이팅·quick·멀티테넌트 403).
>
> **이전:** 2026-06-03 사이클 N+83 — **v1.29.0 + 진단 배포** (deploy 20260603_060501 / 후속 진단 d206f0b). 기능 4종: ① Q Mail inbound 트리아지 ② 모바일 채팅 입력 fix(**미해결 — iOS PWA 에선 무효, 진단 수집중**) ③ 고객 첫 응대 보완 ④ 고객 정기 구독청구(ClientSubscription). recurring_invoice 잠재버그 2건 fix. **후속:** 알림 배너 모바일 반응형 fix(PushPromptBanner flex-wrap) + iOS 채팅 버그 viewport 실측 진단(`/api/diag/vv` + ViewportDebug, Irene 한정) 배포 — **다음 세션에 VVDIAG 로그 읽고 채팅 데이터 기반 fix + 진단 제거** (session-state 참조).
>
> **이전:** 2026-06-02 사이클 N+82 — **v1.28.0** (commit `ec493af`). Q Mail 메일 검색(제목·미리보기·본문) + 무한스크롤 pagination. **Q Mail 핵심 완결**
>
> **이전:** 2026-06-02 사이클 N+80~81 — **v1.27.0** (commit `92ae47f`). Q Mail M4(FAQ 클러스터링·자동답변·insights) + M5(스팸/Uncertain 분류). `email_messages.faq_embedding` 컬럼 + `email_faq_suggestions` 테이블
>
> **이전:** 2026-06-02 사이클 N+79 — **v1.26.0 운영 라이브** (commit `626c4cf`). 채팅 3기능(임시저장·읽음 구분선·무한로드) + cross-tenant IDOR 보안 fix + 오래된-200 버그 수정
>
> **이전 최종 업데이트:** 2026-06-02 사이클 N+78 — v1.25.1 운영 라이브 (채팅 입력·대화 모바일 정밀 수정 + 자동읽음 차단)
>
> **이전 최종 업데이트:** 2026-06-02 사이클 N+77 — **v1.25.0 운영 라이브** (commit `0a10099`, deploy 20260602_065750). 알림 숫자 실시간 회귀 근본 fix(socket business/conv room 서버 auto-join + health-check `realtime` 영구 가드) + 공개문서 넓은 표 가로스크롤 + Q Task 요청자=필수 컨펌자 + PanelLayout 통일(Q Talk/Task/Note)
>
> **이전:** 2026-06-01 사이클 N+76 — 외부 연동 Phase 2-4 + Q Mail M3 + Q Mail UI/UX 통일(공통 PanelLayout·2-pane) + 새 메일 작성
>
> **공통 레이아웃 박제:** `components/Layout/PanelLayout.tsx` (`PanelLayout`+`Panel`) — 멀티컬럼 페이지 통일 컴포넌트. Q Mail 적용 완료, 타 메뉴 마이그레이션 예정. UI/UX 최상위 기준: memory `feedback_uiux_unified_master`
>
> **직전 라이브:** **v1.24.0** (commit `0e500b2`, 2026-06-01) — Q Mail M3 운영 라이브 (스타·라벨·할당·팔로우·폴더 + AI 답변 제안). `businesses.email_labels` 운영 ALTER 완료
>
> **직전 라이브:** v1.23.0 (commit `7ba9fac`, 2026-06-01) — N+76 외부 연동 Phase 2-4 (개인 GCal overlay + 개인 Drive 탭 + 개인 Gmail 격리). Google 검증 제출 대기
>
> **직전 라이브:** **v1.22.0** (commit `6b52029`, 2026-05-27) — N+75 운영 라이브 (Q Mail M2 인박스 + Settings Google 연결 + 명칭 통일 + deploy 8GB)
>
> **직전 라이브:** v1.21.0 (commit `468fcda`, 2026-05-27) — N+74 운영 라이브 + D hotfix (옛 알림 link 절대 URL 회귀 fix — 운영 42건 path 정규화 백필)
>
> **직전 라이브:** v1.20.1 (commit `fa26899`, 2026-05-27) — N+73 알림 시스템 통합 (notification_link helper backend+frontend mirror + Toaster 닫기=읽음 + Dropdown deep link 통일)
>
> **직전 라이브:** v1.20.0 (commit `028f9ef`, 2026-05-26) — N+71~N+72-6 운영 라이브 (8 commit 알림 통합 마무리 + 외부 연동 Phase 1 + visibility 회귀 전수 fix)
>
> **직전 라이브:** v1.19.1 (commit `4f33541`, 2026-05-25) — N+68+N+69 운영 라이브 (visibility 통일 마무리 / Q Mail 기획 / SaaS readiness alias / Smart Routing 1차)
>
> **직전 라이브:** v1.19.0 — N+63~N+67 21 commit visibility 전수 통일 + 운영 라이브
>
> **직전 라이브:** v1.18.0 — N+49~N+62 14 commit SaaS readiness 완성 (pagination 전수 / AuditLog 전수 / share 4 destination / DB 인덱스 영구 / AdminAuditLogsPage 보강)
>
> **직전 라이브:** v1.17.0 — N+39~N+49 17 commit (PWA hook · 실시간 동기화 보강 · displayName · 정기업무 · Brief · Q Note 정리하기 · share_token 만료 · Smart Routing · Profile 2열 정합)
>
> **이전 라이브:** v1.16.2 (commit `242bc43`) — N+32~N+38 11 commit (Focus 옵션 A + 실시간 동기화 7 영역 + /검증 skill PlanQ 특수)
>
> **이전 라이브:** v1.16.1 (commit `8947504`) — N+31 사이클 (Q Talk 모바일 viewport 회귀 fix)
>
> **이전 라이브:** v1.16.0 (commit `ab113a6`) — N+26~N+27 사이클 (업무 흐름 Focus MVP + 인박스 inline 모달 + Cue 주고받음)

---

## ✅ 완료: D 클러스터 착수 — D1 Q조직(운영) + D2-a 외부파트너 유형(dev) (2026-06-19)

### 완료된 작업

| 작업 | 설명 | 상태 |
|------|------|:----:|
| 운영 피드백 #57~#70 | F6·F7·F8/#70/#69/A1·A2/#61/#66/#68 운영 배포, #60 진단(기기측) | ✅ 배포 |
| D 클러스터 설계 | 4페이즈 로드맵 + D1·D2 상세 `docs/Q_ORG_DESIGN.md` | ✅ |
| **D1 #67 Q조직** | departments/teams + 멤버배정 + org API(E2E 11/11) + OrgPage + 대시보드 3단 | ✅ **운영 라이브** |
| **D2-a #66 유형** | clients.kind(4종) + 라우트 + ClientsPage 배지·선택·드로어 + "고객·파트너"(E2E 5/5) | ✅ dev, 미배포 |

### 수정/신규 파일
- 백엔드: `models/Department.js`·`Team.js`(신규), `models/BusinessMember.js`(dept/team), `models/Client.js`(kind), `routes/org.js`(신규), `routes/clients.js`, `server.js`
- 프론트: `pages/Settings/OrgPage.tsx`·`components/Dashboard/OrgScopeOverview.tsx`·`services/org.ts`(신규), `pages/Dashboard/DashboardPage.tsx`, `pages/Clients/ClientsPage.tsx`, `components/Layout/MainLayout.tsx`, `App.tsx`, i18n org·clients·layout ko/en
- 설계: `docs/Q_ORG_DESIGN.md`

### 검증
- 헬스 29/29 · org E2E 11/11(보안403·교차배정400) · kind E2E 5/5(cross-tenant403) · 멘션 E2E 4/4 · 빌드 EXIT0 · i18n ko/en 일치 · hex 팔레트 정렬
- 운영: departments/teams 테이블 + business_members 컬럼 생성 확인 · /business/org·/dashboard 200

### 미배포 / 다음
- **미배포:** D2-a(clients.kind — dev DB만, 운영 sync 시 ENUM 컬럼 자동) → 다음 `/배포`
- **다음:** D2-b 외부인 담당자 picker(보안민감, B중간) → D3 #65 프로젝트 캔버스+#64 보고서뷰 → D4 #62 보안등급+#63 export. 그 외: AI 전수검사, Q위키 캡처 env, iOS Capacitor

---

## ✅ 완료: Q위키 진입점 연결 F6·F7·F8 + 운영 피드백 14건 정리 (2026-06-18)

### 완료된 작업

| 작업 | 설명 | 상태 |
|------|------|:----:|
| F6 HelpDot→Q위키 탭 | `HelpDot` `askTab` prop(기본 'wiki'). `cue:ask` detail.tab 전달 → 드로어 Q위키 탭 진입(드로어 분기 기구현) | ✅ |
| F8 진입점 자동 라우팅 | 기존 6곳(QTask·QTalk·QNote·Knowledge·QDocs·Todo) 기본 wiki + Dashboard HelpDot 신규 | ✅ |
| F7 랜딩 도움말 | 헤더 nav + 푸터 PRODUCT "도움말"→`/wiki` (landing `nav.help` ko/en) | ✅ |
| 운영 피드백 14건 정리 | #57~#70 4클러스터 분류(A 기수정 / B Q helper허브 / C 빠른버그 / D 대형재설계) | ✅ |

### 수정된 파일
- `dev-frontend/src/components/Common/HelpDot.tsx` (askTab prop)
- `dev-frontend/src/components/Landing/LandingLayout.tsx` (nav+footer 도움말)
- `dev-frontend/src/pages/Dashboard/DashboardPage.tsx` (PageShell helpDot)
- `dev-frontend/public/locales/{ko,en}/landing.json` (nav.help)
- `dev-frontend/public/locales/{ko,en}/dashboard.json` (help.body/cuePrefill)

### 검증
- 헬스 29/29 (EXIT 0) · 빌드 EXIT 0 (index 12:02) · dev `/`·`/wiki`·`/dashboard` 200
- i18n 하드코딩 0 (t() 경유, ko/en 키 존재) · HelpDot 8 사용처 후방호환 · 레이아웃 표준 위반 0
- DB·API·실시간 변경 0 → 3·5·10단계(API/멀티테넌트/소켓/e2e) 해당 없음

### 미배포 / 다음 섹션
- **미배포:** F6·F7·F8 → 다음 `/배포`
- **다음:** #70 내 문의·피드백(parent_id 추가문의 스레드 + master-detail) → #61 Cue 답변범위(권한 전방위 검색) → A1·A2 AdminWikiPage

---

## ✅ 완료: 포커스 주간그래프 배포 + 소리 톤다운 + Q위키/AI감사 설계 (2026-06-18)

### 완료된 작업

| 작업 | 설명 | 상태 |
|------|------|:----:|
| 운영 #57·#58·#59 그래프 수정 | daily-progress가 FocusSession 실측 일별귀속 누적 반영, act_used=max(스냅샷,포커스), 프론트 오늘 라이브. E2E 6/6 | ✅ 배포완료(v1.40.3) |
| 알림소리 톤다운 | 합성음 C5+E5+lowpass 2kHz+볼륨0.16 (맥북 귀아픔 fix) | ✅ dev (운영 미반영) |
| Q위키 설계 | `docs/Q_WIKI_DESIGN.md` — IA확정/전수지도/DB2/API/검증 | ✅ 문서 완결 |
| AI 전수검사 체크리스트 | `docs/AI_FEATURE_AUDIT.md` — 22기능 A~E | ✅ 문서 완결 |

### 수정된 파일
- `dev-backend/routes/tasks.js` (daily-progress 포커스 실측 반영)
- `dev-frontend/src/pages/QTask/QTaskPage.tsx` (오늘 actual max 처리)
- `dev-frontend/src/components/Common/NotificationToaster.tsx` (소리 톤다운)
- `docs/Q_WIKI_DESIGN.md` (신규), `docs/AI_FEATURE_AUDIT.md` (신규)

### 다음 섹션
- **Q위키 구현** (DB→Backend→Admin→콘텐츠→Frontend→검증)
- **AI 기능 전수검사** (22기능 실 API 동작증명, 고급기능 우선)

---

## ✅ 완료: 증빙·PDF·정기업무 대규모 사이클 (2026-06-13, 운영 라이브)

> 하루 8+ 사이클 — Q Bill 증빙 컴플라이언스 완결 + PDF 인프라 + Q Task 정기업무 점검. 전부 운영 배포 완료.

### 완료된 작업

| # | 작업 | 핵심 | 상태 |
|:-:|------|------|:----:|
| 1 | 증빙 발행 큐 통합 (v1.35.0) | `receiptsDue` 단일원천 + 법정기한(익월10일) + 세금계산서/현금영수증 단건·분할 + 사업자번호 체크섬 | ✅ |
| 2 | 증빙 루프 완성 | 발행완료 고객 통지 메일 + 취소 후 수정/취소 알림 | ✅ |
| 3 | 회차별 현금영수증 (v1.36.0) | InvoiceInstallment cash 3컬럼 + 회차 mark 라우트 + IssueModal 4-way | ✅ |
| 4 | 문서 PDF 다운로드 | Document PDF 라우트 + posts 서버PDF 격상 (인증 blob fetch) | ✅ |
| 5 | 청구서 PDF 401 + Puppeteer 자가복구 | window.open→blob · 죽은 브라우저 재사용 전체 PDF 행 버그 fix | ✅ |
| 6 | 운영 피드백 #34/#35/#36 | v1.34.0 fix 항목 티켓 close + 회신 (코드 0) | ✅ |
| 7 | 수정세금계산서·증빙 취소 Phase 1 | `receipt_corrections` 테이블 + 부가세법 §70 6사유 + CorrectionModal + 정정이력(큐+드로어) | ✅ |
| 8 | 정기업무 점검·완성 | 인스턴스 project_id 누락 버그 fix (prod 고아 16건 백필) + reviewer 복사 | ✅ |

### 수정된 주요 파일
- `dev-backend/services/receiptsDue.js` (신규) · `recurringTaskGenerator.js` · `pdfService.js`(자가복구) · `pdfTemplates.js`
- `dev-backend/models/ReceiptCorrection.js`·`InvoiceInstallment.js`(cash 컬럼) · `routes/invoices.js`·`docs.js`·`dashboard.js`
- `dev-backend/services/emailService.js` (sendReceiptIssuedEmail/CorrectionEmail)
- `dev-frontend/src/pages/QBill/TaxInvoicesTab.tsx`(증빙 큐+CorrectionModal) · `InvoiceDetailDrawer.tsx` · `services/invoices.ts`·`docs.ts`·`posts.ts`
- `docs/RECEIPT_CORRECTION_DESIGN.md` (신규 설계문서)

### DB 변경 (운영 반영 완료)
- `receipt_corrections` 테이블 신규 (sync_database 자동 생성, 운영 16컬럼 확인)
- `invoice_installments` + cash_receipt_no/at/marked_by 3컬럼
- 운영 백필: 정기업무 인스턴스 project_id (prod 고아 16→0, idempotent)

### 다음 할 일
- 증빙 Phase 2: 정정 PDF · insights 정정 반영 · 팝빌 자동발급 (운영 실시작 때)
- 또는 새 영역 (Irene 지정)

---

## ✅ 완료: 사이클 N+94 — 빌링 갱신 청구 자동 생성 fix + v1.33.3 운영 라이브 (2026-06-08)

> deploy `20260608_195139`, commit `55b5e23`/`b714168`. 운영 고객 호소 "유예 배너 '결제하러 가기' 가 결제 안 되고 플랜 선택으로만 감" 근본 fix.

### 근본 원인
구독 갱신 cron(`runDailyBillingCron`)이 만료 구독을 `past_due → grace → demoted` 로 **상태만** 바꾸고, 정작 결제할 **pending Payment(갱신 청구)를 생성하지 않음**. pending Payment 는 사용자가 직접 플랜을 고를 때(`createPendingSubscription`)만 생성됨. → 유예 진입 시 `pending_payment = null` → 배너 `hasPending=false` → `?pay=1` 없이 플랜 선택으로 빠짐. N+92 에서 UI(배너→모달)는 붙였지만 모달이 띄울 청구 자체가 생성 안 되던 상태.

### 완료된 작업

| 작업 | 설명 | 상태 |
|------|------|:----:|
| `ensureRenewalPayment(sub)` 멱등 헬퍼 | 같은 구독 pending 있으면 재사용, 없으면 sub.price(없으면 플랜표)로 bank_transfer pending 생성 | ✅ 완료 |
| cron 백필 sweep (4단계) | past_due/grace 전 구독에 갱신 청구 보장 — 이번 run 전이분 + 배포 이전 grace 레거시 모두 멱등 커버 | ✅ 완료 |
| 입금안내 메일 인증 owner 한정 | `notifyRenewalDue` 가 `email_verified_at` 있는 owner 에게만 발송 (미인증/test 반송 방지) | ✅ 완료 |
| 운영 grace 구독 백필 | biz=1 sub#2(starter 9900) → pending #4 생성, 운영 실 API `/api/plan/1/status` 노출 검증 | ✅ 완료 |
| 메뉴 위치 확인(검증) | 워크스페이스 구독·결제·영수증 = **설정 → 구독 플랜**(owner). 고객용 "청구 설정" 과 별개 | ✅ 완료 |

### 수정된 파일
- `dev-backend/services/billing.js` (ensureRenewalPayment + notifyRenewalDue + cron 백필 sweep + export)
- `dev-backend/package.json`, `dev-frontend/package.json` (1.33.2 → 1.33.3)

### 검증
- 헬스 29/29 · grace sub 갱신청구 생성→멱등→status 노출 6/6 · 운영 실 API pending #4 노출 · 배포 검증 3/3

---

## ✅ 완료: 사이클 N+93 — 설정 메뉴 개인/워크스페이스 분리 + v1.33.2 운영 라이브 (2026-06-08)

> deploy `20260608_190800`, commit `2227a01`. N+92(Focus 배너 실시간·Q helper 엔터·미결제 청구 결제 UI) + 통합 런처·팝아웃·tap-to-reveal 동봉 배포.

### 완료된 작업

| 작업 | 설명 | 상태 |
|------|------|:----:|
| 설정 메뉴 그룹 분리 | 사이드바 설정 아코디언을 **워크스페이스 설정 / 개인 설정** 2그룹으로 시각 분리 (AccordionGroupLabel) | ✅ 완료 |
| 개인 설정 진입로 노출 | 내 프로필 · 외부 연동(`/profile/integrations`) · 내 업무 설정(`/me/work-settings`) — 페이지는 있었으나 메뉴 없어 "찾을 수 없음" 이던 것 노출 | ✅ 완료 |
| Q Mail 계정 노출 | `/business/settings/mail-accounts` 워크스페이스 그룹에 진입로 추가 (IconInbox) | ✅ 완료 |
| 아코디언 열림/active 조건 보강 | `/me/work-settings` 경로 추가, 프로필 active 를 exact match 로 분리 | ✅ 완료 |
| i18n 키 추가 | layout.json ko/en — integrations/mailAccounts/personalSettings/workspaceGroup, en myWorkSettings | ✅ 완료 |
| v1.33.2 운영 배포 | 검증 3/3 (헬스·프론트·PM2) + 버전업 + 임시 테스트 파일 제거 | ✅ 완료 |

### 수정된 파일
- `dev-frontend/src/components/Layout/MainLayout.tsx` (그룹 라벨·아이콘·개인 그룹·Q Mail 항목)
- `dev-frontend/public/locales/ko/layout.json`, `dev-frontend/public/locales/en/layout.json`
- `dev-backend/package.json`, `dev-frontend/package.json` (1.33.1 → 1.33.2)
- `dev-backend/test-popout-auth.js` (제거)

---

## ✅ 완료: 사이클 N+92 — 운영 고객 피드백 처리 (2026-06-08, dev 검증 완료 · **운영 미배포**)

> **계기:** 운영(planq.kr) 플랫폼 피드백 16건 중 미답변 11건(ID 6~16) 검토. 답변 전부 작성 + 상태 reviewing 운영 DB 반영(platform_admin user 1). 고객이 자주 호소한 항목부터 실제 수정.

### ✅ 이번 세션 실수정 (dev 검증 · 다음 배포 반영 예정)

| 작업 | 설명 | 상태 |
|------|------|:----:|
| Focus 배너 완료 시 정리 (ID 16#1) | `task_workflow.js` 가 FocusSession 미처리 → 신규 `services/focusSync.js` 로 워크플로 완료/전환 시 담당자 세션 종료. E2E 6/6 | ✅ |
| Focus 배너 실시간 전환 (ID 15·16#2) | `FocusWidget` 30s 폴링 → `inbox:refresh`/`focus:refresh` 이벤트 즉시 반영 + `QTaskPage.saveField` dispatch | ✅ |
| Focus 배너 업무명 클릭 이동 (ID 16#4) | `QTaskPage` `?task=` URL→state sync useEffect 추가 (mount 1회만 읽던 회귀) | ✅ |
| Q helper 엔터 통일 (ID 12#1) | `CueHelpDrawer` Q Talk 과 동일 (Enter 전송/Shift+Enter 줄바꿈/IME 가드) + 안내문 ko·en | ✅ |
| 결제 배너 → 미결제 청구 결제 UI | 배너 "결제하러 가기" 플랜 재선택만 되던 것 → `?pay=1` 결제 모달 자동 오픈 + PlanSettings "결제가 필요한 청구" 카드 | ✅ |

### 🚧 답변 완료 + 개발 예정 (운영 reviewing)
ID 16#3 재개 버튼(설계) · 14 업무 삭제 안 됨 · 13 Q docs 리스트·Q info 수정삭제공유 · 12#2 Q Talk 입력란 흔들림 · 11 Q Task 실시간·프로젝트명 변경 · 10 단계 되돌리기 버튼 · 9 Q Talk 팝아웃 창 · 8 활성방 토스터·입장 스크롤 · 7 모바일 채팅 아이콘·간격 · 6 Q info 공유·다중전송·미리보기

### 수정된 파일
- backend: `services/focusSync.js` (신규), `routes/task_workflow.js`
- frontend: `components/Focus/FocusWidget.tsx`, `pages/QTask/QTaskPage.tsx`, `components/Common/CueHelpDrawer.tsx`, `pages/Settings/PlanSettings.tsx`, `components/Layout/WorkspaceBillingBanner.tsx`, `public/locales/{ko,en}/{plan,common}.json`

### 검증
- 헬스 29/29 · 빌드 EXIT 0 · focus E2E 6/6 · 변경 3페이지 서빙 200 · i18n 하드코딩 0 · 8-A padding 22→24 교정 · DB 스키마 변경 0

---

## ✅ 완료: 사이클 N+90 — 모바일 UI/UX 개선 (2026-06-08, dev 검증 완료)

> **계기:** Irene 모바일 실테스트 중 발견한 UI 겹침/잘림 문제 수정.

### 완료된 작업

| 작업 | 설명 | 상태 |
|------|------|:----:|
| Q Talk 채널 빠른 전환 모바일 배치 | 데스크탑은 헤더 우측, 모바일은 채팅방 이름 아래 별도 줄로 배치 (겹침 방지) | ✅ |
| 채널 버튼 이름 잘림 수정 | `max-width: 140px` 제거 → 채널명 전체 표시 | ✅ |
| 모바일 소속 구분자 제거 | 모바일에서 소속 앞 `border-left` 구분선 제거 (간결) | ✅ |
| 결제 유예 배너 헤더 아래 배치 | `MainContent`에 모바일 `padding-top: 56px` 추가 → 배너가 헤더에 안 가려짐 | ✅ |
| 결제 유예 배너 1단 레이아웃 | 모바일에서 아이콘 숨기고 텍스트+CTA를 1단 세로 흐름으로 변경 | ✅ |

### 수정된 파일
- `dev-frontend/src/pages/QTalk/ChatPanel.tsx` — MobileChannelRow, QuickSwitchBtn, ProjectSublabel 모바일 스타일
- `dev-frontend/src/components/Layout/MainLayout.tsx` — MainContent 모바일 패딩
- `dev-frontend/src/components/Layout/WorkspaceBillingBanner.tsx` — 모바일 1단 레이아웃

### 검증
- 빌드 EXIT 0 (1.22s)
- 헬스체크 27/29 (PM2 이름 설정 문제, API 정상)

---

## ✅ 완료: 사이클 N+84 — Q Task "Cue에게 말하기" 바 + iOS 채팅 fix + Cue 고객전용 (2026-06-04, dev 검증 완료 · **운영 미배포**)

> **계기:** ① Irene 요청 "Q task에서 그냥 AI에게 말하는 기능"(30년차 UI/UX 수준) ② iOS 채팅 입력란 버그 진단 로그(VVDIAG) 데이터 기반 fix ③ 모바일 실테스트 중 발견한 키보드 스크롤 + Cue 오작동.

### 완료된 작업

| 작업 | 설명 | 상태 |
|------|------|:----:|
| Q Task "Cue에게 말하기" 바 | 헤더/탭 아래 상시 입력 바. 캐주얼 한마디→Cue가 업무로 정리→인라인 미리보기(모달 아님)→[추가]. Coral Cue 브랜딩, Enter 전송, ⌘T 포커스, 모바일 풀폭 | ✅ |
| quick 모드 (planner) | `mode:'quick'` — 한마디=1업무로 기울임(나열 시만 다중). buildSystemPrompt override + 라우트 분기 | ✅ |
| AiCandidateCard 공통화 | 분해 모달 카드를 공통 컴포넌트로 추출 → 모달·바 공유(DRY). 모달 리팩터링 | ✅ |
| iOS 입력란 위로 사라짐 fix | **확정 해결**. `interactive-widget=resizes-content` 메타 제거(근본) + main.tsx phantom scroll 가드(`scrollTo(0,0)`). VVDIAG 실측: 깨진 focus off/sY=376→0 | ✅ |
| 키보드 up 시 채팅 맨 아래 스크롤 | ChatPanel 키보드 핸들러 `distance<240` 가드가 키보드 높이만큼 커진 distance에 걸려 스킵되던 것 → shrinkAmount 보정 + RAF | ✅ |
| Cue 고객전용 게이팅 | Cue 자동응답이 sender 안 보고 customer 채널이면 다 응답 → **내부 스태프(business_member, owner 포함) 발화 스킵**, 고객(외부) 발화만 | ✅ |
| 진단 오버레이 모바일 전용 | ViewportDebug 데스크탑 노출 제거(검정 박스) + dev hostname 게이트(dev 계정 이메일 다른 문제 보완) | ✅ |

### 검증
- 헬스 **29/29** · 빌드 **EXIT 0**(8GB) · 타입 0 · API **6/6**(Cue member→무응답 / quick=1 / 멀티테넌트 403×2 / confirm DB) · 서빙 200 · viewport 메타 interactive-widget 제거 확인 · i18n 신규 하드코딩 0 · 색상 토큰 정합(#FFF1F2 기수정)
- **백엔드 무변경 재사용:** `/api/tasks/ai-create`(+/confirm) — confirm 이 task:new broadcast(실시간 §16)
- DB 스키마 변경 없음 → 운영 ALTER 불필요

### 수정된 파일
- `dev-frontend/src/components/QTask/CueTaskBar.tsx` (신규), `AiCandidateCard.tsx` (신규), `AiTaskCreateModal.tsx` (공통 카드 리팩터링)
- `dev-frontend/src/pages/QTask/QTaskPage.tsx` (바 마운트), `public/locales/{ko,en}/qtask.json` (ai.bar + itemDays)
- `dev-frontend/index.html` (viewport 메타), `src/main.tsx` (scroll 가드), `src/pages/QTalk/ChatPanel.tsx` (키보드 스크롤)
- `dev-frontend/src/components/Common/ViewportDebug.tsx` + `Layout/MainLayout.tsx` (진단 게이트)
- `dev-backend/services/aiTaskPlanner.js` + `routes/tasks.js` (quick 모드), `routes/projects.js` (Cue 게이팅)

> **다음 배포 시:** 위 전부 + 진단 인프라 제거(ViewportDebug + `/api/diag/vv` + ChatPanel `data-msglist`) 동반.

---

## ✅ 완료: 사이클 N+79 — 채팅 "완벽화" 3기능 + IDOR 보안 fix (2026-06-02, **운영 라이브 v1.26.0** commit `626c4cf`)

> **계기:** 사용자 호소 "채팅 입력·대화가 틀어지고 이상하고 모바일에서 엉망. 완벽한 채팅서비스로 업그레이드". 30년차 3축 감사(입력기·메시지/스크롤·모바일/키보드) → 실코드 검증 후 N+78(모바일 정밀 수정) 이어, 사용자 요청 "셋 다 진행"으로 3기능 구현.

### 완료된 작업

| 작업 | 설명 | 상태 |
|------|------|:----:|
| 작성 중 메시지 임시저장 | 입력 즉시 대화별 localStorage 저장 → 대화 전환·재진입 복원, 전송 시 삭제, 대화 간 누수 차단. **브라우저 e2e 저장+복원 실증** | ✅ |
| "여기까지 읽음" 구분선 | conv 리스트에 `my_last_read_at` 노출 → 진입 시점 freeze → 첫 안읽은 타인 메시지 앞 Coral 구분선 | ✅ |
| 과거 메시지 무한 로드 | 백엔드 최신-N + `?before=<msgId>` 페이지네이션(+has_more) / 프론트 위로 스크롤 prepend + 스크롤 anchor 보존 + 로딩 인디케이터 + RO/MO yank 가드 | ✅ |
| 오래된-200 버그 수정 | 옛 `ASC limit 200`(긴 대화에서 오래된 200개만) → 최신-N 페이지네이션 | ✅ |
| 🔴 cross-tenant IDOR fix | 메시지 GET 라우트가 standalone 대화(project_id null)에 접근검사 없어 conv id 열거로 타 워크스페이스 메시지 조회 가능 → `canAccessConversation` 가드 추가. 검증으로 403 차단 확인 | ✅ |

### 검증
- 헬스 29/29 · 빌드 exit 0 · API 페이지네이션 PASS(2+2+1, has_more 정확) · my_last_read_at 반환 · IDOR 403 차단(정상 접근 200 무회귀) · **Puppeteer 모바일 e2e: 대화 열기·메시지 11렌더·임시저장 저장+복원·critical JS 에러 0** · 8-A 색상/8-E i18n/8-G 레이아웃 통과
- DB 스키마 변경 없음 (last_read_at 기존 컬럼, before=쿼리) → 운영 ALTER 불필요

### 수정된 파일
- `dev-backend/routes/projects.js` (메시지 GET 페이지네이션 + standalone IDOR 가드)
- `dev-backend/routes/conversations.js` (conv 리스트 my_last_read_at 노출)
- `dev-frontend/src/pages/QTalk/ChatPanel.tsx` (임시저장·구분선·무한로드 스크롤 anchor·로딩 인디케이터)
- `dev-frontend/src/pages/QTalk/QTalkPage.tsx` (loadOlder 상태/함수 + props 전달)
- `dev-frontend/src/services/qtalk.ts` (loadOlderMessages API)
- `dev-frontend/src/pages/QTalk/types.ts` (my_last_read_at)
- `dev-frontend/public/locales/{ko,en}/qtalk.json` (loadingOlder·unreadDivider)

> **다음 배포 시 운영 반영 필요:** IDOR 보안 fix 포함 — `/배포` 시 함께 나감.

---

## 🚧 진행: 사이클 N+76 — 외부 연동 팀/개인 Phase 2-4 (개인 GCal·Drive·Gmail) (2026-06-01, dev 검증 완료 · 운영 미배포)

> **사용자 호소:** "외부연동 서비스를 팀이랑 개인을 잘 정리하는 게 우선 아니었어? 이거 다 했어?" → Phase 1(틀)만 되어 있고 개인 자산 실연결(Phase 2-4)이 placeholder 였음. 이번 사이클에 실연결.

**설계:** `docs/EXTERNAL_INTEGRATIONS_DESIGN.md` — `external_connections.owner_scope`(workspace/user) + 같은 GOOGLE_CLIENT_ID 재사용. **DB 스키마: 추가 1개만** (`email_accounts.owner_user_id`).

> **권한 등급 결정 (2026-06-01, Irene):** Google 검증 부담 최소화 —
> - 개인 캘린더 `calendar.readonly` (sensitive, 일반 검증, CASA X) + 개인 Drive `drive.file` (비제한, 회사 Drive 와 동일 = PlanQ 저장 파일만, CASA X) → **이 둘만 출시 검증** 진행
> - 개인 Gmail `mail.google.com` 은 restricted(CASA 유료심사) → **OAuth 원클릭은 검증 대기 항목으로 보류**. **Q Mail 자체는 IMAP 앱 비밀번호로 검증 없이 정상 작동** (회사 메일 이미 그 방식). 일반 이메일앱 기능 제약 없음.

**Chunk 1 — 개인 OAuth 공통 기반:**
- `services/personalOauth.js` — Google 3 provider scope(calendar.readonly/drive.readonly/mail.google.com) + HMAC state(owner_scope='user', 10분 TTL) + 토큰 교환/refresh/revoke
- `routes/external_connections.js` — `POST /me/oauth/google/initiate` + `GET /me/oauth/google/callback`(단일 redirect URI, provider 는 state 분기) → `external_connections`(cal/drive) 또는 `EmailAccount`(gmail) 저장. AES-256-GCM.
- 검증 13/13 (auth_url scope/redirect/state, 400/403/401 격리, 위조 state 거부)

**Phase 2 — 개인 Google Calendar overlay:**
- `services/personalCalendar.js` (events.list, 10s timeout) + `GET /me/calendar/events`
- `QCalendarPage` — 개인 일정 **violet(#8B5CF6) overlay** + "내 캘린더" 토글(연결 시만) + 클릭 시 Google 원본 새 탭. `PersonalCalendarEvent` 타입 + `isPersonalEvent` 가드.
- `ProfileIntegrationsPage` 캘린더 "Google Calendar 연결" 버튼 실작동(popup OAuth)

**Phase 4 — 개인 Google Drive 탭:**
- `services/personalDrive.js` (files.list) + `GET /me/drive/files`
- `QFilePage` 탭 분리(회사 파일 / 내 파일) + `PersonalDriveTab`(검색·열기). 검증 4/4.

**Phase 3 — 개인 Gmail + Q Mail 폴더 분리 (프라이버시 critical):**
- `email_accounts.owner_user_id`(NULL=회사 공용, set=개인) — **기존 IMAP cron 무변경으로 개인 Gmail 자동 수집**
- **프라이버시 격리** `routes/email_threads.js` — `accessibleAccountIds()`(회사 공용 + 본인 개인)로 list/detail/mark-*/reply 전부 제한. 다른 사람 개인 메일 절대 노출 X (admin 도)
- `GET /me/email-accounts` + `GET /:biz/mail-accounts`(폴더트리용) + 개인 메일 해제
- `MailPage` 폴더트리 **회사/개인 계정 그룹** + 계정 필터. `ProfileIntegrationsPage` 메일 "Gmail 연결"
- **격리 검증 9/9** — B 가 A 개인 메일을 list/detail/mark-read/mail-accounts 어디서도 못 봄, A 는 다 봄

**남은 것:** Google Cloud Console 에 redirect URI `${origin}/api/me/oauth/google/callback` 1개 등록 + 최종 OAuth 동의 클릭(Irene 실계정) → E2E 완결. Microsoft(Phase 5)·옛 모델 마이그레이션(Phase 6-7) 후순위.

---

## ✅ 완료: 사이클 N+75 (A/B/C/D) — 명칭 통일 + deploy OOM 차단 + Google 연결 UI + Q Mail M2 (2026-05-27, 4 commit, 운영 라이브 v1.22.0)

**Phase A (commit `8a860c5`):** 명칭 통일 — "공유/공개 범위" → "공개" 5 자산 (VisibilityBadge + DocsTab + KnowledgePage 2곳 + EventDrawer + PostsPage) + i18n ko/en
**Phase B (commit `67b7ef6`):** deploy 스크립트 OOM 차단 — NODE_OPTIONS 4GB → 8GB + pipe 제거 + PRE/POST mtime 3중 안전망 (N+74 Killed 회귀 방지)
**Phase C (commit `02c3ed0`):** Settings ProfileIntegrationsPage — Google 로그인 연결 UI 활성화 (backend API 이미 있었으나 frontend 연결 버튼 누락 — 사용자가 막힌 상태) + Google 브랜드 4색 G + 친화 에러
**Phase D (commit `6b52029`):** Q Mail M2 인박스 read-only — backend routes/email_threads.js (list/detail/mark-read/mark-spam/mark-not-spam, requireMenu+멀티테넌트) + frontend MailPage 3컬럼 (폴더트리 / 리스트 / iframe sandbox 상세) + URL 싱크 + 반응형

**검증:** 헬스 28/28 / 빌드 8GB 0건 OOM / API 통합 7/7 / 7 페이지 200 / 운영 verify ✓

**다음 사이클 (N+76+):**
- Q Mail M3 — 답장 (Tiptap + SMTP) + 라벨 / 스타 / 할당 + AI 답변 제안 (Cue)
- 외부 연동 Phase 2-4 개인 자산 (개인 GCal/Gmail/Drive)
- AdminAuditLogs 보강 후속
- 사용자별 알림 매트릭스 UI 보강 (NotificationPref)

---

## ✅ 완료: 사이클 N+74 (A/B/C/D) — 외부 공유 팀(L2) + 만료 알림 + deep link hotfix (2026-05-27, 4 commit, 운영 라이브 v1.21.0)

**Phase A (commit `7742988`):** files vlevel/target_member_ids + L2-members JSON_CONTAINS + PUT visibility 분기
**Phase B (commit `0a7afd4`):** shareExpiryNotify D-3 cron + backfill_vlevel.js + PersonalVault 점검 (변경 X)
**Phase C (commit `2f108ed`):** share_expiry event_kind 신규 + shareTokenCleanup 6 자산 확장
**Phase D hotfix (commit `468fcda`):** 사용자 호소 "알림 클릭 링크 안 됨" — 옛 운영 알림 link 가 절대 URL 형식 ('https://planq.kr/talk?conv=X') → normalizeLink helper + 운영 backfill 42건 정규화

**DB ALTER (자동/수동):**
- files.vlevel ENUM + files.target_member_ids JSON (sync 자동)
- posts.target_member_ids JSON (운영 수동 ALTER)
- notifications.event_kind ENUM 에 'share_expiry' 추가 (sync 자동)

**검증:** 헬스 28/28 / API 7/7 / normalizeLink 9/9 / 운영 hash 갱신 + PM2 v1.21.0 reload

**회귀 박제 (다음 검증 시 우선 확인):**
- N+73 deep link helper 추가 시 **운영 옛 데이터 sample 검증 누락** → 회귀 발견
- 검증 패턴: 신규 코드 단위 통과 ≠ 옛 DB 데이터 호환. 운영 sample 1건 필수
- 빌드 메모리 4GB → 8GB 상향 (배포 스크립트 옵션 추가 후속)

**다음 사이클:**
- Q Mail M2 인박스 read-only UI
- 외부 연동 Phase 2-4 개인 자산
- 명칭 통일 후속 (Q file/Q info/Q calendar/Q task)

---

## ✅ 완료: 사이클 N+73 — 알림 시스템 통합 (2026-05-27, 1 commit, 운영 라이브 v1.20.1)

**사용자 호소 (2026-05-26):**
- "우측 알림 배너랑 좌측 알림종 드롭다운 숫자가 동기화 안 됨. 닫거나 클릭하면 둘 다 읽음 처리되어야"
- "알림 내용 누르면 링크가 다 제대로 안 걸리고 랜딩페이지로 가는데, 우측 토스터는 잘 감"

**핵심 산출물:**

1. **통합 라우팅 helper (backend + frontend mirror)**:
   - `services/notification_link.js` — buildLink({entity_type, entity_id, event_kind})
   - `utils/notificationLink.ts` — resolveNotificationLink + notificationRowToToastLink
   - 11 매핑 통과: conversation/task/post/file/invoice/signature_request/calendar_event/kb_document + invite/inquiry/signup/payment/subscription/trial/feedback

2. **backend (routes/notifications.js)**:
   - notify() link 자동 생성 — 호출자 link 미전달 시 buildLink 호출
   - socket 'notification:new' full row emit (옛: {id,kind} 만 → id/event_kind/title/body/link/entity_type/entity_id/business_id/created_at 전체)
   - push 채널 link 도 resolvedLink 통일

3. **frontend NotificationDropdown**:
   - resolveNotificationLink fallback — item.link 없으면 entity_type/event_kind 매핑
   - 옛 `if (item.link) navigate(...)` (없으면 navigate 호출 X) → 항상 안전한 path 진입

4. **frontend NotificationToaster**:
   - Toast interface 에 notificationId 추가
   - socket 'notification:new' listen + dedup (notificationId / contextKey)
   - 옛 raw event (message:new/task:new) 와 매칭 시 notificationId 채우기
   - dismiss() — notificationId 있으면 PATCH /:id/read + 'notification:refresh' dispatch → 좌측 종 즉시 동기화
   - 클릭 시 toast.link || '/notifications' (랜딩 fallback 차단)

**검증:**
- buildLink 단위 11/11
- notify() 통합 3/3 (auto/explicit/fallback)
- API 통합 5/5 (목록/IDOR 404/익명 401/unread-count/read-all)
- Socket 4 요소 (a/b/c/d) 모두 정합
- 빌드 1.23s exit 0
- 6 페이지 SPA 라우팅 200

**다음 사이클 (N+74+):**
- 외부 공유 = 팀(L2) + 개인(L1) — 사용자 1순위 강조
- Q Mail M2 인박스 read-only UI
- 외부 연동 Phase 2-4 개인 자산

---

## ✅ 완료: 사이클 N+71~N+72-7 — 알림 통합 + 외부 연동 Phase 1 + visibility 회귀 전수 fix + Q docs UX (2026-05-26, 9 commit, 운영 라이브 v1.20.0)

**핵심 산출물:**

1. **N+71 — Q Talk 리스트 unread 실시간 회귀 fix** (사용자 호소):
   - backend message:new = conv room 만 → conv room + business room 양쪽 emit
   - QTalkPage socket.on('connect') 에서 join:business 자동 호출
   - 활성 외 다른 conv 메시지 도착 시 좌측 리스트 unread + 미리보기 즉시 갱신

2. **N+72 Phase 1 — 외부 연동 통합 모델**:
   - docs/EXTERNAL_INTEGRATIONS_DESIGN.md (380줄) — owner_scope (workspace/user) 패턴 + 4 provider × 5 자원 매트릭스
   - models/ExternalConnection.js — AES-256-GCM 암호화 + UNIQUE (business_id, owner_scope, user_id, provider, account_email)
   - routes/external_connections.js — admin GET /api/businesses/:bizId + user GET /api/me/external-connections + legacy adapter
   - ProfileIntegrationsPage.tsx — 4 섹션 (로그인/캘린더/메일/파일) + Phase 2-4 ComingSoonNote

3. **N+72 시급 3건 + 전수 검사** (사용자 호소 "30년차 수준 전수검사"):
   - 문서 저장 실시간 갱신 (post:updated event refetchOpenDetail)
   - 공유범위 UI 가시성 — VisibilityChip 옆 "공유 범위: {label}" SecondaryBtn
   - L4 권한 회귀 — canAccessPostByLevel/FileByLevel/KbDocByLevel 모두 L4=workspace member 자동 통과 + L2-members target_member_ids
   - PostsPage L2-members modal 멤버 안 보임 — visBizId 도출 변경 + 모든 4 곳 (PostsPage/NewEventModal/KnowledgePage/DocsTab) Cue AI 필터

4. **N+72-4 — Q docs default L3 + 공유 UI**:
   - routes/posts.js default vlevel L1 → L3 (사용자 호소 "내가 공유한 문서가 삭제되었다고 떠")
   - 리스트 RowVisChip (L1=slate/L2=amber/L4=rose/L3=teal)
   - PublicPostPage 자동 redirect 제거 — "PlanQ 앱에서 열기" 버튼만 제공
   - 책갈피/책 IconBtn → SecondaryBtn 텍스트 라벨 ("Q info 로", "템플릿")

5. **N+72-5 — Q info RichEditor + sticky 헤더**:
   - KnowledgePage TextArea → Tiptap RichEditor (modal + drawer 둘 다)
   - TreePanel sticky top:8px → top:0 (body padding 보정)

6. **N+72-6 — 알림 통합 (사용자 호소 핵심 "실시간 + 통일된 숫자 필수")**:
   - backend GET /api/conversations/me/unread-total-all — 4 경로 합집합 (BusinessMember + clients.user_id + clients.invite_email + project_members)
   - useUnreadTotal.ts 재작성 — 단일 모듈 캐시 + 단일 socket + ref-count cleanup (사이드바·OS badge·워크스페이스 selector 모두 같은 데이터)
   - useUnreadByBusiness() 신규 hook — 워크스페이스별 unread 맵
   - socket message:new 옵티미스틱 +1 + 50ms debounce reconcile + inbox:refresh + focus + visibilitychange 4 트리거
   - WorkspaceSwitcher — Trigger OtherUnreadBadge (Coral) + 드롭다운 per-biz MenuUnreadBadge
   - PushPromptBanner 전역 mount (옛: TodoPage 만) + granted-off 자동 silent re-subscribe + iOS Safari 비-PWA 안내
   - Q Talk RightPanel — formatDate(due_date) + tStatus (qtask namespace) raw "not_started" 회귀 fix

**DB 변경:**
- external_connections 신규 테이블 (Phase 1 통합 모델)

**검증:**
- 0단계 28/28 ✓
- 빌드 exit 0 (937ms)
- API 실호출 5 케이스 (정상/익명/위조/ghost/멀티테넌트 격리) 통과
- 운영 배포 121s, https://planq.kr/api/health 200 ✓

**다음 사이클 (N+73+):**
- **외부 공유 = 팀 + 개인 (1순위 — 사용자 강조)** — visibility L2 팀 공유 + share_token 외부 + 통합 ShareModal 4 자산 (Q task/file/info/calendar). 설계: project_share_system_unified.md, project_visibility_unified_arch.md, project_personal_vault.md
- Q Mail M2 인박스 read-only UI (3컬럼 + iframe sandbox)
- 외부 연동 Phase 2-4 — 개인 GCal/Gmail/Drive (owner_scope='user')
- Settings → "Google 로그인 연결/해제" UI (API 존재)
- Microsoft OAuth (Task B/D) — 한국 시장 후순위

---

## ✅ 완료: 사이클 N+70 — Q Mail M1 + Google OAuth 로그인 + Gmail OAuth 메일 연동 + OAuth Connection 표준 (2026-05-25, 8 commit, 운영 미배포)

**핵심 산출물:**

1. **Q_MAIL_SPEC.md v2 (943줄 / 15섹션 + 부록 2)** — 30년차 3 관점 (개발/업무효율/UI-UX) 통합 + 사용자 호소 6 기능 (라벨/할일추출/답변필요/FAQ마이닝/스팸/Uncertain) + 다른 페이지 통일 매트릭스
2. **Q Mail M1 — DB + IMAP 풀세트**:
   - 6 신규 모델 (EmailAccount/Thread/Message/Attachment/ThreadParticipant/Draft)
   - 4 확장 (clients.email_aliases/email_status, task_candidates.source_type+email_thread, kb_documents.faq_*)
   - EmailAccount CRUD 7 endpoint + AES-256-GCM 암호화 + IMAP /test
   - services/emailImapCron.js — 5분 cron + imap-simple + mailparser + thread/client 자동 매칭 + 첨부 File 저장 + socket emit
   - 첫 sync UIDNEXT init (옛 16,862통 hang 차단)
3. **EmailAccountSettings.tsx** — 워크스페이스 admin 이 메일 계정 직접 등록 UI (preset Gmail/Outlook/Naver/Daum/iCloud/Custom + 연결 테스트 + 비밀번호 hash 응답 차단)
4. **Google OAuth PlanQ 로그인 (Task A)**:
   - services/google_oauth_login.js + routes/auth_oauth.js
   - refresh_token cookie 패턴 (옛 /login 정합) — CSP 정합 (inline script X)
   - 신규 가입 시 자동 Business + Cue + 14일 trial (좌측 메뉴 채워짐)
   - browser Accept-Language 우선 (Google profile.locale 보다 정확)
5. **Gmail OAuth 메일 연동 (Task C)**:
   - 같은 GOOGLE_CLIENT_ID/SECRET 공유 (GDrive + Calendar + Login + Mail 4 통합)
   - XOAUTH2 SASL (RFC 7628) + access_token 자동 refresh
   - EmailAccount.auth_type ENUM ('password'/'google_oauth'/'microsoft_oauth')
   - EmailAccountSettings UI "Gmail 로 연결" Google 4색 로고 버튼
6. **OAuth Connection 표준 흐름 (Task 62)**:
   - oauth_connections 신규 테이블 (UNIQUE provider+subject + UNIQUE user_id+provider)
   - 3 분기: [1] subject 매칭 즉시 로그인 / [2] email 매칭 → /oauth/connect-confirm 명시 동의 / [3] 신규 가입 + auto OauthConnection
   - frontend OauthConnectConfirmPage — 기존 PlanQ ↔ Google 양쪽 카드 비교 + 1클릭 연결
   - Settings API (GET list / POST initiate / DELETE 해제 + OAuth-only lockout 방지)
7. **계정 합치기**: id=3 (Irene 옛, irenecompany.com) + secondary_email='irene@irenewp.com' → Google 로그인 시 옛 워크스페이스 합쳐짐
8. **DailyStartModal fix** — 업무 진행 링크 `/projects/${pid}?task=` (오작동) → `/tasks?task=` 통일

**검증:**
- 0단계 28/28 ✓ + 1단계 빌드 1.07s exit 0
- 3+5단계 9/9 API smoke ✓
- 4단계 16 routes 200 OK
- Irene 본인 Google OAuth 로그인 + 계정 합치기 e2e 성공

**다음 사이클 (N+71+):**
- Q Mail M2 인박스 read-only UI (MailPage 3컬럼 + MailThreadList + MailThreadDetail iframe sandbox)
- Settings → "Google 로그인 연결/해제" UI (API 는 이미 있음)
- Microsoft OAuth (B/D) — 한국 시장 후순위

---

## ✅ 완료: 사이클 N+49 hotfix 시리즈 — UI 정돈 + Focus 위젯 회귀 fix (2026-05-22, 6 commit 운영 라이브)

### 사용자 호소 → fix 매트릭스

| 호소 | 진단 | commit | 운영 push |
|------|------|--------|----------|
| ProfilePage 첫 열 빈 공간 | grid Container 안 `<div ref={errorBannerRef} />` + banner 가 첫 cell 점유 | `7c18596` | 19:45:47 |
| FocusBar 헤더 들러붙음 | margin top 0 | `e866c1a` | 19:54:57 |
| FocusBar 좌우 짧음 | Bar margin 20px vs Section padding 14px | `e866c1a` | 19:54:57 |
| 단계 이동 시 깜빡임 | TaskFocusBar useEffect deps 에 status 없음 → 30s polling 대기 → session=null 사이 return null → 사라짐 | `e866c1a` | 19:54:57 |
| MyWorkSettings 좌우 풀 아님 | Body max-width: 720px | `384d8a6` | 20:11:04 |
| FocusWidget 정지 버튼 색 혼란 | N+32 옵션 B 박제 위반 — TaskFocusBar 는 제거됐는데 FocusWidget 만 DangerBtn 잔존 | `3228313` | 20:18:58 |
| 에디터 빈 곳 클릭 시 커서 진입 X | TipTap EditorContent default 동작 | `2c1aeba` | 20:27:?? |
| 좌측 FocusWidget idle 상태 "시작" 버튼 무의미 | N+32 옵션 A 박제 위반 — task 없이 session 생성하는 PrimaryBtn 잔존 | 진행 중 | 예정 |

### 30년차 결정 박제

- **grid item 분포 audit 필수** — 빈 ref div 라도 grid cell 차지. wrapper 안 자식 element 전부 확인
- **TaskFocusBar status deps** — status prop 의존 컴포넌트는 useEffect deps 에 명시 (30s polling race 차단)
- **N+32 옵션 A/B 박제 정합** — Focus 자체 Start/Stop 버튼 없음. task status 가 trigger + 종료 책임
- **TipTap wrapper click → focus('end')** — Notion/Google Docs 표준 UX. ProseMirror DOM 안 클릭은 자동 처리, 그 외 wrapper 영역만 명시
- **자의적 기획 변경 금지** — sameTz 통합 같은 의도된 정책 임의 제거 X. revert 후 진짜 원인 추적

### FocusWidget 상태 매트릭스 (N+49 정합)

| 상태 | UI |
|------|-----|
| focus_enabled=false | 위젯 hide |
| session 없음 (idle) | 안내 + "내 업무로 가기" link (Start 버튼 X) |
| session.task=null (orphan) | "업무 미지정" + 안내 "다른 업무 시작 시 자동 전환" |
| active | 카운터 + Pause + ViewBtn |
| paused | 카운터 + Resume + ViewBtn |
| auto_paused (idle_detected) | 카운터 + idle prompt |

### 수정된 파일

- `dev-frontend/src/pages/Profile/ProfilePage.tsx` — banner/ref div Container 밖
- `dev-frontend/src/components/Focus/TaskFocusBar.tsx` — margin + status deps
- `dev-frontend/src/pages/Profile/MyWorkSettingsPage.tsx` — max-width 제거
- `dev-frontend/src/components/Focus/FocusWidget.tsx` — DangerBtn 제거, Start 버튼 → GotoLink, orphan 안내, useAuth import 정리
- `dev-frontend/src/components/Common/RichEditor.tsx` — wrapper onClick → focus('end')
- `dev-frontend/src/components/Docs/PostEditor.tsx` — 동일 패턴
- `dev-frontend/public/locales/ko/focus.json`, `en/focus.json` — gotoTasks/noTaskHint i18n 신규

### 사용자 호소

"내프로필 좌측 첫번째 공간이 비었다. 워프로랩 프로필 높이는 옆의 열과 같아야 함."

### 30년차 결정 박제

- grid 2열 + dense 배치만으로는 충분치 않음. 카드 height 명시 + align-items 명시 제거가 진짜 fix.
- 직전 N+39-3 의 dense 만 추가했던 게 미흡 (높이 불일치 회귀 잔존). 이번에 완성.

### 수정된 파일

- `dev-frontend/src/pages/Profile/ProfilePage.tsx` (26 +, 21 -)

### 운영 라이브

`b957955` → 운영 push (timestamp 20260522_193237, 108s)

---

## ✅ 완료: 사이클 N+39~N+48 (2026-05-22, v1.17.0 라이브 — 15 commit)

### 핵심 (9 사이클)

| 사이클 | 핵심 |
|--------|------|
| **N+39** | PWA useVisibilityRefresh 6 페이지 + 실시간 동기화 보강 (posts/files/kb/calendar/invoices/clients) + ProfilePage grid + i18n ko/en + /검증 10단계 Playwright MCP 정책 + displayName 전수 (5 commit) |
| **N+40** | Q Task 정기업무 audit — cron broadcast (CLAUDE.md 16번) + parent DELETE 자식 detach + TaskDetailDrawer 인스턴스 chip + i18n |
| **N+41** | Q docs Brief broadcastPost(post:new) 보강 — 자료정리 실시간 동기화 |
| **N+42** | Q Note 정리하기 4 액션 분기 모달 (QNoteSummaryModal) + summarized_at PATCH + prefill 라우팅 (Tasks/Knowledge/Docs/Share) |
| **N+43** | share_token 만료 (Post/Document/Invoice) — share_expires_at 컬럼 3 + 라우트 5 + ShareModal 4 옵션 (7/30/90/무기한) + 만료일 표시 |
| **N+44** | 만료 응답 통일 — 7 entity 410 + ExpiredShareLink 친절 페이지 + dead code 정리 (ShareModal 9→5 entity) |
| **N+45** | FocusWidget baseline ref 카운터 (tick 누적 버그 fix — Date.now() 단조 증가) + SidebarClock revert (자의적 기획 변경 원복) |
| **N+46** | SidebarClock userTzExplicit 정책 — user.timezone 명시 set 시만 두 줄, 안 했으면 "설정" subtle hint |
| **N+47** | Smart Routing 매트릭스 정합 — Post/Invoice auth-check + 자동 redirect 0.3s (6/6 entity 통일) |
| **N+48** | 운영 진입 readiness — 외부 API timeout 표준화 (OpenAI fetch 10 곳 AbortSignal.timeout) |

### 30년차 결정 박제

1. **실시간 동기화 강제 (CLAUDE.md 16번)** — cron 자동 생성 시점도 broadcast. generator 에 io 주입 패턴 정착
2. **FK ON DELETE 미명시 위험 fix** — application-layer detach (parent DELETE 시 자식 instance 의 recurrence_parent_id null)
3. **만료 응답 RFC 9110 준수** — 410 Gone + code='share_expired' + expired_at 메타. 7 entity 100% 통일
4. **share_helper.checkShareExpiry 단일 출처** — 라우트별 inline 검사 X
5. **client tick 누적 패턴 안티** — actual_seconds + tick → Date.now() baseline 으로 정확한 단조 증가
6. **자의적 기획 변경 금지** — sameTz 통합은 의도된 UX (다국 워크스페이스 vs 다국 거주). 사용자 명시 set 시만 두 줄
7. **외부 API timeout 표준화** — OpenAI chat 45s / embedding 30s / 짧은 응답 20s. hang 방어
8. **prefill URL pattern** — `?prefill=`, `?prefill_brief=`, `?prefill_title=` 네임스페이스 명확
9. **Smart Routing 매트릭스 정합** — 7/7 entity (Document skip = in-app 라우트 없음 정당화)
10. **revoke = share_token=null 통일** — 별도 share_revoked_at 컬럼 X (File 패턴 일관)

### 운영 진입 readiness audit 결과 (N+48)

| 항목 | 상태 |
|------|------|
| 외부 API timeout | ✅ N+48 완성 (10 곳) |
| fan-out 비동기 | ✅ 기존 박제 |
| pagination | ⚠️ 부분 (admin/docs/personal_vault) — 별도 사이클 |
| AuditLog 일관 | ⚠️ 11/41 라우트 — 별도 사이클 |
| pino + request_id | ✅ middleware/errorHandler.js |
| uploads cleanup | ✅ services/uploadCleanup.js + cron |

### 미완 (다음 사이클)

1. **pagination 전수 보강** — admin/docs/personal_vault 외 list 라우트 audit
2. **AuditLog CUD 라우트 audit** — 11/41 → 전수
3. **PWA Share Target audit** — manifest + ShareReceivePage 실 동작 검증
4. **Phase 9 통합 컨텍스트 + Q Mail** (9주, 큰 사이클)

---

## ✅ 완료: 사이클 N+32~N+38 (2026-05-22, v1.16.2 라이브 + 10 commit 미라이브)

### N+38 — 실시간 동기화 전수 fix + /검증 skill 박제 (10 commit 미라이브)

CLAUDE.md "운영 안정성 16번" 강력 박제 신설 + 7 영역 적용:

| commit | 영역 | 내용 |
|--------|------|------|
| `c3eb48d` | 박제 | CLAUDE.md 16번 박제 + session-state 다음 사이클 |
| `7346a1b` | release | package.json v1.16.2 |
| `fd5e648` | Q docs | posts.js broadcast 4 mutation + PostsPage socket listener |
| `944b290` | Q file + Calendar | files.js 4 + calendar.js 3 mutation + DocsTab/QCalendarPage listener |
| `0758c1d` | Q info + Q Bill | kb.js 4 + invoices.js 2 mutation + KnowledgePage/InvoicesTab listener |
| `e5762ef` | Q Project + Clients | projects.js conv notes/issues + clients.js 3 mutation + ClientsPage listener |
| `3ab989a` | 정리 | workspace 주간보고 수동 박제 + AutoToggle 제거 (banner 만) |
| `d9e636a` | cleanup | WeeklyReviewTab unused vars |
| `d3a01bd` | cleanup | WeeklyReviewTab 마지막 unused 2건 |
| `496c704` | /검증 skill | PlanQ 특수 5 항목 박제 (멀티테넌트/Socket/Q Note/Visibility권한/hydration) |

### N+32~N+37 (v1.16.2 라이브, commit `7d7accc`)

| 사이클 | 핵심 |
|--------|------|
| N+32 | Focus 옵션 A 통합 동기 + 옵션 B 단순화 + "내 업무 설정" 메뉴 분리 |
| N+33 | Q Talk 채팅 진입 마지막 메시지 회귀 — 2.5초 force-stick 윈도우 |
| N+34 | Drawer 작성자 chip 항상 + description 라벨 동적 + tasks.js displayName helper |
| N+35 | MemoPopup→QNote window CustomEvent + 인박스 안전망 |
| N+36 | "반려"→"건너뛰기" + 옵션 D 후보 만료 (30일 hide / 90일 delete + 이전 후보 보기 토글) |
| N+37 | 주간 진척 그래프 actual 미입력 시 estimated*progress 추정 |

### 30년차 박제 결정

1. **Focus 옵션 A 통합 동기** — task status `in_progress` 진입 = Focus auto start. 이탈 = auto stop. paused 는 micro state.
2. **사용자 멘탈모델 mismatch** — "요청 vs 자기 업무" 구분이 entity 에 없음 → UI 라벨 동적 명확화.
3. **실시간 동기화 강력 박제** (CLAUDE.md 16번) — 4 요소 강제 (socket join / broadcast / listener / visibility refresh).
4. **/검증 PlanQ 특수 5 항목** — 멀티테넌트 / Socket.IO / Q Note 별도 service / Visibility 4단계+권한 4-Layer / Vite hydration.

### 미완 (다음 사이클)

1. **운영 push** — 10 commit 미라이브 (다음 세션 `/배포`)
2. **PWA useVisibilityRefresh 안전망** — N+38 추가 7 페이지에 hook
3. **실시간 동기화 보강** — posts 11 / files move·visibility / kb pinned / QProjectDetailPage / DashboardPage
4. **ProfilePage grid 정리** — 1938 라인 큰 작업
5. **i18n ko/en 키 정합** — 신규 키 다수
6. **Playwright MCP e2e** — /검증 10단계 통합 (--e2e 옵션). LLM auto-fix selector 한정만
7. **나머지 task GET 라우트 displayName** — my-week / my-month / my-year / backlog
8. **다른 라우트 displayName 전수** — dashboard / stats / calendar / docs / records

### 수정된 파일 (19)

**Backend (7)**: routes/posts.js, files.js, calendar.js, kb.js, invoices.js, clients.js, projects.js
**Frontend (8)**: PostsPage, DocsTab, QCalendarPage, KnowledgePage, InvoicesTab, ClientsPage, WeeklyReviewTab
**박제**: CLAUDE.md, .claude/commands/검증.md, .claude/session-state.md, DEVELOPMENT_PLAN.md
**버전**: dev-backend/package.json, dev-frontend/package.json (1.16.1 → 1.16.2)

---

## ✅ 완료: 사이클 N+31 모바일 viewport 회귀 fix (2026-05-20, v1.16.1)

### 회귀 증상
모바일 PWA 에서 Q Talk 진입 시 입력란이 화면 위로 붙거나 아래쪽에 큰 빈 공간 노출. 입력은 되지만 메시지 영역 확인/복사 불가.

### Root cause
**N+29 (`58a8eac`)** 가 `LayoutContainer` / `#root` 를 `min-height:100vh` → `height:100%` 로 변경 (toolbar hide/show 흔들림 fix 목적). 그 결과 body(정적 layout viewport, `position:fixed`) 와 Q Talk Layout(동적 `var(--vvh)`) 사이에 viewport 단위 불일치. 두 viewport 차이만큼 빈 공간 노출 + InputBar 위치 어긋남.

추가로 `--vvh` sync 가 ChatPanel useEffect 안에만 있어서 첫 paint fallback `100dvh` → 다음 frame vvh 적용 시 갑작스런 축소 race + cleanup 의 `removeProperty('--vvh')` 가 다른 페이지 vvh 까지 깨뜨림.

### Fix
| 파일 | 변경 |
|------|------|
| `dev-frontend/src/index.css` | 모바일 `#root` height: `100%` → `var(--vvh, 100dvh)` |
| `dev-frontend/src/components/Layout/MainLayout.tsx` | `LayoutContainer` height: `100%` → `var(--vvh, 100dvh)` |
| `dev-frontend/src/main.tsx` | vvh sync 글로벌화 — `visualViewport.resize/scroll` + `orientationchange` + `focusin/focusout` 트리거 |
| `dev-frontend/src/pages/QTalk/ChatPanel.tsx` | 중복 vvh sync useEffect 제거 |

### Trade-off
iOS Safari **브라우저** (PWA 아닌) 의 toolbar hide/show 시 vvh 변동으로 페이지 살짝 흔들릴 가능성. PWA standalone 에는 toolbar 없으므로 무관. **PWA 사용성 우선** — 입력란 안 보이면 앱 무용지물.

### 30년차 결정 박제
1. **viewport 단위 일관성 > toolbar 흔들림** — 자식 (Layout) 이 `var(--vvh)` 라면 부모 (LayoutContainer/#root) 도 같은 단위. 한 chain 안에 정적 100% 와 동적 vvh 섞이면 차이만큼 빈 공간 회귀.
2. **vvh sync 는 글로벌** — 페이지별 useEffect 에 묶지 말 것. 마운트 race + cleanup 부수효과로 다른 페이지까지 깨짐.

### 운영 배포 (이번 세션)
- `8947504` v1.16.1 (N+31 mobile viewport fix) — 103초

---

---

## ✅ 완료: 사이클 N+30 모바일 UI 개선 (2026-05-20)

### 완료된 작업

| 작업 | 설명 | 상태 |
|------|------|:----:|
| Q docs 템플릿 모달 | 모바일에서 헤더에 가려지던 문제 수정 — Q Calendar 스타일 적용 (`top: 70px; bottom: 20px; left/right: 16px`) | ✅ |
| Q docs [+] 드롭다운 | 화면 밖으로 나가던 문제 수정 — `position: fixed; top: 68px; right: 16px;` | ✅ |
| Q docs 문서 상세 모바일 | 사이드바 숨김 + 뒤로가기 버튼 추가 (제목 앞 인라인) + 헤더+본문 함께 스크롤 | ✅ |
| Profile 이메일 영역 | 버튼 wrap 처리 (`flex-wrap: wrap`) — 화면 밖으로 나가던 문제 수정 | ✅ |
| Profile 언어레벨 표 | 가로 스크롤 wrapper 추가 (`overflow-x: auto`) — "말하기" 컬럼 잘림 수정 | ✅ |

### 수정된 파일

- `dev-frontend/src/components/Docs/PostsPage.tsx` — 템플릿 모달, 드롭다운, 사이드바 숨김, 뒤로가기 버튼, 스크롤 동작
- `dev-frontend/src/pages/Profile/ProfilePage.tsx` — EmailRow flex-wrap, LevelTableWrap horizontal scroll

### 30년차 결정 박제

1. **Q Calendar 모달 패턴 재사용** — 새 디자인 대신 기존 검증된 패턴 (`position: fixed; top: 70px; bottom: 20px;`)
2. **TitleRow wrapper** — PanelHeader가 모바일에서 column 레이아웃이라 뒤로가기+제목을 inline으로 감싸야 함
3. **Sidebar $hasDetail prop** — 문서 선택 시 사이드바 숨김, 뒤로가기로 복귀
4. **Content overflow 분리** — 모바일에서 헤더+본문 함께 스크롤 (Content `overflow-y: auto`, Body `overflow-y: visible`)

---

## ✅ 완료: 사이클 N+26~N+27 (2026-05-18, v1.16.0)

### 완료된 작업

| 사이클 | 작업 | 핵심 산출물 | 상태 |
|------|------|---|:----:|
| N+26 | 업무 흐름 (Focus) MVP | `focus_sessions` 테이블 + `users.focus_*` 5컬럼 + `/api/focus/*` 10 라우트 + `FocusWidget` 4-상태 사이드바 위젯 + `TaskFocusBar` drawer 본문 상단 + `FocusSettingsCard` /profile 섹션 + default OFF zero-overhead | ✅ |
| N+26 | DailyStartModal + 유휴 감지 | `useActivityTracker` hook (mouse/keyboard/touch 5s throttle) + 60s 무활동 시 prompt + auto_pause_min 초과 시 자동 일시정지 + 모달 (오늘 마감/확인요청/지연 3 카테고리) | ✅ |
| N+26 | 주간 보고 자동 확정 설정 | `businesses.weekly_finalize_dow/hour/enabled` 3컬럼 + `assertWorkspaceWeeklyTeam` helper + GET/PUT `/api/businesses/:id/weekly-finalize` + `weeklyReviewCron` 워크스페이스 설정 기반 + WorkManagementSettings 페이지 + WorkspaceFinalizeBanner | ✅ |
| N+26 | weekly_team 메뉴 권한 | `BusinessMemberPermission.menu_key` 'weekly_team' 추가 (default 'none' — 멤버끼리 자동 공유 X) + MemberPermissionMatrix UI 자동 노출 | ✅ |
| N+26 | Image Lightbox 통일 | `ImageLightbox` 갤러리 모드 (← → 화살표 + 키보드 + swipe + 인덱스) + `useImageLightbox` hook + 5 사이트 통합 (Chat 첨부·Task 첨부·Description·댓글·Signature) | ✅ |
| N+26 | 인박스 후보 권한 가드 | `collectCandidates` userRole 인자 — 미지정 후보 owner/admin 만. QTaskPage candidate 진입 못 찾을 때 안내 띠. context "담당자 지정 필요" 중복 제거 | ✅ |
| N+26 | "박제" → "확정" 라벨 | 사용자 노출 5건 (WeeklyReviewAutoSection/Tab/View + WeeklyTrendTab + qtask.json) — 자연스러운 한국어 | ✅ |
| N+27 | 인박스 task_candidate inline 모달 | `dashboard.js` 응답 +3 필드 (candidate_id, conversation_id, guessed_assignee) + `CandidateActionModal` — 카드 클릭 시 즉시 등록/반려 (이동 X) + 등록 후 새 task drawer 자동 오픈 | ✅ |
| N+27 | 채팅 자동 업무 추출 디바운스 | `taskExtractorScheduler` in-memory per-conv timer + 60초 무활동 또는 5+ burst → 추출 + 3+ 새 메시지 threshold + cron 1분 fallback + `candidates:created` socket | ✅ |
| N+27 | Cue 주고받음 (revision + 댓글) | A) revision_requested 라우트에서 task.assignee=Cue 시 revisionNote 자동 재실행. B) 댓글 추가 시 Cue 가 댓글 읽고 task.body 업데이트 + "반영했어요" 답글 댓글. `executeForTask(taskId, opts={revisionNote, commentNote})` feedbackBlock 주입 | ✅ |
| N+27 | Cue smart mode 명세 확인 | confidence = max(topFaqScore, topChunkScore). smart: ≥0.5 auto / <0.5 draft. UI/i18n 이미 명확 (코드 변경 없음) | ✅ |
| N+27 | Cue 답변 thumbs up/down | `messages.cue_rating` 3컬럼 + `POST /api/projects/messages/:id/cue-rating` + ChatPanel Cue 메시지 hover 시 👍/👎 (재클릭 = 취소) | ✅ |
| N+27 hotfix | 채팅방 진입 점프 회귀 | `activeConv.id` reset effect 를 `useEffect` → `useLayoutEffect` 로 변경 — paint phase 일치로 "위 → 맨 아래" 점프 제거 | ✅ |

### DB 변경

| 변경 | 내용 |
|------|------|
| `focus_sessions` 테이블 신규 | state ENUM(active/paused/stopped) · started/ended/pause_total/last_activity · auto_paused · end_reason. 인덱스 3종 (user_state · user_task · biz_date) |
| `users` +5 컬럼 | focus_enabled · focus_idle_min · focus_auto_pause_min · focus_daily_prompt · focus_prompt_last_dismissed_date |
| `businesses` +3 컬럼 | weekly_finalize_dow · weekly_finalize_hour · weekly_finalize_enabled |
| `messages` +3 컬럼 | cue_rating · cue_rating_at · cue_rating_by_user_id |
| `business_member_permissions.menu_key` | weekly_team 추가 (default 'none', READ_ONLY) |
| 마이그레이션 스크립트 | `dev-backend/migrations/n26-focus-sessions.js` + `n27-cue-feedback.js` |

### 30년차 결정 박제

1. **명명 — "포커스" 채택** — "근무 시작/종료" 부담 회피 + PlanQ Cue 컨셉 결 맞춤
2. **default OFF + zero overhead** — focus_enabled=false 시 컴포넌트 렌더 자체 없음
3. **"박제" → "확정"** — 사용자 노출 라벨 자연스러운 한국어로 통일
4. **사이드바 위젯 = 진짜 적극성** — 자주 뜨는 팝업은 학습되어 dismiss 됨. 위젯은 부담 0
5. **인박스 inline 액션** — 알림 → 즉시 액션 모달 (이동 X). 4 step → 1 step
6. **채팅 추출 디바운스** — 60s 무활동 또는 5+ burst. LLM 토큰 절약
7. **Cue 주고받음** — revision_note (공식) + 댓글 (대화형) 두 패턴 모두
8. **weekly_team 권한** — 멤버끼리 자동 공유 X. owner/admin 자동 + 명시 read 부여만
9. **useLayoutEffect phase 일관성** — reset effect 와 scroll effect 같은 paint phase 에서 처리

### 수정된 파일 (40+)

**Backend 신규 (5)**: `models/FocusSession.js`, `routes/focus.js`, `services/taskExtractorScheduler.js`, `migrations/n26-focus-sessions.js`, `migrations/n27-cue-feedback.js`

**Backend 수정**: `middleware/menu_permission.js`, `models/{Business,Message,User,index}.js`, `routes/{businesses,dashboard,projects,task_workflow,tasks,weekly_reviews}.js`, `server.js`, `services/{cue_task_executor,weeklyReviewCron}.js`

**Frontend 신규 (8)**: `components/Focus/{FocusWidget,TaskFocusBar,FocusSettingsCard,DailyStartModal,CandidateActionModal}.tsx`, `components/Settings/WorkManagementSettings.tsx`, `components/QTask/WorkspaceFinalizeBanner.tsx`, `hooks/useActivityTracker.ts`

**Frontend 수정**: `components/{Common/ImageLightbox,Dashboard/TodoList,Docs/PostsPage,Docs/SignatureProgressSection,Layout/MainLayout,Permissions/MemberPermissionMatrix}.tsx`, `components/QTask/{DescriptionAttachments,TaskAttachments,TaskDetailDrawer,WeeklyReviewAutoSection,WeeklyReviewTab,WeeklyReviewView}.tsx`, `pages/{Insights/tabs/WeeklyTrendTab,Profile/ProfilePage,QProject/ProjectPostsTab,QTalk/{ChatPanel,types},QTask/QTaskPage,Settings/WorkspaceSettingsPage,Todo/TodoPage}.tsx`, `services/{dashboard,permissions,qtalk}.ts`, `i18n.ts`

**i18n**: ko/en `focus.json` (신규) · `layout.json` · `qtalk.json` · `qtask.json` · `settings.json`

**문서**: `docs/WORK_FLOW_DESIGN.md` (신규, 30년차 UI/UX 디자인 시스템 포함)

### 운영 배포 (이번 세션 3건)
- `8f66cc9` (N+26 통합) → `19c1b5a` v1.16.0 (버전 업) → `ab113a6` (N+27) — 사실상 v1.16.0 한 번에 라이브
- `ae96c30` (채팅 점프 회귀 hotfix) — 113초

---

## ✅ 완료: 사이클 N+22~N+25 (2026-05-18, v1.14.0 → v1.15.0)

### 완료된 작업

| 사이클 | 작업 | 상태 |
|------|------|:----:|
| N+22 | 채팅 sender = BusinessMember.name (`services/displayName.js`) — 11지점 일관 적용, irene 워크스페이스 "김미정"→"아이린"/"IRENE" | ✅ |
| N+22 | 좌측 메뉴 워크스페이스명 즉시 반영 (Settings/Profile `refreshUser()`) | ✅ |
| N+22 | 프로필 2열 grid + 사용처 hint 박제 (nicknameUsage / nicknameEnUsage ko/en) | ✅ |
| N+22 | Q Task drawer 닫힘 상태에서도 클릭 시 열림 + waiting status 드롭다운 3 파일 일관 | ✅ |
| N+22 | Q Task EdgeHandle 통일 (Q Talk/Q docs 표준 8×60→14×72 teal) | ✅ |
| N+22 | Q Task 6점 grip → 3점 ⋮ (`TaskRowActionMenu.tsx`) | ✅ |
| N+22 | Q Talk 별·⋮ center 정렬 + admin role 권한 가드 | ✅ |
| N+22 | 한글 파일명 mojibake 복구 (`services/filename.js`) — multer latin1 fix + RFC 5987 + 운영 17 row cleanup | ✅ |
| N+22 | 본문 인라인 이미지 L1→L3 (`/api/posts/editor-image`) + 운영 3 row promote | ✅ |
| N+22 | PostEditor 이미지 selectednode outline read-only 차단 (위/아래 녹색선 제거) | ✅ |
| N+22 | PWA dock badge race fix — SW visible client skip + client visibility reapply | ✅ |
| N+22 | q-note text 메모 5 컬럼 idempotent migration (운영 prod qnote.db) | ✅ |
| N+23 | SEO·SNS OG 동적 응답 (`middleware/ogMeta.js`) — share bot UA 17종 + 페이지별 OG | ✅ |
| N+23 | OG 썸네일 1200×630 자동 생성 (`scripts/generate-og-default.js`, puppeteer) | ✅ |
| N+23 | platform_settings 4 컬럼 + Admin "SEO·SNS 공유" 카드 | ✅ |
| N+23 | KB AI ingest parser — 단일 object 도 array 래핑 (짧은 자격증명 텍스트 회귀) | ✅ |
| N+23 | MemoFab Q Talk 노출 + 채팅 textarea lang=ko + autoCapitalize=off | ✅ |
| N+23 | HEIC/HEIF/TIFF/RAW 미리보기 fallback (`services/files.ts` isImage + onError) | ✅ |
| N+23 | Google Calendar 정기 회의 — rrule → events.insert recurrence 전달 (모든 회차 Meet 영구 유효) | ✅ |
| N+24 | 채팅 실시간 회복 가드 (visibility/focus/online tryRecover) | ✅ |
| N+24 | RightPanel "프로젝트 상세 보기" navigate onClick 추가 | ✅ |
| N+24 | CueHelpDrawer FAB_HIDDEN_PATHS 에서 /talk 제거 (Q Talk 도 헬프 FAB 노출) | ✅ |
| N+24 | Q Note 종료 후 [설정 보기] [요약 생성] [질문 보기] 3 버튼 onClick + 모달 | ✅ |
| N+24 | MemoFab allowed 가드에 admin role 추가 (N+21 가드 누락 회귀) | ✅ |
| N+24 | '지식' → '정보' 라벨 잔존 처리 (common.json + knowledge.json 4곳) | ✅ |
| N+25 | Q Note 공유 통합 모달 (`QNoteShareModal.tsx`) — visibility L1~L3 + L4 share_token 한 모달 | ✅ |
| N+25 | q-note `GET /api/sessions/public/by-token/:token` anonymous endpoint | ✅ |
| N+25 | `PublicQNoteSessionPage.tsx` + `/public/qnote-sessions/:token` 라우트 — read-only 미리보기 | ✅ |

### 운영 데이터 cleanup (1회)
- 한글 파일명 mojibake 17 row 복구 (File 11 + MessageAttachment 5 + TaskAttachment 1)
- 본문 인라인 이미지 3 row L1 → L3 promote (KIYUL AI 캐릭터 디자인 등)

### 30년차 콘텐츠 기획·시스템 분석가 박제 결정 사항

1. **표시명 단일 진실 원천** — 모든 사용자 노출 표시명은 BusinessMember.name 우선, User.name fallback. `services/displayName.js` 거치도록 강제. 11지점 일관 (conversations.js 5 + projects.js 4 + 응답 1 추가). 새 메시지 라우트도 같은 helper 통과.
2. **한글 파일명 안전** — multer latin1 → utf8 decode + Content-Disposition RFC 5987. `services/filename.js` 헬퍼 6 라우트 일관 (posts/files/task_attachments/message_attachments/kb).
3. **OG meta 페이지별** — SPA SEO 한계 극복. UA 봇 감지 → backend dynamic HTML. nginx UA map + share bot 만 backend proxy.
4. **PWA dock badge** — SW push와 client setAppBadge race 차단. visible client 시 SW skip → client 단일 진실. visibility/focus 시 latest total 재호출.
5. **Q Note 공유 통합 모달** — visibility 4단계 + share_token 한 모달. 다른 자산도 다음 사이클에 같은 패턴 통일 권장.
6. **Google recurring meeting** — PlanQ rrule 자체 expansion + Google 의 recurrence 양쪽 동기. Meet 링크는 single conference object 가 모든 회차에 유효.

### 수정된 파일 (33개)

**Backend 신규 (7)**: `middleware/ogMeta.js`, `services/displayName.js`, `services/filename.js`, `scripts/fix-filename-mojibake.js`, `scripts/promote-editor-images-l3.js`, `scripts/generate-og-default.js`, `q-note/routers/sessions.py` (public/by-token GET 추가)
**Backend 수정**: `routes/admin.js`, `routes/calendar.js`, `routes/conversations.js`, `routes/files.js`, `routes/kb.js`, `routes/message_attachments.js`, `routes/posts.js`, `routes/projects.js`, `routes/task_attachments.js`, `models/PlatformSetting.js`, `server.js`, `services/google_calendar.js`
**Frontend 신규 (3)**: `components/QNote/QNoteShareModal.tsx`, `pages/QNote/PublicQNoteSessionPage.tsx`, `public/og-default.png` (1200×630)
**Frontend 수정**: `components/Common/CueHelpDrawer.tsx`, `components/Docs/PostEditor.tsx`, `components/QNote/MemoFab.tsx`, `components/QTask/TaskDetailDrawer.tsx`, `components/QTask/TaskRowActionMenu.tsx`, `hooks/useGlobalBadge.ts`, `pages/Admin/AdminPlatformSettingsPage.tsx`, `pages/Profile/ProfilePage.tsx`, `pages/QNote/QNotePage.tsx`, `pages/QProject/ProjectTaskList.tsx`, `pages/QTalk/ChatPanel.tsx`, `pages/QTalk/LeftPanel.tsx`, `pages/QTalk/QTalkPage.tsx`, `pages/QTalk/RightPanel.tsx`, `pages/QTask/QTaskPage.tsx`, `pages/Settings/WorkspaceSettingsPage.tsx`, `services/files.ts`, `services/qnote.ts`, `index.html`, App.tsx
**i18n**: ko/en `profile.json` · `qtask.json`, ko `common.json` · `knowledge.json`
**Q-note**: `services/database.py` (5 컬럼 idempotent migration)

### 운영 배포 (이번 세션 4건)
- `bfb5835` v1.14.0 (N+22 패키지) — 103초
- `e8dbbf6` (SEO·OG N+23) — 99초  
- `04a19d8` / `6d4bab8` / `7b7d139` (N+23 hotfix 3건)
- `6135fb8` (N+24 채팅 실시간 + 우측 패널 + FAB) — 100초
- `dafb78a` (N+24 Q Note 종료후) — 104초
- `64ace71` v1.15.0 (N+25 Q Note 공유) — 107초

### 운영 nginx 적용 (사용자 직접 1회)
- share bot UA map + planq.kr location / 안 conditional proxy (운영서버 sudo 필요로 사용자 SSH 직접 적용)
- `/tmp/planq-share-bot.conf` 운영에 배포됨

### 남은 작업 (다음 세션)

- **B**: 개인 보관함 = 프로젝트 페이지처럼 등록·수정·관리 풀세트 (큰 UX 변경)
- **C**: Image Lightbox 통일 — 채팅·문서·곳곳에서 이미지 클릭 시 원본+닫기 동일 컴포넌트
- **D**: 입력란 외 클릭 영역 확장 — 첫 줄 외 영역 클릭 시 자동 커서 진입
- **E**: 메모/음성노트/다른 자산 공유 시 권한 설정 같은 컴포넌트로 (QNoteShareModal 패턴 ShareModal 통합)
- **F**: 운영 nginx OG share bot proxy 적용 (사용자 SSH 직접 1회 명령 실행 필요)
- **F1**: dev qnote PM2 등록 재정비 (현재 errored — irene uvicorn 수동 서빙)

---

## ✅ 완료: 사이클 N+18~N+21 — 주간보고·디자인 시스템·권한·청구·히스토리 (2026-05-17 ~ 18, v1.13.0)

### 완료된 작업

| 사이클 | 작업 | 핵심 산출물 | 상태 |
|------|------|---|:----:|
| N+18 | 워크스페이스 통합 주간보고서 | `business_weekly_reports` 테이블 신규, snapshot v1 스키마 (KPI delta·highlights·risks·blockers·issues·next_week·portfolio·heatmap·decisions), `WeeklyReviewWorkspaceView` 신규, cron 자동 박제 + 수동 박제, ProjectStage history. + Q Project 검색·필터 + 메모 분리 창 | ✅ |
| N+19 | 디자인 시스템 + 요청 정책 | `ActionButton` + `DrawerFooter` 공용 컴포넌트 (3톤 × 3사이즈), TaskDetailDrawer Action* alias 마이그레이션, WeeklyReviewModal 마이그레이션, 요청 탭 estimated_hours/recurrence_rule UI 숨김 + 백엔드 sanitize (책임선 분리), DetailDrawer z-index 60 | ✅ |
| N+19 hotfix | GDrive reconnect 옛 폴더 재사용 | `cloud.js` callback 에서 createRootFolder 전 Drive 같은 이름 폴더 search → 재사용 (drive.file scope 안전) | ✅ |
| N+20 | 사용량 시각화 + AI 학습 | `TaskEstimation.business_id` 컬럼 + backfill, `cue_actions_by_type` 응답, `/qnote/estimate` endpoint, `UsageWarningCard` Primary CTA (Danger red), `PlanSettings` Cue breakdown 막대, `PostAiModal` cue hint + 임박 확인 모달, `callAiEstimate` 워크스페이스 few-shot | ✅ |
| N+21 | 멤버 메뉴 권한 + admin role | `BusinessMember.role` admin ENUM, `business_member_permissions` 테이블 (UNIQUE biz+user+menu_key), `businesses.default_billing_owner_id`, `project_status_history` + `invoice_status_history`, `middleware/menu_permission.js`, 권한 라우트 5종, Invoice 8 mutation 라우트 `requireMenu('qbill','write')` 가드, AuditLog 5 영역 누락 채움, `MemberPermissionMatrix` + `DefaultBillingOwnerSection` | ✅ |
| N+21 hotfix | 메뉴 정렬 + qmail/qinfo + insights | MENU_LIST 사이드바 순서 1:1 정합 (11종), qmail·qinfo 추가, insights write 코어스 → read, role 라벨 "오너/관리자" 통일, 한글 white-space:nowrap, sticky 컬럼 min-width 160px | ✅ |
| N+21 hotfix2 | 설정 페이지 헤더 중복 + 외부 연동 이름 | StorageSettings 내부 `<SectionTitle>` 제거 + PermissionsSettings 내부 `<Title>` 제거 (외부 헤더만), "파일 저장소" → "파일·외부 연동" / "Storage & Integrations" (캘린더 포함 의도 반영), 자체 스토리지 "사용 안 함" 제거 (개인 보관함은 항상 자체) | ✅ |

### 30년차 콘텐츠 기획·시스템 분석가 박제 결정 사항

1. **권한 4-Layer 아키텍처**: Role (owner/admin/member/client) + 워크스페이스 토글 (financial/schedule/client_info × all/pm) + 멤버별 메뉴 권한 (9 메뉴 × 3 레벨, default write) + 자원 owner (Invoice.owner_user_id). PERMISSION_MATRIX.md 의 "열린 문화" 일관.
2. **개인 보관함 정책 재정의**: Drive 연동과 무관, 항상 자체 스토리지. 워크스페이스 공용 quota 안 합산. 개인별 quota 분리 X (단순화).
3. **워크스페이스 주간보고서 vs 개인 주간보고서**: 워크스페이스 × 주차 = 1 row (담당자 fan-out X). 개인본은 멤버 × 주차 = N row 그대로. 둘 독립.
4. **AI 워크스페이스 학습**: callAiEstimate 가 같은 워크스페이스 최근 12 사용자 추정 few-shot 사용. 같은 task 제목이어도 옷가게 vs 컨설팅 다르게 추정.
5. **상태 히스토리**: project/invoice 상태 전이 모두 자동 박제. AuditLog 와 별개 (전용 history 테이블).
6. **요청 탭 책임선**: 의뢰자는 명세만, 시간/반복 설정은 담당자 ack 후. UI/백엔드 양쪽 가드.

### 수정된 파일 (66개)

**백엔드 모델 (5 신규)**: `BusinessWeeklyReport.js`, `BusinessMemberPermission.js`, `ProjectStatusHistory.js`, `InvoiceStatusHistory.js`, `Business.js` (default_billing_owner_id 컬럼)
**백엔드 middleware**: `menu_permission.js` 신규
**백엔드 routes**: `businesses.js`, `cloud.js`, `files.js`, `invoices.js`, `plan.js`, `projects.js`, `task_estimations.js`, `tasks.js`, `weekly_reviews.js`
**백엔드 services**: `plan.js`, `templateApply.js`, `weeklyReviewCron.js`, `weeklyReviewSnapshot.js`
**프론트 신규 컴포넌트**: `Common/ActionButton.tsx`, `Common/DrawerFooter.tsx`, `Permissions/MemberPermissionMatrix.tsx`, `Permissions/DefaultBillingOwnerSection.tsx`, `QTask/WeeklyReviewWorkspaceView.tsx`, `QNote/MemoStandalonePage.tsx`, `QNote/NewNoteModal.tsx`
**프론트 services**: `permissions.ts` 신규, `plan.ts` · `weeklyReview.ts` 확장
**i18n**: ko/en common · layout · plan · qdocs · qnote · qproject · qtask · settings (총 약 100 키 추가)

---

**v1.12.0 운영 라이브 (commit `3c1a98b`, 99s 배포)**

### Q Note 메모 통합 (RichEditor + popup + 페이지 detail panel)
- MemoPopup 신규 — TipTap RichEditor lazy / 드래그/리사이즈 8방향 / 최근 메모 자동 이어쓰기 / 검색바 드롭다운 / 별도창 (Chrome Document PiP + window.open fallback)
- MemoFab 신규 — 우하단 FAB + ⌘+Shift+M / Ctrl+Shift+M 글로벌 단축키
- MemoView 신규 — Q Note 페이지 우측 풀모드 편집 panel
- NewSessionBtn dropdown (음성/메모 선택), text 메모 click → 우측 panel
- utils/qnoteBody — body JSON ↔ legacy plain text 호환 helper (검색·preview·제목 추출)
- DB: sessions input_type/translate_enabled/linked_voice_session_id/summarized_at/body 5컬럼
- API: POST/PUT text 메모 + GET /me/recent-memos + owner_only edit + chain follow 폐지

### 로딩 속도 — Entry 75% 감소
- vite-plugin-compression — 빌드 시 .gz 미리 생성 (level 9)
- nginx gzip_static on (dev. 운영은 sudo 수동 적용 필요)
- vendor-highlight 청크 분리 (lowlight 318KB → lazy)
- App.tsx 9 overlay 컴포넌트 lazy
- Google Fonts weight 19개 → 12개
- 실 전송 716KB → 181KB

### 채팅 모바일 4 회귀 fix
- ChatPanel `<form>` 제거 → iOS InputAccessoryView (위/아래 화살표) 차단
- visualViewport → CSS var(--vvh) JS sync (키보드 정확 위치)
- send 후 scrollToBottom 안정화
- Container/Layout height 3중 fallback

### 로그아웃 회귀 fix
- refresh route chain follow 폐지 — stale row audit log + 401, active row 보존
- rotation grace 5min → 15min (bfcache/idle/race 흡수)
- CORS allowedHeaders X-Client-Kind/X-Internal-Api-Key
- cookie sameSite strict → lax (iOS Safari ITP 호환)
- 진단 로그 (no_cookie/jwt_invalid/no_row/stale_reuse)

---

## ✅ 완료: 사이클 N+16 — 코드블록·드래프트·Drive fix·알림·메시지액션·핀공지·이미지fix (2026-05-15)

### 5개 사이클 통합 (v1.10.0 → v1.11.0)

**N+16-A 코드 블록 + 드래프트 자동저장:**
- `@tiptap/extension-code-block-lowlight` + `lowlight` common 30+ 언어팩
- 신규 `CodeBlockNodeView` — 회색 박스 + atom-one-dark syntax + 언어 selector (button+popover) + 복사 버튼
- 신규 `useLocalDraft` hook — localStorage debounce 500ms, 7일 TTL
- `ProjectPostsTab` 드래프트 자동 복원 + 주황 배너

**N+16-B GDrive/Calendar 연동 보강:**
- `buildCallbackHtml` 헬퍼 통합. postMessage 즉시 + 800ms auto-close + 1.5s fallback 안내 (Chrome COOP 차단 회피)
- `gcal` scope 에 `openid email` 추가 + `id_token` JWT email claim 파싱 → "(확인 불가)" 회귀 fix

**N+16-C 알림 매트릭스 전수조사:**
- `notification_prefs.event_kind` ENUM 에 `comment_mention` 추가 (DB ALTER)
- `message` event UI 노출 (옛 매트릭스 누락 → 이메일 OFF 적용 안 되던 회귀)
- `mention` 분리: 채팅 @멘션 vs 댓글 멘션. `routes/tasks.js` 댓글 dispatch → `comment_mention`
- `NotificationToaster` prefs matrix fetch + chat channel 검사 (옛 주석만 있고 실 코드 누락)
- `useUnreadTotal` debounce 200→50ms + 옵티미스틱

**N+16-D 채팅 아바타 클릭:**
- 아바타 클릭 → `UserInfoPopover` (이름 클릭과 동일). Cue 제외

**N+16-E 메시지 액션 + 핀 공지 + GDrive 이미지 fix:**
- DB: `messages.pinned_at + pinned_by_user_id` + 인덱스
- routes: PUT/DELETE message + POST/DELETE pin + GET pinned (5 라우트)
- `ChatPanel` hover toolbar (복사/수정/핀/⋮) + 인라인 수정 + 묶음 선택 모드 + `PinnedBar`
- "(수정됨)" / "삭제된 메시지" placeholder / 핀 좌측 노란 띠 / 선택 좌측 teal 띠
- GDrive 이미지 회귀 fix: `/raw` 가 `storage_provider` 분기 → Drive API 서버 프록시 stream
- `services/gdrive.js` 신규 helper: `getFileMeta`, `getFileStream`

**N+16-F hotfix — 더보기 메뉴 portal:**
- ⋮ 메뉴가 `MessageList` overflow 안 absolute positioned → InputBar 뒤로 클립되던 회귀
- `createPortal` 로 `document.body` 직접 렌더 + `position: fixed` + 버튼 rect 기준 좌표
- 하단 공간 부족 시 위로 auto flip / viewport 경계 보호 / z-index 2400 / 페이드 애니메이션
- Esc 닫기 + anchor 기반 외부 클릭 닫기

### 변경 통계

- N+16: 27 files, 1,790 insertions, 77 deletions (commit `36362fc`)
- N+16-F hotfix: 1 file, 70 insertions, 36 deletions (commit `efb890f`)

### 운영 적용

- v1.11.0 정식: 2026-05-15 08:09 (commit `36362fc`)
- N+16-F hotfix: 2026-05-15 08:25 — frontend rsync + nginx reload (commit `efb890f`)
- 백업: `/opt/planq/backups/20260515_080732`

### 검증

- 헬스체크 28/28 PASS
- API 15/15 PASS — send / edit / edit empty 400 / pin / 멱등 / list / pinned_at 필드 / unpin / delete / edit-deleted 400 / GET 제외 / 타인 edit 403 / not_found 404 / /raw redirect
- 빌드 923ms TS 0
- 페이지 5/5 200 (/talk /talk?conv=N /docs /tasks /settings)

### 박제

- 메모리 stale 정정: Q Task 정기업무 + Weekly Review 는 이미 구현 완료 — 다음 세션에서 메모리 plan 갱신 권장

---

## ✅ 완료: 헬스체크 multi-user PM2 지원 + 좀비 프로세스 정리 (2026-05-14)

### 배경

`/개발완료` 실행 시 헬스체크가 `PM2 planq-dev-backend online` 항목에서 false negative — `process not online` 으로 실패. 실제로는 백엔드는 정상 가동 중 (port 3003 응답 OK).

### 원인

`scripts/health-check.js` 의 `pm2Online()` 가 현재 user (irene) 의 `pm2 jlist` 만 검사. CLAUDE.md 협업 규칙대로 **planq-dev-backend / planq-qnote 는 lua 의 PM2 에 등록**되어 있음. 단일 user 검사만으로는 협업 환경에서 false negative.

### 수정

| 항목 | 변경 |
|---|---|
| `scripts/health-check.js:pm2Online()` | irene `pm2 jlist` + `sudo -n -u lua pm2 jlist` 두 source 합쳐서 검사 |
| 좀비 node 프로세스 (PID 557245, 565607) | 2h+ hang 상태의 옛 GDrive 테스트 스크립트 kill |

### 검증

- 헬스체크 재실행: **28/28 ALL PASSED**
- 좀비 프로세스 0건 확인

### 수정된 파일

- `scripts/health-check.js`

---

## ✅ 완료: 사이클 N+14 후속 — 알림 진입 시각 점프 fix + hotfix 4건 (2026-05-14)

운영 라이브 직후 사용자 보고 4건 hotfix:

1. **personal_vault 403** — `routes/personal_vault.js` 5 라우트의 권한 검사를 `isOwner||isMember` → `isMemberOrAbove(scope)` 헬퍼로 교체 (platform_admin 포함). irene 운영 user 가 platform_admin 이라 막힘.
2. **task_extractor invalid date 500** — LLM 의 `guessed_due_date` 가 'Invalid date'/'next week'/'곧' 같은 non-YYYY-MM-DD 값으로 INSERT 시 SequelizeDatabaseError. YYYY-MM-DD 형식 + 유효 Date 만 통과시키고 나머지 null.
3. **보관 conv 영구 삭제 FK 위반** — `routes/conversations.js` DELETE 라우트에 트랜잭션 + 명시 cascade (message_attachments → messages → conversation_participants → task_candidates → conv). FK DELETE_RULE='NO ACTION' 회피.
4. **알림 클릭 진입 시각 점프** — `pages/QTalk/QTalkPage.tsx` 의 Empty 컴포넌트 (`calc(100vh - 56px)`) vs Layout (`100dvh`) viewport 단위/높이 차이로 spinner 위치 점프. Layout wrapper 안의 CenteredHint + Spinner 로 통일.

### 모바일 push 발송 검증

운영 lua → irene conv 10 실 채팅 발송:
- iPhone web push (apple) sub 3개 + Mac Chrome (fcm) sub 1개 = 4 디바이스 모두 sent code=201

### 운영 적용

- (1)(2)(3) backend hotfix — 운영 backend 의 3 파일 직접 scp + pm2 restart (19:02, 19:10)
- (4) frontend hotfix — 운영 frontend rsync + nginx reload (19:52)
- 사이클 N+14 정식 배포 — commit `31ff578` (94s) + 버전 bump `8bb96ac` v1.9.0 (41s)

### 검증

- 9단계 검증: 27/28 헬스 / 빌드 872ms TS 0 / API 16/16 PASS / 페이지 9개 200 / UI/UX 8-A~8-G 통과
- 운영 dev = prod build hash 동기 (index-C2CMxPCp.js)

### 박제

- 메모리 갱신: `feedback_qnote_personal_tool.md` (Q Note 공유 정책 변경)
- 메모리 신규: `project_visibility_unified_arch.md` (4 자산 통합)

---

## ✅ 완료: 사이클 N+14 — Visibility 통합 + Q Note 공유 + Q info 프로젝트 스코프 (2026-05-14)

### 통합 아키텍처

| 자산 | visibility 컬럼 | 매핑 |
|---|---|---|
| Q file | `files.visibility` L1-L4 | 직접 |
| Q docs | `posts.visibility` internal/public | 헬퍼 변환 (다음 사이클 마이그) |
| Q info | `kb_documents.scope` private/workspace/project/client | 헬퍼 매핑 |
| Q note | `sessions.visibility` L1-L4 (신규) | 직접 |

**공통 컴포넌트:** `VisibilityBadge` / `VisibilityChangeModal` / `ShareModal` / `AttachmentField` / `DetailDrawer`. 4 자산 모두 같은 컴포넌트로 통일.

### Q Note 정책 변경 (메모리 박제 갱신)

기존 "공유 절대 안 함" → **기본 L1 + 사용자 명시 활성화 시 공유 가능**

- DB: `sessions` 에 6 컬럼 추가 (`visibility/project_id/share_token/shared_at/share_expires_at/shared_consent`) + 2 인덱스
- `_load_session_or_403` — owner / L1 / L2 (Node internal API project-membership 검증) / L3 (same business) / L4 (인증 동일 워크스페이스)
- 3 신규 endpoint — PUT visibility / POST share / DELETE share
- `status='recording'` 시 차단 강제

### Q info 프로젝트 스코프

- 신규 `pages/QProject/ProjectKnowledgeTab.tsx` (KnowledgePage 와 동일 UI/UX, AttachmentField/ShareModal/DetailDrawer 공통)
- 프로젝트 탭: `dashboard / tasks / clients / files / docs / **info(Q info)** / transactions / details(메타)`
- 옛 `info` (프로젝트 메타) → `details` 로 키 변경

### 개인 보관함 (Personal Vault) 5탭

`dashboard / posts / files / kb / **notes(Q note)**` — Single Source of Truth, Multiple Views

- `routes/personal_vault.js` 의 `/sessions` endpoint 신규 — Q Note `/api/sessions?scope=mine&visibility=L1` proxy
- "지식" → "정보" 라벨 통일

### Q Note ↔ Node Internal API

- Q Note 가 별도 SQLite 라 ProjectMember 직접 조회 불가
- Node 신규: `GET /api/internal/project-membership/:userId/:projectId`, `GET /api/internal/user-project-ids/:userId?business_id=N`
- 인증: `x-internal-api-key` 헤더
- **응답 파싱 함정**: Node `{success, data: {member}}` 구조. Python 측 `body.get('data').get('member')` 추출 필요 (직접 `body.get('member')` 면 None 반환되어 모든 L2 fail)

### 라벨 통일

- `qdocs.json sendToKnowledge*`, `knowledge.json cuePrefill` 의 "Q knowledge" → "Q info" (ko/en)

### 검증 13/13 PASS (실 API)

| 시나리오 | 결과 |
|---|---|
| KB scope=project 등록 + 필터 조회 | ✓ |
| PersonalVault /sessions endpoint | ✓ |
| Q Note visibility L1 → L3 | ✓ |
| recording 중 차단 (400) | ✓ |
| L2 project_id 검증 + 정상 경로 | ✓ |
| share_token 발급 + 폐기 | ✓ |
| Internal API project-membership / user-project-ids | ✓ |

### 변경 통계

- **DB**: q-note sessions 6 컬럼 + 2 인덱스 (dev 적용 완료)
- **Backend**: Q Note Python 1 파일 + Node 4 파일 (server.js / routes/internal.js 신규 / routes/personal_vault.js / services/visibility.js 신규)
- **Frontend**: 5 파일 변경 + 1 파일 신규 (ProjectKnowledgeTab.tsx)
- **메모리**: 1 갱신 (qnote_personal_tool 정책 변경) + 1 신규 (visibility_unified_arch)

### 박제

- 메모리 `feedback_qnote_personal_tool.md` — 정책 변경 (사이클 N+14)
- 메모리 `project_visibility_unified_arch.md` — 신규 (4 자산 통합 아키텍처)

---

## ✅ dev 완료: 사이클 N+13 (이전) — 알림 trigger fix + Daily.co → Google Meet (2026-05-14)
> **이전 라이브:** 2026-05-14 사이클 N+13 (v1.8.0) — 채팅·업무 알림 trigger fix + Daily.co → Google Meet (이미 운영 라이브)
>
> **dev 적용된 사이클 N+13:** 채팅·업무 알림 발송 trigger 누락 회귀 fix (routes/projects.js POST messages + routes/task_workflow.js 7 라우트 + push_service urgency/TTL + subscribe same-host 좀비 정리)
>
> **이전 라이브:** 2026-05-13 `c96d515`/`8867807`/`d6e696f`/`ccc5d02` (v1.7.3 N+12 후속) / `e7e8420`/`78e38a8`/`793a896` (v1.7.2 N+12) / 2026-05-12 `3e2b595`/`d746d6f`/`966144e` (v1.7.1 N+11) / `5807d2f`/`da62196`/`ec85423` (v1.7.0 N+10)
>
> **다음 진입 ★:** 사이클 N+13 운영 배포 (사용자 `/배포` 받으면 진행) — 채팅 push 가 단 한 번도 안 도달했던 회귀 근본 fix
>
> **차순위:** 운영 GDrive 연결 fix (irene 직접) / 청크 5 visibility 배지 / DocsTab share / 동적 OG / Q note 텍스트 / Custom SMTP / 설문 MVP
>
> **결제 정책:** 1순위 자체 결제 (계좌이체 mark-paid), 2순위 PortOne (P-7 마지막). 월결제 + 연결제. Free 플랜 폐지 — 신규 가입은 starter+trialing 14일.

---

## ✅ dev 완료: 사이클 N+13 — 알림 발송 trigger 누락 회귀 fix (2026-05-14)

사용자 호소: "모바일에서 알림이 제대로 안와. 잘 오다가 또 안와. 채팅오면 무조건 와야 해. 업무 확인요청 들어오는 것도 와야 하고. 앱이 꺼졌든 켜졌든 오는 거 아니야? 제발 안정적이게 해줘. 알림이 제대로 안되서 고객을 초대 못하고 있어."

진단 결과: **"잘 오다가 또 안와" 가 아니라 사실은 처음부터 발송이 누락된 상태.** 5/13 07:27 의 sent 는 lua 가 디바이스 알림 테스트로 직접 발송한 흔적. 실 채팅·업무 알림은 0건.

### 근본 원인 (3 영역)

| 영역 | 원인 | 증상 |
|---|---|---|
| **채팅** | `routes/projects.js:551` POST `/conversations/:id/messages` 에 notify 호출 0건. frontend `qtalk.ts:394 sendMessage` 가 이 라우트로 발송. `routes/conversations.js:401` 의 다른 메시지 라우트엔 notify 있지만 frontend 가 호출 안 함 = dead code | 채팅 push 가 단 한 번도 안 도달 |
| **업무 확인요청** | `routes/task_workflow.js` 7 라우트 모두 notify 호출 0건. status 를 직접 변경하므로 `routes/tasks.js` PUT 의 status 알림 분기 안 거침 | 확인요청·수정요청·완료 알림 0 |
| **PushSubscription 좀비** | iOS Safari endpoint 갱신 시 옛 sub 가 `expired_at NULL` 그대로 → fan-out → Apple silent drop | 운영 irene iPhone sub 3개 active. "한 번은 오고 한 번은 안 오는" 변동성 |

### fix 3 영역 + 인프라 강화

1. **`routes/projects.js`** POST `/conversations/:id/messages` 에 mention + message notifyMany 추가. `routes/conversations.js` 패턴 복사 (sender 자동 제외, internal 채널은 client 제외, mention 분리해 중복 방지).
2. **`routes/task_workflow.js`** 7 라우트 notify 추가:
   - `ack` → 요청자 ("담당자가 요청을 확인했습니다")
   - `submit-review` → reviewers ("업무 검토 요청")
   - `cancel-review` → reviewers ("검토 요청이 취소되었습니다")
   - `approve` → completed 면 요청자 ("요청한 업무 완료"), 아니면 담당자 ("컨펌자가 승인했습니다")
   - `revision` → 담당자 ("업무 수정 요청") + note 본문
   - `complete` → 요청자 ("업무 완료")
   - `reviewers POST` → 새 reviewer (라운드 중이면 "검토 요청", 아니면 "컨펌자로 추가")
   - 공통 헬퍼 `notifyTask` / `notifyTaskMany` / `buildTaskLink` / `workspaceName` 신설
3. **`routes/push.js`** POST `/subscribe` 에 `expireSameHostZombies(userId, newEndpoint, keepId)` 헬퍼 — 같은 user × 같은 push service host (`web.push.apple.com` / `fcm.googleapis.com` / ...) 의 옛 active sub 자동 만료. 한 host 당 active 1개. 다른 host 는 별개 (Mac Chrome + iPhone Safari 동시 OK). unique 제약 해소 위해 옛 row 의 endpoint 를 `'expired:<id>:<원본>'` prefix 변경.
4. **`services/push_service.js`** `webpush.sendNotification` 에 `TTL: 86400, urgency: 'high'` 옵션 — RFC 8030 immediate delivery. topic 의도적 비활성 (collapse 안 시키고 모든 메시지 도착).

### 검증 (실 API 5/5 PASS, node test 스크립트)

| 시나리오 | 검증 | 결과 |
|---|---|---|
| [1] 채팅 메시지 push trigger | login owner → POST messages → sleep 3s → PushLog row `김오너 · notify-test-...` | ✓ PASS |
| [2] submit-review reviewer push | reviewer 추가 + submit → PushLog `'업무 검토 요청'` | ✓ PASS |
| [3] revision 담당자 push | reviewer revision → PushLog `'업무 수정 요청'` | ✓ PASS |
| [4] approve completed 요청자 push | reviewer approve all → recalc completed → PushLog `'요청한 업무가 완료되었습니다'` | ✓ PASS |
| [5] same-host 좀비 sub 자동 정리 | owner 가 같은 host 의 새 endpoint 등록 → 옛 sub 1개 자동 expired | ✓ PASS |

(검증 가짜 endpoint 라 `'Public key is not valid for specified curve'` 로 failed — trigger 자체는 정상 호출됨이 입증. 운영에선 실 endpoint 라 sent code=201)

### 변경 파일 (백엔드만, DB 변경 없음)

| 파일 | 변경 |
|---|---|
| `routes/projects.js` | notifyMany 추가 (mention + message) — 60줄 |
| `routes/task_workflow.js` | 7 라우트 notify + 4 헬퍼 — 110줄 |
| `routes/push.js` | `expireSameHostZombies` + subscribe 두 분기 호출 — 30줄 |
| `services/push_service.js` | TTL + urgency 옵션 — 5줄 |
| `CLAUDE.md` | §13~§15 신규 회귀 패턴 박제 |
| `MEMORY.md` + 2 신규 메모리 | feedback_notify_trigger_required.md / feedback_push_same_host_zombie.md |

### 박제 (메모리 + CLAUDE.md)

- `feedback_notify_trigger_required.md` — 메시지/status 전이 라우트는 notify 호출 강제
- `feedback_push_same_host_zombie.md` — PushSubscription 같은 host 좀비 자동 만료
- CLAUDE.md §13 notify 호출 강제 / §14 좀비 자동 만료 / §15 urgency 'high' + TTL 1일

### 운영 배포 (사용자 `/배포` 명령 받으면)

1. version bump v1.7.3 → v1.8.0 (minor — 알림 정상화는 의미 있는 기능 회복)
2. commit + push
3. `dev/scripts/deploy-planq.sh` 실행
4. 운영 https://planq.kr 헬스체크 + 직접 채팅 메시지 1건 → 운영 PushLog 'sent' code=201 확인
5. (선택) 운영 좀비 sub 명시적 cleanup — 사용자 승인 후 한 번만

---

## ✅ 완료: 사이클 N+12 후속 — 알림 안정성·채팅 스크롤·SW 자가 update (2026-05-13)

운영 라이브 직후 사용자 보고 4건 + push backend desync 자동 복구 박제. 3 commit 운영 라이브 (102s + 93s + 38s = 233s).

### 청크별 상세

| Commit | 작업 | 핵심 |
|---|---|---|
| `e7e8420` | 채팅 푸시 복원 + 재진입 메시지 회복 + 입력란 초기 높이 + 사이드바 2-step | 4건 사용자 보고 (운영 v1.7.1 직후 회귀) |
| `78e38a8` | Q Task 격주 반복 + 권한 UX + 외부 발송 검증 + visibility refresh server fresh | lua 협업 — 사이클 N+12 메인 |
| `793a896` | push backend desync 자동 복구 — GET /api/push/me + backendHasMatchingSub | dev PushLog sent=0/skipped=12 회귀의 진짜 원인 차단 |
| `ccc5d02` | health-check PushLog 24h 실패율 항목 fix | child_process 분리 + dotenvx prefix 처리 |
| `d6e696f` | 알림 클릭 chunk 자동 복구 + 채팅방 진입 스크롤 즉시화 + badge 진단 | "Something went wrong" + "위에 갔다 옴" 회귀 fix |
| `8867807` | sw.js push/notificationclick 시점 self.registration.update() | PWA 자가 update — 사용자 재시작 불필요 |
| `c96d515` | v1.7.2 → 1.7.3 bump | 후속 fix 통합 운영 라이브 |

### 핵심 fix 7건

1. **푸시 매트릭스 'message' eventKind 노출** (e7e8420) — `routes/notifications.js` EVENT_KINDS 에 'message' 추가. badge 계산 1.5s AbortController timeout 으로 hang 차단.
2. **POST /subscribe 입력 검증 + 좀비 자동 재구독** (e7e8420) — p256dh ≥ 80, auth ≥ 8. frontend subscribe() 가 기존 sub invalid 시 자동 unsubscribe→재구독.
3. **재진입 메시지 회복** (e7e8420) — QTalkPage useVisibilityRefresh 가 직접 listConversationMessages 호출 + setMessages 교체. cache invalidate 만으로는 deps 반응 안 됨.
4. **push backend desync 자동 복구** (793a896) — backendHasMatchingSub() 헬퍼 + autoSubscribeIfPossible 의 'already_subscribed' early return 분기 검증. granted 인데 backend 에 row 없으면 자동 unsubscribe → 재구독. 네트워크 에러 시 보수적으로 matched=true (무한 루프 방지).
5. **ErrorBoundary chunk reload 강화** (d6e696f) — reset() 가 chunk error 였으면 location.reload() + SW update. 60초 자동 가드 reload 도 SW update 동반.
6. **ChatPanel 스크롤 즉시화** (d6e696f) — `requestAnimationFrame x 2` 지연 제거. useLayoutEffect commit 직후 즉시 scrollIntoView. 후속 1 RAF + ResizeObserver 가 비동기 콘텐츠 보정.
7. **sw.js 자가 update** (8867807) — push handler 와 notificationclick handler 시작 부분에 `await self.registration.update()`. 알림 도착·클릭 자체가 새 SW install→activate 트리거. PWA 자동 갱신.

### 박제 메모리 (이번 사이클)

CLAUDE.md §8·§9 + 4 시나리오 검증 + N+12 회귀 패턴 박제 (78e38a8 lua commit 포함):
- `feedback_external_dispatch_validation.md` — push/email/sms 형식 검증 + 5분 3회 platform_admin email
- `feedback_visibility_refresh_server_fresh.md` — list 자원은 server response 전체로 setState 교체
- `feedback_chat_notification_verification.md` — 채팅·알림 4 시나리오 (활성 외 conv / bg→fg / OS push / 다중 디바이스)

### 검증

- 빌드 0.93~1.05s, TS 에러 0
- 헬스체크 27/28 PASS (1 fail = pm2 권한 환경 차이, 실 서비스 online)
- API 8/8 PASS — 401 격리 / VAPID / rate-limit 5-per-min / p256dh 검증 / endpoint whitelist
- 실 채팅 검증: u=15 → conv 97 → irene (dev) sent code=201 ✅
- 운영 검증: lua → conv 10 → irene 3 디바이스 모두 sent code=201 ✅

### 운영 배포 (3회)

| 시각 (UTC) | Commit | 항목 | 결과 |
|---|---|---|---|
| 05:50 | `ccc5d02` | N+12 통합 + push desync 자동 복구 + health-check fix | ✅ 102s |
| 06:05 | `d6e696f` | 알림 chunk + 채팅 스크롤 + badge 진단 | ✅ 93s |
| 07:32 | `8867807` | sw.js 자가 update | ✅ 93s |
| 07:35 | `c96d515` | v1.7.3 bump | ✅ 38s (--skip-build) |

### 메모리 박제 (이번 세션 신규 추가 예정)

- `feedback_pwa_sw_self_update.md` — sw.js push/notificationclick 시점 self.registration.update() 패턴. 옛 SW + 새 빌드 desync 자동 회복

---

## ✅ 완료: 사이클 N+12 — Q Task 반복 설정 격주 버그 fix + 권한 UX 개선 (2026-05-13)

### 버그 수정

1. **격주 반복 저장 안 되는 버그 fix** — TaskDetailDrawer에서 `setRecurPreset(p)` 후 `setTimeout(saveRule, 0)` 호출 시 React state가 아직 업데이트 안 된 이전 값('weekly')으로 RRULE 빌드. 격주 선택해도 매주로 저장됨. `buildRecurRule`과 `saveRule`에 `overrides` 파라미터 추가해서 새 값을 직접 전달하도록 fix.

2. **반복 설정 RRULE 파싱 누락 fix** — 상세 진입 시 `setRecurEnabled(true)`만 호출하고 preset/endType/endCount/endUntil을 복원 안 함. `parseRRule()` 사용해서 전체 recurrence state 복원.

3. **반복 설정 권한 체크 UX 개선** — 담당자(작성자 아닌 경우)는 `recurrence_rule` 수정 권한이 없는데 UI에서 편집 가능하게 보이고 저장 시 403 에러 발생. `canEditRecurrence` 권한 체크 추가해서 권한 없으면:
   - 체크박스/select 모두 disabled
   - "읽기 전용" 힌트 표시
   - 전체 영역 흐린 스타일 (opacity 0.7, 회색 배경)

### 수정된 파일

- `dev-frontend/src/components/QTask/TaskDetailDrawer.tsx` — parseRRule import, recurrence state 복원, buildRecurRule overrides, canEditRecurrence 권한 체크, UI disabled 처리

---

## ✅ 완료: 사이클 N+11 — v1.7.1 우측 패널 + ErrorBoundary + 모바일 실시간 + prefetch + 청크 분할 (2026-05-12)

3 commit 운영 라이브 (218s, 1회 deploy). 사용자 보고 3건 + 인프라 개선 2건 모두 fix.

### 청크별 상세

| Commit | 작업 | 핵심 |
|---|---|---|
| `966144e` UX fix | Q Task 우측 패널 빈 공간 + ErrorBoundary 깜빡임 + Q Task 모바일 실시간 회복 | 3건 사용자 보고 |
| `d746d6f` perf | 라우트 prefetch + visibilitychange 일괄 적용 (Q Talk/Todo) | 모바일 페이지 이동 + 모든 socket 페이지 회복 |
| `3e2b595` build | vendor 청크 분리 + 빌드 OOM scripts 박제 | 인프라 안정화 |

### 핵심 fix 5건

1. **Q Task 우측 패널 상단 빈 공간 해소** — `2b64012` lua 모바일 fix 가 17+ 모달 일괄 적용하며 TaskDetailDrawer + QTaskPage 업무추가 패널까지 `top:0` → `top:60px` 로 휩쓸음. 데스크탑은 상단 GNB 없는데 60px 빈 공간 발생. 모바일도 GNB 56px 인데 60px 처리되어 4px 어긋남. fix: 데스크탑 `top:0`, 모바일 `top:56px` (`@media max-width:1024px`).

2. **ErrorBoundary "문제가 발생했습니다" 깜빡임 제거** — ChunkLoadError 자동 reload 시 `setTimeout(reload, 0)` 전에 React 가 fallback render 한 frame 그리던 회귀. `getDerivedStateFromError` 에 `silentReload` flag → render() 에서 `null` 반환해 fallback UI 안 그림. 60초 가드에 막혀 reload 못 할 때만 일반 에러 화면.

3. **useVisibilityRefresh 공통 훅 + 3 페이지 적용** — PWA background → foreground 복귀 시 socket 재연결 사이 missed events 보정 표준 패턴. 5초 minInterval 가드. QTaskPage / QTalkPage / TodoPage 에 적용. QTalkPage 는 socket 재연결 + 활성 conv messages cache invalidate + 대화 목록 merge refresh 3중 회복.

4. **라우트 청크 prefetch 인프라** — `lib/routePrefetch.ts` 신규. 17 핵심 path 매핑. 앱 mount idle 시 자주 가는 5개 (dashboard/talk/tasks/calendar/notes) 미리 다운로드. 전역 mouseover + focusin delegation 으로 모든 internal link hover 자동 prefetch. Vite module promise 캐시로 lazy() 와 동일 import 공유.

5. **vendor 청크 분리 + 빌드 OOM 박제** — `vite.config.ts` manualChunks 추가:
   - vendor-tiptap (416KB) — RichEditor 사용 페이지만
   - vendor-recharts (310KB) — Insights/WeeklyReview 만
   - vendor-react/router/select/socket/i18n/styled/date/tippy 분리
   - **index 청크 343 → 165 KB (52% 감소)**
   - `package.json` scripts.build 에 `NODE_OPTIONS=--max-old-space-size=4096` 박제 — `npm run build` 만으로 안정 빌드

### 신규 파일

| 위치 | 역할 |
|---|---|
| `hooks/useVisibilityRefresh.ts` | PWA background 복귀 시 refetch 표준 훅 |
| `lib/routePrefetch.ts` | 라우트 청크 prefetch — idle + hover delegation |

### 검증

- 빌드 3.73 ~ 4.07s, TS 에러 0
- 헬스체크 27/27 PASS
- 외부 https://planq.kr/api/health 200, planq-prod-backend v1.7.1

### 운영 배포

| 시각 (KST) | Commit | 항목 | 결과 |
|---|---|---|---|
| 18:05 | `3e2b595` | UX fix + prefetch + 청크 분할 통합 | ✅ 218s |
| 18:?? | (예정) | v1.7.0 → 1.7.1 버전 bump | --skip-build |

### 메모리 박제 (이번 사이클)

- `feedback_react_portal_bubble.md` (이전 사이클 — 그대로 유효)
- `feedback_express_route_order.md` (이전 사이클 — 그대로 유효)
- 새 메모리 없음 (인프라 개선 위주, 회귀 패턴 박제는 이전 사이클에서 끝남)

---

## ✅ 완료: 사이클 N+10 — v1.7.0 활성 conv unread + 다중 디바이스 세션 + 즐겨찾기 동기화 + 보관함 + 모바일 로그인 풀스크린 (2026-05-12)

3 commit 운영 라이브 (2회 deploy + 1회 버전 bump deploy, 181s + 49s + 47s). https://planq.kr health 200, planq-prod-backend v1.7.0. 사용자 보고 4건 (활성 채팅방 unread / 모바일 자동 로그아웃 / 즐겨찾기 동기화 / 모바일 로그인 페이지 스크롤) + 추가 4건 (보관함 의미 / ⋮ "00" / 보관함 진입점 / 삭제) 모두 fix + Q Task 행 캘린더 click drawer 열림 버그 fix.

### 청크별 상세

| Commit | 작업 | 핵심 |
|---|---|---|
| `5807d2f` 메인 | 활성 conv unread + 다중 디바이스 + 즐겨찾기 + 보관함 + 모바일 로그인 + 캘린더 fix | 9 변경 영역 (DB + 7 backend + 6 frontend + 4 i18n) |
| `da62196` hotfix | 보관함 라우트 순서 충돌 fix | `/:businessId/archived` 를 `/:businessId/:id` 앞으로 (Express 정의 순서 매칭 함정) |
| `ec85423` 버전 | 1.6.1 → 1.7.0 minor bump | package.json + DEVELOPMENT_PLAN + session-state |

### 데이터 변화

| 자원 | 변경 |
|---|---|
| `refresh_tokens.client_kind` | 신규 ENUM('pwa','web') NOT NULL DEFAULT 'web'. login/register/refresh 시 X-Client-Kind 헤더 또는 body 로 결정. 기존 row 는 'web' 그대로 (sliding renewal 시 자연스럽게 본인 platform 로 갱신) |
| `conversations.archivedBy` | 새 association (User belongsTo, as: 'archivedBy', foreignKey: 'archived_by_user_id') |

### 정책 변화 — refresh_token TTL

| client_kind | TTL | 갱신 | 동기 |
|---|:-:|:-:|---|
| pwa (PWA standalone) | 365일 | sliding (refresh 시마다 +365일) | 모바일 앱 = 푸시 수신 위해 사실상 무한 세션 |
| web (브라우저) | 30일 | sliding | 데스크탑 활동 기반 만료 (Slack/Notion 패턴) |
| remember=false | session cookie | — | 공용 PC 안전 |

### 신규 컴포넌트 / 라우트

| 위치 | 역할 |
|---|---|
| `pages/QTalk/ArchivedChatsModal.tsx` | 보관된 채팅 list + 복원 + 영구 삭제 (workspace admin only) |
| `LeftPanel.tsx` Footer | 좌측 풋터 "보관된 채팅" 진입점 (admin only) |
| `GET /api/conversations/:bizId/archived` | 보관 목록 |
| `POST /api/conversations/:bizId/:id/unarchive` | 복원 |
| `DELETE /api/conversations/:bizId/:id` | 영구 삭제 (archived_at NOT NULL 인 경우만) |
| `conversation:pin` socket event | 같은 user 의 모든 디바이스에 핀 변경 broadcast |
| `user:N` socket room | 다중 디바이스 동기화용 자동 join (server.js) |

### 핵심 fix — Express 라우트 순서 함정

`router.get('/:businessId/archived', ...)` 와 `router.get('/:businessId/:id', ...)` 는 둘 다 2-segment + param. Express 는 **정의 순서대로 매칭**하므로 `/:businessId/:id` 가 먼저 정의되면 `/api/conversations/3/archived` 를 `id="archived"` 로 받음 → conversation lookup 실패 → 404. **literal segment 라우트는 param 라우트보다 먼저 정의 강제**. 신규 라우트 추가 시 항상 체크.

### 핵심 fix — React Portal Synthetic Event Bubbling

`CalendarPicker` 가 `createPortal` 로 document.body 에 마운트되어도 **React synthetic event 는 virtual DOM tree 따라 bubble**. DayCell 클릭 → DateRangeCell → TRow.onClick → openDetail. Wrapper 에 `onClick={e => e.stopPropagation()}` + `onMouseDown` 추가로 일괄 차단. 다른 모든 사용처 (NewEventModal, ProjectTaskList, AdminBusinessesPage, NewProjectModal, SingleDateField, CandidateEditCard, TaskDetailDrawer 등) 동시 fix.

### 검증

- 헬스체크 27/27 PASS
- 빌드 1.6 ~ 2.4s, TS 에러 0
- 외부 https://planq.kr/api/health 200, planq-prod-backend v1.7.0

### 운영 배포 (3회)

| 시각 (KST) | Commit | 항목 | 결과 |
|---|---|---|---|
| 06:58 | `5807d2f` | 메인 (사이클 N+10) | ✅ 181s, refresh_tokens.client_kind ALTER + frontend rebuild |
| 08:54 | `da62196` | hotfix 보관함 라우트 순서 | ✅ 49s (--skip-build) |
| 09:08 | `ec85423` | 버전 1.7.0 bump | ✅ 47s (--skip-build) |

### 잔여 (다음 사이클)

- ⋮ 메뉴 "00" 정체 — i18n key 다 정상이지만 모바일 실측 필요 (PWA SW cache 가능성). 사용자가 새 v1.7.0 받으면 자연 해소 가능
- 청크 5 (visibility 배지 카드/행 적용 + 5중 시각 시그널) — lua 충돌 우려로 다음 사이클
- Q note 텍스트 type + Quick Capture
- Custom SMTP (Pro+)
- 설문 기능 MVP

---

## ✅ 완료: 모바일 반응형 QA — 모달 GNB 오버랩 + 로그아웃 버튼 + i18n + 모달 디자인 통일 (2026-05-12)

17+ 모달 파일 모바일 반응형 수정 + 모달 디자인 통일 (Q Calendar NewEventModal 패턴).

### 수정 내역

| 영역 | 변경 내용 |
|---|---|
| **모달 GNB 오버랩 fix (17+ 파일)** | 모든 모달에 `@media (max-width: 640px) { margin-top: 60px; height: calc(100vh - 60px); height: calc(100dvh - 60px); }` 추가 — GNB 60px 영역 확보 |
| **모바일 로그아웃 버튼** | `MainLayout.tsx` Sidebar 에 `height: 100dvh; height: -webkit-fill-available;` + SidebarFooter `padding-bottom: calc(12px + env(safe-area-inset-bottom))` |
| **PageShell 헤더 래핑** | `PageShell.tsx` Header/HeaderRight 에 `flex-wrap: wrap` — 모바일에서 버튼 잘림 방지 |
| **Q Info i18n** | `knowledge.json` (en/ko) `csvUpload`, `aiIngest` 키 추가 + KnowledgePage.tsx 한글 fallback 제거 |
| **모달 디자인 통일 (Q Calendar 패턴)** | KnowledgePage.tsx, NewInvoiceModal.tsx — 밝은 backdrop (rgba 0.08) + centered transform + 14px border-radius + 헤더 title + close 버튼 |
| **PostsPage.tsx** | 미사용 `EmptyList` styled component 제거 (TS6133 에러 fix) |

### 수정 파일 (39개)

```
MainLayout.tsx, PageShell.tsx, PanelHeader.tsx
KnowledgePage.tsx, KbAiIngestModal.tsx, KbCsvIngestModal.tsx
NewInvoiceModal.tsx, CheckoutModal.tsx
QCalendarPage.tsx, NewEventModal.tsx, CalendarPicker.tsx
QProjectPage.tsx, DocsTab.tsx, ProcessPartsTab.tsx
QTaskPage.tsx, TaskDetailDrawer.tsx, AiTaskCreateModal.tsx
TemplateSaveModal.tsx, TemplateSelectModal.tsx, WeeklyReviewModal.tsx
PostsPage.tsx, PostAiModal.tsx, PostSignatureModal.tsx, SlotFormModal.tsx
NewDocumentModal.tsx, StartMeetingModal.tsx
ChatSettingsModal.tsx, NewChatModal.tsx, NewProjectModal.tsx
GlobalSearchModal.tsx, PlanSettings.tsx, StorageSettings.tsx
AdminBusinessesPage.tsx
knowledge.json (en/ko), qcalendar.json (en/ko), qproject.json (en/ko)
```

### 검증

- 헬스체크 27/27 PASS
- 빌드 성공, TS 에러 0
- PM2 planq-dev-backend + planq-qnote online

---

## ✅ 완료: 사이클 N+9 — v1.6.0 / v1.6.1 권한 옵션 A + 개인 보관함 + 이미지 라이트박스 + 공유 미리보기 보강 (2026-05-11)

9 commit 운영 라이브 (2회 deploy, 110s × 2). https://planq.kr health 200, planq-prod-backend v1.6.1. VISIBILITY_VOCABULARY.md / PERSONAL_VAULT_DESIGN.md 사이클 첫 청크 4개 (DB → 페이지 → 라우트 → 배지) + 사용자 보고 fix 3개 (이미지 lightbox · editor-image File 통합 · 인박스 후보 link).

### 청크별 상세

| Commit | 작업 | 핵심 |
|---|---|---|
| `e04a71b` 청크 1 | DB visibility ENUM | files/posts(vlevel)/kb_documents/invoices.owner_user_id 컬럼 + 마이그레이션 백필 + access_scope 옵션 A 헬퍼 6종 + projectMemberIds |
| `8cc69e7` 청크 2 | 개인 보관함 | 사이드바 협업/개인 섹션 + `/personal-vault` 4 탭 + backend `/api/personal-vault/*` 4 라우트 + 첫 사용 explainer |
| `a41a6ea` 청크 3 | 라우트 옵션 A | files/posts/search listWhere → ByLevel 점진 교체. client 는 옛 헬퍼 보존 (project-client) |
| `59f6f25` 청크 4 | Visibility 배지 + 변경 모달 | VisibilityBadge (4 단계 아이콘+색) + VisibilityChangeModal + PUT `/api/files/.../visibility` + `/api/posts/.../visibility` |
| `d812068` | 이미지 lightbox + 사이즈 | ImageLightbox + LightboxWrapper (자식 img 위임, ProseMirror 편집 영역 제외) + Tiptap Image width attribute + BubbleMenu S/M/L + 공유 미리보기 첨부 다운로드 라우트 |
| `da8c80f` | editor-image File 통합 + OG | POST `/editor-image` business_id → File 등록 (Q file 메뉴 노출 + share-link) + PostEditor borderless + index.html generic OG |
| `eb8769a` | 헬스체크 fix | VisibilityChangeModal raw `<select>` → PlanQSelect |
| `d3e7f0a` | 인박스 후보 link fix | task_candidate link → `/tasks?scope=mine&tab=all&candidate=Y` + archive Conversation 제외 + Q task 우측 패널 자동 펼침 + CandCard 1.8s rose flash |

### 데이터 변화 (운영)

| 자원 | 변경 |
|---|---|
| `files.visibility` | 신규 ENUM('L1','L2','L3','L4'). 백필 5건 (L3=3, L2=2) |
| `posts.vlevel` | 신규 ENUM. 백필 3건 (L2=3) |
| `kb_documents.scope` | 'private' 추가 |
| `invoices.owner_user_id` | 컬럼 추가. 백필 0건 (이미 created_by 채워져 있었음) |

### 정책 변화 — 옵션 A 본격 적용

| visibility | owner | member 참여 | member 비참여 | client |
|---|:-:|:-:|:-:|:-:|
| L1 (개인) | 자기만 | 자기만 | 자기만 | 자기만 |
| L2 (팀) | ✅ | ✅ | ❌ | project-client only |
| L3 (워크스) | ✅ | ✅ | ✅ | ❌ |

### 신규 컴포넌트

| 위치 | 역할 |
|---|---|
| `components/Common/VisibilityBadge.tsx` | 4 단계 시각 배지 (L1 lock·gray, L2 users·teal, L3 building·blue, L4 globe·orange) |
| `components/Common/VisibilityChangeModal.tsx` | L1/L2/L3 picker + project 선택 (PlanQSelect) |
| `components/Common/ImageLightbox.tsx` | 풀스크린 portal + Esc/배경 닫기 + body scroll lock |
| `pages/PersonalVault/PersonalVaultPage.tsx` | 4 탭 (대시·문서·파일·지식) + 첫 사용 explainer |
| `routes/personal_vault.js` | `/summary`, `/files`, `/posts`, `/kb-documents` |
| `scripts/migrate-visibility-l-levels.js` | 백필 스크립트 |

### 검증

- 누적 E2E **19/19 PASS** + 청크별 60+ PASS (16+11+12+7+6+8 = 60)
- 헬스체크 27/27
- 빌드 1.5~2.3s 안팎, TS 에러 0
- 외부 https://planq.kr/api/health 200, planq-prod-backend v1.6.1

### 운영 배포

| 시각 (KST) | Commit | 항목 | 결과 |
|---|---|---|---|
| 03:00 | `eb8769a` (누적 7) | v1.6.0 사이클 N+9 라이브 | ✅ 110s, invoices.owner_user_id 사전 ALTER + 백필 (files 5 + posts 3) |
| 03:26 | `d3e7f0a` | v1.6.1 hotfix (인박스 후보 link) | ✅ 110s |

### 잔여 (다음 사이클)

- 청크 5: VisibilityBadge 카드/행 적용 (Q file, Q docs, Q info) + VisibilityChangeModal 진입점 + 5중 시그널 (헤더 sub-line, dismiss 박스, popup 자물쇠, FirstVisitTour)
- DocsTab 카드 hover share 아이콘 (사용자 요청 잔여)
- 동적 OG — backend SSR `/public/posts/:token` HTML 응답 + 운영 nginx `/public/*` proxy 변경 (sudo)
- lua 모바일 반응형 7 파일 — lua 마무리 대기

---

## ✅ 완료: 사이클 N+8 + N+8 hotfix — v1.5.4 / v1.5.5 (2026-05-11)

`c962c5f` + `2f379ee` 운영 라이브. 자세한 내역은 commit log 및 session-state 참조.
주요: refresh_token rolling renewal · LeftPanel Unread/별표 일관 · AI 라벨 분기 · 인박스 reviewer 회귀 · Q Talk 채팅방 ⋮ · 멤버 카운트 (AI 제외) · UsageWarningCard 초과 표시 · LimitReachedDialog 사용량 링크 · 공유 미리보기 정책·설문 설계 docs · 인박스 task_candidate (다음 사이클로 이동) 등.

---

## ✅ 완료: 사이클 N+6/N+7 — v1.5.3 진행률 sync + reviewer 분기 + 관련업무·description 첨부 + 시간 자동 누적 + 모바일 UX (2026-05-11)

`1031409 + 4aecdff` 운영 라이브 (108s). 외부 https://planq.kr health 200. 18 파일 (+1259/-98). E2E 17/17 PASS.

### 핵심 변경

| 영역 | 변경 내용 | 동기 |
|---|---|---|
| **refresh_token chain 격리 ★★** | reuse_detected 가 같은 user 의 모든 active row 일괄 revoke 하던 회귀 → chain (replaced_by_id 사슬) 만 revoke. grace 30s → 5min (모바일 PWA wake-up 흡수) | Irene 보고: 자꾸 자동 로그아웃됨. user 16 하루 3회 강제 로그아웃 발화. 다중 디바이스 정책 본질 위반 |
| **이번 주 내 업무 필터** | `QTaskPage.tsx:870` 담당자=나 분기에서 status 화이트리스트 제거 → 활성 status 모두 표시 (reviewing 포함) | "담당자가 컨펌 요청 보내도 본인 책임은 끝까지. 마감관리·시간계산 책임은 담당자" |
| **관련 업무 링크 풀세트 ★** | `task_links` 테이블 (양방향 단일 row, a < b 강제), GET/POST/DELETE links + GET search, RelatedTasksSection (description 섹션 안), 자기 자신·중복·cross-workspace 차단 | "다른 업무 연결하기 — 파일/문서 연결처럼 검색하고 하나씩 추가" |
| **description_attach 풀세트** | `TaskAttachment.context` ENUM 에 'description_attach' 추가, FilePicker 패턴 (uploads + 기존 파일·문서 link), 권한 = description 편집 권한 (작성자/owner/admin) | "업무 설명에도 댓글처럼 똑같이 파일첨부 아이콘 — 결과물용 첨부와 분리" |
| **reviewer 가드 ★★** | reviewer 0명이면 reviewing/revision_requested 단계 차단 (400 no_reviewers_assigned). 100% 자동 completed 도 reviewer ≥ 1 시 차단 (in_progress 유지) | "컨펌자 없으면 확인요청중 단계 자체가 없어야 일관" + "100% 도달해도 컨펌 필요한 task 는 명시 클릭으로만 reviewing" |
| **진행률 ↔ status 양방향 sync** | PATCH /time + PUT /by-business 모두 동일 로직 (단일 진실 원천). PUT 의 progress → status 자동 전환 분기 신규 추가 (이전 결함 fix). 100% → completed / completed → active 시 progress 90 자동 / completed 진입 시 progress < 100 이면 자동 100 | 사용자 지적: PUT 으로 progress 만 변경 시 status 안 따라옴. PATCH 양방향이지만 PUT 단방향 → 단일 진실 원천 위반 |
| **실제 시간 자동 누적 ★★** | `services/taskActualHours.js` + TaskStatusHistory afterCreate hook. in_progress 진입 ~ 이탈 라운드 합산 (다중 라운드 지원). Task.actual_source ENUM('auto','user') — 사용자 직접 입력 시 자동 누적 정지. 현재 in_progress 면 실시간 누적 표시 | "진행 시작·확인 요청·완료 시점에 자동 계산. AI 회색·사용자 검정 톤 분리" |
| **TaskDetailDrawer 시각 개편** | RelatedTasksSection (description 안) / DescriptionAttachments (FilePicker 패턴) / latest_estimation_source·actual_source 회색 분기 (`MetaNumInput $ai`) / InProgressDot (라벨 옆 라이브 dot, Apple Watch 패턴) / TimeAutoHint (시간 자동 안내 상시 노출) / ReviewReminderHint (100% reviewer 동적 노출) / MetaCell layout fix (진행률 cell·range slider vertical center) | "시간 자동 누적 안내 어디에 했어? 안 보여" / "진행률 % 안으로 가져와. 그래프 중앙정렬" |
| **FilePicker 모바일 bottom sheet** | 풀스크린 → 75vh bottom sheet (Slack/Apple 정석). slide-up 애니메이션 + safe-area 보정 | "채팅 파일업로드 창 너무 길게 커져서 제대로 볼 수 없음" |
| **QTalk LeftPanel 모바일** | PinBtn `@media (hover: none), (max-width: 1024px)` opacity 1 → unpinned 별표 항상 노출. Unread `margin-left: auto` 로 행 우측 끝 + 모바일 살짝 키움 | "모바일 채팅 리스트에 새 메시지 알림 안 나옴 + 즐겨찾기 별표 안 나옴" |
| **auto-ai-estimate FK 가드** | setImmediate AI 예측 전 task 존재 확인 → test cleanup 후 FK 위반 회귀 방지 | 검증 중 발견된 로그 노이즈 |
| **보안: .env 권한 640** | 600 → 640 (planq 그룹 read 허용). lua (PM, planq 그룹 멤버) PM2 환경변수 정상 로드. q-note/.env 도 664 → 640 강화 | lua 의 PM2 errored 보고 |

### 검증

- 헬스체크 27/27 PASS
- API E2E 17/17 PASS (cycle verification 통합)
  - 진행률 양방향 sync (PATCH+PUT 4 시나리오) + reviewer 분기 (3) + 관련업무 (4) + description_attach (2) + 자동 누적 (3) + 응답 표준 (1)
- 빌드 1.5s 안팎, TS 에러 0
- 운영 health 200, planq-prod-backend v1.5.3

### 박제 (메모리 + 문서)

- `feedback_no_options_just_fix.md` (신규) — 검증 중 발견된 에러 옵션 묻지 말고 직접 fix
- `project_multi_device_session.md` 업데이트 — chain 격리 + grace 5분 박제
- `feedback_no_mvp.md` 강화 — "MVP" 단어 자체 금지 (사용자 노출 표현)

### 운영 배포

| 시각 (KST) | Commit | 항목 | 결과 |
|---|---|---|---|
| 18:03 | `1031409 + 4aecdff` | 사이클 N+6/N+7 (v1.5.3) | ✅ 108s, 외부 health 200 |

### 잔존 (다음 사이클)

- lua 의 모바일 반응형 7 파일 미커밋 (PageShell, QCalendar, QProject + 그 i18n) — lua 마무리 대기
- Message 편집/삭제 라우트 신규 구현 (PERMISSION_MATRIX §5.9 박제만 됨)

---

## ✅ 완료: 사이클 N+5 — v1.5.2 권한 매트릭스 책임선 분리 (2026-05-10)

`8dc5251 + 06e327f` 운영 라이브 (109s). 외부 https://planq.kr health 200. 30년차 솔루션 기획 관점의 권한 매트릭스 정식 박제 + 6 변경 + 매트릭스 4 영역 신설.

### 핵심 변경

| 영역 | 변경 내용 | 동기 |
|---|---|---|
| **Task 본문 책임선 분리 ★★** | `description` 담당자 빠짐 (의뢰자 영역: 작성자/owner/admin), `body` owner 빠짐 (수행자 영역: 담당자/admin). 워크플로우 (revision_requested) 로만 owner 가 결과물 영향 줄 수 있게 | 사용자 보고: "관리자(owner)가 담당자 결과물 수정되는 게 말 안 됨" → 책임선 무너짐 30년차 진단 |
| **RichEditor 본문 링크** | `openOnClick: true` + `target=_blank` — editable/readOnly 무관 모든 사용처에서 본문 링크 클릭 시 새 탭 | "권한 있는 사용자도 링크 클릭 안 돼서 너무 불편" |
| **Task DELETE 안전핀** | 작성자는 댓글·이력·리뷰어 0건 신생 task 만 삭제 가능 (실수 정정용). 활동 있으면 owner/admin 만. 담당자·요청자는 X | 30년차 — 자산 손실 방지 |
| **Invoice 재무 mutation owner only** | `assertInvoiceMutationOwner` 헬퍼 신설. send / mark-paid / unmark-paid / mark-tax-invoice / delete(invoice·installment) 5 라우트에 적용. member 호출 시 403 `owner_only` | 재무 사고 예방. member 는 draft 만 |
| **Q Note 진짜 사적 공간 명문화** | q-note `_load_session_or_403` 이미 owner/admin 백도어 없음 — 매트릭스 §5.8 도 admin 차단으로 코드 현실에 일치 | 음성/회의 = 매우 개인적 |

### 프론트엔드 분기
- `TaskDetailDrawer.tsx` — `canEditMeta` 단일 → `canEditTitle / canEditDescription / canEditBody` 3분기
- 권한 없으면 RichEditor `readOnly` + 섹션 타이틀 옆 회색 "읽기 전용" 뱃지 (`#94A3B8 / #F1F5F9`)
- Title 클릭 편집 핸들러 / 편집 아이콘 권한 분기

### 박제 문서
- `docs/PERMISSION_MATRIX.md` — §5.7 Task 필드별 / §5.8 Q Note / §5.9 Message 모더레이션 / §5.10 Invoice 재무 신설. §12 이력 추가
- `CLAUDE.md` — 사이클 N+5 정책 4 인라인 노트 (Task 본문 분리 / Invoice owner only / Q Note 사적 / 책임선 8원칙)
- 신규 라우트 PR 체크리스트 6개 명시 (PERMISSION_MATRIX §4-E)

### 검증
- 헬스체크 27/27 PASS
- API 권한 테스트 18/18 PASS (owner 9 + member 9)
  - member(담당자) → description PUT → **403 forbidden_fields:description** ✓
  - owner(비담당자) → body PUT → **403 forbidden_fields:body** ✓
  - member → invoice send / delete → **403 owner_only** ✓

### i18n
- `detail.readOnly` / `detail.readOnlyHint` ko/en 추가

### 수정된 파일
- `dev-backend/routes/tasks.js` (FIELD_RULES 분리 + DELETE 활동 체크)
- `dev-backend/routes/invoices.js` (assertInvoiceMutationOwner 헬퍼 + 5 라우트 가드)
- `dev-frontend/src/components/QTask/TaskDetailDrawer.tsx` (3 분기 + ReadOnlyHint)
- `dev-frontend/src/components/Common/RichEditor.tsx` (Link openOnClick + target)
- `dev-frontend/public/locales/{ko,en}/qtask.json` (readOnly 키)
- `docs/PERMISSION_MATRIX.md` (§5.7~§5.10 + 이력)
- `CLAUDE.md` (4 인라인 노트)

---

## ✅ 완료: 사이클 N+4 — v1.5.0 + v1.5.1 운영 라이브 (2026-05-10)

2 commit 정식 deploy (`e1ee6e4` v1.5.0 105s + `5cd518e` v1.5.1 follow-up 113s). 외부 https://planq.kr health 200.

### 주요 작업

| 영역 | 작업 |
|---|---|
| **통합 공유 시스템 1~6차 ★★** | 1차 Q task / 2차 file·kb·calendar / 3차 4 UI 진입점 (TaskDetail·EventDrawer·DocsTab·Knowledge) / 4차 비번 보호 (bcrypt + X-Share-Password + ?p=) + 만료 옵션 / 5차 통합 이메일 (sendEntityShareEmail entity 별 라벨/CTA) / 6차 통합 채팅방 발송 + Q Talk 카드 풍부 렌더링 (4 신규 card_type, 톤별 색). services/share_helper.js + routes/share.js + SharePasswordPrompt 공통. Public preview 4종 (Smart Routing canAccess 자동 redirect) |
| **Weekly Review Phase 2 ★** | Insights `/stats/weekly` 탭 — KPI 4장 + 완료율 추세 차트 1개. workspace 두번째 탭 "전체 주간보고" (owner 멤버별 필터). "지난주 내 업무보고" 라벨. snapshot_data attributes 누락 fix + BusinessMember 컬럼명 fix (`business_days → weekly_work_days`, `efficiency_rate` 제거). buildSnapshot 필터 확장 (start_date·기간미정·이번주완료 포함 — week 탭과 동일) |
| **WeeklyReviewView 정리** | 박제 시점 그래프 가장 위 (LineChart 큰 1개, 실제 vs 예측 누적). 요약 KPI list 형식 (3 col x 2 row, label/value 좌우, 활용률 ⓘ 툴팁). 상태 한글 라벨 (status.observer). 삭제 버튼 + inline 확인 + list refresh. 모든 mutation 시각 피드백 (✓ 뱃지 / 에러 inline / 진행 라벨) |
| **Q Task UI** | ScopeBtn / FinalizeBtn 회색 톤. FinalizeBtn 위치 보기 토글 앞. 4 탭 (mine) + 2 탭 (workspace) URL ?tab= 동기화. setTab + closeDetail race condition fix (setTab 안에서 task 정리). 담당자 필터 "(나)" 표시 |
| **공통 컴포넌트 fix** | PlanQSelect menu maxHeight viewport-relative (`min(320px, calc(100vh - 80px))`) + menuPlacement 'auto' + maxMenuHeight 280 — 모든 드롭다운 가려짐 해결. SearchBox `box-sizing: border-box` 추가 (36px 정확) |
| **프로젝트 문서 메뉴 추가 시스템** | 카드 "메뉴 추가" 토글 → 상단 탭바에 동적 탭 (📄 제목). localStorage 영속 (`qproject_pinned_docs_${projectId}`) + CustomEvent 동기화. 메뉴 탭 본문: PostEditor read-only + 편집 버튼 (?tab=docs&editPost=N → pendingEditId 패턴으로 자동 진입). list 회귀 방지 |
| **Q docs 테이블 첨부 개선** | 첨부 칩 클릭 → 새 창 (`/files?file=N` / `/docs?post=N`). AttachChipLink (anchor + ↗). "첨부" → "파일/문서 첨부" 라벨. 모달 섹션 아이콘 (📎/📄) + 안내문. 새 문서 / AI 작성 후 자동 새 창 |
| **CRUD 누락 fix** | Q note 세션 list 휴지통 + confirm dialog + active reset (deleteSession). Invoice DELETE backend 신설 (draft/canceled 만, sent/paid 차단) + drawer 빨간 "삭제" 버튼. WeeklyReviewView 에 삭제 추가. ProcessParts 는 이미 존재 |
| **PWA / 작은 fix** | "새 창" 모호한 버튼 제거 (편집 1개만). 시간 표시 ISO → slice(0,10). 워크스페이스 mode = `user_id=all` (owner 만, user_name 응답 포함) |

### 신규 모델/테이블 (DB sync 자동)
- `tasks` 4 컬럼: share_token / shared_at / share_password_hash / share_expires_at
- `files` 동일 4 컬럼 + (`shared_at` 신규)
- `kb_documents` 동일 4 컬럼
- `calendar_events` 동일 4 컬럼
- backend: `services/share_helper.js`, `services/email_share`(emailService 안), `routes/share.js`

### 신규 컴포넌트/페이지
- `pages/Public/PublicTaskPage / PublicFilePage / PublicKbDocumentPage / PublicCalendarEventPage / SharePasswordPrompt`
- `components/Common/ShareModal` (탭 3종: 링크/이메일/채팅방)
- `components/QTask/WeeklyReviewTab + WeeklyReviewView + WeeklyReviewModal` (이전부터 존재, 이번 사이클 정리)
- `pages/Insights/tabs/WeeklyTrendTab`
- `pages/Admin/AdminPushLogsPage`

### 운영 배포 결과
| 시각 (KST) | Commit | 항목 | 결과 |
|---|---|---|---|
| 19:37 | `e1ee6e4` | 사이클 N+4 통합 공유 1~6차 + Phase 2 + Q Talk 카드 (v1.5.0) | ✅ 105s |
| 21:43 | `5cd518e` | UX 정리 + 프로젝트 문서 메뉴 + CRUD 보완 (v1.5.1) | ✅ 113s |

---

## ✅ 완료: 사이클 N+3 — v1.4.0 운영 라이브 (2026-05-10)

1 commit 1회 정식 deploy (`e16b125`). 외부 https://planq.kr health 200, 103s.

### 주요 작업

| 영역 | 작업 |
|---|---|
| **task_extractor 근본 회귀 fix ★★** | `response_format: json_object` 사용 시 messages 안 'JSON' 단어 필수 — 옛 프롬프트 누락으로 매번 OpenAI 400 → fallback `{tasks:[]}` → **추출 자체가 한 번도 정상 작동 안 했던 회귀**. 프롬프트에 JSON 키워드 추가 + REVIEW vs DELIVERABLE 구분 보강 (디자인 부탁/제작 요청 = task, 검토 부탁 = task X). 검증: "퍼플히어 파비콘" + "앱 아이콘" 정확 추출 |
| **UpdateBanner 시스템 통째 제거 ★** | 사이클 N+2 의 PWA 자동 무효화 시스템이 빌드 잦은 환경에서 짜증 + cache-bust `_v=` query 무한 누적 회귀. main.tsx polling/socket build_id/UpdateBanner mount 모두 제거. SW activate 시 모든 client URL 의 `_v=` query 정리 + 강제 navigate (옛 PWA 자동 탈출) |
| **댓글 본인 편집/삭제** | PUT/DELETE `/api/tasks/:id/comments/:commentId` 신규 — 본인만 (workspace owner 도 차단). UI: ⋮ 메뉴 + inline edit (Ctrl+Enter 저장 / Esc 취소). 메시지 정책 (작성자만) 동일 |
| **task PUT 필드별 권한** | 단일 권한 → 필드별 차등. title/description/body: 작성자/담당자/owner / assignee/due_date: 작성자/owner / project_id: owner only / hours: 담당자/owner. 멤버 위변조 차단 |
| **채팅방 unlink + archive** | POST `/api/projects/conversations/:id/unlink` (project_id=null) + POST `/api/conversations/:bizId/:id/archive` (soft delete). conversations.archived_at 컬럼 신규. ⋮ 메뉴에서 둘 다 ConfirmDialog 통과 |
| **latest_estimation_source 시각 분기** | tasks list API 에 Sequelize literal subquery — 최신 estimation source 노출. NumInput `$ai` italic + AiInlineBadge `fx` 칠. 사용자가 입력하면 자동 user 톤 전환 |
| **부수 fix** | weeklyReviewCron `BusinessMember.active → removed_at:null` (pre-existing 매시 에러) / rate-limit `/push/test` IPv6 helper (`ipKeyGenerator`) |

### 신규/수정

- **신규 컬럼**: `conversations.archived_at` + `archived_by_user_id` (soft delete)
- **신규 endpoint**: `POST /api/tasks/:id/comments/:commentId` (PUT/DELETE), `POST /api/projects/conversations/:id/unlink`, `POST /api/conversations/:bizId/:id/archive`
- **신규 권한 매트릭스**: `routes/tasks.js` PUT 의 `FIELD_RULES` (title/description/assignee/due_date/project_id/hours 각각 차등)
- **신규 UI**: TaskDetailDrawer 댓글 ⋮ 메뉴 + inline edit, QProjectDetailPage ConvRow ⋮ 메뉴
- **제거**: `UpdateBanner` mount + `/version.json` 폴링 + Socket `server:build` listener (frontend 만, backend emit 은 deprecated 잔존)

### 검증 결과 (운영 라이브 직전)

- 헬스체크 27/27 PASS
- API 13/13 PASS — 누적 7건 (#1 cron + #2 est_source + #3 IPv6 + #4 unlink/archive + #5 JSON 키워드 + #6 댓글 권한 + #7 task PUT 권한)
- 프론트 산출물에서 UpdateBanner 흔적 4종 모두 0 (완전 제거)
- 운영 sw.js 에 navigate/`_v` 정리 코드 11 라인 반영

### 운영 배포

- 정식 deploy-planq.sh `e16b125` → 운영 reload (planq-prod-backend 1.3.0 → 1.4.0 + planq-prod-qnote)
- 백업: `/opt/planq/backups/20260510_151817`
- 외부 health 200, db_pool ok, openai/smtp/vapid configured
- 버전: v1.3.0 → **v1.4.0** (minor)

### 사용자 자동 회복 (옛 PWA 갇힌 사용자)

운영 deploy 후 사용자가 평소 새로고침 한 번이면:
1. nginx no-cache → 새 sw.js 받음 (updateViaCache:'none')
2. 새 SW install → activate → 모든 client URL `_v=...&_v=...` 정리 + 강제 navigate
3. 새 chunk → 새 main.tsx (UpdateBanner 시스템 없음)
4. 정상

수동 cache 비우기 안내 X.

---

## ✅ 완료: 사이클 N+2 — v1.3.0 운영 라이브 (2026-05-10)

1 commit 1회 정식 deploy (`650fb6f`). 외부 https://planq.kr health 200, 107s.

### 주요 작업

| 영역 | 작업 |
|---|---|
| **로그아웃 race fix** | `refresh_tokens.replaced_by_id` + 30초 grace + JWT `jti` UUID + tryRefresh 1.5s 재시도. 다중 탭 동시 refresh 200/200 PASS |
| **PWA 자동 무효화** | `vite.config emitVersionJson` plugin → `/version.json` + main.tsx 5분 폴링 + Socket.IO `server:build` 1차 신호 + form-dirty 가드 + UpdateBanner 토스트 |
| **표 (Q record) 고도화** | 시드 컬럼 제거 (빈 표 시작) + ColumnSettings popover (이름/타입/options/aggregate/Delete) + 중간 컬럼 삭제 + select 옵션 사용자 정의 + `attach` 셀 (파일/문서/AI 새 작성→연결) + 행 자동 계산 4 type (row_sum/avg/min/max) + footer 8 aggregate 친근화 ("값 있는 행 수" / "비어있는 비율") + 보기 모드 readOnly + 표 설명 collapsible 에디터 박스 |
| **본문↔문서 연결** | `posts.linked_post_ids` JSON + `AttachmentField includePosts` + 보기 모드 chip (📄/📊) + 자기 자신 차단 + 다른 워크스페이스 invalid 무시 |
| **서명 받기 picker** | PostSignatureModal 에 멤버/고객 통합 자동완성. 선택 시 빈 첫 행 채움 또는 새 행 추가, 중복 차단 |
| **외부 점검 7원칙 (사이클 N+3 박제)** | rate-limit `/push/test` 분당 5회 + endpoint 화이트리스트 (https + 5 도메인) + 재등록 cleanup (옛 row expired 마크) + **PushLog 테이블** (모든 발송 기록) + ping 200ms debounce + 권한 좀비 동기화 (`syncPermissionOnFocus`) + form-dirty reload 가드 + UpdateBanner |
| **UX** | PwaInstallBanner "7일 안 보기" (localStorage) + 모바일 로그인 로고 140px + Q docs 새 문서 모달 dead UI 정리 + 셀 흰 배경 + 라벨 친근화 |
| **규칙 박제** | CLAUDE.md "운영 안정성 규칙" 7개 섹션 + `memory/feedback_ops_stability_7.md` |

### 신규/수정

- **신규 모델**: `models/PushLog.js` (user/sub/host/category/status/code/error/title)
- **신규 컬럼**: `posts.linked_post_ids` JSON / `refresh_tokens.replaced_by_id` INT / `q_records.columns[].aggregate` (JSON 내부)
- **신규 컴포넌트**: `components/Common/UpdateBanner.tsx` / `services/push.ts:syncPermissionOnFocus + bindPermissionSync`
- **신규 라우트**: `socket server:build` event broadcast (deploy 후 자동 알림)

### 검증 결과 (운영 라이브 직전)

- 헬스체크 27/27 PASS
- API 8/8 PASS — race + 화이트리스트 (FCM 201 / evil 400 / http 400) + rate-limit (200×5, 429) + PushLog 5건 + 재등록 옛 row expired
- 매트릭스 E2E PASS — 행 합계 + 평균 + 열 합계 + grand total 1,870 정확
- /docs HTTP 200, 빌드 산출물에 핵심 변경 모두 포함

### 운영 배포

- 정식 deploy-planq.sh `650fb6f` → 운영 reload (planq-prod-backend 1.3.0 + planq-prod-qnote)
- 백업: `/opt/planq/backups/20260510_110953`
- 외부 health 200, db_pool ok, openai/smtp/vapid configured
- 버전: v1.2.0 → **v1.3.0** (minor)

### 알려진 회귀 (다음 사이클)

- `weeklyReviewCron` 매시 에러: `Unknown column 'BusinessMember.active'` (pre-existing, 이번 사이클 무관). 다음 사이클 별도 fix 권장.

---

## ✅ 완료: 사이클 N+1 — v1.2.0 운영 라이브 (2026-05-08)

7 commit 1회 정식 deploy (`f497693 → 4f8658d → 3aa91d0 → eab297d`). 외부 https://planq.kr health 200, 101s 소요.

### 주요 작업

| 영역 | 작업 |
|---|---|
| **AI 업무 추가** | 자연어 → AI 다중 업무 분해 미리보기 + 일괄 확정 (`services/aiTaskPlanner.js` + `routes/tasks.js POST /ai-create + /confirm`). 30년차 컨설턴트 LLM 페르소나, 도메인별 표준 phases, 결과물 기반 명명 강제, 의존성 추론. AiTaskCreateModal — /docs PostAiModal 패턴 1:1 (Dialog 560 / Header padding 18 22 14 + Sparkle 빨강 별 / Body 16 22 12 / Footer 12 22 18). 카드 압축 (제목+담당자 한 줄 + 메타 한 줄, CalendarIcon/ClockIcon 라인). 시작일 picker (양 stage). progress bar 12s |
| **AI 자동 예측** | POST /api/tasks 시 estimated_hours 미입력 → 백그라운드 LLM (`callAiEstimate`) → tasks 자동 채움 + task_estimations source='ai' + socket task:updated emit. 모든 추가 경로 동일. 사용자 명시 입력 시 호출 X (비용 절약) |
| **업무 템플릿 시스템** | DB 2 테이블 (`task_templates`, `task_template_items`). 9 시스템 preset (WordPress 12 / Next.js 18 / 마케팅 캠페인 10 / 콘텐츠 시리즈 8 / 신규 고객사 온보딩 9 / 견적·계약·제작·납품 7 / 채용 6 / 분기 회고 4 / 쇼핑몰 20). routes/task_templates.js (CRUD + apply + items 일괄 교체 + save-as-template). services/templateApply.js (시작일 + role_hint fuzzy 매핑). TemplateSelectModal (검색·카테고리 그룹·자유 입력 datalist·items 인라인 편집). TemplateSaveModal (현재 프로젝트 → 워크스페이스 템플릿 저장). 진입점: 프로젝트>업무 [템플릿] / [템플릿으로 저장] (Q Task 에서는 제거 — 일정 단위) |
| **Row 액션 메뉴 (노션 패턴)** | TaskRowActionMenu — row 좌측 ⋮⋮ 6dots handle (항상 표시) → portal 드롭다운. 메뉴: 아래에 업무 추가 (인라인 폼 — Enter 저장 / Esc 취소) / 복제 / 삭제 (Danger). POST `/api/tasks/:id/copy` (메타 deep clone, 진행/상태 초기화). ProjectTaskList + QTaskPage 동일 패턴 (Fragment + addingBelowId). 모바일 < 640px 핸들 36px |
| **컬럼·Drawer 통일** | 기간 컬럼 fixed 100px + 가운데 정렬 (이전 row 마다 다른 폭). 라벨 '기간' (ko) / 'Period' (en). default sort = start_date asc. utils/responsiveDrawer.ts — viewport × 0.35 [380, 560] clamp. TasksTab + QTaskPage + QCalendarPage 단일 헬퍼. ProjectTaskList onRefresh prop |
| **알림 토스터 회귀 fix** | conversations.js POST /messages 에 socket emit 누락 회귀 fix → io.to(conv:id).emit('message:new') 추가. 사운드 풍부화 (G5+D6 chord, 볼륨 4배 up). 자동 페이드 제거 (X 닫기까지 유지). "모두 닫기 (n)" 컨트롤. mp3 음원 우선 + 합성 fallback 구조 |

### 신규 컴포넌트

- **components/Common/**: `AiActionButton` (단일 소스 — 빨강 그라디언트 + 별), `ModalActionButton` (variant ai/primary/secondary)
- **components/QTask/**: `AiTaskCreateModal` / `TemplateSelectModal` / `TemplateSaveModal` / `TaskRowActionMenu`
- **utils/**: `responsiveDrawer.ts`
- **dev-backend/services/**: `aiTaskPlanner.js` / `templateApply.js`
- **Icons**: `CalendarIcon` / `ClockIcon` / `AlertTriangleIcon`

### 신규 테이블 (DB sync 자동)

- **`task_templates`** (id, business_id NULL=시스템 / 워크스페이스, name, description, category, is_default, is_system, total_duration_days, task_count, usage_count, created_by)
- **`task_template_items`** (id, template_id FK, order_index, title, description, start_offset_days, duration_days, estimated_hours, priority, role_hint, depends_on_indexes JSON)

### 운영 배포

- 정식 deploy-planq.sh `3aa91d0` → 운영 reload (planq-prod-backend + planq-prod-qnote) + nginx reload
- 백업: `/opt/planq/backups/20260508_203554`
- 외부 health 200, db_pool ok, openai_configured=true
- 버전: v1.1.1 → **v1.2.0** (minor)

### 사이클 N+2 박제 권장

- list API 에 `latest_estimation_source` 필드 추가 → AI 자동 예측 task 의 회색 + ✨ 시각 분기
- 모달 통일 스프린트 — ~20 outlier 모달 → StandardModal + ModalActionButton 마이그레이션
- 통합 공유 시스템 (share_token + ShareModal) — 박제 설계 docs/SHARE_SYSTEM_UNIFIED.md
- Smart Routing (App-First Deep Linking) — 박제 설계 docs/SMART_ROUTING_DESIGN.md

---

## ✅ 완료: Q-S 사이클 — 알림 통합 + 사이클 N+1 박제 (2026-05-08)

5 commit 4회 운영 push (`64bcfc1 → 83e2c03 → f6bbe69 → 4fad341 → 9a18ea3`).

### 주요 작업

| 영역 | 작업 |
|---|---|
| 알림 사운드 | NotificationToaster — persistent AudioContext + first-gesture unlock. 활성 conv 라도 사운드 항상 (토스트만 skip) |
| OS app badge | 인박스 + 채팅 합산 단일 source (useGlobalBadge), backend payload.badge 동일 정의, race fix (prevTotalRef), SW number-only |
| Cross-workspace inbox | TodoPage 모든 워크스페이스 socket room 자동 join/leave |
| 영상/음성 업로드 | message_attachments + files multer 5GB, ALLOWED_EXT 12 종 추가, Drive 라우팅 (Conversations 폴더), 친절 에러 |
| Q Talk 모바일 | 100dvh + interactive-widget=resizes-content + visualViewport scrollIntoView |
| Q Talk FAB | /talk 라우트 자동 숨김 + 헤더 ⓘ 도움말 인라인 |
| Q Talk 스크롤 | sentinel + ResizeObserver/MutationObserver 안정화. 메시지 로드 1.5s 재시도 |
| StorageSettings | setInterval `window.open('', name)` 빈 브라우저 폴링 제거 |
| Q Task 우측 패널 | 1회 peek 애니메이션 (FloatingPanelToggle) |
| 알림 진단 | NotificationSettings 5초 timeout 자동 진단 모달 (OS 별 안내) |
| 사이드바 뱃지 | InboxDot 점 → InboxBadge 숫자 통일 (collapsed absolute) |

### 박제 — 사이클 N+1 합의 (8 설계 문서 + 12 메모리)

**docs/:** VISIBILITY_VOCABULARY · PERSONAL_VAULT_DESIGN · QNOTE_CAPTURE_DESIGN · AI_TASK_DESIGN · TASK_TEMPLATE_SYSTEM · SHARE_SYSTEM_UNIFIED · SMART_ROUTING_DESIGN · EMAIL_DELIVERY_POLICY

**memory/:** project_visibility_vocabulary · project_personal_vault · project_invoice_signature_owner · feedback_visibility_signal_required · project_qnote_capture_design · project_ai_task_creation · project_task_templates · project_share_system_unified · project_smart_routing_appfirst · project_email_smtp_policy · feedback_ai_recommendation_threshold · feedback_qnote_personal_tool (갱신)

### 운영 push 결과

- 4회 누적 push: `64bcfc1` → `83e2c03` → `f6bbe69` → `4fad341` → `9a18ea3`
- 마지막 backup: `/opt/planq/backups/20260508_093744`
- 외부 https://planq.kr/api/health 200

### 미해결 이슈

데스크탑 (Mac Chrome) PWA push 알림 + 사운드 한 번도 안 옴:
- 백엔드 statusCode 201 (FCM 통과)
- 모바일 (iPhone) 정상 작동
- POS 는 같은 Mac Chrome 에서 정상 작동
- 추정 원인: planq.kr origin 의 Chrome 권한 차단 / SW 캐시 / PWA 환경
- 권장: PWA 재설치 (fresh state). 안 되면 옛 commit rollback 검토

---

## ✅ 완료: 랜딩 페이지 Hero 카피 리뉴얼 (2026-05-07)

Irene 요청으로 랜딩 페이지 Hero 섹션 카피 전면 변경.

### 완료된 작업

| 작업 | 설명 | 상태 |
|------|------|:----:|
| 슬로건 변경 | "일을 일답게 하다" → "일이 일이 되지 않게" | ✅ 완료 |
| 프리헤드라인 신규 | "업무, 프로젝트, 사람, 시간, 고객, 청구를" (20px, #fff) | ✅ 완료 |
| 헤드라인 변경 | "하나로 연결해 / 시간을 돈으로 바꾸는 / 수익성 엔진" (48px, 줄바꿈) | ✅ 완료 |
| 하이라이트 색상 | "시간을 돈으로 바꾸는" 부분 #14B8A6 강조 | ✅ 완료 |
| 서브카피 삭제 | "대화, 할일, 자료, 회의, 청구까지 —" 제거 | ✅ 완료 |
| 레이아웃 조정 | 마진/간격 최적화, Hero 영역 상단 80px 올림 | ✅ 완료 |

### 수정된 파일
- `dev-frontend/src/pages/Landing/HomePage.tsx` (Hero 섹션 구조 + 스타일)
- `dev-frontend/public/locales/ko/landing.json` (hero.slogan, preHeadline, headline)
- `dev-frontend/public/locales/en/landing.json` (영문 번역 동기화)

---

## ✅ 완료: 풀 사이클 운영 라이브 (2026-05-06) v1.1.1+

직전 운영 (`a0b550f`, 2026-05-05) 이후 **31 commit** 박제·검증·배포 풀 사이클. Irene 의 풀 보고 (알림·업무 추출·반복·로그인·다중 디바이스·채팅 UX·모바일 반응형·UI 일관화) 일괄 처리.

### 핵심 영역별 작업

| 영역 | 주요 commit | 상태 |
|------|------|:----:|
| **알림 풀세트 (Slack 수준)** | `62b2eb8` 풀세트 + `375b540` 사운드/진동 + `a0c8572` unread 실시간 + `101f1a5` 노이즈/path + `e3578d3` 본인 액션 차단 + `72ee853` SW fallback | ✅ |
| **업무 추출 정밀화** | `f196029` 풀 재설계 (ZERO-TOLERANCE prompt + 인라인 편집 + 등록/요청 분기 + URL autolink) + `4d32890` candidate 카드 기간 + `fa292a1` 정렬·간격 | ✅ |
| **Q Calendar 반복 풀세트** | `63c4c0a` 3주/N주마다 + 종료 조건 + 공통 RecurrencePicker + biweekly | ✅ |
| **로그인·인증** | `c29aeef` 로그인 상태 유지 체크박스 + `963cced` cookie 보강 + `4adcbc8` 약관 hotfix + `ffab8c5` 로고/슬로건 갱신 | ✅ |
| **다중 디바이스 세션** ★ | `1b05435` refresh_tokens 테이블 신규 — RFC 6749 표준. login/refresh/logout 재작성. 도난 reuse_detected 방어 | ✅ |
| **Q Talk 채팅 UX** | `d54da34` 시간 미표시 fix + Hangouts 그룹핑 + [고객] 라벨 + `9206095` 줄간격 좁힘 + `33731d3` 모바일 100dvh + `a67c4c3` 자동 포커스 + auto-resize | ✅ |
| **Q Task 댓글 첨부** | `ec2b9eb` stored_name 누락 fix + `da6e8e3` 클릭 인증 + 댓글/업무 영역 분리 | ✅ |
| **모바일 / PWA** | `e7708e4` 설치 배너 위치 + 클릭 + `41d7ee1` iOS 자동 줌 차단 + `05c68f4` 안내 위치 일반화 | ✅ |
| **반복 라벨 정밀화** | `581728b` "매년 NaN월" 차단 + 리스트 칩 short ("매월/매년") + Invalid Date 방어 | ✅ |
| **UI 일관화 (CalendarPicker 통일)** | `4650404` 모든 단일 날짜 SingleDateField (12곳 native input 제거) | ✅ |
| **주간 보고 Phase 1** | `58487e9` Q Task 4번째 탭 + 자동/수동 박제 + JSON 통계 + `f0b7e38` cron 컬럼명 fix | ✅ |
| **협업 규칙** | `66f55da` Irene + lua 동시 개발 룰 + 권한 분리 권장 | ✅ |

### 신규 테이블 (DB 변경)
- **`refresh_tokens`** (`1b05435`) — id / user_id / token_hash / user_agent / ip_address / expires_at / revoked_at / revoked_reason / last_used_at
- **`weekly_reviews`** + **`weekly_review_settings`** (`58487e9`)

### 신규 컴포넌트
- `components/Common/SingleDateField.tsx` — CalendarPicker singleMode wrapper
- `components/Common/RecurrencePicker.tsx` — 공통 반복 설정 (Q Calendar / 향후 Q Task 통합)
- `components/QTalk/CandidateEditCard.tsx` — 업무 후보 인라인 편집 카드
- `components/QTask/WeeklyReview*.tsx` — 주간 보고 4 컴포넌트

### 운영 배포 결과
- 직전 `a0b550f` (2026-05-05) → `fa292a1` (2026-05-06 18:22)
- 4회 운영 push 누적 (66f55da · 9206095 · da6e8e3 · fa292a1)
- 헬스체크 27/27 PASS / 외부 health 200 / PM2 prod 안정

### 다중 디바이스 마이그레이션 1회 비용
`1b05435` 배포 직후 기존 사용자 1회 재로그인 필요 (옛 cookie hash 와 새 token_hash 매칭 X). 그 후부터 Mac + iPhone + Mac Safari 등 동시 사용 시 자동 logout 영구 해소.

---

## ✅ 완료: 운영 라이브 풀세트 (2026-05-05)

운영 진입 직전 30년차 시각 점검 — 빠진 핵심 기능 + UI 다듬기 + 운영자 도구 일괄. 21 commit 운영 라이브 (`a0b550f`).

### 완료된 작업

| 작업 | 설명 | 상태 |
|------|------|:----:|
| Q-R 검증 + 배포 | Free 폐지 / Starter 14일 trial / Addon 자체결제 / 세금계산서 / migrate-free-to-starter | ✅ 완료 |
| 결제 메일 표준 layout + placeholder 가드 | billing/addonBilling 자체 HTML 우회 → emailWrap 통일. `<예: 토스뱅크>` 가드 | ✅ 완료 |
| PublicPostPage 헤더+배너+Invalid Date | 로고 88px / 마케팅 배너 / Sequelize toJSON override 근본 fix | ✅ 완료 |
| 게스트 Cue 채팅 모드 | 비로그인용 PlanQ 안내 + "문의 남기기" 탭 + IP rate limit + 24h 캐시 | ✅ 완료 |
| 워크스페이스 스위처 빨간 레이어 제거 | platform_admin 모드도 일반 워크스페이스와 동일 teal | ✅ 완료 |
| 문의 시스템 일괄 | AdminInquiriesPage + 자동 회신 + platform_admin 알림 + timezone 동시 표시 | ✅ 완료 |
| 플랫폼 알림 6 종 + 발송 연동 | inquiry/signup/payment/subscription/trial/feedback (5 위치 platformNotify 헬퍼) | ✅ 완료 |
| KB AI/CSV Ingest Phase 1 | 자유 텍스트 → 토픽별 분리 + 카테고리·태그 자동 + 검수/일괄 저장 + 다국어/번역 정책 | ✅ 완료 |
| KB 등록·상세 폼 통일 | 7 필드 인라인 편집 (scope/project/client/tags/read_policy/attached_files/posts) | ✅ 완료 |
| /info 모달 풀 재구성 | "새 정보 등록" + 필드 순서 재배치 + 통합 첨부 검색 + menuPlacement bottom | ✅ 완료 |
| **사용자 라이프사이클** | 비밀번호 재설정 (forgot/reset 4 라우트 + 3 페이지) + 약관 동의 + 이메일 인증 (signup verify) | ✅ 완료 |
| **점검 모드 + 공지 배너** | maintenanceMiddleware (admin 통과) + announcement 3 severity + 사이드바 노출 | ✅ 완료 |
| **운영자 도구** | 사칭 (30분 + AuditLog 강제) / AuditLog read / share_token cron / GDPR data export | ✅ 완료 |
| **Phase 2 admin UI** | AdminUsersPage / AdminAuditLogsPage / AnnouncementBanner / TermsReacceptModal / ImpersonateBanner | ✅ 완료 |
| Q Note 용어 통일 | 음성메모/기록/회의록 → 음성 노트/녹음 (명사/동작 분리) | ✅ 완료 |

### 운영 push 결과
- 운영 라이브: `https://planq.kr` `a0b550f` (timestamp `20260505_211956`)
- 운영 백업: `/opt/planq/backups/20260505_211956`
- 헬스체크 27/27 PASS, 운영 4 신규 페이지 200, API 보안 401 + 200

### Irene 운영 셋업 (내일)
- 운영 `/admin/billing-settings` 에 PlanQ 결제 계좌 입력 (placeholder 가드 박제됨, 안전)
- `/legal/terms` `/legal/privacy` 약관 텍스트 변호사 검토 권장
- 첫 가입자 verify 메일 도달 (Gmail SPF/DKIM) 모니터링

### DB 스키마 변경 (운영 자동 sync)
- User: password_reset_token/expires, email_verify_token/expires, terms_accepted_at, terms_version, privacy_accepted_at, privacy_version (6 컬럼)
- PlatformSetting: terms_version, privacy_version, maintenance_mode, maintenance_message, announcement_text, announcement_dismissible, announcement_severity (7 컬럼)
- KbDocument: source_language, auto_translate, translation_visibility, translations, parent_doc_id (5 컬럼)
- ContactInquiry: from_user_timezone (1 컬럼)
- NotificationPref ENUM: signup/payment/subscription/trial/feedback/inquiry 6 종 추가 (총 13)
- Payment: kind, addon_code, addon_quantity, tax_invoice_requested, tax_invoice_status, tax_invoice_data, tax_invoice_issued_at (7 컬럼)

### 21 commit 박제
4e10cc3, cfef873, 67dbd42, 7ecebb8, 778cbee, a8ad1c7, 91d52cc, 2942068, 5259b91, 1b8ddcb, 8853b23, 368a039, 7d9bece, 02c5336, 255f3ea, 9a1e2a1, e676528, dda1e3e, 2d339b8, 9fbefb7, a0b550f

---

## ✅ (이전) Q-R 사이클 — Free 폐지 + Starter 14일 trial + Addon 자체결제 + 세금계산서 + 운영 안정화 (2026-05-05, 검증 + 배포 완료)

> **상태:** 코드 작성 완료 (25 modified + 8 new = +1700 line). **빌드·DB sync·검증·배포는 다음 세션이 이어받음.**
>
> **이전 세션이 이 사이클 도중 멈췄음 — uncommitted 채로 발견 → 다음 세션이 검증·배포 이어받기 위해 본 commit 으로 박제.**

### 1. Free 플랜 폐지 + Starter 신규가입 14일 trial
- `config/plans.js` — Free `deprecated: true` + PLAN_ORDER 에서 제외 (ENUM 호환 위해 PLANS 객체 자체는 유지). `getPlan` fallback 도 `starter` 로 변경
- Starter 한도 재설계: members 2→1, clients 10→5, projects 10→5, conversations 30→10, storage 1→2GB, cue_actions 300→50, qnote 5h→1h
- `services/trial.js` (신규 153줄) — 신규 가입 시 starter+trialing 14일 자동 부여 + 만료 시 강등
- `scripts/migrate-free-to-starter.js` (신규 87줄) — 기존 Free 워크스페이스 일괄 starter+trialing 14일 부여 (다음 세션 1회 실행)

### 2. Addon 자체결제 풀 흐름
- `services/addonBilling.js` (신규 246줄) — 일할 청구서 자동 발행 + 한도 즉시 적용 + 입금 안내 메일 + mark-paid 시 컬럼 자동 증가
- `routes/plan.js` `/addons/request` — 신청 기록만 → 풀 흐름으로 확장
- `routes/admin.js` `/payments/:id/mark-paid` — `kind` 자동 분기 (plan vs addon)

### 3. 세금계산서 옵션 (한국 사업자)
- `models/Payment.js` — `kind`, `addon_code`, `addon_quantity`, `tax_invoice_requested`, `tax_invoice_status`, `tax_invoice_data`, `tax_invoice_issued_at` 컬럼 추가
- `routes/plan.js` checkout / mark-paid — `tax_invoice` payload 전달
- `routes/admin.js` (Day 10) — admin 세금계산서 발행 라우트
- `CheckoutModal.tsx` — 세금계산서 입력 펼침 (체크박스 → biz_no/biz_name/ceo_name/address/email)
- `AdminPaymentsPage.tsx` (Day 8) — 결제 목록에 addon / 세금계산서 컬럼 노출

### 4. PlanQ 결제 계좌 admin 관리 (env → platform_settings)
- `routes/plan.js` `/bank-info` — `platform_settings` 우선, env 는 legacy fallback. 운영 진입 후 admin UI 에서 관리

### 5. 운영 안정화 UI (프론트 신규 4종)
- `BuildVersionGuard.tsx` (48줄) — 새 빌드 배포 시 사용자 자동 reload (chunk fail 보강)
- `LimitReachedDialog.tsx` (135줄) — 한도 초과 시 안내 + 업그레이드 / 추가 슬롯 / 추가 시간 분기
- `TrialStatusBanner.tsx` (133줄) — 14일 trial 잔여일 안내 + 결제 유도
- `UsageWarningCard.tsx` (151줄) — 한도 임박 (80%/90%) 경고 카드

### 6. 보조 변경
- `routes/auth.js` — 신규 가입 시 trial 부여 호출
- `routes/businesses.js`, `clients.js`, `cue.js`, `invites.js`, `projects.js` — limit 검사에 trial 컨텍스트 반영
- `services/billing.js` — `createPendingSubscription({ taxInvoice })` + addon 연동
- `services/emailService.js` — 입금 안내 / trial 만료 안내 템플릿
- `App.tsx`, `AuthContext.tsx`, `DashboardPage.tsx`, `PricingPage.tsx`, `services/plan.ts` — Free 노출 제거 + Trial 컨텍스트
- i18n 4종 (ko/en common+landing) — common +87줄 양쪽

### 수정·신규 파일 (총 33개)
**백엔드 수정 (14):** `config/plans.js`, `models/Payment.js`, `routes/admin.js`, `routes/auth.js`, `routes/businesses.js`, `routes/clients.js`, `routes/cue.js`, `routes/invites.js`, `routes/plan.js`, `routes/projects.js`, `server.js`, `services/billing.js`, `services/emailService.js`, `services/plan.js`

**백엔드 신규 (3):** `scripts/migrate-free-to-starter.js`, `services/addonBilling.js`, `services/trial.js`

**프론트 수정 (11):** `App.tsx`, `contexts/AuthContext.tsx`, `pages/Admin/AdminPaymentsPage.tsx`, `pages/Dashboard/DashboardPage.tsx`, `pages/Landing/PricingPage.tsx`, `pages/Settings/CheckoutModal.tsx`, `services/plan.ts`, i18n 4종 (ko/en common+landing)

**프론트 신규 (4):** `BuildVersionGuard.tsx`, `LimitReachedDialog.tsx`, `TrialStatusBanner.tsx`, `UsageWarningCard.tsx`

### ⚠️ 검증·배포 체크리스트 (다음 세션 이어받기)

| # | 단계 | 명령 | 비고 |
|:-:|------|------|------|
| 1 | DB 스키마 sync | `cd dev-backend && node sync-database.js` | Payment 7 컬럼 추가 |
| 2 | PM2 restart (dev) | `pm2 restart planq-dev-backend` | 신규 라우트·서비스 로드 |
| 3 | 프론트 빌드 (dev) | `cd dev-frontend && npm run build` | 신규 컴포넌트 4종 |
| 4 | Free → Starter 마이그레이션 (dev) | `node scripts/migrate-free-to-starter.js` | 기존 Free 워크스페이스 일괄 |
| 5 | 헬스체크 | `node scripts/health-check.js` | 27 테스트 |
| 6 | 결제 시나리오 검증 | login → checkout → mark-paid → tax_invoice 발행 | 실 API |
| 7 | trial 시나리오 검증 | 신규 가입 → starter+trialing 14일 → banner 노출 | 실 API |
| 8 | addon 시나리오 검증 | /addons/request → 일할 청구서 → mark-paid → 한도 증가 | 실 API |
| 9 | UI 검증 | LimitReached / Usage / Trial / BuildVersionGuard 4 컴포넌트 | 브라우저 |
| 10 | /배포 | dev → 운영 (Payment 컬럼 sync + migrate-free 운영 적용 포함) | Irene 명령 시 |

**❗ 배포 전 운영 DB 백업 필수 (`scripts/backup-prod.sh`).**

### 메모리 (검토 — 다음 세션에 추가 예정)
- Free 플랜 폐지 정책 (Starter+trial 14일 신규 가입 표준)
- Addon 자체결제 풀 흐름 (일할 청구·자동 한도 적용)
- BuildVersionGuard 패턴 (chunk fail + version polling 이중 보강)

---

## ✅ 완료: Q-Q 사이클 — 랜딩 풀세트 + Q Task 상세 폼 통일 + 주간 보고 설계 (2026-05-04)

운영 진입 후 Irene 의 광범위 피드백 사이클. 8 commit 운영 라이브 (`abe697f → f7256ac`) + 다음 사이클 설계 문서 1건.

### 1. 알림 시스템 디테일
- 알림 매트릭스 grid 4 컬럼 fix (이전 3 컬럼 — email 채널 잘림)
- 디바이스 알림 OFF 적극 안내 — 인박스 띠 배너 + 설정 강조 카드
- 인박스 띠 배너 "알림 설정" 진입 버튼 추가

### 2. 운영 fix
- 업무 후보 추출 중복 dedup (extractTaskCandidates POST 응답 + socket broadcast 둘 다 setCandidates 에 push 되던 결함)
- ErrorBoundary chunk fail 자동 reload (60초 가드) — 새 빌드 배포 후 이전 페이지 머문 사용자 자동 복구

### 3. 랜딩 페이지 풀세트 (비로그인 외부 트래픽)
- HomePage 풀 — Hero/Problem/Value/Q시리즈/Engine/Compare/Trust/Target/CTA 9 섹션
  · 다크 + teal 그라디언트 (Hero/Q Series/Engine/Final CTA), 라이트 (Problem/Value/Compare/Trust/Target)
  · useReveal hook + Hero blob keyframes 살살 떠다님
- FeaturesPage 풀 — 16 모듈 4 그룹 (Q시리즈 5 + 워크스페이스 4 + AI·분석 3 + 기반 4)
- PricingPage 풀 — Free/Basic/Pro 3 plan + Addon 3 + FAQ 5
- AboutPage 풀 — Our Story + Mission + Values 3 + Timeline 4
- ContactPage 풀 — 연락처 카드 + 문의 폼 (백엔드 /api/inquiries)
- BlogPage 신규 ("인사이트") — 카테고리 5 (영상·글·사례) + 발행 예정 placeholder
- LandingLayout — sticky GNB transparent → scrolled 전환, 다크 Footer
  · 로고: 텍스트 → planQ_white_new.svg / planQ_color.svg (실제 워드마크)
  · GNB 5 메뉴: 기능·요금제·인사이트·회사·문의
- App.tsx — / RootRoute (POS 패턴, 로그인 무관 항상 랜딩) + 5 신규 라우트
- index.html — Outfit + Noto Sans KR 폰트 추가
- i18n landing namespace 풀 (ko/en, 200+ 키)

### 4. PWA 정책
- PwaInstallBanner — 비로그인 시 미노출 (마케팅 페이지 어색)
- 로그인 후 앱 영역에서만 노출

### 5. Q Task 상세 드로어 — 등록 폼과 통일
- 셀 순서: 프로젝트 → 담당자 → 기간 → 예측+AI → 실제 → 진행 (등록 폼 동일)
- styled: AddOptRow/AddOptField/AddOptLabel 패턴 카피 (flex-wrap, 자연 폭)
- 담당자/프로젝트 PlanQSelect — saveField 즉시 저장, 로컬 객체도 갱신
- 예측 input 옆 ✨ AI 추천 버튼 — 담당자 한정 항상 노출 (값 있어도 재추천)
- 반복하기 토글 + preset 4 + 종료 3 (등록 폼 동일 i18n recur.* 재사용)
- 백엔드 routes/tasks.js PUT 에 recurrence_rule 추가 (RRULE 검증 + next_occurrence_at 재계산)
- 업무 추출 등록 시 default 담당자 = 등록 누른 사용자 (guessed_assignee 없으면)

### 6. 다음 사이클 설계 — 주간 보고 (Weekly Review)
- `docs/WEEKLY_REVIEW_DESIGN.md` 신규 (16KB, 풀 기획·DB·API·cron·검증)
- Q Task 안 4번째 탭 "주간 보고" + 헤더 "이번 주 마무리" 버튼 + "한 주 메모" 모달
- 자동 박제 (매주 일요일 23:59 ws_tz cron) + 수동 박제
- JSON 데이터 저장 → Insights "주간 추세" 탭으로 통계 활용 (Phase 3)
- 신규 테이블 2 (`weekly_reviews`, `weekly_review_settings`) — 기존 0 변경
- 라벨 합의: 주간 보고 / 이번 주 마무리 / 한 주 메모

### 검증
- 헬스체크 27/27
- 빌드 (tsc 0건 + vite ~1.5s)
- 운영 라우트 7/7 200 (/, /features, /pricing, /blog, /about, /contact, /tasks)

### 운영 라이브
- `f7256ac` (timestamp `20260504_182803`) 운영 라이브
- 백업: `/opt/planq/backups/20260504_182803`

### 수정·신규 파일 (총 24개)

**백엔드 (1):** routes/tasks.js (PUT recurrence_rule 처리)

**프론트 (12 수정 + 8 신규):**
- 수정: App.tsx / components/Common/PwaInstallBanner.tsx / components/Common/ErrorBoundary.tsx / components/Landing/LandingLayout.tsx (대규모) / components/QTask/TaskDetailDrawer.tsx / pages/Landing/HomePage.tsx (풀 재작성) / pages/Landing/RootRoute.tsx / pages/QTalk/QTalkPage.tsx (candidates dedup) / pages/QTask/QTaskPage.tsx / pages/Settings/NotificationSettings.tsx / index.html / i18n.ts
- 신규: hooks/useReveal.ts / pages/Landing/FeaturesPage.tsx / PricingPage.tsx / AboutPage.tsx / ContactPage.tsx / BlogPage.tsx

**i18n (4):** locales/{ko,en}/landing.json (신규 풀 200+키), locales/{ko,en}/qtask.json (detail.meta + recur 키 추가)

**문서 (1 신규):** docs/WEEKLY_REVIEW_DESIGN.md

### 메모리 (1 신규)
- project_weekly_review_design.md (다음 사이클 즉시 시작 정보)

---

## ✅ 완료: Q-P 사이클 — 알림 매트릭스 + 인앱 토스터 + 모바일 PWA 풀 (2026-05-04)

운영 진입 후 Irene 이 "채팅 알림 우측 상단 / 디바이스 알림 / 외부 공유 — 채팅에만? 다 가능?" 4 가지 질문 → 30년차 시각으로 phase 1~3 통합 사이클. 1 commit 운영 라이브 (`3ca0c35`).

### 1. Phase 1 — 알림 페이지 명확화
- `/business/settings/notifications` 헤더 결함 fix — `WorkspaceSettingsPage.tsx` `tabFromUrl` 이 `params.tab` 없을 때 `location.pathname` 마지막 segment 도 참조 (App.tsx 의 specific route 가 :tab param 미전달하던 결함)
- 헤더 라벨: `tabs.notifications` "알림" → `tabs.notificationSettings` "알림 설정" (페이지 컨텍스트 명확)
- 4 채널 매트릭스 — 인박스 / 인앱 / 디바이스 / 이메일 (이전 3 종 → push 채널 추가, 백엔드 ENUM 이미 push 지원)
- 각 채널 hint 카피로 의미 명확화 ("일하는 중 우측 상단 알림창" / "자리 비웠을 때 OS 알림")

### 2. Phase 2 — 인앱 Toaster (NotificationToaster.tsx 신규)
- 우측 상단 fixed, focus-steal 금지 (`pointer-events: none` 컨테이너, 자식만 catch)
- Context-aware — 활성 conv·페이지 토스트 X (`activeConvIdRef` + `location.search?conv` 추적)
- 단일 socket per session — 페이지별 socket 과 별개, App.tsx 레벨에서 user 로그인 시 상시
- `business:{id}` + 사용자 모든 conv 룸 join (fetch list once)
- 구독 이벤트:
  - `message:new` — 본인 발신 제외, 활성 conv 제외 (`💬 한수정의 메시지`)
  - `task:new` — 나에게 배정된 업무만 (`✓ 새 업무 배정됐습니다`)
  - `task:updated` — completed (요청자) / reviewing (리뷰어)
  - `inbox:refresh` — signature_created / signature_signed / invoice_status / installment_paid
- 5s 자동 페이드, hover 시 timer 정지 + 강조 (transform translateX), 클릭 → navigate
- 최대 3 stack, 사운드 OFF (작업 방해 X)
- 토큰 만료 시 connect_error → apiFetch 자동 refresh
- Notification fatigue 방지 — 본인 발신·활성 컨텍스트 자동 skip

### 3. Phase 3 — 모바일 PWA 풀
- **Service Worker 자동 register** (`main.tsx`) — 앱 로드 시 silent register, push 알림 + share-target POST + PWA install 모두 SW 필요
- **share-target POST handler** (`sw.js`) — multipart/form-data 받아서 Cache 에 텍스트+파일 임시 저장 → `/share-receive?shared=1` redirect (Web Share Target Level 2 표준)
- **`manifest.json` 업그레이드** — share_target POST + multipart + files 필드 (이미지·PDF·docx·xlsx·zip 등 8 종 MIME accept)
- **PwaInstallBanner.tsx 신규** — beforeinstallprompt catch 후 우측 하단 배너 + "설치" 버튼 / iOS Safari 안내 ("하단 공유 → 홈 화면 추가")
  - 한 번 dismiss 시 7일 정지, 설치 완료 시 1년 정지
  - standalone 감지 시 자동 미표시
- **ShareReceivePage 강화** — Cache 에서 파일 읽어 미리보기 + Q File destination 추가 (워크스페이스 자동 업로드 + `/files` 이동)
- 5 destination: 채팅 / 업무 / 메모 / 문서 / **Q File** (파일 있을 때만 노출, 강조 색)

### 검증
- 헬스체크 27/27
- E2E 15/15 (알림 매트릭스 4 채널 / push PUT / sw.js handlers / manifest 표준 / 페이지 응답)
- 역할별 prefs 접근 3/3 (owner/member/client)
- 페이지 응답 11/11 (manifest·sw.js 외부 200)

### 운영 라이브
- `3ca0c35` (timestamp `20260504_091626`) 운영 라이브 https://planq.kr

### 수정·신규 파일
- 신규: `dev-frontend/src/components/Common/NotificationToaster.tsx`, `dev-frontend/src/components/Common/PwaInstallBanner.tsx`
- 수정: `dev-frontend/src/{App,main}.tsx`, `dev-frontend/public/{manifest.json,sw.js}`, `dev-frontend/src/pages/Settings/{WorkspaceSettingsPage,NotificationSettings}.tsx`, `dev-frontend/src/pages/ShareReceive/ShareReceivePage.tsx`, `dev-frontend/public/locales/{ko,en}/settings.json`

---

## ✅ 완료: Q-O 사이클 — 운영 fix + UI/UX 통합 (2026-05-04)

운영 진입 후 Irene 사용 피드백 기반 광범위 fix + UI/UX 통일 사이클. 3 commit 운영 라이브 (`e88fbac → b96a258 → 0690328`).

### 1. 인증 401/403 정석 분리 (`e88fbac`)
- `auth.js`: JWT decode 실패 시 403 → **401** + `code` 필드 (no_token / token_expired / invalid_token / user_not_found / account_suspended)
- `AuthContext.tsx`: JWT exp 능동 검사 + 단일 in-flight refresh + Page Visibility 복귀 시 즉시 refresh
- 워크스페이스 task 누락 — workspace/all-tasks 가 `business_id` 직접 필터 (project null task 도 포함)
- 12 검증 시나리오 PASS

### 2. Socket.IO 미연결 + 양방향 통합 (`b96a258`)
- 채팅·업무·할일 실시간 안 되던 근본 원인 — `localStorage('token')` (메모리 only 정책)
- `getAccessToken()` + `useAuth().user` 의존성 일괄 교체
- Room 이름 통일 (`conversation:` → `conv:`)
- WebSocket 시간 지나면 끊김 fix (auth 함수형 + connect_error refresh + reconnection Infinity)
- 채팅 핀 (사용자별 BusinessParticipant.pinned_at) 신규 + 정렬 우선
- 이미지 업로드/표시 (link-existing path.relative 정규화 + /raw/public 엔드포인트 + GET messages include attachments)
- 채팅 두번 찍힘 dedup
- 즉시 업로드 (드래그/paste) — 인라인 통합 (popup-on-popup 제거)

### 3. UI/UX 통합 사이클 (`0690328`, 32 파일 +1345/-385)
- **업무 폼 재구성**: inline 4 필드 한 줄 + 패널 2 행 분리, DateRangeCell 통일, AI 추천 버튼, 우선순위 색 Primary teal, 반복 칩 ⟳ 매주 토
- **업무 상세**: description RichEditor + 첨부 popup-on-popup 제거 + 댓글 첨부 (새 + 기존 파일·문서)
- **프로젝트 ↔ Q Talk 양방향**: NewChatModal "+ 새 프로젝트" + NewProjectModal Q Talk 채널 토글 스위치 + 명칭 통일
- **워크스페이스 표시명 enrichment**: BusinessMember.name 우선 (`User.display_name` 백엔드 enrich, 프론트 6 군데)
- **피드백 단순화**: title 제거, "내용" 단일 에디터
- **프로필**: 계정 이름 필드 추가 (영수증·세금계산서) + 워크스페이스 "닉네임/영문 닉네임" 라벨
- **기타**: Q info 빨간점 제거, knowledge "+ 새 정보", manifest enctype, language level select wrap fix

### 검증
- 헬스체크 27/27
- Auth E2E 12/12, Task 추가/수정/첨부 17/17, 양방향 채널 0/1/2, 핀, 역할별 권한 8/8

### 운영 배포
- `0690328` (timestamp `20260504_083441`) 운영 라이브

---

## ✅ 완료: Q-H 사이클 + 첫 운영 배포 (2026-05-01 저녁)

dev/운영 양쪽 Claude 세션 협업으로 운영 라이브 (https://planq.kr) 진입 + 거대 권한·프로필·GDrive 정책·Q Note 사이클 마무리 + 두 번째 배포 (commit `024d368`).

### 1. 첫 운영 실배포 (commit `661b893`)
- 운영서버 (87.106.78.146 / planq.kr / port 3004) PM2 + nginx + SSL 모두 정상
- DB sync 시 `kb_documents.project_id` INT vs `projects.id` BIGINT FK 불일치 fix (broken FK 드롭 + INT→BIGINT)
- POS production-backend (3002) 와 공존, 영향 없음

### 2. Client 권한 매트릭스 정리
| 영역 | 동작 | 위치 |
|------|------|------|
| 사이드바 노출 | 인박스 / Q Talk / Q Task / Q Project / Q Calendar / Q Bill / 프로필 | MainLayout |
| 사이드바 숨김 | Q Note / Q Knowledge / Q Docs / Q File / Q Mail / 통계 / 설정 / 멤버 | hasBiz 분기 |
| 라우트 가드 | files (POST/move/DELETE/bulk-delete) / calendar (POST/PUT/DELETE) / tasks (자기 자신 X) / kb (GET 4 + 쓰기 5) | client 403 |
| Q Task 우측 패널 | detail 있을 때만 노출 | QTaskPage isClient |
| client 사이드바 2뎁스 | 설정 → 내 프로필 / 알림 (AccordionWrap) | MainLayout |
| `/business/settings/notifications` | client 도 접근 OK | App.tsx 별도 라우트 |
- 메모리: `project_client_permission_matrix.md`

### 3. Calendar 권한 명확화
- Member/Owner default = 워크스페이스 전체 일정
- "나" 탭 = 자기 관련만 (frontend 후처리 필터)
- "나" 탭 task 필터 버그 fix (created_by 만 → assignee_id+created_by)

### 4. GDrive 정책 (옵션 B + 옵션 1)
- 워크스페이스 공용 파일 (project_id 있음) = Drive
- 개인 파일 (project_id 없음 = "내 파일") = PlanQ 자체
- StorageSettings + CloudConnectNotice 안내 강화. CloudConnectNotice client hidden
- 메모리: `project_gdrive_policy.md`

### 5. 계정 vs 워크스페이스 프로필 분리
- DB:
  - `users` 7 컬럼 (email_verified_at, secondary_email + 5 OTP)
  - `business_members` 10 컬럼 (name, name_localized + Q Note 8 필드)
  - `clients.display_name_localized`
- 신규 라우트 12개 (me/profile GET-PUT, email-verify-*, secondary-email-*)
- ProfilePage 재설계: 계정 / "{워크스페이스} 프로필" / "{워크스페이스} — Q note 답변 생성용" 3 Card
- expertise_level 5단계 + 결과 예시 카드
- EmailChangeModal `kind` 4종 (primary, secondary, verify-primary, verify-secondary)
- 알림 매트릭스 ProfilePage 에서 분리 → `/business/settings/notifications` 별도 메뉴
- 메모리: `project_account_workspace_profile_split.md`

### 6. Q Note 용어 + UX
- i18n ko/en: 회의 → 음성메모, 회의 언어 → 사용 언어, 회의 진행 → 녹음 시작
- StartMeetingModal: 목적 칩 (회의/상담/강의/인터뷰/메모/기타) + 캡처 방식 안내 + 프로필 미완성 배너

### 7. Push UX
- NotificationSettings PushSection: "본인 계정 + 이 브라우저 1개만" 명시 안내

### 8. 두 번째 운영 배포 (commit `024d368`)
- 32 파일, +1667/-467, 96초 완료
- planq-prod-backend reload 1회, 헬스체크 외부/내부 모두 OK

### 9. 검증 (/검증 9단계)
- 0단계 헬스체크 27/27
- 1단계 TS 0건, 3단계 신규 라우트 가드 OK, 6단계 25 항목 매트릭스 통과

### 수정된 파일 (이번 세션, 총 32개)
**Backend (9):** models/User.js, BusinessMember.js, Client.js / routes/businesses.js, calendar.js, files.js, kb.js, tasks.js, users.js
**Frontend (15):** App.tsx, MainLayout.tsx, UserChip.tsx, EmailChangeModal.tsx, ProfilePage.tsx, QCalendarPage.tsx, StartMeetingModal.tsx, DocsTab.tsx, QTaskPage.tsx, NotificationSettings.tsx, StorageSettings.tsx + 신규: CloudConnectNotice.tsx
**i18n (10):** ko/en × common, profile, qnote, qproject, settings 5 ns
**Skill:** .claude/commands/배포.md 정비

### 메모리 (5 신규)
- project_client_permission_matrix.md
- project_gdrive_policy.md
- project_account_workspace_profile_split.md
- project_backup_strategy_pending.md (다음 세션 즉시 작업)
- feedback_dev_first_always.md / feedback_korean_demonstrative_scope.md

---

## ✅ 완료: N+ 운영 진입 사이클 (2026-05-01)

dev/운영 양쪽 Claude 세션 협업으로 운영서버 (POS 운영서버 87.106.78.146 공존 설치) 셋업 1~4단계 완료. 첫 실배포 직전.

### 1. 배포 모델 결정 — **모델 B (POS rsync 패턴) 확정**

- 운영서버 = dev 서버 정확 복사. 별도 코드/정보 없음.
- dev (87.106.11.184) → SSH rsync push → 운영서버 (87.106.78.146)
- 운영서버에 git repo 없음 → GitHub key 노출 없음
- POS deploy-production-v3.sh 시퀀스 + 플래그 동일 채용

### 2. dev 측 작업

| 영역 | 산출물 |
|------|--------|
| **commit `6c34535`** N+ 사이클 | services/{overdue_handler, recurring_invoice, report_generator, mention_parser}.js (cron 4종) + routes/reports.js + Reports 자동 생성 (services/stats.js + pdfTemplates.js) + 요금제 Addon (config/plans.js + AddonSection.tsx) + Q Bill 결제·서명·외화 폴리싱 + .env.production.example 보강 |
| **commit `1f3b791`** | scripts/deploy-planq.sh (442줄) — preflight + show_changes + backup + sync_backend/frontend/qnote (rsync over SSH) + install_deps + sync_database + restart_server + reload_nginx + verify + update_record. 플래그 --auto / --dry-run / --skip-build / --skip-qnote |
| 운영 자료 scp | scripts/{generate-prod-secrets, prod-diagnose, nginx-planq.kr.conf, prod-ecosystem.config.js} + .env.production.example → 운영서버 |
| Secret SSH 직접 박음 | dev .env 의 OPENAI/Deepgram/SMTP 5개 → ssh sed 통해 운영 .env 에 직접 입력 (채팅 노출 없음) |
| dry-run 통과 | 모든 단계 정상 출력 |

### 3. 운영서버 (별도 Claude 세션) 작업

| 영역 | 산출물 |
|------|--------|
| 디렉터리 구조 | /opt/planq/{backend, frontend-build, q-note, logs, uploads} mkdir + irene:irene |
| SSH key 분리 분석 | id_ed25519 (POS, Apr 8) 보존 + 새 키 생성 시도 → 모델 B 확정으로 키 불필요 → 삭제. dev 공개키 ~/.ssh/authorized_keys 등록 확인 |
| MySQL | planq_prod_db + planq_admin@localhost (Irene SSH 직접 sudo mysql 실행) |
| DB 비밀번호 | openssl rand -base64 24 → /opt/planq/.db-password (mode 600) |
| DNS | planq.kr / www.planq.kr → 87.106.78.146 (Irene 등록, propagation 대기) |
| .env 자동 채움 | PORT=3004 (POS 3002 충돌 회피), DB_PASSWORD, JWT 2개, INTERNAL_API_KEY, VAPID 쌍 + dev 직접 박은 5개 = 13항목 입력 완료. chmod 600 |
| 남은 placeholder | PLANQ_BILLING_BANK_* (skip — platform_settings 사이클로 이전), GOOGLE_CLIENT_* (선택), PORTONE_* (K 사이클) |

### 4. 핵심 결정 (메모리 반영 필요)

- **운영서버 = dev 정확 복사** — 운영 전용 별도 코드/정보 없음
- **운영 정보는 모두 DB + 관리자 UI** — `.env` 는 시크릿만, 회사명/SMTP_FROM/은행계좌/플랫폼 정보는 platform_settings 테이블 + 플랫폼 관리자 페이지
- 은행계좌 입력은 첫 배포 후 platform_settings 사이클 (반나절) 에서 처리

### 5. 검증

- 헬스체크 27/27 통과
- 빌드 OK (commit 6c34535, exit 0, 2.06s)
- dev → 운영 SSH 도달 OK
- deploy-planq.sh dry-run 모든 단계 정상

### 다음 세션 즉시 액션

1. **운영서버 Claude:** nginx site 설치 (`/opt/planq/scripts/nginx-planq.kr.conf` root → frontend-build, port → 3004 수정 후 sites-available 배치 + reload) + PM2 ecosystem 수정 + DNS propagation 확인 후 certbot
2. **dev Claude:** 운영서버 신호 받으면 `./scripts/deploy-planq.sh` 첫 실배포
3. 검증 (https://planq.kr/api/health + 회원가입 E2E)

---

## ✅ 완료: Q-A~Q-G 대규모 사이클 (2026-04-30)

대규모 다중 사이클 — mock 정리부터 통계 6탭까지 한 세션에 진행.

### Q-A 정리 사이클 — production 정합성

| 영역 | 산출물 |
|------|--------|
| QTalk mock 제거 | `pages/QTalk/mock.ts` (377줄) + `QDataContext.tsx` (402줄) 삭제, `types.ts` 신규 — production 코드에서 mock 100% 제거 |
| 사용자 노출 엔지니어링 용어 정리 | `SettingsTab.tsx:246` "Phase E", `DashboardPage.tsx:12` "Phase 1·Phase 4" → 사용자 친화 텍스트 |
| ProfilePage i18n 마감 | 언어 레벨 섹션 (line 632-705) + LEVEL_OPTIONS 6 + ExpertiseBtn — 모두 ko/en t() |
| RightPanel 표준 라벨 통일 | `taskStatusLabel/Color` → `utils/taskLabel.ts` `STATUS_COLOR` + `getStatusLabel('observer')` |
| LeftPanel border 표준 색 | `#F1F5F9` → `#E2E8F0` |

### Q-B 보안 사이클

| 영역 | 산출물 |
|------|--------|
| `checkBusinessAccess` IDOR 강화 | URL path 만 신뢰 (body/query 폴백 제거), NaN 가드, `req.businessId` 노출 |
| auth.js 회원가입 race | `SequelizeUniqueConstraintError` catch → 표준 409 응답 |
| Refresh token cookie 정합성 | logout 시 `path=/api/auth` + `path=/` 둘 다 clearCookie |
| Invoices SQL injection 청소 | `sequelize.literal` → `fn('JSON_EXTRACT', col('meta'), '$.invoice_id')` parameterized |
| Platform admin businessRole 명시 | `req.businessRole='owner'` set — 라우트가 가정 시 undefined 가드 |

### Q-C Push + 메일 사이클

| 영역 | 산출물 |
|------|--------|
| Web Push VAPID 활성 | `.env` VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT — Irene 1회 입력 후 즉시 작동 |
| EmailLog 모니터링 | `models/EmailLog.js` (status/error_message/template/retry_count) + `services/emailService.recordLog()` 자동 통합 |
| 관리자 메일 모니터링 페이지 | `routes/admin.js` GET /email-logs + retry endpoint, `pages/Admin/AdminEmailLogsPage.tsx` |
| 알림 매트릭스 UI | ProfilePage `NotificationPrefsCard` (7 event × 4 channel = 28 토글), `NotificationPref` ENUM 'push' 추가 |
| 좌측 nav 메뉴 추가 | 메일 모니터링 항목 (admin) |

### Dashboard + UserChip + 로고 사이클

| 영역 | 산출물 |
|------|--------|
| Dashboard 위젯 페이지 | placeholder 32줄 → 위젯 그리드 (인박스 카드 + 4 액션 + 미리보기 5건 + 이번주 일정) |
| UserChip 우측 상단 | `Layout/UserChip.tsx` 신규, PageShell 헤더 우측 모든 페이지 자동 노출, 클릭 → /profile |
| 로고 4종 적용 | favicon.svg + apple-touch-icon.png + icon-192/512.png (puppeteer SVG→PNG) + planQ-slogan_white.svg (LoginPage·Sidebar) + planQ_white.svg (랜딩 백업) + planQ-slogan_color.svg (백업) |
| manifest.json | PWA 아이콘 4종 + share_target |

### PWA Install + Share Target 사이클

| 영역 | 산출물 |
|------|--------|
| InstallPromptBanner | `components/Common/InstallPromptBanner.tsx` — Android `beforeinstallprompt` + iOS 단계 안내 + standalone 자동 감지 + 7일 dismiss |
| 알림 권한 prompt | PWA 설치 후 `Notification.requestPermission` + `subscribePush` 1탭 활성 |
| PWA Share Target | manifest `share_target` GET / `pages/ShareReceive/ShareReceivePage.tsx` (title·text·url 받음 → 채팅·업무·메모·문서 4 카드 분기) |
| prefill 핸들러 | ChatPanel + QTaskPage `?prefill=` 자동 input 채움 |

### Q-G Insights (통계·분석) 6탭 풀 구현

설계 문서 `docs/INSIGHTS_DESIGN.md` 신규 작성 — 30년차 임원급 (서비스 기획자 + 글로벌 컨설턴트 + UI/UX) 통합.

| 탭 | 백엔드 | 프론트 | 핵심 차트 |
|----|--------|--------|---------|
| Overview | `buildOverviewTab` | `OverviewTab.tsx` | 인사이트 + KPI 6 + 12개월 매출·이익 라인 |
| Tasks & Time ★ | `buildTasksTab` | `TasksTab.tsx` | 인사이트 + KPI 6 + Scatter (예측vs실제) + AI MAPE Line |
| Profit | `buildProfitTab` | `ProfitTab.tsx` | 프로젝트 손익 Bubble + 테이블 |
| Team | `buildTeamTab` | `TeamTab.tsx` | 직원별 가동률 Bar + 순위 테이블 |
| Finance | `buildFinanceTab` | `FinanceTab.tsx` | 카테고리별 지출 Bar |
| Reports | `buildReportsTab` | `ReportsTab.tsx` | 자동 생성 안내 + PDF 카드 그리드 |

추가:
- **CSV (Excel) 다운로드** 5탭 모두 (UTF-8 BOM, 한글 깨짐 방지) — `csvUtils.ts`
- **인사이트 박스 가로 inline 1줄** — Irene 피드백 (좌우 여백 최소화)
- 라우트: `/stats/:tab` 단일 dynamic path (이전 6 명시 라우트 → ComingSoonPage 가렸던 버그 fix)
- `useParams<{tab}>` 분기로 6 페이지 독립 컴포넌트 마운트
- 신규 endpoint: `/api/stats/:businessId/{overview,tasks,profit,team,finance,reports}` (`/api/insights/*` Cue 인박스 카드와 분리)

### I4 RevisionPanel inline diff 보강

| 영역 | 산출물 |
|------|--------|
| `RevisionPanel.tsx` | `splitInlineDiff` (공통 prefix/suffix 검출) + `bodyTextLength` + DeltaPill (+N/-N) + `renderFormDataChange` (form_data 풀어서 sub-key 별 표시) + `countActualChanges` |

### P8.1 Cue 결과 표시 UI

| 영역 | 산출물 |
|------|--------|
| `routes/tasks.js` `buildCueMeta` | task.cue_kind 있을 때 sources resolve (conversation/post/kb_doc/meeting) + 최근 cue.task_executed/failed/skipped audit |
| 신규 `POST /:id/cue/rerun` | 재실행 endpoint (member 권한, 이미 sent 면 400) |
| `TaskDetailDrawer.tsx` | Cue 섹션 (★ 뱃지 + Kind 라벨 + 재실행 버튼 + 출처 chip + 마지막 이벤트 dot) |

### 수정된 파일 (이번 세션)

신규:
- `docs/INSIGHTS_DESIGN.md`
- `dev-backend/routes/stats.js`, `dev-backend/services/stats.js`
- `dev-backend/models/EmailLog.js`
- `dev-backend/scripts/svg-to-png.js`
- `dev-frontend/src/pages/Insights/{InsightsPage.tsx, components.tsx, csvUtils.ts}` + `tabs/{OverviewTab, TasksTab, ProfitTab, TeamTab, FinanceTab, ReportsTab}.tsx`
- `dev-frontend/src/pages/Admin/AdminEmailLogsPage.tsx`
- `dev-frontend/src/pages/ShareReceive/ShareReceivePage.tsx`
- `dev-frontend/src/components/Layout/UserChip.tsx`
- `dev-frontend/src/components/Common/InstallPromptBanner.tsx`
- `dev-frontend/src/services/insights.ts`, `dev-frontend/src/pages/QTalk/types.ts`
- `dev-frontend/public/{favicon.svg, planQ-slogan_white.svg, planQ_white.svg, planQ-slogan_color.svg, icon-192.png, icon-512.png, apple-touch-icon.png}`
- 메모리: `project_insights_design.md`, `project_pwa_share_target_pending.md` → 활성 / `project_web_push_pending.md` → 활성, `project_share_token_expiry_pending.md`

삭제:
- `dev-frontend/src/pages/QTalk/mock.ts`, `QDataContext.tsx`

수정:
- middleware/auth.js (IDOR 강화)
- routes/auth.js (race), routes/invoices.js (literal→fn), routes/tasks.js (cue/rerun + buildCueMeta)
- services/emailService.js (recordLog), services/cue_task_executor.js
- 모델 다수 (NotificationPref ENUM, EmailLog 등록)
- 프론트: ProfilePage, ClientsPage, QProjectDetailPage (AutoSaveField), QBill SettingsTab/NewInvoiceModal (canTax 통화 조건), Dashboard 4건 수정 + 리디자인, MainLayout (UserChip, 로고, 메일 모니터링 nav), App.tsx (라우트 정리), index.html, manifest.json
- i18n 19 네임스페이스 ko/en 모두

### 빌드 / 검증
- 마지막 빌드: exit 0 (1.91s)
- 헬스체크: 27/27 통과 (반복)
- 신규 endpoint 6 (stats) + 1 (cue rerun) + 1 (admin/email-logs) + 1 (admin/email-logs/:id/retry) 모두 E2E 통과

---

## ✅ 완료: N 사이클 운영 배포 + P8 Cue 자동실행 + Q Project 카드 재설계 + 피드백/RevisionPanel (2026-04-29)

### 1. N 사이클 — 운영 배포 스크립트 (운영 진입 직전 인프라)

| 영역 | 산출물 |
|------|--------|
| 배포 스크립트 | `scripts/deploy-prod.sh` — dev → prod rsync + pm2 reload 자동화 |
| 환경 템플릿 | `dev-backend/.env.production.example` — 운영 진입 시 Irene 채울 placeholder |
| nginx 설정 | `scripts/nginx-planq.kr.conf` — planq.kr/dev.planq.kr 사이트 config (HTML no-cache 포함) |
| PM2 ecosystem | `scripts/prod-ecosystem.config.js` — dev/prod 인스턴스 분리 |

### 2. P8 — Cue Teammate-ification (Cue 가 진짜 팀원처럼 업무 받음)

| 영역 | 핵심 |
|------|------|
| DB | `Task.cue_kind` ENUM (summarize/draft_reply/categorize/research) + `cue_context_ref` JSON |
| 신규 서비스 `cue_task_executor.js` | 4종 자동 실행 엔진 — body 에 결과 저장 + status='reviewing' 전환 |
| Hook | `routes/tasks.js` POST 시 `assignee_id === business.cue_user_id && cue_kind` → setImmediate executeForTask |
| UI | `QTaskPage.tsx` 멤버 fetch 에서 `is_ai` 필터 제거 — Cue 가 담당자 셀렉트에 노출 |

### 3. Q Project 페이지 카드 30년차 디자인급 재설계

| 영역 | 핵심 |
|------|------|
| 카드 구조 | `<CardHead>` + `<ClientLine>` + `<Description>` + `<BottomStack>` (margin-top:auto) |
| BottomStack 통합 | 단일 상단 구분선 + 일관 10px gap → 진행률·기간·사람 블록 카드 바닥 정렬 |
| 시각 위계 | ProgressBlock (bar + % + 4/19 + Overdue ⚠) → MetaLine (📅 기간 + D-day color-coded + 🕐 활동) → PeopleRow (★ PM + Avatar stack + 고객 chip) |
| D-day color | 초과 빨강 / 7일 이내 노랑 / 그 외 teal |
| 컬러 정렬 | `QProjectDetailPage.tsx` 색상 동그라미 좌측 정렬 (justify-content: flex-start + flex-wrap) |
| 컬러 피커 | `NewProjectModal.tsx` SwatchRow 아래 native HexRow + hex 텍스트 입력 (자유 색상) |
| `is_ai` 필터 제거 | bizMembers 에서 Cue 도 Default/PM 후보로 노출 |

### 4. 피드백 시스템 (사용자 피드백 수집)

| 영역 | 산출물 |
|------|--------|
| DB | `models/FeedbackItem.js` — user × type × content × status |
| API | `routes/feedback.js` — POST/GET/PATCH (admin) |
| UI | `pages/Admin/AdminFeedbackPage.tsx` — 플랫폼 admin 전용 피드백 리스트/상태 변경 |

### 5. I4 슬롯 revision diff (Q docs 사용성)

| 영역 | 산출물 |
|------|--------|
| UI | `components/Docs/RevisionPanel.tsx` — DocumentRevision 기반 슬롯값 변경 이력 시각화 |

### 수정된 파일 (이번 세션)
- 신규: `dev-backend/services/cue_task_executor.js`, `dev-backend/models/FeedbackItem.js`, `dev-backend/routes/feedback.js`, `dev-frontend/src/components/Docs/RevisionPanel.tsx`, `dev-frontend/src/pages/Admin/AdminFeedbackPage.tsx`, `scripts/deploy-prod.sh`, `scripts/nginx-planq.kr.conf`, `scripts/prod-ecosystem.config.js`, `dev-backend/.env.production.example`
- 수정: `dev-backend/models/Task.js` (cue_kind/cue_context_ref), `dev-backend/routes/tasks.js` (Cue executor hook), `dev-frontend/src/pages/QTask/QTaskPage.tsx` (is_ai filter 제거), `dev-frontend/src/pages/QProject/QProjectPage.tsx` (카드 재설계 + BottomStack), `dev-frontend/src/pages/QProject/QProjectDetailPage.tsx` (컬러 좌측정렬 + is_ai filter 제거), `dev-frontend/src/pages/QTalk/NewProjectModal.tsx` (HexRow), `dev-frontend/public/locales/{ko,en}/qproject.json`, `dev-frontend/public/locales/{ko,en}/qtalk.json`

### 빌드 / 검증
- 마지막 빌드: exit 0
- 헬스체크: 27/27 통과

---

## ✅ 완료: Q Task "My week" overdue 버그 수정 + dashboard todo 보안 수정 (2026-04-29)

### 버그 수정 2건

| 버그 | 원인 | 수정 |
|------|------|------|
| **Q Task "My week" 탭에 overdue 업무 미표시** | `inPeriod` 필터가 "기간과 겹치는" 업무만 포함 → 마감일 지난 미완료 업무 제외됨 | `isOverdue = e && e < todayStr` 조건 추가 → overdue 업무 항상 표시 |
| **Dashboard todo API 보안 불일치** | 단일 business_id 호출 시 `removed_at` 체크 누락 → 제거된 멤버도 데이터 접근 가능 | `removed_at: null` 조건 추가 + Client 테이블 fallback 체크 |

### 수정된 파일
- `dev-frontend/src/pages/QTask/QTaskPage.tsx` (632번 줄 — overdue 포함 로직)
- `dev-backend/routes/dashboard.js` (655-661번 줄 — removed_at + client 체크)

### 빌드
- `index-D6xj1G7z.js` (1.37s, 타입에러 0)

---

## ✅ 완료: P-0+ Q talk 번역 + 채팅 설정 + P-1.1 인박스 카운트 + 영어 샘플 시드 + 번역 안정화 (2026-04-28)

대규모 마라톤 세션. 핵심 묶음:

### 1. Q talk 메시지 번역 (Q note 패턴)

| 영역 | 핵심 |
|------|------|
| DB | `Conversation.translation_enabled` + `translation_languages JSON` / `Message.translations JSON` + `detected_language` |
| 신규 서비스 `translation_service.js` | gpt-4o-mini · 5종 (KO/EN/JA/ZH/ES) · 2-원소 + 서로 다른 언어 강제 검증 |
| **비동기 번역** | 메시지 발송 60ms 즉시 응답 (이전 1~3초) → setImmediate 백그라운드 LLM → `message:translated` + `message:updated` Socket.IO push |
| **JSON parse 안전** | raw newline / control char / 빈 응답 sanitize + 1회 자동 재시도 (`translateWithRetry`) |
| **max_tokens 적정화** | min 400 / max 2000 / `length×4 + 200` — 짧은 메시지 응답 잘림 방지 |
| ChatPanel | `TranslatedText` 옅은 회색 박스 + `white-space:pre-wrap` 줄바꿈 보존 + IIFE robust fallback (detected_language 없어도 다른 키 자동) |
| 폴링 fallback | 메시지 발송 4초 후 자동 GET — Socket.IO 못 받아도 보장 |
| Cue 응답 번역 | cue_orchestrator hook 동일 적용 (사용자/AI 일관성) |
| 스크롤 정책 | 진입 시 무조건 마지막 + 본인 메시지 무조건 sticky + 번역 도착 200px 이내면 자동 따라감 |

### 2. 채팅 설정 통합 + NewChatModal 정비

- **신규 `ChatSettingsModal.tsx`** — 기본 (프로젝트 read-only) + 번역 + 자동추출 + 참여자 추가/제거 (실시간 fetch). standalone 대화도 PATCH 허용
- NewChatModal 디폴트 → 항상 미연결 (preselectedProjectId 무시)
- NewChatModal 에 번역/자동추출 토글 + 언어 선택 추가
- 독립 채팅 그룹 분리 — channels filter standalone 묶임 fix

### 3. P-1.1 좌측 nav 인박스 카운트 배지

- `hooks/useInboxCount.ts` — fetchTodo + Socket.IO `inbox:refresh`
- MainLayout NavItem `InboxBadge` (확장 pill / collapsed dot, Coral, 0 숨김, 99+)

### 4. 영어 샘플 시드 (워크스페이스 3 / project 70 신규)

- 프로젝트 **International Onboarding 2026 Q2** (Acme Global, fixed milestone, 8주)
- 캘린더 8 / 업무 20 / 노트 3
- 거래 stage 영어 라벨 (Issue Quote → Sign Contract → Invoice & Payment → Issue Tax Invoice)

### 5. 인프라 fix

- **nginx HTML `Cache-Control: no-cache`** 추가 → 사용자 브라우저 옛 번들 stale 캐시 근본 해결
- memberOptions null user 방어 (탈퇴/삭제 멤버) → ChatSettingsModal TypeError 해소
- standalone 대화 PATCH `not_a_project_channel` 차단 → `loadStandaloneConvOrForbidden` fallback 추가
- PostsPage `projectId` 미전달 → 추가

### 사용자 피드백 대응 (이번 세션, 13건+)

1. mock 절대 금지 명문화 (이전 라운드 유지)
2. AI 문서 client/project 강제 → 롤백 (선택)
3. 채팅 path-param 진입 시 빈 화면 → useParams + 정규화
4. 디폴트 프로젝트 연결 X
5. 엔터값/줄바꿈 보존 (white-space pre-wrap)
6. 채팅 클릭 시 마지막 메시지 기준
7. 번역 빈 응답 (영→한 ko ""): retry + 프롬프트 강화
8. 번역 도착 시 가려지지 않게 sticky-to-bottom
9. 독립 채팅 묶임 분리
10. 좌측 nav 인박스 카운트 표시
11. 영어 시드 (프로젝트 + 캘린더 + 업무)
12. 거래 stage 영어 라벨
13. Profile/ID 시스템 신청 (다음 세션 P-1.5)

### 신규 파일
- Backend: `services/translation_service.js`
- Frontend: `hooks/useInboxCount.ts`, `pages/QTalk/ChatSettingsModal.tsx`

### 검증
- 헬스체크 27/27 (라운드별 반복 PASS)
- 번역 E2E: 한↔영 / 줄바꿈 / 번호 / 이모지 / 짧은 메시지 / max_tokens / 빈 응답 재시도 / 사용자 동일 케이스 모두 PASS
- ChatSettingsModal E2E 12/12 + 후속 6/6
- NewChatModal E2E 4/4
- 영어 시드: 프로젝트 70 + 캘린더 8 + 업무 20 + 노트 3 + stage 4 라벨

### 빌드 (이번 세션 누적)
DVxZLkcy → DVPO91YA → D4hYsYSx → 9hEw4WII → Di7M1zvg → Dx49pBv4 → reYADfw- → ikmafdzy 등 — 모두 1.3~1.7s, 타입에러 0

---


>
> **상세 할일 리스트:** `.claude/session-state.md` "할일 리스트 (P-1 ~ P-7)" 섹션 참조

---

## ✅ 완료: P-0 운영 안정화 4건 + 디자인 통일 (2026-04-28)

세션 중반 사용자 발견·요청에 따른 운영 안정화 묶음. 각 항목 E2E 검증 + 9단계 종합 검증 완료.

### 4 fix

| # | 항목 | 핵심 |
|---|------|------|
| #1 | 채팅방 카드 렌더 빈 화면 | `QTalkPage` 가 `useParams` 미사용 → `/talk/:convId` 진입 시 activeConv null 로 EmptyState 노출 (사용자 "하얀 화면"). useParams 추가 + URL `/talk` 정규화 + conv→project 자동 매핑 |
| #2 | AI 문서 client/project 연결 | 1차 강제 (`client_required` 400) → 사용자 피드백 ("필수 아니지, 템플릿마다 다른데") → **롤백**. PostAiModal 에 페이지 컨텍스트(`projectId`) prop + workspace 스코프엔 optional selector + "현재 페이지 컨텍스트로 연결됨" 배지 |
| #3 | 업무 추출 히스토리 차단 | `task_extractor.js` 후처리에 차단 목록 추가 — `Task.source_message_id` + `TaskCandidate(status registered/merged/rejected).source_message_ids` 기반. LLM 결과에서 source 가 ⊆ blockedIds 면 폐기 |
| #4 | 파일 공유 링크 + 대량 ZIP (multi-source) | `File.share_token` 컬럼 + archiver. 4 라우트: POST/DELETE share-link, GET public/:token/download (인증 X), POST bulk-download. **direct + chat MessageAttachment + task TaskAttachment** 묶기 (post/meeting 후속) |
| 디자인 | BulkBar 통일 (UI_DESIGN_GUIDE 1.7 준수) | 검은 배경 (`#0F172A`) → 흰 배경 + 옅은 테두리, 삭제 빨간 배경 (`#DC2626`) → outline, ZIP 다운로드 → Primary teal |

### 신규 컬럼·라우트 (요약)

**Backend**
- `files.share_token VARCHAR(64) UNIQUE`, `files.share_expires_at`, `files.share_created_at` (idx)
- `routes/files.js`: `POST /:bizId/:id/share-link`, `DELETE /:bizId/:id/share-link`, `GET /public/:token/download`, `POST /:bizId/bulk-download` (composite ID)
- `services/task_extractor.js`: 후처리 차단 목록 (resolved candidate + task source)
- `routes/docs.js`: `buildTemplateContext` 시그니처 확장 (projectId 추가) + ProjectClient 자동 매핑

**Frontend**
- `services/files.ts`: `createShareLink`, `revokeShareLink`, `bulkDownloadZip` (composite ID 통과)
- `pages/QTalk/QTalkPage.tsx`: `useParams` 추가 + URL 정규화 + conv→project 자동 effect
- `components/Docs/PostAiModal.tsx`: projectId/clientId props + workspace optional selector + ContextBadge
- `pages/QProject/DocsTab.tsx`: BulkBar 디자인 토큰 통일 + 공유링크/ZIP 버튼 + downloadable filter (direct/chat/task)

### 검증
- ✅ 헬스체크 27/27
- ✅ E2E 통합 14/14
- ✅ 9단계 검증 (빌드·API·렌더·유저흐름·요구사항·연관영향·UI/UX·크로스페이지)
- ✅ Multi-source ZIP 검증 (direct + task 첨부 386KB)
- ✅ 부적합 1건 발견·즉시 수정 (PostsPage projectId 미전달)
- ✅ 빌드 `index-DVxZLkcy.js`
- ✅ mock 잔존 0건, 한국어 하드코딩 0건 (수정 파일 기준)

### 신규 패키지
- `archiver` (백엔드, ZIP 스트리밍)

---



---

## ✅ 완료: Phase D+1·D+2 + 외화 인프라 + 설정 통합 + Phase E (2026-04-27)

대규모 세션. 거래 시퀀스 자동 진행 엔진 → 외화 결제 인프라 → 설정 통합 → PDF/메일/알림 매트릭스 한 묶음.

### Phase D+1 — 거래 시퀀스 자동 진행 엔진

| 영역 | 내용 | 상태 |
|------|------|:----:|
| **신규 모델** | `ProjectStage` (project_id, order_index, kind, label, status, linked_entity_*, metadata, is_template_seeded) | ✅ |
| **4 템플릿** | fixed (견적→계약→청구→세금계산서) / subscription (계약→월별) / consulting (제안→SOW→회차) / custom (빈) | ✅ |
| **자동 진행 엔진** | `services/projectStageEngine.js` — entity 상태 기반 멱등 재계산 | ✅ |
| **Hooks** | post create/update · signature sign/reject · invoice send/mark-paid/unmark-paid/PATCH/mark-tax 모두 연결 | ✅ |
| **next_action** | 현재 active stage 분석 → "지금 무엇 할지" + 액션 링크 (프로젝트 스코프) | ✅ |
| **TransactionsTab** | 다음 할 일 카드 + 단계 보드 (4 dot + 연결선 + glow active) + 요약 + 문서·청구서·타임라인 | ✅ |
| **레거시 lazy seed** | stage 0개 프로젝트는 GET /transactions 첫 호출 시 자동 시드 | ✅ |
| **세금계산서 자동 skip** | 한국 사업자 (`is_business=true && country='KR'`) 만 활성. 해외/개인 자동 skipped | ✅ |

### Phase D+2 — 거래 stage 사용자 정의 UI

| 영역 | 내용 | 상태 |
|------|------|:----:|
| **신규 라우트** | `POST /api/projects/:id/stages/:stageId/move` (트랜잭션 swap) | ✅ |
| **편집 모드** | StageBoard 헤더 ✏️ 토글 → row 형식 (label input + ↑↓ + 🗑) | ✅ |
| **단계 추가** | "+ 단계 추가" 카드 → inline input → POST stages (kind='custom') | ✅ |
| **삭제 차단** | template_seeded 자물쇠 아이콘 (custom 만 🗑) | ✅ |
| **수동 토글** | read-only 모드의 custom stage dot 클릭 → status 토글 | ✅ |
| **권한** | client 는 편집 토글 안 보임 (백엔드 role 가드와 일치) | ✅ |

### 외화 결제 인프라

| 영역 | 내용 | 상태 |
|------|------|:----:|
| **Business 컬럼** | swift_code · bank_name_en · bank_account_name_en | ✅ |
| **통화 5종 활성** | KRW/USD/EUR/JPY/CNY (NewInvoiceModal + SettingsTab) | ✅ |
| **입금 계좌 통합** | 한국 정보 + SWIFT/영문 정보 한 섹션 (분리 X) | ✅ |
| **공개 결제 페이지** | `currency !== 'KRW'` 면 SWIFT/영문 자동 노출 | ✅ |
| **PDF 영문 모드** | 외화 invoice PDF 자동 영문 (Bill To/Wire Transfer/Subtotal) | ✅ |

### 설정 통합 (`/business/settings/*`)

| 영역 | 내용 | 상태 |
|------|------|:----:|
| **Q Bill SettingsTab → 통합** | `/bills?tab=settings` 자동 redirect → `/business/settings/billing` | ✅ |
| **신규 secondary nav** | 청구 설정 (영수증 아이콘) · 이메일 (편지) · 알림 (벨) | ✅ |
| **워크스페이스 아이콘** | 톱니바퀴 → 회사 건물 (IconBuilding) | ✅ |
| **청구·플랜 아이콘 차별화** | 청구=영수증, 구독=신용카드 | ✅ |

### Phase E — PDF · 메일 · 알림 매트릭스

| 영역 | 내용 | 상태 |
|------|------|:----:|
| **PDF 인프라** | Puppeteer 싱글톤 + invoice/post 템플릿 (외화면 영문) | ✅ |
| **PDF 라우트 4종** | 멤버 invoice/post + 익명 invoice/post | ✅ |
| **메일 첨부** | invoice send 시 PDF 자동 첨부 | ✅ |
| **PDF 다운로드 버튼** | InvoiceDetailDrawer · PublicInvoicePage · PublicPostPage | ✅ |
| **메일 발신자** | Business.mail_from_name + mail_reply_to + EmailSettings UI | ✅ |
| **NotificationPref 모델** | user × business × event × channel × enabled (기본 ON) | ✅ |
| **21 토글 매트릭스** | 7 이벤트 × 3 채널 NotificationSettings UI | ✅ |
| **isAllowed helper** | 발송 시점 prefs 차단 검사 export | ✅ |

### 사용자 지적 대응 (다수)

1. 거래 탭 stage 라인 끊김 → grid + ::after pseudo-element 로 connector 재설계
2. 거래 → 새 문서 자동 연결 → `/projects/p/X?tab=docs&new=1&category=...` 프로젝트 스코프
3. 프로젝트>문서 탭에 AI/템플릿 버튼 추가
4. 모달이 list 모드 return 블록 밖에 있어 안 보이는 버그 fix (PostAiModal + 템플릿 모달)
5. 청구 설정 visibleTabs 누락 fix (`brand` 로 떨어지던 버그)
6. 발신자 정보 redundancy 제거 (워크스페이스 법인 정보로 통합)
7. 통화/은행/세금계산서 멘탈 모델 정리 — 통화는 표기, 입금은 단일, 세금계산서는 결제자 기준
8. EmailSettings/NotificationSettings placeholder 자연 언어로 정정 ("Phase E 에서 제공 예정" → "준비 중")
9. 워크스페이스/청구 설정/구독 플랜 아이콘 차별화

### 채팅방 가기 버튼 4 지점

PostShareModal · PostSignatureModal · NewInvoiceModal · InvoiceDetailDrawer 모두 발송 후 결과 화면 또는 액션바에 채팅방 이동 버튼.

### 업무 추출 정확도 (Phase D1 보완)

- 카드 메시지 (`kind='card'`) 추출 제외 → "표준 견적서 작성" 같은 오추출 방지
- 채팅방 상단 배너 "확인하기/나중에" 제거 → X 닫기만 (이미 우측 패널 열려있어 redundant)

### 검증 누적 (이번 세션)

- 헬스체크 27/27 (모든 단계 통과)
- D+1 자동 진행 E2E 14/14
- D+2 stage 편집 E2E 18/18
- Phase E (PDF/메일/알림) E2E 17/17
- 최종 통합 회귀 22/22
- 빌드 통과 (`index-D8MbLadb.js`)
- mock 잔존 0건, 한국어 하드코딩 (신규 라인) 0건

### 신규 파일 (12)

**Backend (5)**:
- `models/ProjectStage.js`, `models/NotificationPref.js`
- `routes/notifications.js`
- `services/projectStageEngine.js`, `services/pdfService.js`, `services/pdfTemplates.js`

**Frontend (7)**:
- `pages/QProject/TransactionsTab.tsx`
- `pages/QBill/PublicInvoicePage.tsx`
- `pages/Settings/BillingSettings.tsx`, `EmailSettings.tsx`, `NotificationSettings.tsx`

### 수정된 파일 통계

51 파일 변경 (+3,693 / -235 라인)

### 신규 패키지

- `puppeteer` (백엔드, PDF 생성)

### 신규 메모리

- `project_phase_e_complete.md` — PDF/메일/알림 인프라 노트
- `project_project_stages.md` — ProjectStage 4 템플릿 + 자동 진행 엔진
- `feedback_user_facing_copy.md` — 사용자 노출 문구 자연 언어 원칙
- `feedback_currency_vs_bank.md` — 통화·은행·세금계산서 분리 멘탈 모델
- `feedback_tab_layout_unify.md` — 탭 레이아웃 스코프 통일

### 다음 작업 (우선순위)

| 옵션 | 내용 | 추정 |
|---|---|:--:|
| **C** | Phase F — Q docs 슬롯 시스템 (영문 계약/견적 자동 채움) | ~5일 |
| **B** | SMTP 운영 연결 (.env SMTP_HOST/USER 결정 + 도메인 인증) | ~1일 |
| **D** | Phase 8 — 반응형 일괄 스프린트 | ~5일 |

---

## ✅ 완료: Q Bill B2 정석 개발 — 견적 폐기 + 5탭 재정의 + 청구서↔출처 연결 + 채팅방 자동 + 발송 통합 + 실 API + mock 절대 금지 명문화 (2026-04-27)

대규모 세션. 사용자 합의 ("MVP가 아니다, 실데이터 정석") 에 따라 Q Bill 전 영역 mock 제거 + 백엔드 라우트 강화 + 4번의 사용자 지적 즉시 반영 + CLAUDE.md mock 금지 강제.

### 사용자 지적 4건 — 모두 즉시 반영
| 지적 | 반영 |
|------|------|
| "청구서와 계약서/문서 연결돼야 해" | `invoices.source_post_id` FK + 발행 모달에서 client별 출처 자동 표시 + 상세에 출처 카드 |
| "발행하고 보내기 어디로 가는 거야?" | 모달 푸터에 "발행 후: 💬 [채팅방명] · ✉ [이메일]" 명시 |
| "채팅 보내기 = 관련 채팅방 먼저 떠야지, 또 생성해서 보내?" | `findConversationForClient` 자동 검색 (project 우선 → client 단독), 없으면 안내 (새 방 생성 X) |
| "발신자 정보가 워크스페이스에서 가져오는 거 아니야? 모든 데이터 실데이터야?" | mock.ts 통째로 삭제 + 5탭 모두 실 API + Business 모델 default_due_days/default_currency 컬럼 추가 + Q Bill 설정에서 인라인 편집 |

### Q Bill 5탭 재정의 (견적서 폐기)
| 탭 | 변경 |
|------|------|
| 견적서 | **폐기** (Q docs로 이동) — `QuotesTab.tsx`/`QuoteEditor.tsx`/`mock.ts`/`ComingSoonTab.tsx` 삭제 |
| 개요 | 실 invoices 합산 KPI (매출/미수금/발행대기/세금계산서대기) + 12개월 매출 차트 + 미수금 TOP + 최근 활동 |
| 청구서 | 검색 + 상태 chip 필터 + 분할 진행 dot + 우측 상세 드로어 |
| 결제 추적 | 회차별 임박/완료/전체 그리드 (실 invoices) |
| 세금계산서 | 사업자 고객만 필터, 결제완료 회차 큐 + 발행번호 마킹 모달 |
| 설정 | 발신자 정보(read-only) + 입금 계좌(인라인 편집) + 청구서 기본값(인라인 편집) |

### 백엔드 (정석)
| 영역 | 작업 |
|------|------|
| **DB** | `invoices.source_post_id INT FK posts(id)` + index · `businesses.default_due_days INT default 14` · `businesses.default_currency VARCHAR(3) default 'KRW'` |
| **Invoice 모델** | `source_post_id` + `belongsTo(Post, as: 'sourcePost')` 양방향 association |
| **POST /api/invoices/:bid** | `source_post_id` 검증 (같은 business + published) · `project_id`/`currency` 받아 저장 · 응답에 `sourcePost` include · 분할 시 `milestone_ref` 저장 (이전 누락 수정) |
| **GET /api/invoices/:bid 목록·상세** | `Client(biz_*)` + `installments` + `sourcePost(category)` 풀세트 include |
| **POST /:id/send** | `send_chat`/`send_email`/`message` 옵션. Conversation 자동 검색 (project 우선) → 결제 요청 카드 메시지 (Message.kind='card', meta.card_type='invoice'). 이메일 발송 (recipient_email → tax_invoice_email → billing_contact_email → invite_email 우선순위) |
| **GET /:bid/source-candidates** | published post 후보 (category 필터 가능) |
| **GET /:bid/find-conversation** | client_id (+ project_id) 기존 conversation 검색, 없으면 `suggest_create: true` |
| **PUT /:bid/billing** | bank_name/bank_account_number/bank_account_name + default_due_days/default_vat_rate/default_currency 인라인 편집 (범위 검증 포함) |
| **emailService.sendInvoiceEmail** | HTML 템플릿 + 결제기한 표시 + 공개 링크 버튼 |

### 프론트 (정석 — mock 0건)
| 파일 | 상태 |
|------|------|
| `services/invoices.ts` (신규) | 17 함수 + 타입 (list/get/create/send/markPaid/unmarkPaid/markTax/cancel/cancelInst/updateStatus/listSource/findConv/listClients/getBusinessInfo/updateBusinessBilling + formatMoney/invoiceStatusColor/installmentStatusColor/countByStatus/missingClientBizFields) |
| `InvoicesTab` | 실 API list + 검색/필터 + reload + URL 싱크 |
| `InvoiceDetailDrawer` | 실 API get + **모든 액션 실연결** (markPaid·unmarkPaid·markTax·cancelInst·cancelInvoice·copyShareLink) + ConfirmDialog + 세금계산서 마킹 모달 (window.prompt 폐기) + 출처 문서 카드 |
| `NewInvoiceModal` | 실 API + Business prefill (default_due_days/vat_rate/currency) + Client 목록 fetch + 출처 후보 자동 표시 + 채팅방 자동 검색 + 발송 옵션 통합 (3카드 폐기) + 누락 사업자정보 인라인 보완 |
| `OverviewTab` | 실 invoices 합산 KPI + 12개월 매출 차트 + 미수금 TOP + 최근 활동 |
| `PaymentsTab` | 실 invoices에서 회차/단일 union, 행 클릭 시 청구서 상세 |
| `TaxInvoicesTab` | 사업자 고객만 필터 + 결제완료 회차 큐 + 발행번호 마킹 실연결 |
| `SettingsTab` | 발신자 정보 read-only (1개 진입점만) + 입금 계좌 + 청구서 기본값 인라인 편집 (AutoSaveField + PUT /billing) |
| `mock.ts` | **파일 삭제** — Q Bill 영역 mock 잔존 0건 |

### CLAUDE.md mock 절대 금지 강제 (최상위 원칙)
- "🚫 mock 데이터 절대 금지" 섹션 신설 (작업 워크플로우 최상위)
- 절대 금지 사항에 추가
- 메모리 `feedback_no_mvp.md` 강화
- 메모리 `feedback_button_plus_no_duplicate.md` 신규 — "+" 아이콘 SVG로만, i18n에 + 금지

### UI 보완
- 버튼 "+" 중복 제거 (qbill i18n 5곳 + 코드 SVG 통일)
- "+" 아이콘 정렬 (line-height: 1, svg display: block)
- SettingsTab/InvoicesTab Primary 버튼 사이즈 통일
- 페이지 styled 위반 수정 (Header → DrawerHeader)
- Switch role/aria-checked 추가
- ConfirmDialog로 window.confirm 교체 (2곳)

### 검증
- ✅ 헬스체크 27/27
- ✅ 백엔드 E2E 21/21 (정상/경계/권한 시나리오)
- ✅ 빌드 통과 (마지막 번들 `index-vsqFuaUx.js`)
- ✅ Q Bill 영역 mock 잔존 0건
- ✅ raw select / window.confirm / alert / page styled 위반 모두 0건

### 발견·수정한 버그
1. `routes/invoices.js` 분할 발행 시 `milestone_ref` 저장 누락 → 추가
2. `Client.biz_representative` 필드명 오류 (실제 `biz_ceo`) → 모든 라우트 수정
3. `Post`에 `kind` 컬럼 없음 (`category` 자유 분류 사용) → source 검증을 published만 단순화
4. `routes/invoices.js` 라우트 순서 — `/:businessId/source-candidates`가 `/:businessId/:id` 뒤에 있어 `:id="source-candidates"`로 매칭됨 → 위로 이동
5. `Client.email` 컬럼 없음 → `tax_invoice_email`/`billing_contact_email`/`invite_email` 우선순위로 변경
6. `Invoice.source_post_id` 타입 불일치 (BIGINT vs posts.id INT) → INTEGER로 통일

### 남은 작업 (다음 세션)
- Phase C: 채팅 결제 요청 카드 + 공개 결제 페이지 (`/public/invoices/:token`)
- Phase D: 통합 트리거 (서명/검수 → 후속 액션 카드) + 알림 센터 + **D4 프로젝트 거래 통합 뷰** (계약/청구/결제/세금계산서 타임라인)
- Phase E: PDF 인프라 (Puppeteer 싱글톤) + 메일 매트릭스 (시스템 SMTP / 사용자 SMTP·OAuth) + 알림 설정
- Phase F: Q docs 슬롯 시스템 (계약서 변수 슬롯 + 변경 비교)

---

## ✅ 완료: Q docs 공유·서명·표 에디터 + Q Bill 분할 청구 백엔드 (2026-04-26)

대규모 세션. Q docs UI/UX 정리 → 통합 설계 문서 → Phase A (서명 받기) 4단계 전체 완료 + Phase B1 (분할 청구) 백엔드 완료.

### 1. Q docs 정리 (PostsPage)

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **상세 제목 중복** | h1 → PrintOnlyTitle (인쇄에서만 출력) | ✅ |
| **공유 모달** (`PostShareModal`) | 토큰 발급/revoke + 이메일 + 채팅 카드 + 탭 UI + 발송 후 결과 화면 + URL 카드 + 토글 라벨 고정 ("공개 링크 활성화") | ✅ |
| **공개 페이지** (`/public/posts/:token`) | 익명 본문 조회 · 인쇄 · 삭제된 문서 friendly 안내 | ✅ |
| **AI 작성 모달** (`PostAiModal`) | kind 별 시스템 템플릿 body 를 참조 구조로 주입, 프롬프트 강화, maxTokens 4000 (proposal/contract/sow) | ✅ |
| **표 에디터** | TipTap Table extensions 추가 (resizable·column-resize) + Notion-style 표 + border-collapse separate (라운드 외곽) + 셀 모서리 radius | ✅ |
| **에디터 줄간격** | line-height 1.55 + `> * + *` 0.5em + `<li> > <p>` margin 0 (벙벙 해소) | ✅ |
| **편집 폼 정리** | 카테고리·프로젝트 2열 grid, "프로젝트" 라벨 제거 + placeholder "프로젝트 연결 안 함" | ✅ |
| **사이드바 접기** | EdgeHandle (Q Talk 패턴 통일) + localStorage 저장 | ✅ |
| **상세 chip 순서** | 카테고리 → 프로젝트 → 공유중 (자주 쓰는 순) | ✅ |
| **conversation_id 출처 필드 폐기** | 편집 폼 + 상세 chip 모두 제거 (공유 카드로 대체) | ✅ |

### 2. 7종 시스템 템플릿 풍부화

견적·청구·NDA·제안·회의록 + **계약서·SOW 신규 = 7종**. 모두 시스템(`is_system=true`) 으로 전 워크스페이스 노출. 8 column 품목표·결제 분할·세금계산서 안내·SLA·차별화·리스크 등 30년차 컨설팅 표준.

### 3. 프로젝트 detail 의 docs 탭 (`ProjectPostsTab`)

PostsPage 통째로 마운트(레이아웃 중첩) → 별도 `ProjectPostsTab` 신규. 1컬럼 인라인 마스터-디테일 + 카드 그리드 + DocsTab(파일) 패턴 통일. 페이지 이탈 0.

### 4. 채팅 카드 메시지 (Message.meta JSON)

| 영역 | 작업 |
|------|------|
| **DB** | Message.meta JSON 컬럼 추가 |
| **share-to-chat** | `kind='card', meta.card_type='post'` — 카드 메시지로 전송, 공개 토큰 URL 임베드 |
| **ChatPanel** | DocCard 렌더 + `PostCardPreviewModal` (인라인 미리보기 + "문서로 가서 보기") |

### 5. 통합 설계 문서

`docs/Q_BILL_SIGNATURE_DESIGN.md` (14 섹션, 1100+ 줄). Q Bill 분할 청구 + 서명 받기 + 채팅 결제 요청 통합. 시나리오·ERD·API 35종·UI 와이어프레임 6종·시퀀스·엣지 케이스 매트릭스·전자서명법 충족·구현 4주 분량.

**핵심 결정 (사용자 합의)**:
- B2B 송금 기반 (PG 통합 X)
- 세금계산서: 액션 알림만 (사용자 외부 발행 후 마킹)
- 서명: Phase 1 자체 구현 (이메일 OTP + 캔버스 + 동의 — "서명 받기" 가벼운 명칭)
- 분할은 발행자 토글 (단일/분할)

### 6. Phase A — 서명 받기 (자체 구현, 4 task 모두 완료)

| Task | 내용 | E2E 통과 |
|---|---|:--:|
| **A1 백엔드** | `signature_requests` 테이블 (15 컬럼 · OTP hash · 만료 lock · audit) + 9 라우트 (멤버 4 + 공개 5) + 이메일 템플릿 2종 + rate limit (otpSend 1분3·otpVerify 5분10) | 16/16 |
| **A2 모달·카드·진입** | `PostSignatureModal` (서명자 N명 + 키보드 Enter/Backspace 흐름 + 만료 chip + 채팅 토글 + 발송 결과) + 헤더 "서명 받기" 버튼 + ChatPanel `signature_request` 카드 분기 | 12/12 |
| **A3 공개 서명 페이지** | `/sign/:token` 5단계 (검토→OTP→캔버스→동의→완료) + 모바일 반응형 + 6 input OTP autoFocus 이동/paste 분배 + DPR scale 캔버스 + 60초 쿨다운 | 17/17 |
| **A4 진행 표 + 후속 액션** | `SignatureProgressSection` (진행 표 · Avatar · 상태 badge · 서명 thumbnail 라이트박스 · 액션 dropdown) + 양사 signed 시 후속 액션 카드 (계약→분할 청구, 견적→청구서) + 거절 알림 카드 | 10/10 |

**누적 55/55 E2E 통과** + 헬스체크 27/27.

### 7. Phase B1 — Q Bill 분할 청구 백엔드 (13/13)

| 영역 | 작업 |
|------|------|
| **Invoice 모델 확장** | `installment_mode ENUM('single','split')` · `bank_snapshot JSON` · status enum 'partially_paid' 추가 |
| **InvoiceInstallment 신규** | 15 컬럼 · 분할 일정 · status (pending/sent/paid/overdue/canceled) · 결제 마킹 · 세금계산서 마킹 · milestone_ref |
| **라우트 5종** | POST /invoices (분할 처리 + 합계 100% 검증 + 마지막 row 잔여 흡수) · POST /:id/send (status sent + share_token 발급 + installments 동시 sent) · POST /:id/installments/:iid/mark-paid (paid_amount/status 자동 갱신) · unmark-paid · mark-tax-invoice (사용자 외부 발행 번호) · DELETE installment (paid 차단) |
| **검증** | 단일/분할 발행 · 합계 80%/13건 차단 · 발송 → sent 동시 전환 · 부분 결제 → partially_paid · 모두 결제 → paid · 마킹 해제 · 세금계산서 번호 필수 · 익명 401 |

### 발견·수정한 버그 4건 (senior-level 케이스)

1. `routes/signatures.js:210` — `let row` 변수 스코프 (for 루프 종료 후 undefined) → ReferenceError → `created[0]?.note` 로 수정
2. `routes/signatures.js maybeUpdateEntityStatus` — Post.status enum 에 'signed/rejected' 없는데 update 시도 → MySQL `Data truncated for column 'status'` → no-op 으로 변경 (차원 다른 status 는 별개 컬럼이 옳음)
3. `routes/signatures.js:288` — Sequelize update 가 인스턴스도 갱신함을 잊고 `+ 1` 더블 증가 → reminder_count 응답 +1 더 큼 → `sr.reminder_count` (update 후) 만 반환
4. `SignatureProgressSection.tsx:85` — `window.confirm` 헬스체크 룰 위반 → ConfirmDialog 컴포넌트로 교체

### 신규 파일 (12)

**Backend (3)**:
- `models/SignatureRequest.js`, `models/InvoiceInstallment.js`, `routes/signatures.js`

**Frontend (9)**:
- `components/Docs/PostShareModal.tsx`, `components/Docs/PostAiModal.tsx`, `components/Docs/PostSignatureModal.tsx`, `components/Docs/SignatureProgressSection.tsx`
- `pages/QDocs/PublicPostPage.tsx`, `pages/QDocs/PublicSignPage.tsx`
- `pages/QProject/ProjectPostsTab.tsx`
- `pages/QTalk/PostCardPreviewModal.tsx`

**Docs**:
- `docs/Q_BILL_SIGNATURE_DESIGN.md`

### 다음 작업 (우선순위)

| Task | 내용 | 추정 |
|---|---|:--:|
| **B2** | Q Bill 청구서 리스트 + 발행 모달 (분할 토글 UI) | 2일 |
| **B3** | 청구서 상세 (분할 일정 표 + 액션) | 2일 |
| **B4** | 공개 청구서 페이지 `/public/invoices/:token` | 1일 |
| **C1** | 채팅 결제 요청 — 카드 메시지 + 공개 결제 페이지 | 2일 |
| **C2** | 입금 완료 알림 → 사용자 마킹 → 카드 자동 갱신 | 1일 |
| **D1** | 통합 트리거 — 서명/검수 → 후속 액션 카드 자동 표시 | 2일 |
| **D2** | 알림 센터 — 서명/결제/세금계산서/검수 일관 표시 | 2일 |

---

## ✅ 완료: Q Task 시간모델 단순화 + done_feedback 폐지 + Q docs D-2~5 + PostEditor 진단 (2026-04-25)

대규모 세션. Q Task 시간/진행율 권한 강화, done_feedback 단계 폐지, Q docs D-2~5 핵심 + PostEditor "에디터 안 보임" 근본 원인 추적·해결.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **Q Task 시간/진행율 모델 단순화** | 담당자만 입력 (정규화 모델 폐기) · 백엔드 PATCH/PUT 권한 가드 (`only_assignee_can_edit_hours` 403) · 프론트 인라인 행/드로어 disabled 분기 | ✅ |
| **비활성 시각 처리** | NumInput/MetaNumInput/SliderRange disabled 스타일 (회색·점선·spinner 숨김·opacity 0.5) | ✅ |
| **헤더 chip 라벨 변경** | `15개 · 내 업무 X.Xh/가용 Y.Yh · 실제 Z.Zh` (3 chip 분리) | ✅ |
| **0.5h 화살표 입력** | `type="number" step="0.5" min="0"` (행 + drawer 메타) | ✅ |
| **workspace 뷰 담당자 컬럼** | Status 앞에 추가, mine 뷰 NameChip 중복 제거 | ✅ |
| **요청 task 시간칸 숨김** | 새 task 생성 모달에서 `(newAssignee==null \|\| newAssignee===myId)` 조건 | ✅ |
| **`done_feedback` 단계 폐지** | recalcStatusFromReviewers — 컨펌 정책 충족 시 자동 completed (DB 6 row 마이그레이션) · statusOptionsFor + kanban 컬럼 + drawer completeFinal 정리 | ✅ |
| **inbox 활성 워크스페이스 명시** | TodoPage 가 `fetchTodo(bizId)` — 첫 가입 워크스페이스 fallback 버그 fix | ✅ |
| **inbox candidate 카드 명확화** | 추정 담당자 본인 → `accept` / 다른 사람 → `review` / 미지정 → `assign` (verb i18n + 컨텍스트 라인 `담당: X` 또는 `담당자 지정 필요`) · 클릭 → 원본 대화 (`/talk?conv=X&candidate=Y`) | ✅ |
| **Q docs D-2 잔여** | 시드 5종 본문 풍부화 (NDA 8조항·제안서 5섹션·회의록 4섹션·표 포함 HTML) + `{{path.to.value}}` placeholder 치환 + `body_template` → `body_html` 자동 채움 | ✅ |
| **Q docs D-3 (AI 자동 생성)** | `POST /api/docs/ai-generate` (Cue gpt-4o-mini, CueUsage 카운터, 플랜별 한도) + NewDocumentModal AI 탭 활성화 (kind/title/user_input 입력 + 에러/한도 안내) | ✅ |
| **Q docs D-4 핵심** | `/public/docs/:token` PublicDocPage (인증 없음 + 인쇄 + 동의/서명/거절 모달) · `POST /:token/sign` 라우트 (1회 정책, 거절 분기, IP/UA 기록) · A4 print CSS (`@page` + `[data-print-area]`) | ✅ |
| **Q docs D-5 핵심** | Q Talk RightPanel "+ 새 문서" 진입 (대화 컨텍스트 prefill) · QDocsPage `?new=1` 자동 모달 → 후속 이터레이션에서 PostsPage 흡수로 전환 | ✅ |
| **게시판/문서 잘못 분리 → 복구** | `/docs` 단일 PostsPage 유지 + 템플릿 흡수 (검색·시스템5종+사용자 자작 합산) · 사용자가 만든 글 "템플릿으로 저장" (DocumentTemplate 멤버 권한 완화) · 인쇄/PDF 액션 (워크플로우 안에서) | ✅ |
| **PostEditor "에디터 안 보임" 근본 진단** | 콘솔 로그로 추적 → TipTap v3 Link 중복 (StarterKit + 별도 Link) + 중첩 flex column 안에서 Wrap height 0 → `link: false` + `flex-shrink: 0; min-height: 280px` | ✅ |
| **이모지 → 라인 SVG 통일** | KindIcon.tsx 신설 (Lucide-style) · KIND_ICON 빈 string · PinTag 📌 → PinDot · 모달 close 등 라인 SVG | ✅ |

### 핵심 진단·해결 요약

| 증상 | 원인 | 해결 |
|---|---|---|
| 화면 합 54.5h vs 헤더 48.5h 불일치 | 컨펌자만 task 의 시간이 헤더 합산에서 누락 | 시간/진행율 = 담당자 전용으로 단순화. 헤더 chip 의미 명확화 (`내 업무 = assignee=me`) |
| C1 컨펌 버튼 안 나옴 | 검증 스크립트가 task #274 status 변경 후 원복 누락 | DB 직접 복구 + 메모리 저장 (검증 후 try/finally 원복 필수) |
| inbox 비어 있음 | `fetchTodo()` 가 첫 가입 워크스페이스 default → 활성 워크스페이스와 불일치 | `fetchTodo(bizId)` 명시 |
| inbox 후보 카드 의미 모호 | 클릭 시 `/tasks` 로 이동, "수락 대기" 라벨만 | 추정 담당자 따라 verb 분기, 클릭 → 원본 대화 |
| PostEditor 에디터 안 보임 | (1) TipTap v3 Link 중복 console warn → editor 인스턴스 깨짐 (2) 중첩 flex column 안 Wrap height 0 | `StarterKit.configure({ link: false })` + `Wrap` 에 `flex-shrink: 0` + `min-height: 280px` |

### 수정된 파일 (주요)

**Backend (8):**
- `routes/tasks.js` (권한 가드 + 시간 row 동기화 hook)
- `routes/task_workflow.js` (done_feedback 자동 completed 전환)
- `routes/dashboard.js` (collectCandidates 담당자 정보 + 활성 워크스페이스)
- `routes/docs.js` (placeholder 치환 + AI 생성 + 공개 sign 라우트)
- `services/cue_orchestrator.js` (`generateDocumentDraft` 추가)
- `models/TaskUserHours.js` (정규화 모델, 추후 폐기 결정)
- `utils/taskUserHours.js` (헬퍼)
- `scripts/seed-document-templates.js` (5종 본문 풍부화 + close 에러 fix)

**Frontend (15):**
- `pages/QTask/QTaskPage.tsx` (헤더 chip · 시간 컬럼 분기 · 0.5h step · 권한 disabled · workspace 담당자 컬럼)
- `components/QTask/TaskDetailDrawer.tsx` (메타 그리드 권한 · disabled 시각)
- `pages/QDocs/QDocsPage.tsx` (PostsPage 단일 + scope useMemo 안정화)
- `pages/QDocs/NewDocumentModal.tsx` (AI 탭 활성화)
- `pages/QDocs/PublicDocPage.tsx` (신규 — 공개 페이지 + 서명)
- `components/Docs/PostsPage.tsx` (템플릿 모달 + 검색 + 사용자 템플릿 저장 + 인쇄 + URL 싱크)
- `components/Docs/PostEditor.tsx` (link 중복 fix + Wrap height fix)
- `components/Docs/KindIcon.tsx` (신규 — 라인 SVG)
- `pages/Todo/TodoPage.tsx` (활성 워크스페이스 명시)
- `pages/QTalk/RightPanel.tsx` (Q docs 진입점)
- `pages/QProject/ProjectTaskList.tsx` (statusOptionsFor — done_feedback 제거)
- `pages/QProject/TasksTab.tsx` (요청 task 시간칸 숨김)
- `services/dashboard.ts`, `services/docs.ts` (타입 + AI 생성)
- `index.css` (A4 print CSS)
- `i18n.ts` + ko/en 6개 JSON (qdocs/qtask/dashboard 키 대규모 추가)

### 메모리 추가 (`/home/irene/.claude/projects/-opt-planq/memory/`)

- `feedback_test_data_restore.md` — 검증 스크립트 try/finally 원복 필수
- `feedback_props_useMemo.md` — 자식 props 객체/배열 useMemo 안정화
- `feedback_flex_min_height.md` — 중첩 flex column 자식 min-height + flex-shrink:0

---

## ✅ 완료: Q Talk 독립 대화 지원 + 우측 패널 스코프 확장 (2026-04-24 저녁 세션)

사용자 보고한 `/talk` 런타임 에러 3종 → 독립 채팅 완전 지원으로 스코프 확장. 대화 = 1급 엔티티, 프로젝트는 선택적 컨테이너.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **런타임 에러 해소** | `/api/projects/-1/*` 404 (activeProjectId=-1 누수) · `TASK_STATUS_COLOR[status].bg` undefined (ENUM 불일치) · extract 400 (standalone에서 버튼 노출) · `m.user.name` null (삭제 유저) — 모두 fix | ✅ |
| **DB 스키마 확장** | `project_notes.project_id`·`project_issues.project_id`·`task_candidates.project_id` → NULL 허용, `conversation_id` 컬럼 추가 (notes/issues) · 수동 ALTER 적용 | ✅ |
| **백엔드 독립 대화 라우트 4종** | `GET/POST /api/projects/conversations/:convId/notes` · `.../issues` · `.../task-candidates` · `.../tasks` + `loadStandaloneConvOrForbidden` 헬퍼 | ✅ |
| **task_extractor standalone 지원** | `conversation.project_id` null 시 `resolveAssignees`/`findSimilarTasks` 스킵, `memberNames` 빈 문자열 · `registerCandidate` 가 business_id 를 conv 에서 조회 | ✅ |
| **프론트엔드 scope 일반화** | RightPanel `matchScope()` (project OR conversation_id) · `if (!project) return null` 제거 · `titleStandalone` i18n · InputToolbar `project` 가드 제거 | ✅ |
| **채팅-프로젝트 메모·이슈 연결** | 프로젝트 채팅에서 쓴 메모·이슈에 `conversation_id` 기록 → `SourceTag` 로 `#채팅명` 표시 · 스코프 불일치 conv_id 는 null 로 저장 (보안) | ✅ |
| **독립 대화 메시지 지속성** | `listBusinessConversations` 초기 로드 추가 (프로젝트별 loop 가 standalone 누락) · `activeConversationId` 변경 시 lazy fetch | ✅ |
| **프로젝트 업무 섹션 preview** | 최신 5개 + `→ Q Task 전체 보기 (N개 더)` 링크 · 프로젝트 필터링된 Q Task 로 이동 | ✅ |
| **섹션 자동 펼침** | 내용 있으면 자동 펼침 — scope 인지 + async 데이터 반영 (deps: issues.length · tasks.length · notes.length) | ✅ |
| **좌측 리스트 최신순 + bump** | Q Talk 대화 `last_message_at` DESC + socket `message:new` & send 시 bump · Q Note 세션 `created_at` DESC | ✅ |
| **ENUM 백엔드 동기** | mock.ts `TaskStatus` 8종 (reviewing/revision_requested/done_feedback) + `taskStatusColor()`/`taskStatusLabel()` fallback 헬퍼 — 알 수 없는 status 에서도 crash 안 남 | ✅ |
| **NewChatModal 통합** | LeftPanel `+` 아이콘 1개로 통합 (새 프로젝트 버튼 제거) · EmptyState CTA 도 NewChatModal 로 · `m.user?.name` null 방어 + `m.user` 필터 | ✅ |

### 수정된 파일

**Backend (5):**
- `dev-backend/models/ProjectNote.js`, `ProjectIssue.js`, `TaskCandidate.js`
- `dev-backend/routes/projects.js` (+4 라우트 + standalone 헬퍼)
- `dev-backend/services/task_extractor.js`

**Frontend (9):**
- `dev-frontend/src/pages/QTalk/QTalkPage.tsx`, `RightPanel.tsx`, `ChatPanel.tsx`, `LeftPanel.tsx`
- `dev-frontend/src/pages/QTalk/NewChatModal.tsx`, `NewProjectModal.tsx`, `QDataContext.tsx`, `mock.ts`
- `dev-frontend/src/pages/QNote/QNotePage.tsx`
- `dev-frontend/src/services/qtalk.ts`
- `dev-frontend/public/locales/{ko,en}/qtalk.json`

### E2E 검증 (owner@test.planq.kr)
- standalone conv 생성 → 201 (project_id null)
- conv 메모/이슈 CRUD → 200
- extract (LLM 실호출) → 200 (1 candidate)
- register → task (project_id=null, conversation_id 연결)
- 프로젝트 메모 + conv_id → 저장 + GET 에서 유지
- 스코프 불일치 conv_id 는 null 로 저장 (보안)
- **21/21 pass** · health check 27/27 pass

---

## ✅ 완료: 전체 코드 감사 · 보안 강화 · 리포트/Q Bill 기획 (2026-04-22)

**설계 문서:** `docs/Q_BILL_SPEC.md` · `docs/FINANCIAL_REPORTS_SPEC.md`

이번 세션은 **초대 플로우 완성 → Q Talk 첨부 → Q Note Drive 동기화 → Drive webhook → 멤버 관리 Phase 2 → 전체 감사 → 보안 수정 → 리포트·Q Bill 기획** 까지 대규모 스프린트. 감사 에이전트 3개 병렬로 Critical/High 문제 전수 발굴·수정.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **초대 플로우 3청크** | 프로젝트 고객(만료·email 검증·email 발송)·워크스페이스 고객(user_id nullable + invite_token)·멤버 초대 + 통합 `/api/invites/:token` | ✅ |
| **업무 삭제 기능** | 우측 드로어 Danger Zone · 권한(owner/admin/본인) · 로즈 칩으로 "{요청자}에게 요청받음" | ✅ |
| **Q Talk 메시지 첨부** | `/api/message-attachments/*` · 이미지 썸네일 + 파일 chip · Socket.IO 이벤트 | ✅ |
| **Q Note → Drive 자동 저장** | Python ingest 후 Node `/api/cloud/qnote/sync` · 내부 API 키 인증 · Q Note 세션 폴더 자동 생성 | ✅ |
| **Drive changes.watch** | `/api/cloud/watch/start/:businessId` · webhook 수신 · Socket.IO 브로드캐스트 · BusinessCloudToken 확장 | ✅ |
| **프로젝트 상태 토글 · 삭제** | 카드 컨텍스트 메뉴 + closed 필터 · owner-only 가드 | ✅ |
| **멤버 관리 Phase 2** | removed_at soft delete · role 변경 API · 마지막 오너 보호 · defaultScope 전역 차단 | ✅ |
| **QNote/QProject i18n 130키** | 하드코딩 제거 (Agent A) — ko/en 양쪽 완비 | ✅ |
| **ProjectClient FK 전환** | email/name 문자열 매칭 → contact_user_id FK (과거 데이터 backfill) | ✅ |
| **운영서버 배포 스크립트** | `deploy-to-production.sh` + `rollback-production.sh` (POS 패턴 기반) | ✅ |
| **리포트 + Q Bill 기획** | 통계·분석 6탭 + Q Bill 5탭 + 자동 해석 + 월간 보고서 설계 완료 | ✅ |
| **좌측메뉴 확장** | Q Bill 활성 · 통계·분석 섹션 6개 + ComingSoon 페이지 · /billing→/bills 통합 | ✅ |

### 🔒 보안 강화 (전체 감사 후속)

| # | 수정 | 심각도 | 파일 |
|---|------|:----:|------|
| 1 | IDOR — users.js refresh_token/reset_token 유출 차단 + 본인/admin 만 조회 | **Critical** | routes/users.js |
| 2 | `req.user.role` → `platform_role` 통일 (tasks·businesses 2곳) | High | routes/tasks.js, businesses.js |
| 3 | 프로젝트 종료/삭제 owner-only | High | routes/projects.js |
| 4 | OAuth state HMAC 서명 + 10분 TTL | High | services/gdrive.js |
| 5 | `JWT_SECRET \|\| 'planq'` 폴백 제거 | High | routes/cloud.js |
| 6 | `/public/attach` 이미지 MIME 만 + nosniff + inline | Med | routes/task_attachments.js |
| 7 | conversations participants business 소속 검증 | Med | routes/conversations.js |
| 8 | plan/invoices owner-only 가드 | Med | routes/plan.js, invoices.js |
| 9 | invites accept 트랜잭션 + FOR UPDATE lock | High | routes/invites.js |
| 10 | businesses role/DELETE 트랜잭션 + 마지막 오너 race 방어 | High | routes/businesses.js |
| 11 | raw fetch + localStorage token → apiFetch | Med | WorkspaceSettingsPage.tsx |
| 12 | refresh_token SHA-256 해시 저장 (login/register/refresh) | Low | routes/auth.js |
| 13 | CSP `script-src 'unsafe-inline'` 제거 (Vite 번들만 허용) | Low | middleware/security.js |
| 14 | BusinessMember `defaultScope: { removed_at: null }` 전역 차단 | - | models/BusinessMember.js |
| 15 | 22개 라우트 `checkBusinessAccess` 누락 지점 보강 (Agent) | High | tasks/calendar/file_folders/projects |

**회귀 테스트**: 10/10 통과 (IDOR·권한·OAuth·테넌트 격리·세금계산서 경로 등).
**헬스체크**: 27/27 유지.

### 기획 결정 (Irene 확정)

- **포트원 V2 Starter (무료, 월 5천만 미만)** — 국내 토스·해외 Stripe 채널 통합
- **팝빌 세금계산서** — 워크스페이스 설정에서 키 등록 시 자동 발행
- **고객 `country`·`is_business` 자동 분기** — 부가세·언어·세금계산서
- **Q Bill** = 최상위 메뉴 (견적·청구·결제·세금계산서 통합) · 프로젝트 상세에도 Bill 탭
- **통계·분석** 6 탭 = 개요·업무시간·수익성·팀생산성·비용재무·보고서 (최하위 메뉴)
- **자동 해석** = 룰(즉시) + Cue LLM(자연어) 하이브리드
- **운영서버** = 실결제 시작 시점 전에만 필요 (개발 중 dev 로 전부 검증)

### 수정된 파일 (주요)

**백엔드 (22개)**
- `routes/auth.js`, `users.js`, `businesses.js`, `projects.js`, `tasks.js`, `calendar.js`,
- `clients.js`, `conversations.js`, `plan.js`, `invoices.js`, `task_attachments.js`,
- `file_folders.js`, `cloud.js`, `invites.js` (신규), `message_attachments.js` (신규)
- `middleware/security.js`, `services/gdrive.js`, `services/emailService.js`
- `models/BusinessMember.js`, `BusinessCloudToken.js`, `Client.js`
- `server.js`

**프론트엔드 (40+개)**
- `pages/Settings/WorkspaceSettingsPage.tsx`, `PlanSettings.tsx`
- `pages/Clients/ClientsPage.tsx`
- `pages/QTalk/ChatPanel.tsx`, `QTalkPage.tsx`, `LeftPanel.tsx`, `RightPanel.tsx`, `NewProjectModal.tsx`
- `pages/QNote/QNotePage.tsx`, `StartMeetingModal.tsx`
- `pages/QProject/*.tsx` (TasksTab, ProjectTaskList, ProcessPartsTab, DocsTab)
- `pages/QTask/QTaskPage.tsx`, `components/QTask/TaskDetailDrawer.tsx`
- `pages/Admin/AdminBusinessesPage.tsx`
- `pages/Login/LoginPage.tsx`, `Register/RegisterPage.tsx`, `Invite/InvitePage.tsx`
- `pages/ComingSoon/ComingSoonPage.tsx` (신규)
- `components/Layout/MainLayout.tsx`, `components/Common/*.tsx`
- `components/ProtectedRoute.tsx`
- `App.tsx` · 16개 i18n json (ko/en)

**설계 문서 (2개 신규)**
- `docs/Q_BILL_SPEC.md`
- `docs/FINANCIAL_REPORTS_SPEC.md`

**운영 스크립트 (2개 신규)**
- `deploy-to-production.sh`
- `rollback-production.sh`

### Phase 순서 (확정, 10주)

1. **Phase 0** — DB 기반 스키마 확장 (1주)
2. **Phase 1** — Q Bill 견적·청구·결제 (3주)
3. **Phase 2** — 세금계산서 자동화 (0.5주)
4. **Phase 3** — 프로젝트 Bill 탭 + 시간기반 자동청구 (1주)
5. **Phase 4** — 통계 대시보드 5개 + 자동해석 (2주)
6. **Phase 5** — 월간 보고서 자동 생성 + PDF (1주)
7. **Phase 6** — PlanQ 자체 구독 청구 (0.5주)
8. **Phase 7** — 운영서버 세팅 + 실배포 (0.5주)
9. **Phase 8** — 반응형 스프린트 (1주) — 전 페이지 모바일/태블릿 일괄 적용

### Phase 8 — 반응형 스프린트 상세 (2026-04-24 신설)

**원칙:** 기능 완성 후 일괄 적용. 기능별 찔끔찔끔 금지 (Q Docs 상단 탭 같은 파편화 방지).

**핵심 패턴:**
- **햄버거 드로어 2뎁스 아코디언** — 통계·분석/설정 1뎁스 탭 시 그 자리 인라인 확장 (Slack/Linear 방식)
- **마스터-디테일 드릴다운** — Q Talk/Q Note/Q Task/Q Calendar/Q Docs 모바일에서 리스트→상세 풀 라우트 + 상단 `<` 뒤로 (iOS Mail 표준)
- **공용 `<ListDetailLayout>` 훅** — 데스크탑 3컬럼 ↔ 모바일 드릴다운 자동 전환. `?task=:id` URL 싱크 규칙을 모바일에서 `/tasks/:id` 풀 라우트로 연결
- **모달/드로어 풀스크린화** ≤640px — `DetailDrawer` 이미 지원 (width: 100vw)
- **터치 타겟 44×44 일괄 상향** — 현재 36 기준을 Phase 8 때 전역 업그레이드
- **Safe-area inset** — iOS 노치 대응

**범위 (1주 / Day 1~7):**
| Day | 작업 |
|---|---|
| 1 | 전역 기반 — breakpoint 토큰 확장, `useIsMobile` 훅, 햄버거 아코디언 구현, 사이드바 Secondary 모바일 해제 |
| 2 | `<ListDetailLayout>` 공용 컴포넌트 — 리스트/상세 자동 라우팅, 뒤로가기 스택 |
| 3 | Q Talk + Q Note 모바일 적용 |
| 4 | Q Task + Q Calendar + Q Docs 모바일 (Docs 상단 탭 → 드릴다운 재작업) |
| 5 | 대시보드 To do + 통계/설정 2차 패널 + 폼·모달·드로어 풀스크린화 |
| 6 | 터치 타겟 44px 상향 · Safe-area · 가로스크롤 제거 · 키보드 대응 |
| 7 | 실기기 QA (iPhone SE/13/14 Pro Max, 갤럭시 S22/S23, iPad) + 최종 보정 |

**그전까지 신규 코드 규칙 (기존 3원칙 유지):**
1. 고정 px 폭 금지 — `max-width`/`flex`/`minmax()`
2. 인라인 `style={{ width }}` 금지 — styled-components 경유
3. 아이콘 버튼 최소 36×36 — Phase 8 때 일괄 44로 상향

**현재 파편화 이슈 (Phase 8 정리 대상):**
- Q Docs 상단 가로 탭 (좌측 폴더 트리 축소) — 드릴다운으로 재작업
- `SecondaryPanel` 모바일 `display: none` — 햄버거 아코디언으로 교체

---

## ✅ 완료: 파일 시스템 Phase 1·1+·2A — 문서 탭 실구현 (2026-04-21)

**설계 문서:** `docs/FILE_SYSTEM_DESIGN.md` · `docs/OPS_ROADMAP.md`

프로젝트 문서 탭을 placeholder 에서 **자체 스토리지 + SHA-256 dedup + 플랜 쿼터 + 폴더 시스템 + 대량 작업** 이 모두 작동하는 실제 파일 허브로 교체. 자동 집계(Q Talk·Q Task 첨부)도 포함. 30년차 UI/UX 감사 반영.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **설계 문서** | `docs/FILE_SYSTEM_DESIGN.md` (스키마/API/UI/롤아웃 전 10섹션) + `docs/OPS_ROADMAP.md` (Stage 0~4 임계치) | ✅ |
| **Phase 1 UI Mock** | `pages/QProject/DocsTab.tsx` + `services/files.ts` (타입·mock) + i18n ko/en | ✅ |
| **Phase 1+ UI 보강** | 좌측 폴더 트리 + 대량 선택 모드 + 플로팅 액션바 + 재귀 폴더 삭제 모달 | ✅ |
| **30년차 UI/UX 감사 8건** | SVG 아이콘(이모지→Lucide), 확장자별 색상 아이콘(PDF빨강/DOC파랑/XLS녹색/PPT주황/ZIP보라/이미지핑크), Progressive drop zone, skeleton shimmer, focus-visible 10건, 조건부 grid-template-columns, 폴더 삭제 파일수 안내, 다운로드 아이콘 헤더 상단 이동 | ✅ |
| **Phase 2A DB 스키마** | `files` 확장 (project_id/folder_id/storage_provider/external_id/external_url/content_hash/ref_count/deleted_at) + 신규 테이블 3: `file_folders`, `business_storage_usage`, `ops_capacity_log` | ✅ |
| **Phase 2A Backend — routes/files.js** | 업로드(쿼터+SHA256 dedup), 이동, 소프트 삭제, 대량 삭제, 다운로드, 스토리지 상태 | ✅ |
| **Phase 2A Backend — routes/file_folders.js** | CRUD + 재귀 삭제 시 내부 파일 parent 로 자동 이동 | ✅ |
| **Phase 2A 집계 API** | `GET /api/projects/:id/files` — direct + chat(MessageAttachment) + task(TaskAttachment) 통합. id 접두어 규칙 (`direct-12`/`chat-45`/`task-7`) | ✅ |
| **Phase 2A OPS 자동화** | `scripts/ops-capacity-check.js` — 주간 스냅샷 + Stage 전환 감지 + provider 비중 트래킹 | ✅ |
| **서비스 실 API 연결** | `services/files.ts` mock 전부 제거 → apiFetch 기반 실 API (upload/download/move/bulk-delete/folders/storage) | ✅ |
| **검증** | 헬스체크 27/27, Phase 2A E2E 22/22, 빌드 tsc 0 error (gzip 433 kB), SPA 9 라우트 전부 200, 멀티테넌트 격리 (타 biz 403) | ✅ |

### 플랜별 쿼터 (운영 기준)

| 플랜 | 파일당 | 총 스토리지 |
|---|---|---|
| Free | 10 MB | **1 GB** |
| Basic | 30 MB | **50 GB** |
| Pro | 50 MB | **500 GB** |

SHA-256 dedup: 같은 파일 여러 폴더/프로젝트 첨부 시 물리 파일 1개만 저장, `ref_count` 로 관리. 삭제 시 `ref_count` 0 도달해야 물리 제거.

### 자동 타이밍 알림 (docs/OPS_ROADMAP.md)

| Stage | 임계치 (biz 또는 용량) | 도입 항목 |
|---|---|---|
| Stage 0 (지금) | — | 쿼터 + dedup + 휴지통 + OPS 체크 스크립트 |
| Stage 1 | 100 biz or 50 GB | 휴지통 자동 정리 cron + 썸네일 자동 생성 |
| Stage 2 | 500 biz or 500 GB | Cold storage (B2/R2) + 서명 URL |
| Stage 3 | 2,000 biz or 5 TB | CDN + Redis 업로드 큐 + 모니터링 스택 |

주 1회 `scripts/ops-capacity-check.js` → Stage 전환 감지 시 로그 (SMTP 구축 후 이메일 전환).

### 신규 파일

**Backend**
- `models/FileFolder.js`, `models/BusinessStorageUsage.js`, `models/OpsCapacityLog.js`
- `routes/file_folders.js`, `scripts/ops-capacity-check.js`

**Frontend**
- `pages/QProject/DocsTab.tsx` (780줄 — 폴더 트리 + 대량 선택 + 드롭존 + 미리보기)
- `services/files.ts` (실 API 래퍼)

**Docs**
- `docs/FILE_SYSTEM_DESIGN.md` · `docs/OPS_ROADMAP.md`

### 수정 파일

- Backend: `models/File.js`, `models/index.js`, `routes/files.js`, `routes/projects.js`, `server.js`
- Frontend: `pages/QProject/QProjectDetailPage.tsx` (문서 탭 placeholder → DocsTab 교체)
- 로케일: `public/locales/{ko,en}/qproject.json` (tab/docs/folder/bulk 키 추가)

### 다음 (외부 클라우드 연동)

| Phase | 내용 | 예상 | 상태 |
|---|---|---|:-:|
| **Phase 2B** | Google Drive App Folder OAuth + Direct upload + Webhook | 4일 | ⏳ 선결: OAuth 앱 등록 |
| **Phase 4** | Q Docs 전역 페이지 (동일 DocsTab scope 재사용) | 1일 | ⏳ |

**OAuth 선결 (Irene 작업 — 15분)**
- Google Cloud Console — OAuth Client ID + redirect URI (dev.planq.kr 먼저) + 동의 화면

### 알려진 범위 외 이슈
- `QProjectDetailPage.tsx` 전반 기존 한글 하드코딩 62건 — 별도 작업으로 분기 (Phase 2A 와 무관)
- express-rate-limit `X-Forwarded-For` warning — nginx proxy trust 설정 이슈

---

---

## ✅ 완료: Calendar Phase A~E 전체 구현 + 드로어 반응형 통일 (2026-04-20)

캘린더 시스템을 DB→API→UI→반복→화상→Q Task 통합까지 한 사이클 완주. 동시에 모든 우측 드로어를 햄버거 패턴(왼쪽 strip 남김) + 엣지 핸들 + 접근성 훅으로 통일.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **Phase A (DB+API)** | `calendar_events` + `calendar_event_attendees` 테이블, CRUD 6개 엔드포인트, visibility personal/business, attendee 응답, AuditLog 4종 | ✅ |
| **Phase A 검증** | API 24/24 PASS (역할별 owner/member, 엣지 케이스, 멀티테넌트 격리) | ✅ |
| **Phase B (UI)** | `pages/QCalendar/*` 신규 8파일. 월/주/일 3뷰, NewEventModal, EventDrawer, MonthView, TimeGridView, URL 싱크, i18n ko/en | ✅ |
| **Phase B API 연결** | Mock 제거 → `services/calendar.ts` 실 API. 낙관적 업데이트, 로딩/에러 UI | ✅ |
| **Phase C (반복)** | `rrule.js` 설치, 백엔드 range 쿼리 RRULE expansion, 프리셋 6종(없음/매일/매주/2주마다/매월/매년), 드로어 배지 | ✅ |
| **Phase C 검증** | DAILY 7 인스턴스, WEEKLY 4, BIWEEKLY 2, MONTHLY 6 — 10/10 PASS | ✅ |
| **Phase D (화상미팅)** | `services/daily.js` Daily.co 래퍼, `auto_create_meeting` 옵션, 기존 이벤트 지연 방 생성, iframe 임베드, `video/status` 엔드포인트 | ✅ |
| **Phase D 실연결** | `DAILY_API_KEY` 설정 → `planq.daily.co` 실 방 생성 확인 | ✅ |
| **Phase E (Q Task 통합)** | `taskToEvent.ts` 변환기, due_date 있는 업무 종일 이벤트로 표시, 4필터(전체/나/업무/일정), 업무 클릭 시 캘린더에서 TaskDetailDrawer 오버레이 | ✅ |
| **Phase E 버그픽스** | `due_date` 풀 ISO 파싱 수정, 업무 단일 날짜 표시(기간 중복 제거), 월 뷰 팝오버(+N 더보기) | ✅ |
| **CalendarPicker 재사용** | NewEventModal 의 native datetime-local → 기존 `CalendarPicker` + `PlanQSelect` 시간 드롭다운 | ✅ |
| **PlanQSelect 개선** | `density='compact'` prop 추가 (옵션 many 리스트용, 패딩 절반) | ✅ |
| **DetailDrawer 프리미티브** | 공용 `components/Common/DetailDrawer.tsx` + Header/Body/Footer 서브. 반응형 3-구간 내장 | ✅ |
| **반응형 드로어 통일** | 5개 드로어 모두 `min(desktopW, 100vw - 56px)` 폭 — 좌측 56px strip 남김 (햄버거 패턴) | ✅ |
| **엣지 핸들 + 팝아웃 패널** | `FloatingPanelToggle.tsx` — 얇은 우측 세로 핸들(8px), 화살표 회전, 열면 right:0 → panel-width 이동. pulse 최초 1회(localStorage) | ✅ |
| **접근성 훅 2종** | `useFocusTrap` (Tab 순회 + 복귀), `useEscapeStack` (중첩 모달 안전) — DetailDrawer·TaskDetailDrawer 에 적용 | ✅ |
| **body scroll lock** | `useBodyScrollLock` — 5곳 (드로어·RightPanel) 통합 | ✅ |
| **키보드 단축키** | `⌘/` · `Ctrl+\` 우측 패널 토글 — QTask, QTalk | ✅ |
| **뒷배경 blur 제거** | Irene 피드백 — 모든 드로어 `backdrop-filter: blur` 제거, dim 0.32→0.08 | ✅ |
| **필터 네이밍** | "내 것" → "나", "업무만/일정만" → "업무/일정" (중복어 제거) | ✅ |
| **레거시 `/raw` URL 호환** | 구 task body 의 `/api/tasks/attachments/:id/raw` 자동 302 → `/public/attach/:storedName` | ✅ |

### 신규 파일
**Backend**
- `models/CalendarEvent.js`, `models/CalendarEventAttendee.js`
- `routes/calendar.js`, `services/daily.js`

**Frontend**
- `pages/QCalendar/` 9파일 (QCalendarPage, MonthView, TimeGridView, EventDrawer, NewEventModal, types, dateUtils, categoryColors, taskToEvent)
- `components/Common/DetailDrawer.tsx`, `components/Common/FloatingPanelToggle.tsx`
- `hooks/useBodyScrollLock.ts`, `useFocusTrap.ts`, `useEscapeStack.ts`, `useMediaQuery.ts`
- `services/calendar.ts`
- `public/locales/ko/qcalendar.json`, `public/locales/en/qcalendar.json`

### 수정 파일
- Backend: `routes/task_attachments.js` (레거시 raw 호환), `models/index.js` (associations), `server.js` (라우트 마운트)
- Frontend: `App.tsx`, `i18n.ts`, `components/QTask/TaskDetailDrawer.tsx`, `components/Common/PlanQSelect.tsx`, `pages/Clients/ClientsPage.tsx`, `pages/QTask/QTaskPage.tsx`, `pages/QTalk/RightPanel.tsx`, `pages/QProject/TasksTab.tsx`
- 원칙: `CLAUDE.md` (드로어 접근성 3훅, 반응형 드로어 3-구간 정책), 메모리 1건 추가 (`feedback_responsive_drawer.md`)

### 검증 결과
- 헬스체크 27/27 (반복)
- Phase A+B+C+D+E E2E 20/20 PASS
- Phase A 단독 24/24, Phase C 단독 10/10
- 라우트 12/12 전부 200
- 빌드 tsc 0 error, gzip ~422 kB

### 알려진 제약
- RRULE 단일 인스턴스 수정/삭제 미구현 (parent 건드리면 모든 인스턴스 영향)
- RRULE UNTIL/COUNT 미지원 (프리셋은 무한 반복)
- Daily.co API 키는 dev 키 (Irene 대시보드 발급). 프로덕션 배포 전 rotate 필요

---

## ✅ 완료: 대규모 세션 — 드로어·재클릭 토글·샘플 데이터·고객 관리 완성 (2026-04-20)

하루 세션에서 1) Task 드로어 추출·Gantt 공용화, 2) 브랜드 컨셉 최종화, 3) 반응형 Phase 0 토큰, 4) 공용 `<EmptyState>` + Q Talk 재설계, 5) Q Project 감사·샘플 시드 + `project_id` 이관 버그 수정, 6) Irene 3-역할 실데이터(owner/member/client), 7) 우측 패널 일반대화 섹션, 8) 고객 페이지 마스터-디테일 드로어 + 인라인 편집 + 활성 토글 + 히스토리, 9) 이메일 초대 API 준비 + 메일 시스템 출시 스프린트 보류 결정, 10) 캘린더 설계 확정.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **공용 컴포넌트** | `components/QTask/TaskDetailDrawer.tsx` 신규 (QTask/QProject 공용) | ✅ |
| **공용 컴포넌트** | `components/Common/GanttTrack.tsx` 공용 간트(스크롤 동기화·눈금·파스텔 바·today 마커). 3곳 재사용 | ✅ |
| **공용 컴포넌트** | `components/Common/EmptyState.tsx` 통일 (Q Note/Talk/Task 동일 스타일) | ✅ |
| **반응형 Phase 0** | `theme/breakpoints.ts` 토큰 + CLAUDE.md 3원칙 | ✅ |
| **재클릭 토글 원칙** | Q Talk/Note/Task/Project 리스트·드로어 전역 적용 + CLAUDE.md/메모리 명문화 | ✅ |
| **Q Talk 재설계** | `POST /api/conversations` 독립 대화 생성. 프로젝트 선택적 연결. NewChatModal 신규. 프로젝트 자동 채널 제거 | ✅ |
| **Q Talk UX** | 좌측 필터 탭 제거 (미동작 코드). 채팅방 단위 `?project=X&conv=Y` URL 싱크. 재진입 복원 | ✅ |
| **Q Talk 우측패널** | 프로젝트 미선택 시 패널 숨김. 중앙 empty state 공용 EmptyState 적용 | ✅ |
| **Q Note** | 좌측 헤더·검색 border 통일. main 배경 #FFFFFF. Layout height 100vh (바닥 회색 제거). 세션 상태 pill Q Task 통일 | ✅ |
| **Q Task** | 리스트 빈 상태 Q Note 스타일 EmptyState + CTA. 뷰 모드 `?view=` URL 싱크. scope 별 인사이트 영역 (전체업무/요청하기/workspace) | ✅ |
| **Q Project 감사** | `docs/QPROJECT_AUDIT.md` 신규 — 미구현 목록 3단계 우선순위. 샘플 6 시나리오 시드 (A~F) | ✅ |
| **Q Project 연동** | `PUT /tasks/by-business/:bizId/:id` 에 `project_id` 이관 허용 (버그 수정). 검증 13/13 PASS | ✅ |
| **프로젝트 완료 처리** | 상세정보 탭 상태 3-segment (active/paused/closed). closed 모달 + 고객 체크박스 내보내기. 대화 자동 archived cascade | ✅ |
| **Irene 3-역할** | 워프로랩(owner) 실데이터, PlanQ 테스트(member) 6 프로젝트+21 업무, 브랜드 파트너스(client) 2 프로젝트+8 업무+4 대화 시드 | ✅ |
| **고객 페이지** | 마스터-디테일 드로어 (Linear/Pipedrive 패턴). 헤더 아바타+인라인 편집+활성 Switch, 연락처·메모·프로젝트·대화·히스토리 섹션 | ✅ |
| **고객 hard delete** | `DELETE /api/clients/:id` + ProjectClient 자동 정리 + removal-impact API + 경고 모달 | ✅ |
| **고객 초대** | `POST /api/clients/:bizId/invite` 이메일 기반 신규 초대 + 모달 UI + 프로젝트 고객 탭 "초대 대기/참여 중" pill | ✅ |
| **AuditLog** | client.invited/activated/archived/updated/deleted + project.client_added/removed 훅. 미들웨어 camelCase/snake_case 호환 | ✅ |
| **사이드바** | Business→**워크스페이스**, Features→**기능**, Admin→**관리**. Main 섹션 라벨 제거 | ✅ |
| **브랜드 컨셉** | `docs/BRAND_CONCEPT.md` 신규 10섹션. 슬로건 "일을 일답게 하다" / "일이 일이되지 않게". Q 이중의미 확장 | ✅ |
| **로그인 슬로건** | auth.json tagline "요청은 Queue로…" → "일이 일이되지 않게, PlanQ" 교체 | ✅ |
| **빈 상태 텍스트** | Q Note "기록을 시작해 보세요" / Q Talk "대화를 시작해 보세요" (중앙+우측 분리) | ✅ |
| **URL 싱크 확장** | Q Task `?view=list/kanban`. Q Project TasksTab `?view=split/list/timeline/calendar`. 모든 드로어 `?task=:id` 싱크 | ✅ |
| **파스텔 간트** | Gantt 바 `fg 진함` → `bg 파스텔 + border-left 3px fg + fg text` 로 정돈 | ✅ |
| **로드맵** | 메일 시스템 3일 출시 스프린트 보류, 타임라인 드래그 3단계 백로그 유지, 캘린더 Phase A~E 설계 확정 | ✅ |

### 신규 파일
- `dev-frontend/src/components/Common/EmptyState.tsx`
- `dev-frontend/src/components/Common/GanttTrack.tsx`
- `dev-frontend/src/components/QTask/TaskDetailDrawer.tsx`
- `dev-frontend/src/theme/breakpoints.ts`
- `dev-frontend/src/pages/QTalk/NewChatModal.tsx`
- `docs/BRAND_CONCEPT.md` · `docs/QPROJECT_AUDIT.md`
- 시드 6종: `seed-project-samples.js`, `seed-client-samples.js`, `seed-client-samples-biz3.js`, `seed-conversations-biz3.js`, `seed-conversations-biz6.js`, `seed-irene-client-biz7.js`

### 주요 수정 파일
- Backend: `middleware/audit.js` (양쪽 호환), `routes/clients.js` (drawer detail + invite + history + hard delete), `routes/projects.js` (cascade·project_id 이관·client audit hooks), `routes/conversations.js` (독립 생성), `routes/tasks.js` (project_id 이관 버그 수정)
- Frontend: `pages/Clients/ClientsPage.tsx` (마스터-디테일 전면 재작성), `pages/QTalk/*` (재설계), `pages/QTask/QTaskPage.tsx` (드로어 추출), `pages/QProject/QProjectDetailPage.tsx` (상태 토글·멤버·고객 관리), `pages/QProject/TasksTab.tsx` + `ProjectTaskList.tsx` (Gantt 공용 적용), `pages/QNote/QNotePage.tsx` (레이아웃 통일), `components/Layout/MainLayout.tsx` (사이드바 라벨)
- 로케일: ko/en 7 파일 갱신
- 원칙: `CLAUDE.md` 3건 (반응형·재클릭 토글·UI 규칙), 메모리 2건 추가

### 검증 결과
- 헬스체크 27/27 통과 (반복)
- API 18건 PASS (client drawer/history + archive toggle + invite + cascade + project_id 이관 + removal-impact)
- 빌드 성공 · tsc 0 error · gzip ~414 kB

### 알려진 미구현 (다음 세션 후보)
- **캘린더 Phase A~E (약 5일)** — DB/API/월주일 뷰/반복/**Daily.co 임베드 + 수동 링크**/Q Task 통합 + 4필터 (전체/내/업무만/일정만). 색상은 프로젝트 색 자동 상속 + 카테고리 팔레트(개인일정). Daily.co 선택 이유: 스타트업 트렌드·임베드 API·Q Note 탭 캡처 호환
- 문서 탭 실파일 업로드 · 프로젝트 삭제 UI · F5-2b `/invite/:token` 랜딩
- 메일 발송 시스템 (출시 직전 스프린트로 보류)
- 반응형 Phase 1~5 (기능 완성 후 일괄)

---

## 🗺️ 개발 로드맵 (2026-04-20 확정)

### 현재 방침
- **기능 우선**. 반응형·하이브리드앱 대응은 기능 95% 완료 후 스프린트로 몰아서 수행.
- i18n (ko/en) 은 신규 코드마다 즉시 적용 (기존 규칙 유지, 별도 스프린트 불요).
- **신규 코드부터는 반응형 3원칙** (고정 px 금지 / 아이콘 36+ / 인라인 style 금지) 준수 — `CLAUDE.md`·`theme/breakpoints.ts` 참조.

### 남은 기능 (우선순위)
1. ✅ **멤버 관리** — 프로젝트 상세정보 탭 (2026-04-20 완료)
2. **프로젝트 문서 탭 실구현** — 업로드·리스트·다운로드. 기존 files API 재사용. `docs/QPROJECT_AUDIT.md` 참조 🔴
3. **프로젝트 상태 토글 UI** — active/paused/closed 전환. 헤더 또는 상세정보 🔴
4. **프로젝트 삭제 UI** — 파괴적이므로 확인 모달 + cascade 정책 정리 🔴
5. **F5-2b 초대 랜딩 페이지** `/invite/:token`
6. **Q Talk NewChatModal** — 프로젝트 연결 + 참여자 선택 간소 모달
7. **lua 팀원 계정 세팅** — 실제 협업 테스트 환경
8. **NewProjectModal 채팅 채널 유연화** (0~N개)
9. **Q Talk Cue 자동 추출 트리거** (청크 5)
10. **Dashboard** (위젯 범위 합의 선행)

### 유보된 UX 개선 (후일)
- 프로젝트 아카이브/복제, 멤버 역할 프리셋, 색상 커스텀 입력
- 멤버 제거 시 담당 업무 재할당 UX
- 프로세스/문서 탭 빈 상태 CTA

### 반응형·하이브리드앱 스프린트 (기능 95% 이후)

| Phase | 내용 | 예상 |
|---|---|---|
| **Phase 0** ✅ | 브레이크포인트 토큰 + 3원칙 명문화 (2026-04-20 완료) | 완료 |
| Phase 1 | MainLayout 사이드바 햄버거화 + 하단 탭바 | 1일 |
| Phase 2 | Q Talk / Q Task 마스터-디테일 패턴 | 2일 |
| Phase 3 | Q Project 상세 + TasksTab 모바일 | 1일 |
| Phase 4 | Q Note 모바일 (회의 모드 세로 2단) | 1일 |
| Phase 5 | 터치 타겟(44×44) + 폰트 16+ 일괄 상향 | 0.5일 |
| 출시 직전 | Capacitor 하이브리드앱 래핑 (아이콘/스플래시/푸시) | 0.5일 |
| **소계** | Phase 1~5 + 래핑 | **약 6일** |

브레이크포인트: `phone ≤640 / tablet ≤1024 / desktop ≥1025`. 모바일 웹이 곧 하이브리드앱 UI.

### 유보 (후일 업데이트)
- **타임라인 바 드래그 수정** — 3단계 로드맵. 1단계(반나절) 바 전체 드래그+1일 스냅, 2단계(하루) 왼/오 핸들 분리, 3단계(하루+) 행간 이동·충돌 해결. 실수 방지 위해 Ctrl 드래그·Undo 토스트 권장.
- **메일 발송 시스템 — 출시 직전 스프린트 (2026-04-20 결정)**. 약 3일:
  1. `business_mail_configs` 테이블 (SMTP + from_address, 비밀번호 암호화) — 0.5일
  2. `/business/settings/mail` 페이지 (Nodemailer SMTP 설정 + 테스트 발송) — 0.5일
  3. 초대 이메일 템플릿 (ko/en) + 발송 라우트 — 0.5일
  4. `/invite/:token` 수락 랜딩 + 메시지 연결 (F5-2b) — 1일
  5. 실패 재시도 + AuditLog — 0.5일
  - **추천 스택:** Resend API (SPF/DKIM 자동, 무료 3,000통/월) + SMTP 병행 옵션
  - **이유:** 현재 사용자가 Irene+lua 뿐이라 수동 링크 복사로 충분. 반응형 스프린트와 같은 출시 직전 타이밍에 묶어서 처리가 효율적.

---

## ✅ 완료: 프로젝트 상세 업무 드로어 + 공용 Gantt + 반응형 로드맵 (2026-04-20)

- **TaskDetailDrawer 공용 컴포넌트** — QTaskPage 2200줄에서 드로어 전부 `components/QTask/TaskDetailDrawer.tsx` 로 추출. QProjectDetailPage TasksTab 에서 재사용 → 같은 페이지 오버레이로 상세 열기 (URL `?task=:id` 싱크).
- **GanttTrack 공용 프리미티브** — `useGanttScrollSync` / `<GanttHeader>` / `<GanttRowTrack>` / `<GanttBar>` 를 `components/Common/GanttTrack.tsx` 로 추출. ProjectTaskList 스플릿 뷰 + TasksTab TimelineView 양쪽 재사용. 스크롤바는 헤더 하나만, 모든 행 숨김 + 동기화. 파스텔 bg + fg border+text 로 톤 통일.
- **TasksTab 뷰 URL 싱크** — `?view=split/list/timeline/calendar`. 기본 split 생략.
- **리스트 뷰 개선** — 컬럼 폭 확장 + 우측 설명 컬럼 추가 (업무 설명 2줄 클램프). 제목이 전폭 먹던 "우측 쏠림" 해결.
- **타임라인/캘린더 뷰 정보 강화** — 상태 pill, 담당자, 진행률 표시. Q Task 관점별 i18n 라벨 `getStatusLabel()` 사용.
- **상태 라벨 통일** — ProjectTaskList 로컬 STATUS_LABEL 제거, `utils/taskLabel.ts` + `utils/taskRoles.ts` 사용. 관점(담당자/요청자/컨펌자/관찰자)별 라벨 자동 적용. 드롭다운도 `statusOptionsFor` (요청업무 vs 일반업무 분기).
- **드로어 UX** — Backdrop 추가 (rgba(15,23,42,0.12)). 바깥 클릭 시 닫힘. Q Task 상세/추가 드로어 + 프로젝트 업무 추가 드로어 공통.
- **업무 추가 패턴** — 상단 버튼 → 우측 오버레이 드로어 (Q Task 패턴). 하단 링크 → 표 아래 인라인 폼 (margin-top:16px 간격). QTaskPage 도 동일.
- **로그인 슬로건 교체** — "요청은 Queue로, 실행은 Cue로" → "일이 일이되지 않게, PlanQ". 브랜드 컨셉 최종화에 맞춤.
- **브랜드 컨셉 문서** — `docs/BRAND_CONCEPT.md` 신규 (10섹션). 메인 슬로건 "일을 일답게 하다, PlanQ" / 서브 "일이 일이되지 않게, PlanQ". Q 이중의미(Cue 메인 + Queue 서브) 확장. 컬러 Deep Teal 풀 팔레트.
- **반응형 Phase 0** — `theme/breakpoints.ts` (phone ≤640 / tablet ≤1024) + CLAUDE.md 3원칙 명문화.
- **백엔드** — `GET /projects/:id/tasks` 응답에 `assignee/requester/reviewers` include 추가 (상태 라벨 계산에 필요).

### 수정 파일
- `components/QTask/TaskDetailDrawer.tsx` (신규), `components/Common/GanttTrack.tsx` (신규), `theme/breakpoints.ts` (신규)
- `pages/QTask/QTaskPage.tsx` (드로어 추출·Add 드로어 backdrop·리스트 하단 add link), `pages/QProject/TasksTab.tsx` (뷰 URL 싱크·Add 드로어·Timeline/Calendar 정보강화), `pages/QProject/ProjectTaskList.tsx` (공용 Gantt 적용·상태 라벨 i18n·설명 컬럼)
- `public/locales/{ko,en}/auth.json` (슬로건 교체)
- `routes/projects.js` (tasks include)
- `CLAUDE.md` (반응형 3원칙), `docs/BRAND_CONCEPT.md` (신규)

---

## ✅ 완료: Q Task 결과물 편집기 + Q Project 상세 허브 + Q Talk 정비 (2026-04-19)

하루 세션에서 Q Task 드로어(리치 에디터/첨부/오버레이), Q Project 상세 페이지 전체(5탭), Q Talk 일부 정비를 동시 추진. Q Task 는 상세 드로어가 Notion 스타일 편집·첨부·실시간 저장 상태 뱃지까지 완성, Q Project 는 신규 라우트 `/projects/p/:id` 에 대시보드/업무/프로세스 파트/고객/문서/상세정보 6탭 구현, Q Talk 은 첫 방문 시 모든 프로젝트의 채팅방 로드 및 새 프로젝트 모달에 채팅 채널 설정(이름+참여자) UI 추가.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **Q Task 드로어** | Linear 패턴 오버레이 드로어 (position:fixed, 420~1000px 드래그 리사이즈). 기본 우측 패널 유지 + 드로어가 오버레이 | ✅ |
| **Q Task 드로어 섹션 순서** | 액션 → 설명 → 댓글 → 결과물 → 첨부 → 접기(컨펌자/히스토리/일일기록) | ✅ |
| **Q Task description/body 분리** | description = 짧은 설명(plain), body = 결과물(리치 HTML). DB `tasks.body LONGTEXT` 추가 | ✅ |
| **TipTap 리치 에디터** | `/` 슬래시 커맨드(9종 블록) + BubbleMenu + 이미지 붙여넣기/드래그. 설치: `@tiptap/react @tiptap/starter-kit @tiptap/extension-link/image/placeholder/task-list/task-item @tiptap/suggestion @tiptap/extension-bubble-menu` | ✅ |
| **Task/Comment 첨부** | `task_attachments` 테이블(context ENUM description/task/comment) + multer + 공개 UUID 경로(`/public/attach/:storedName`) | ✅ |
| **저장 상태 pill** | saveTaskField 에 saving/saved/error 상태 + 드로어 헤더 배지. description·body 2초 debounce 자동저장 | ✅ |
| **드로어 닫기 3종** | X 버튼 / Esc / 좌측 빈 영역 클릭 | ✅ |
| **상세 URL 싱크** | `?task=:id` 쿼리로 싱크, 새로고침 시 자동 복원 | ✅ |
| **제목 인라인 편집** | 드로어 제목 클릭 → 인라인 input, Enter/blur 저장 | ✅ |
| **기간 CalendarPicker** | 드로어 + 업무 추가 폼 + 새 프로젝트 모달 모두 공용 CalendarPicker 사용 | ✅ |
| **Q Task 로딩 최적화** | 첫 페인트는 allTasks + members만, 탭 전환 시 lazy load (week/requested/all 각 1회) | ✅ |
| **Q Project `/projects/p/:id`** | 6 탭: 대시보드 · 업무 · 테이블(프로세스 파트, 이름 편집) · 고객 · 문서 · 상세정보 | ✅ |
| **projects 테이블 확장** | `project_type` ENUM(fixed/ongoing) + `process_tab_label` VARCHAR 추가 | ✅ |
| **createProject 고도화** | 오너 자동 project_members + customer/internal 2채널 자동 생성 + participants 커스텀 지원 + 기본 상태 옵션 4종 seed | ✅ |
| **프로세스 파트 테이블** | `project_process_parts` (depth1~3/description/status_key/link/notes/extra JSON/order_index) + CRUD + 드래그 순서 변경 | ✅ |
| **프로세스 파트 확장** | `project_status_options` (커스텀 상태) + `project_process_columns` (사용자 정의 컬럼) + 관리 모달 | ✅ |
| **대시보드 구성** | 기본정보 → 고객정보 → 연결된 채팅방 → 진척 → 주요 이슈 → 프로젝트 메모 → 업무 타임라인(최하단) | ✅ |
| **프로젝트 업무 탭** | Q Task 테이블 디자인 복제(ColRow/TRow/TCell/StatusPill/SliderWrap/DateTrigger/NameChip/DelayBadge/DetailBtn). 기본 뷰 = 리스트 + 타임라인 바 통합. 리스트/타임라인/캘린더 4뷰 | ✅ |
| **상세정보 탭** | 2열 그리드 풀폭. 기본정보(이름/고객사/타입/기간/색상/설명) 편집 + 채팅방 + 이슈 + 메모 | ✅ |
| **NewProjectModal 확장** | 프로젝트 타입 카드(fixed/ongoing) + CalendarPicker 기간 + 색상 팔레트 + **채팅 채널 섹션(이름·참여 멤버)** | ✅ |
| **고객 탭 CRUD** | 프로젝트 고객 추가/삭제 (invite_token 생성) | ✅ |
| **대시보드 이슈/메모** | 프로젝트 레벨 이슈·메모 Enter 저장 (IME + submittingRef 가드, 중복 저장 버그 수정) | ✅ |
| **Q Talk 전체 프로젝트 채팅** | 첫 로드 시 모든 프로젝트의 conversations 병렬 로드 — 직접 /talk 진입해도 채팅 리스트 표시 | ✅ |
| **프로세스 파트 url 필드 리네임** | SSRF 미들웨어 `url` 파라미터 충돌 → `link` 로 변경 | ✅ |
| **PlanQSelect 기본 placeholder** | "선택하세요" → "선택하기" | ✅ |
| **/projects 리스트** | `+ 새 프로젝트` 버튼 + 클릭 시 `/projects/p/:id` 이동 | ✅ |
| **App 라우팅** | `/projects/p/:id` → `QProjectDetailPage` | ✅ |
| **문서화** | `UI_DESIGN_GUIDE` 1.7~1.9(액션 버튼 3톤·중복 제출·URL 싱크), `FEATURE_SPEC` F5-24/24-a/25(프로세스 파트) + F6 Q Task 재작성, `CLAUDE.md` UI 규칙 3건 추가 | ✅ |
| **메모리** | 액션 버튼 3톤 원칙, 상세 패널 URL 싱크 — 2건 추가 | ✅ |

### 신규 파일

**백엔드**
- `models/TaskAttachment.js` / `ProjectStatusOption.js` / `ProjectProcessColumn.js` / `ProjectProcessPart.js`
- `routes/task_attachments.js` / `project_process.js`

**프론트엔드**
- `components/Common/RichEditor.tsx` / `SlashCommand.ts` / `SlashCommandList.tsx`
- `components/QTask/TaskAttachments.tsx`
- `pages/QProject/QProjectDetailPage.tsx` / `TasksTab.tsx` / `ProjectTaskList.tsx` / `ProcessPartsTab.tsx`

### 수정 파일

- `models/Project.js` (project_type + process_tab_label), `models/Task.js` (body LONGTEXT), `models/index.js` (어소시에이션)
- `routes/projects.js` (createProject 채널·참여자·상태seed + 고객 추가 API + put project_type/process_tab_label)
- `routes/tasks.js` (body/start_date 허용, detail에 comment.attachments include)
- `server.js` (신규 라우트 마운트)
- `App.tsx` (`/projects/p/:id` 라우트)
- `pages/QTask/QTaskPage.tsx` (드로어 재설계, 로딩 최적화, 자동저장 pill, 제목 인라인 편집 등)
- `pages/QProject/QProjectPage.tsx` (새 프로젝트 버튼 + 네비게이션)
- `pages/QTalk/QTalkPage.tsx` (전체 프로젝트 conversations 병렬 로드)
- `pages/QTalk/NewProjectModal.tsx` (타입·색상·채널 섹션)
- `components/Common/PlanQSelect.tsx` (placeholder 기본값)
- `public/locales/{ko,en}/qtask.json` (신규 키 다수)

### DB 마이그레이션
- `projects.project_type` ENUM('fixed','ongoing')
- `projects.process_tab_label` VARCHAR(80)
- `tasks.body` LONGTEXT
- 신규 테이블: `task_attachments`, `project_status_options`, `project_process_columns`, `project_process_parts`

### 검증 결과
- 헬스체크 27/27 통과
- 최신 빌드: tsc 0 error, gzip ~400 kB
- E2E:
  - 프로젝트 플로우 17/17 (fixed/ongoing 생성, 오너 자동 참여, 2채널 자동 생성, 프로세스 파트 CRUD, 커스텀 상태/컬럼, 타 biz 403)
  - 첨부 15/15 (description/body HTML 왕복, 3개 context 업로드, 공개 이미지 경로, .sh 거부, 401/403)
  - 채널 커스텀 7/7 (기본/커스텀 이름 + 참여자)

### 알려진 미구현 (다음 세션)
- **타임라인 바 드래그 — 후일 업데이트 개발로 유보 (2026-04-20 결정)**. 3단계 로드맵:
  - 1단계 (반나절) — 바 전체 드래그 양쪽 동시 이동, 1일 스냅, 드래그 중 로컬 state, 드롭 시 API 저장
  - 2단계 (하루) — 왼쪽/오른쪽 핸들 분리 드래그, 드래그 중 날짜 툴팁, 제약 검증
  - 3단계 (하루+) — 행간 드래그로 담당자/상태 변경, 충돌 해결 UX, 키보드 네비, 스냅 단위 선택
- **프로젝트 생성 시 채팅 채널 추가/제거** (현재 customer+internal 2개 고정)
- **문서 탭** 실제 파일 리스트 + 업로드
- **멤버 관리** (상세정보 탭에서 추가/제거/역할)
- **Q Talk NewChatModal** (프로젝트 연결 + 참여자 지정 간소 모달)
- **F5-2b 초대 랜딩 페이지** `/invite/:token`
- **Q Talk 청크 5** — Cue 자동 추출 트리거
- **Dashboard** 페이지 구현
- **lua 팀원 계정 세팅**

---

## ✅ 완료: Q Task UI 재정비 + 문서화 (2026-04-19)
> **데이터베이스:** planq_dev_db (MySQL) + qnote.db (SQLite, FTS5)
> **프로젝트:** B2B SaaS — 업무 전용 고객 채팅 + 실행 구조 통합 OS
> **로드맵 상세:** `docs/DEVELOPMENT_ROADMAP.md`

---

## ✅ 완료: Q Task UI 재정비 + 문서화 (2026-04-19)

Phase D(탭 뱃지)·E(세그먼트) 1차 구현 후 Irene 피드백 반영 대폭 재설계. 세그먼트는 과잉 분할이라 제거, 뱃지 의미는 "받은/보낸 업무요청에서 내 할 일"로 재정의, 우측 패널에 상응 섹션 신설. 액션 버튼은 상태별 색칠에서 Primary/Secondary/Danger 3톤으로 통일. 업무 추가 폼 확장 + 중복 제출 가드 + 상세 패널 URL 싱크 추가. 히스토리 라벨은 "컨펌" 접두어로 의미 명확화. 관련 설계 규칙은 `UI_DESIGN_GUIDE` 와 `FEATURE_SPECIFICATION` F6 에 명문화.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **세그먼트 제거** | `내 전체업무` 안의 담당/컨펌 서브탭 제거 — 통합 리스트 복원. 역할은 이름 칩으로 구분 | ✅ |
| **미배정(백로그) 섹션 제거** | 전체업무 탭 하단 중복 섹션 + backlog API 로드 제거 | ✅ |
| **탭 뱃지 재정의** | 이번 주=받은+보낸 합산 / 전체업무=From Q Talk / 요청하기=보낸. 정의는 F6-1 명기 | ✅ |
| **우측 패널 신설** | 이번 주: `받은 업무요청 (N)` + `보낸 업무요청 (N)` 카드 섹션 / 요청하기: 같은 `보낸 (N)` 섹션 + 피드백 | ✅ |
| **From Q Talk 추가 플로우** | `+ 업무로 추가` 클릭 → 등록 성공 즉시 `openDetail()` 호출, 상세 패널에서 담당자/기간/설명 바로 수정 | ✅ |
| **액션 버튼 3톤** | $fill prop(상태색) 제거. Primary(teal #14B8A6)/Secondary(회색 outline)/Danger(에러 outline) 3종만 사용. `requestRevision`/`submitRevision` 은 Danger | ✅ |
| **업무 추가 폼 확장** | 프로젝트/담당자/시작일/마감일/예측(h)/설명 선택 입력. 전부 비우면 제목만으로 저장. 중복 방지: `addingSubmitting` 가드 + disabled. Enter 단독 저장 금지, Ctrl+Enter | ✅ |
| **백엔드 start_date 허용** | `POST /api/tasks` 에 start_date 파라미터 허용 | ✅ |
| **상세 패널 URL 싱크** | `?task=:id` 쿼리로 싱크. 새로고침/URL 공유 시 상세 자동 재오픈, 닫기 시 제거 | ✅ |
| **컨펌자 정책 토글 UX** | "승인 기준" 라벨 제거, 버튼 문구만으로 전달. 컨펌자 2명 이상일 때만 표시 (1명이면 무의미) | ✅ |
| **히스토리 이벤트 라벨** | 컨펌 접두어로 의미 명확화. "확인/승인/결정" 같은 모호한 단어 교정. 예: `policy_change` = "컨펌 정책 변경" | ✅ |
| **액션 버튼 라벨** | `resubmitReview` "수정 반영 후 재요청" → "수정 반영 후 **재확인요청**" (재요청은 요청자 측 어휘여서 담당자 버튼에 부적합) | ✅ |
| **문서화** | `UI_DESIGN_GUIDE` 1.7 액션 버튼 3톤 + 1.8 중복 제출 가드 + 1.9 URL 싱크 / `FEATURE_SPECIFICATION` Phase 6 재작성 (F6-1 ~ F6-10) | ✅ |

### 수정된 파일

**프론트엔드**
- `pages/QTask/QTaskPage.tsx` — 세그먼트 제거/뱃지 재정의/우측 패널 신설/업무 추가 폼 확장/URL 싱크/액션 버튼 3톤
- `public/locales/{ko,en}/qtask.json` — right/add/detail.actions/detail.reviewers/detail.history.event 키 정리

**백엔드**
- `routes/tasks.js` — POST /api/tasks start_date 허용

**문서**
- `dev-frontend/UI_DESIGN_GUIDE.md` — 1.7 ~ 1.9 신규 섹션
- `docs/FEATURE_SPECIFICATION.md` — Phase 6 (Q Task) 재작성
- `DEVELOPMENT_PLAN.md` — 이 세션 기록
- `CLAUDE.md` — 자동저장 섹션에 중복 제출 가드 원칙 1줄 추가

### 검증
- 빌드 성공 (gzip 253 kB, tsc 0 error)
- DB 기준 뱃지 기대값 계산 검증 (biz=3 irene: week=3, all=n/a, requested=1)
- 컨펌자 1명/2명 토글 분기 확인

### 다음 할 일 (다음 세션 시작점)

1. **Clients 초대/편집 UI** (F5-2b 포함)
2. **Q Talk 청크 5** — Cue 자동 추출 트리거 (post-insert hook)
3. **Q Project 상세 페이지** `/projects/:id` (대시보드/업무/문서/고객/AI 5탭)
4. **Dashboard** (위젯 범위 합의 필요)
5. **lua 팀원 계정 세팅**

---

## ✅ 완료: Q Task Phase C — 상세 패널 액션 매트릭스 + 컨펌자/히스토리 UI + 종류별 스테이지 (2026-04-19)

워크플로우 Phase 1~B 에서 쌓은 백엔드를 실제 조작 가능한 UI 로 연결. 상세 패널에 역할별 액션 카드 (담당자/컨펌자), 컨펌자 섹션(정책 토글·추가/제거·경고), 히스토리 타임라인, 상태 드롭다운(자유 전환), 라운드 뱃지 추가. 리스트/카드 뷰 선택 표시 통일, 상태 드롭다운 오버플로우 이슈 해결, 버튼 색 = 도착 상태 색 매핑. 일반 업무 vs 요청 업무 스테이지 분기 — `waiting` 은 요청 업무에만 노출, `not_started` 는 요청+미ack일 때 "업무요청 받음" 라벨. "이번 주 내 업무" 필터 확장 — 담당자 외에 컨펌자(pending)인 업무도 포함. irene 계정 biz=3 에 시나리오 시드 19건 배치.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **상세 패널 액션 카드** | 역할별(담당자/컨펌자) 블록 분리. 상태별 노출: ack / start / submit / cancel-review / resubmit / complete / approve / revision(인라인 폼) / revert. 버튼 색 = 도착 상태 색. Disabled 버튼 은닉 (전제 미충족 시 버튼 자체 숨김) | ✅ |
| **컨펌자 섹션** | 리스트(이름+state 뱃지+제거), 정책 토글(all/any), 추가 드롭다운(멤버 후보), 진행 중 라운드에 추가 시 경고 다이얼로그 ("이미 승인 N명 다시 검토 필요") | ✅ |
| **히스토리 타임라인** | event_type 별 컬러 도트(approve/revision/ack/completed 등), actor→target 표기, round 뱃지, note, 시간. 기본 최근 5개 + 모두 보기 토글 | ✅ |
| **상태 드롭다운 (자유 전환)** | 상태 뱃지 클릭 → 원하는 단계로 자유 전환. 리스트/상세 dropdown 상태 분리 (동시 열림 버그 수정). 업무 종류별 옵션 다름: 요청 업무 = 8단계(waiting 포함), 일반 업무 = 7단계(waiting 제외) | ✅ |
| **종류별 라벨** | not_started + 요청업무 + 미ack → "업무요청 받음" 라벨. 그 외는 기본 상태 라벨. 관점(담당자/요청자/컨펌자/관찰자) 별 라벨 자동 적용 | ✅ |
| **선택/지연 시각 UX** | 카드/리스트 모두 선택 시 로즈 좌측 3px 라인, 리스트 선택 시 옅은 배경. 지연 행: 배경 없이 빨간 좌측 라인만. 카드 지연: 우상단 "지연" 뱃지로 분리 | ✅ |
| **상세 버튼 확대/토글** | 리스트의 `>` 버튼 20×20 → 28×28, 활성 시 로즈 배경 (열림 표시). 다시 누르면 닫힘 | ✅ |
| **라운드 뱃지** | reviewing/revision_requested/done_feedback 상태에서 `R1/R2…` 뱃지 상태 뱃지 옆 노출 | ✅ |
| **인라인 이름 칩 (요청자/담당자)** | 요청자/담당자 별도 컬럼 제거. 업무명 옆 3색 이름 칩: 🌹 내가 받은 요청의 요청자 / 🟢 내가 보낸 요청의 담당자 / ⚪ 워크스페이스 타인 담당 | ✅ |
| **정렬 null 처리** | due_date 정렬에서 null 을 `Infinity` 숫자로 치환하여 string localeCompare 에서 NaN 나던 버그 수정 → nulls-last 원칙 | ✅ |
| **상태 드롭다운 오버플로우** | TCell `overflow:hidden` 에 dropdown 잘리던 문제 — 해당 셀만 `overflow:visible` | ✅ |
| **"이번 주" 필터 확장** | 담당자(행동 필요 상태) + 컨펌자(pending + reviewing/revision_requested) 조합. 단순 요청자 대기는 제외 (내가 행동할 게 없으므로) | ✅ |
| **완료 상태 색상** | 진녹 → 슬레이트 그레이 (#E2E8F0 / #475569). 완료 뱃지/컬럼/버튼 전부 통일 | ✅ |
| **백엔드 API 확장** | `/api/projects/workspace/:bizId/all-tasks` 응답에 `reviewers` 포함 → 프론트 "내가 컨펌자" 판정 가능 | ✅ |
| **i18n 키 추가** | `detail.actions.*` (ack/start/submit/resubmit/cancelReview/complete/completeSimple/approve/requestRevision/revision*/revert*/roundTip 등 20+), `detail.reviewers.*` (policy/state/warn/add/remove), `detail.history.event.*` (10개), `detail.back/description/dailyLog/comments 등` (ko/en 동시) | ✅ |
| **시드 스크립트** | `scripts/seed-qtask-workflow-test.js` — irene 활성 biz(워프로랩 3) + `워크플로우 테스트` 프로젝트에 19건 (M1~M8 일반, R1~R6 받은 요청, S1~S3 보낸 요청, C1~C2 컨펌자). idempotent (`[WF]` 접두사 기반) | ✅ |

### 수정된 파일

**백엔드**
- `routes/projects.js` — all-tasks 응답에 reviewers include
- `scripts/seed-qtask-workflow-test.js` (신규)

**프론트엔드**
- `pages/QTask/QTaskPage.tsx` — 상세 패널 확장, 액션 카드, 컨펌자/히스토리 섹션, 상태 드롭다운 분리, 드롭다운 종류별 분기, 선택 UX, 인라인 이름 칩, week 필터 확장
- `utils/taskLabel.ts` — completed 색상 그레이 전환
- `public/locales/{ko,en}/qtask.json` — detail.* 20여 개 키 추가, common.cancel 추가

### 검증 결과
- 헬스체크 27/27 통과
- 빌드 성공 (gzip ≈ 250 kB)
- 시드 idempotent — 재실행 시 기존 [WF] 전체 삭제 후 재생성
- 백엔드 재시작 후 reviewers 필드 정상 응답 확인

### 다음 할 일 (다음 세션 시작점)

**Phase D — 탭 뱃지 카운트**
- 이번 주 탭: 미확인 요청(task_requested) + 내가 리뷰어 pending 수
- 요청하기 탭: 결과 대기 중(reviewing) 수
- 전체업무 탭: 수정요청 받은(revision_requested) 수

**Phase E — "내 전체업무" 의미 정리**
- 현재 assignee=me OR reviewer=me 합쳐놓음. UX 리뷰 필요
- 필터 명확화 (역할별 탭 vs 합산)

**기타 백로그**
- Q Project 상세 페이지 (`/projects/:id`)
- Q Talk 청크 5 — Cue 자동 추출 트리거
- Clients 초대/편집 UI (F5-2b)
- Dashboard 구현
- lua 팀원 계정 세팅

---

## ✅ 완료: 타임존 백엔드 연결 + Q Talk 청크3 + Q Project 신규 + Q Task 워크플로우 재설계 (2026-04-19)

한 세션에서 대형 개선 다수 수행. 타임존 실데이터 연결 + 전역 tz 표시 통일, Q Talk 업무 추출 실동작, Q Project 메뉴/페이지 신규 (리스트/타임라인/일정 3뷰 + 프로젝트 색상), Q Task 상태 머신 재설계 (멀티 컨펌자 + 관점별 라벨 + 탭별 카드 칸반).

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **타임존 백엔드 연결** | `users.timezone`/`reference_timezones`, `businesses.reference_timezones` JSON 필드 추가. `PUT /api/users/:id`/`/businesses/:id/settings` 확장. `useTimezones` 훅을 localStorage → API 기반으로 교체. `/api/auth/me`에 workspace_timezone 노출 | ✅ |
| **전역 tz 표시 통일** | `utils/dateFormat.ts` + `hooks/useTimeFormat.ts` 신규 (워크스페이스 tz 바인딩 포맷터). Q Talk·Q Note·Q Task·Clients·Profile 모든 시각 표시 통일. `utils/datetime.js` (백엔드 유틸). Q Task my-week/month/year + task_snapshot per-business tz 적용 | ✅ |
| **Q Talk 청크 3 — 업무 후보 추출 실동작** | task_extractor OpenAI 키 연결 (Q Note 에서 복사), 청크 3 E2E 13/13 통과, 배너/Cue 드래프트 UX 재정의, 업무명 규칙 정정 ("완료" 접미사 금지) | ✅ |
| **Q Task ↔ Q Talk 실시간 연동** | `business:{id}` Socket room 추가. task:new/updated/deleted 양방향 전파. QTaskPage Socket 리스너 | ✅ |
| **Q Project 신규 페이지** | `/projects` + `/projects/:view` 라우트, 리스트/타임라인/일정 3뷰, 프로젝트 색상 팔레트 (10색), 드릴다운 링크, 반응형 @media | ✅ |
| **Q Task 워크플로우 재설계 (Phase 1)** | 8 상태 ENUM (not_started/waiting/in_progress/reviewing/revision_requested/done_feedback/completed/canceled) + `task_reviewers` 멀티 컨펌자 테이블 + `task_status_history`. 워크플로우 API 13개 (ack/submit/cancel/approve/revision/revert/complete/reviewers CRUD/policy). 정책 all/any. FK CASCADE | ✅ |
| **Q Task 탭 재구성** | `/tasks` (내 업무) / `/tasks/workspace` URL 분리, 세그먼트 토글, 탭 이름 재정의 (이번 주/내 전체업무/요청하기), 담당자 컬럼 조건부, 업무 추가 UX (제목+담당자 인라인) | ✅ |
| **Q Task 관점별 라벨 (Phase A+B)** | `utils/taskRoles.ts`(getRoles/primaryPerspective) + `utils/taskLabel.ts`(displayStatus/getStatusLabel). i18n `status.{code}.{role}` 4차원 구조. 탭별 카드 칸반 카테고리 컬럼. 빈 컬럼 자동 숨김 | ✅ |
| **보기 모드 토글** | `/tasks` 에 리스트/카드 뷰 토글 (localStorage 유지). 리스트 뷰 컬럼 정렬 (flex-shrink 0, min-width 0). 반응형 breakpoint 기반 컬럼 숨김 | ✅ |
| **버그 픽스** | FK task_comments/task_daily_progress CASCADE, 보안 필터 hex 차단 완화, 업무 추가 중복(Socket+POST 경합), 상태 드롭다운 한 번 클릭 UX, 지연 업무 정렬 어긋남(box-shadow inset), i18n 캐시 무효화(BUILD_ID 쿼리), SQL regex pattern 과차단 | ✅ |
| **스킬 업데이트** | `.claude/commands/검증.md` 에 8단계 UI/UX 상세 템플릿 추가 (8-A~8-G) | ✅ |

### 수정된 파일 (주요, 총 60개)

**백엔드 (Node)**
- 신규: `models/TaskReviewer.js`, `TaskStatusHistory.js`, `routes/task_workflow.js`, `utils/datetime.js`
- 수정: `models/Task.js`(status ENUM 재정의 + 8 컬럼 확장), `TaskComment.js`(visibility/kind), `ProjectNote.js`(shared), `User.js`/`Business.js`(tz 필드), `Project.js`(color), `TaskDailyProgress.js`(CASCADE)
- 수정: `routes/tasks.js`(source 자동판정 + tz 경계 계산 + FK CASCADE), `projects.js`(color + candidate register socket), `users.js`/`businesses.js`/`auth.js`(tz API), `server.js`(business room + task_workflow mount)
- 수정: `services/task_extractor.js`(업무명 규칙 + 프롬프트), `task_snapshot.js`(per-biz tz), `middleware/security.js`(hex 허용)

**프론트엔드 (TS/TSX)**
- 신규: `utils/dateFormat.ts`, `projectColors.ts`, `taskLabel.ts`, `taskRoles.ts`, `hooks/useTimeFormat.ts`, `global.d.ts`, `pages/QProject/QProjectPage.tsx`, `public/locales/{ko,en}/qproject.json`
- 수정: `pages/QTask/QTaskPage.tsx` 전면 재작성 (스코프/탭/보기모드/필터/칸반/관점별 라벨)
- 수정: `pages/QTalk/QTalkPage.tsx`(query param project 파싱, 업무추출 안내), `ChatPanel.tsx`/`RightPanel.tsx`(배너/Cue 재정의), `NewProjectModal.tsx`(색상 swatch), `mock.ts`(legacy 제거)
- 수정: `pages/Settings/WorkspaceSettingsPage.tsx`(타임존 callout + useEffect 제거), `Profile/ProfilePage.tsx`, `Clients/ClientsPage.tsx`, `QNote/QNotePage.tsx`(시각 표시 훅)
- 수정: `App.tsx`(/tasks/:scope 라우트 + /projects 라우트), `MainLayout.tsx`(Q project 메뉴), `i18n.ts`(BUILD_ID 쿼리)
- 수정: `vite.config.ts`(BUILD_ID define), 모든 `locales/*.json`(status/scope/view/roleBadge/columnGroup 키)

**설계 문서**
- `docs/FEATURE_SPECIFICATION.md`(업무명 예시)
- `.claude/commands/검증.md`(8단계 UI/UX 상세 템플릿)

### 검증 결과
- 헬스체크 27/27 (매 Phase 통과)
- 워크플로우 API E2E 18/18 (ack·submit·approve·revision·revert·complete·정책 전환·FK CASCADE)
- 타임존 E2E 11/11 + per-biz snapshot 7/7
- 청크3 E2E 13/13 (extract/register/merge/reject)
- SPA 15/15 라우트 200
- 빌드 성공 (gzip 249.18 kB, tsc 0 error)

### 다음 할 일
**Phase C — Q Task 상세 패널 액션 버튼 매트릭스 (역할별)**
- 담당자: [요청 확인] / [확인 요청 보내기] / [확인 요청 취소] / [최종 완료]
- 컨펌자: [승인] / [수정 요청] (댓글 필수) / [내 결정 취소] (1회)
- 컨펌자 추가/제거 시 라운드 리셋 UI 경고
- 히스토리 타임라인 (task_status_history 렌더)

**Phase D — 탭 뱃지 카운트**
- 이번 주: 미확인 요청 개수
- 요청하기: 내가 컨펌해야 할 개수
- 전체업무: 수정요청 받은 개수

**기타 백로그**
- Q Project 상세 페이지 (`/projects/:id`) — 프로젝트 허브 (대시보드/업무/문서/고객정보/AI 탭)
- Q Talk 청크 5 — Cue 자동 추출 트리거
- Clients 초대/편집 UI (F5-2b 설계)
- Dashboard 구현 (placeholder)
- lua 팀원 계정 세팅

---

## ✅ 완료: 타임존 기능 + 페이지 레이아웃 표준화 (2026-04-17)

워크스페이스/개인 타임존 + 사이드바 시계, 3컬럼 페이지(Q Talk/Note/Task) + 단일 컬럼 페이지(Settings/Profile/Clients) 헤더 통일. 레이아웃 공통 컴포넌트 `PageShell`/`PanelHeader` 추가해 앞으로의 일관성 강제. 비즈니스 메뉴 분리(/settings, /members, /clients 3개 URL). Q Task 선커밋.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **타임존 UI 기반** | `utils/timezones.ts` (preset 30개 + Intl 지원) / `TimezoneSelector` 공통 컴포넌트 / `useTimezones` 훅 (localStorage mock) | ✅ |
| **사이드바 시계** | `SidebarClock` — 워크스페이스 기본 + 내 시간 + 참조 타임존 펼침, 도시·시간 1행, 가로선 풀폭, row 클릭 시 설정 페이지로 이동, 관리자만 워크스페이스 편집 | ✅ |
| **워크스페이스 타임존 탭** | Settings `timezone` 탭 신규 (프리뷰 카드 + 기본 select + 참조 칩) | ✅ |
| **개인 타임존 섹션** | Profile 페이지에 "내 타임존" 섹션 추가 (rose 톤 프리뷰 + 브라우저 기준 자동 감지 버튼) | ✅ |
| **레이아웃 공통 컴포넌트** | `PageShell` (단일 컬럼) + `PanelHeader`/`PanelTitle` (3컬럼) 신규 — 60px 헤더 / 18px-700 제목 / 14x20 padding 표준 잠금 | ✅ |
| **페이지 헤더 통일** | /profile, /business/settings, /business/members, /business/clients → PageShell 마이그레이션. 모든 헤더 동일 스타일 | ✅ |
| **패널 헤더 통일** | Q Talk 좌/중/우, Q Note 사이드바+메인, Q Task 메인+우측 모두 min-height 60px. 가로 border-bottom 수평 연결 | ✅ |
| **Q Note 사이드바 통일** | SearchBox/SessionList/SessionItem/EmptyMsg 를 Q Talk 기준으로 동일 스타일화 (active inset box-shadow, teal 포인트) | ✅ |
| **Business 메뉴 분리** | /business/settings (브랜드/법인/언어/타임존 4탭) + /business/members (멤버/Cue 2탭) + /business/clients 신규 ClientsPage | ✅ |
| **고객 페이지 신규** | `pages/Clients/ClientsPage.tsx` + `clients.json` i18n — 테이블 리스트, 검색, 초대 버튼 stub, `/api/clients/:businessId` 연결 | ✅ |
| **Q Talk ChatPanel 소속 인라인화** | 프로젝트 표시를 제목 아래 stack → 제목 우측 인라인 (세로선 구분) 으로 변경, 헤더 60px 유지 | ✅ |
| **Q Task 선커밋** | 이전 세션 미커밋 코드(QTask/Invite/CalendarPicker/task_extractor/task_snapshot/TaskComment/TaskDailyProgress) 커밋 65f5c2a | ✅ |
| **문서화** | `CLAUDE.md`에 "페이지 레이아웃 표준 (필수)" 섹션 추가 — PageShell/PanelHeader 강제 사용 명시 | ✅ |

### 수정된 파일 (주요)

**신규**
- `dev-frontend/src/utils/timezones.ts`
- `dev-frontend/src/hooks/useTimezones.ts`
- `dev-frontend/src/components/Common/TimezoneSelector.tsx`
- `dev-frontend/src/components/Layout/SidebarClock.tsx`
- `dev-frontend/src/components/Layout/PageShell.tsx`
- `dev-frontend/src/components/Layout/PanelHeader.tsx`
- `dev-frontend/src/pages/Clients/ClientsPage.tsx`
- `dev-frontend/public/locales/{ko,en}/clients.json`

**수정**
- `dev-frontend/src/App.tsx` — /business/* 라우팅 정비 (settings/members/clients)
- `dev-frontend/src/i18n.ts` — clients 네임스페이스
- `dev-frontend/src/components/Layout/MainLayout.tsx` — SidebarClock 통합, Business 메뉴 Features 아래로 이동
- `dev-frontend/src/pages/Settings/WorkspaceSettingsPage.tsx` — tab 분리 로직, timezone 탭, PageShell 사용
- `dev-frontend/src/pages/Profile/ProfilePage.tsx` — UserTimezoneSection, PageShell 사용
- `dev-frontend/src/pages/QTalk/{LeftPanel,ChatPanel,RightPanel}.tsx` — 헤더 60px, Search 분리, 프로젝트 인라인
- `dev-frontend/src/pages/QNote/QNotePage.tsx` — SidebarHeader/MainHeader 60px, 사이드바 스타일 통일, 새세션 버튼 아이콘화
- `dev-frontend/src/pages/QTask/QTaskPage.tsx` — Header/RightHeader 60px, RightTitle 복원
- `dev-frontend/public/locales/{ko,en}/{layout,profile,settings}.json` — timezone/clock/membersPage 키
- `CLAUDE.md` — 레이아웃 표준 섹션 추가

### 다음 할 일 (다음 세션 시작점)

**타임존 백엔드 연결** (UI mock 단계 완료, 실 데이터 연결 필요)
- DB 마이그레이션: `businesses.reference_timezones` JSON, `users.timezone` + `users.reference_timezones` JSON
- API: `PATCH /api/users/:id`에 timezone 필드 허용 + `PATCH /api/businesses/:id/settings`에 reference_timezones 확장
- 백엔드 유틸: `dev-backend/utils/datetime.js` (UTC ↔ tz 변환)
- 프론트: `useTimezones` 훅을 localStorage → API 기반으로 교체
- 기존 시간 표시 화면(Q Task 마감, Q Note 일시 등) UTC 기준으로 정규화

**기타**
- lua 팀원 계정 세팅 (Irene 지시 시 실행)
- Q Talk 청크 3 — 업무 후보 자동 추출

---

## ✅ 완료: 팀원 협업 환경 설계 + 서버 보안 점검 (2026-04-16)

서버 SSH/워크트리 구조 파악, 팀원(lua) 계정 추가를 위한 9개 영역 25개 항목 세팅 계획 수립. 코드 변경 없음 (계획 수립 세션).

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **서버 보안 점검** | SSH 유휴 타임아웃 설정 확인 (ClientAliveInterval 0 = 기본값, 서버 측 타임아웃 없음). 개발서버는 키 인증이라 현 상태 유지, 운영서버 시 설정 예정 | ✅ |
| **워크트리 구조 이해** | Claude Code 워크트리 동작 확인: Primary working directory 기준 생성, 변경 없으면 세션 종료 시 자동 정리 | ✅ |
| **팀원 협업 계획** | lua 계정 세팅 계획 수립 — 리눅스 계정/SSH 키/PlanQ 디렉토리 권한/POS 차단/DB 분리/PM2 제한/Git 설정/Claude Code 환경/보안 (9개 영역 25개 항목) | ✅ |

### 다음 할 일 (다음 세션 시작점)

**lua 팀원 계정 세팅 (Irene 지시 시 실행)**
- 리눅스 `lua` 계정 + `planq` 그룹 생성
- SSH 키페어 생성 + 비밀키 전달
- `/opt/planq/` 그룹 권한, `/var/www/` 차단
- MySQL `lua@localhost` (planq_dev_db만)
- PM2 sudoers 제한 (planq 프로세스만 restart)
- Git + Claude Code 환경 설정

**Q Talk 청크 3 — 업무 후보 자동 추출 (개발 작업)**
- Cue 오케스트레이터 확장, 커서 기반 LLM 호출
- task_candidates extract/register/merge/reject API
- 프론트 RightPanel candidates 실 API 연결
- E2E 검증

---

## ✅ 완료: Q Note 동시 녹음 방지 + Q Talk 프로젝트 중심 재설계 + 실데이터 연결 Chunk 1~2 (2026-04-15)

하루 동안 Q Note recorder lock, 테스트 계정 + 워크스페이스 스위처 (멀티 역할), Q Talk 전면 재설계 (프로젝트 중심, 채팅-first UI), 설계 문서 5개 갱신, 청크 1 프로젝트 CRUD 실데이터 + 시드, 청크 2 메시지 전송·채널 설정 실 API 완료.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **Q Note recorder lock** | 2탭 동시 녹음 차단: `sessions.active_recorder_token` + `recorder_heartbeat_at` 컬럼, acquire/heartbeat/release 엔드포인트, stale 12s, 프론트 fetch keepalive unload 핸들러, 5초 heartbeat, 다른 탭 4초 폴링. i18n ko/en. | ✅ |
| **테스트 계정 5종** | admin/owner/member1/member2/client @test.planq.kr — 비밀번호 Test1234!, idempotent 스크립트, 로그인 rate limit 화이트리스트. | ✅ |
| **로그인 퀵로그인 패널** | dev.planq.kr/localhost 에서만 노출, 5개 계정 클릭 로그인, full page nav 로 세션 충돌 방지. | ✅ |
| **워크스페이스 스위처** | `users.active_business_id` 컬럼, `/api/auth/me` 에 workspaces[] 배열 반환, `/api/auth/switch-workspace` 엔드포인트, 사이드바 상단 dark-teal 드롭다운 (WorkspaceSwitcher.tsx). irene 계정에 3 역할 × 3 워크스페이스 세팅 (워프로랩 owner / 테스트 member / 파트너스 client). E2E 14/14. | ✅ |
| **LanguageSelector 리디자인** | 사이드바 variant 풀폭 hit area + 다크 드롭다운, 흰 카드 제거, 두 컨트롤 시각 통일. | ✅ |
| **LetterAvatar 공용 컴포넌트** | 중성 회색 그라데이션 + active/cue variant, 프로젝트·멤버·고객 모두 동일 스타일. | ✅ |
| **Q Talk UI Mock (승인 전)** | 3단 레이아웃 + 좌/우 접기 + 5 섹션 아코디언 (이슈/내 할일/프로젝트업무/메모/정보) + 프로젝트 생성 모달 + 업무 후보 카드 + 채팅 flat 리스트 + 채팅 이름 인라인 편집 (mock.ts/LeftPanel/ChatPanel/RightPanel/NewProjectModal). | ✅ |
| **설계 문서 5개 갱신** | FEATURE_SPECIFICATION.md Phase 5 F5-0 ~ F5-24 재작성 + F5-2b 초대 링크 미가입/기가입 분기 명시 / INFORMATION_ARCHITECTURE.md 사이트맵/3단 레이아웃/고객 권한 필터 / DATABASE_ERD.md 섹션 6 신규 6 테이블 + 확장 DDL / API_DESIGN.md 섹션 11.5 Q Talk API / SECURITY_DESIGN.md 섹션 3.7 권한 매트릭스. | ✅ |
| **DB 마이그레이션 (청크 1~5 기반)** | 신규: `projects`/`project_members`/`project_clients`/`project_notes`/`project_issues`/`task_candidates`. 확장: `conversations`(project_id/channel_type/auto_extract/cursor), `messages`(reply_to/cue_draft_processing_*), `tasks`(project_id/from_candidate/recurrence/status ENUM), `business_members.default_role`. | ✅ |
| **Sequelize 모델** | Project, ProjectMember, ProjectClient, ProjectNote, ProjectIssue, TaskCandidate 신규 + Conversation/Message 필드 보강 + associations 14개 추가. | ✅ |
| **청크 1 프로젝트 CRUD API** | POST/GET(list)/GET(detail)/PUT/DELETE + PUT /members. 권한 검증 (owner/member/client), 생성자 자동 project_members 등록, 초대 토큰 자동 생성 (crypto.randomBytes 24). | ✅ |
| **청크 1 시드 스크립트** | `scripts/seed-qtalk-demo.js` idempotent — 테스트 워크스페이스 3 프로젝트 (브랜드 리뉴얼/패키지 디자인/내부 툴 개선) + 워프로랩 2 프로젝트 (온보딩 자동화/AI 리서치). 각 프로젝트마다 채널 2개 + 메시지 9개 + 업무 5개 + 메모 4개 + 이슈 4개 + 후보 2개. client@test 를 contact_user_id 로 연결. | ✅ |
| **청크 1 읽기 API** | GET /api/projects/:id/conversations/tasks/notes/issues/task-candidates + /api/projects/conversations/:id/messages. 권한 필터 자동 주입 (고객 internal 차단, 개인 메모는 본인만). | ✅ |
| **청크 1 프론트엔드** | `services/qtalk.ts` 전 API 래퍼. QTalkPage 전면 재작성 — 실 API 기반 로드, 프로젝트 선택 시 채널+메시지+업무+메모+이슈+후보 병렬 fetch. NewProjectModal 에서 `listBusinessMembers` 로 실 워크스페이스 멤버 fetch. | ✅ |
| **청크 2 쓰기 API** | POST /api/projects/conversations/:id/messages (reply_to 지원, Socket.IO broadcast), PATCH /api/projects/conversations/:id (rename + auto_extract 토글). 권한 필터 엄격. | ✅ |
| **청크 2 프론트엔드** | `sendMessage`/`updateConversation` 서비스, ChatPanel → QTalkPage 핸들러로 실 API 호출. | ✅ |
| **검증** | 헬스체크 27/27 통과 (매 단계), 청크 1 CRUD E2E 16/16, 청크 1 읽기 API 13/13, 청크 1 전수 회귀 29/29 (owner/member1/client 3 역할 × 13 케이스), 청크 2 E2E 16/16, recorder lock E2E 8/8, 워크스페이스 스위처 E2E 14/14. SPA 라우트 /talk /notes /settings /dashboard /login 전부 200. | ✅ |

### 수정된 파일 (주요)

**백엔드 (Node)**
- 수정: `routes/auth.js` (workspaces[] + switch-workspace), `routes/projects.js` (청크 1+2 전체), `server.js` (projects router 등록 + body parser 순서 교정), `middleware/security.js` (dev 테스트 이메일 rate-limit skip), `models/User.js` (active_business_id), `models/Conversation.js` (project_id/channel_type 등), `models/Message.js` (reply_to/cue_draft_processing_*), `models/index.js` (14개 associations)
- 신규: `models/Project.js`, `ProjectMember.js`, `ProjectClient.js`, `ProjectNote.js`, `ProjectIssue.js`, `TaskCandidate.js`, `routes/projects.js`, `scripts/create-test-accounts.js`, `scripts/seed-qtalk-demo.js`

**Q Note (Python)**
- 수정: `q-note/services/database.py` (active_recorder_token + recorder_heartbeat_at 마이그레이션), `q-note/routers/sessions.py` (recorder acquire/heartbeat/release + GET 응답에 recorder_lock 필드)

**프론트엔드 (TS)**
- 수정: `contexts/AuthContext.tsx` (WorkspaceMembership 타입 + switchWorkspace), `components/Layout/MainLayout.tsx` (WorkspaceSwitcher 통합), `components/Common/LanguageSelector.tsx` (사이드바 다크 변형), `pages/Login/LoginPage.tsx` (dev 퀵로그인 패널 + full page nav), `pages/QNote/QNotePage.tsx` (recorder lock 로직 + keepalive fetch unload), `pages/QTalk/QTalkPage.tsx` (실 API 기반 재작성), `services/qnote.ts` (recorder lock API)
- 신규: `components/Common/LetterAvatar.tsx`, `components/Layout/WorkspaceSwitcher.tsx`, `pages/QTalk/LeftPanel.tsx`, `pages/QTalk/ChatPanel.tsx`, `pages/QTalk/RightPanel.tsx`, `pages/QTalk/NewProjectModal.tsx`, `pages/QTalk/mock.ts`, `pages/QTalk/QDataContext.tsx` (Mock 시절 유물, 향후 제거 예정), `services/qtalk.ts`

**Locales (ko/en)**
- 수정: `auth.json` (devPanel 키), `layout.json` (switcher 키), `qnote.json` (recorderLocked/recorderLost/recorderLockedBanner), `qtalk.json` 신규 재작성 (left/chat/right/modal)

**설계 문서 (5)**
- `docs/FEATURE_SPECIFICATION.md` (Phase 5 전면 재작성, 778→959 줄)
- `docs/INFORMATION_ARCHITECTURE.md` (사이트맵/3단 레이아웃, 340→446 줄)
- `docs/DATABASE_ERD.md` (섹션 6 신규, 677→911 줄)
- `docs/API_DESIGN.md` (섹션 11.5 Q Talk, 496→696 줄)
- `docs/SECURITY_DESIGN.md` (섹션 3.7 권한 매트릭스, 287→456 줄)

### 설계 결정 (시니어 관점)

- **Q Talk UI 주인은 채팅, 프로젝트는 메타데이터**: 초기 "project-centric" 해석을 "data-model centric, chat-first UI" 로 정정. 채팅 헤더에서 프로젝트 breadcrumb 제거, 소속 서브라벨로 격하. 프로젝트 없는 채팅 지원 준비. Slack/Discord 패턴.
- **멤버 역할은 팀 설정에 저장, 프로젝트에 이어받음**: `business_members.default_role` 컬럼 추가. 프로젝트 모달은 팀 레벨 default 를 불러와 표시, 프로젝트별 override 가능. "직접 넣은 내용이 나와야 한다" Irene 피드백 반영.
- **역할 자유 입력**: 하드코딩 ROLE_OPTIONS 드롭다운 제거 검토. 팀설정 UI 는 추후 구현.
- **초대 링크 2분기 설계**: 미가입(가입폼 → clients insert) / 기가입(검증 → contact_user_id 연결). 7일 TTL, 1회성 토큰, 피싱 방어 이메일 일치 검증. Phase 2 에 랜딩 페이지 구현 예정.
- **AI 최소 사용**: 기존 데이터로 가능한 건 DB 쿼리로 해결. 업무 후보 히스토리 재조회, 주요 이슈 CRUD, 메모 조회 전부 AI 없음. 메모리 `feedback_ai_minimal_usage.md` 로 저장.
- **청크 단위 검증**: 청크 7 에 몰아두지 않고 각 청크 끝날 때마다 E2E + 헬스체크 돌리도록 절차 교정 (Irene "검증하면서 하고 있어?" 피드백 반영).
- **시드에 client@test 연결 실수 즉시 수정**: 첫 시드에 contact_user_id 누락 → client 로그인 시 빈 화면. 재검증 중 발견하여 재시드 + 29/29 재검증.
- **Rate limit body parser 순서**: express-rate-limit skip 함수에서 req.body 를 보려면 body-parser 가 security 미들웨어보다 먼저 실행되어야 함. server.js 미들웨어 순서 교정.

### 검증 결과

- **헬스체크 27/27** (매 단계마다 통과)
- **빌드**: tsc 0 error, vite 566~661ms, 649~703 KB (`index-BsrszKEA.js` 최종)
- **Recorder Lock E2E 8/8**: acquire/heartbeat/release 정상 + 409 충돌 처리
- **워크스페이스 스위처 E2E 14/14**: 3 역할 × 워크스페이스 전환, 권한 403
- **청크 1 CRUD E2E 16/16**: POST/GET/PUT/DELETE + 권한 (owner/member1 양쪽)
- **청크 1 읽기 API 13/13**: 채널/메시지/업무/메모/이슈/후보 + 권한 필터
- **청크 1 전수 회귀 29/29**: owner/member1/client × 13 케이스 + 권한 위반 3
- **청크 2 E2E 16/16**: 메시지 전송/reply/rename/auto_extract 토글 + 권한 필터
- **SPA 라우트**: `/talk`, `/notes`, `/settings`, `/dashboard`, `/login` 전부 200

### 미완 / 다음 세션 (Irene 화면 확인 후)

- **청크 3**: 업무 후보 자동 추출 (Cue 오케스트레이터 확장, 커서 기반 LLM 호출, task_candidates 저장)
- **청크 4**: 프로젝트 메모/이슈/업무 쓰기 API + 프론트 연결
- **청크 5**: Q Task 페이지 실데이터 + tasks 상태 전환 API
- **청크 6**: Socket.IO 이벤트 broadcast (message:new, cue:draft_* 등) + 실시간 UI 반영
- **청크 7**: 9단계 전수 검증 + UI/UX 최종 확인
- **Team Settings**: `/settings/workspace` Members 탭에서 default_role 편집 UI
- **Q Task page**: 전체 업무 조회 화면
- **채팅 검색**: 좌측 리스트 인라인 검색 결과 전환

### Irene 에게 요청 (UI/UX 8단계 확인)
1. owner@test.planq.kr → /talk → 3 프로젝트 실데이터 표시, 메시지/업무/메모/이슈/후보 확인
2. client@test.planq.kr → /talk → 브랜드 리뉴얼 + 패키지 디자인 2개만, internal 채널 숨김
3. irene 계정 → 워크스페이스 스위처로 워프로랩/테스트/파트너스 3 개 전환, 각 워크스페이스별 프로젝트 로드
4. 메시지 전송 실제 작동 (청크 2), 채널 이름 변경 인라인, 자동 추출 토글 작동 확인

---

## 완료: Phase 0 기초 정비 + Phase 5 Q Talk 백엔드 + UI 목업 (2026-04-14)

설계 7 문서 전면 정비 후, Q Talk 의 기초(워크스페이스 · Cue AI 팀원 · 가시성)와
대화 자료(KB) + Cue 오케스트레이터 백엔드까지 자율 구현. Q Talk 메인 UI 는
UI-First 원칙에 따라 목업까지만 제작 (Irene 아침 승인 대기).

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **설계 문서** | 7 개 전면 정비 — SYSTEM_ARCHITECTURE (네이밍·가시성·Cue·사용량) / DATABASE_ERD (신규 4 테이블 + 마이그레이션 DDL) / API_DESIGN / SECURITY_DESIGN (Cue 안전장치) / INFORMATION_ARCHITECTURE / FEATURE_SPECIFICATION (Phase 0 + Phase 5 재작성) / DEVELOPMENT_ROADMAP (Phase 0 + Phase 5 13 단계) | ✅ |
| **DB 마이그레이션** | users.is_ai / businesses 확장 (brand/legal/default_language/cue_*) / business_members.role 에 'ai' / conversations Cue 필드 / messages AI·internal 필드 / clients.summary / 신규 테이블 4 개 (kb_documents · kb_chunks · kb_pinned_faqs · cue_usage) | ✅ |
| **Phase 0 마이그레이션 스크립트** | 기존 5 워크스페이스에 brand_name 백필 + Cue 계정 자동 생성 | ✅ |
| **Auth 확장** | register 트랜잭션에 Cue 계정 자동 생성 / login·refresh 에서 is_ai=true 차단 / 예약 이메일 패턴 차단 | ✅ |
| **Workspace API** | GET detail (Cue 포함 멤버) / PUT brand / PUT legal / PUT settings / GET members (Cue 포함) / GET cue (사용량 포함) / PUT cue (모드·pause) / 감사 로그 | ✅ |
| **i18n 네이밍** | locales ko/en 에서 business_owner → 관리자/Admin, 워크스페이스 label 추가, businessName → workspaceName 병행 | ✅ |
| **가시성 미들웨어** | `middleware/visibility.js` — canAccess·loadResource·checkVisibility 스켈레톤 (리소스별 적용은 각 메뉴 Phase 에서) | ✅ |
| **워크스페이스 설정 페이지** | `WorkspaceSettingsPage.tsx` — 5 탭 통합 (Brand/Legal/Language/Members/Cue), 모든 입력 AutoSaveField, default_language='en' 일 때 영문 필드 자동 숨김, Cue 모드 카드 라디오, 사용량 바 + 종류별 집계 | ✅ |
| **KB 서비스** | `services/kb_service.js` — OpenAI text-embedding-3-small 래퍼, sliding-window 청킹, Float32 BLOB 직렬화, 코사인 유사도, 하이브리드 검색 (임베딩 + LIKE 폴백) | ✅ |
| **Cue 오케스트레이터** | `services/cue_orchestrator.js` — 4-tier 매칭, 민감 키워드 감지, Auto/Draft/Smart 모드, CueUsage UPSERT, 비용 계산, generateClientSummary, OpenAI 키 없을 때 graceful fallback | ✅ |
| **KB 라우터** | `routes/kb.js` — 문서 CRUD + 비동기 인덱싱 + Pinned FAQ CRUD + CSV 템플릿 + 하이브리드 검색 테스트 엔드포인트 | ✅ |
| **Conversations 라우터 확장** | Cue 자동 참여자 등록, Cue trigger, 대화별 pause/resume, suggestions, Draft approve/reject, 고객 요약 갱신, Client 역할 is_internal/Draft 필터링 | ✅ |
| **Q Talk UI 목업** | `QTalkPage.tsx` — 3 단 반응형 레이아웃 (좌: 필터·대화 리스트 / 중: 메시지·Cue 뱃지·출처 인라인·컴포저 / 우: 고객 프로필·자동 요약·진행 업무·Cue 답변 후보·내부 메모), i18n ko/en, 목업 데이터로 화면 확인 가능 | ✅ |

### 수정된 파일

**설계 문서 (7)**
- 전 문서 업데이트 — `docs/{SYSTEM_ARCHITECTURE,DATABASE_ERD,API_DESIGN,SECURITY_DESIGN,INFORMATION_ARCHITECTURE,FEATURE_SPECIFICATION,DEVELOPMENT_ROADMAP}.md`

**백엔드 (Node)**
- 모델: `User.js`, `BusinessMember.js`, `Conversation.js`, `Message.js`, `Client.js`, `index.js` 수정 / `Business.js` 전체 재작성 / `KbDocument.js`, `KbChunk.js`, `KbPinnedFaq.js`, `CueUsage.js` 신규
- 미들웨어: `auth.js` (businessRole 세팅) / `visibility.js` 신규
- 라우트: `auth.js` (Cue 계정 생성 + AI 차단), `businesses.js` 전체 재작성, `conversations.js` 전체 재작성 / `kb.js` 신규
- 서비스: `kb_service.js`, `cue_orchestrator.js` 신규
- 스크립트: `scripts/phase0-migrate.js` 신규

**프론트엔드 (TS)**
- `src/i18n.ts`, `src/App.tsx` 수정
- `src/pages/Settings/WorkspaceSettingsPage.tsx`, `src/pages/QTalk/QTalkPage.tsx`, `src/services/workspace.ts` 신규

**Locales**
- `{ko,en}/common.json`, `{ko,en}/layout.json`, `{ko,en}/auth.json` 수정
- `{ko,en}/settings.json`, `{ko,en}/qtalk.json` 신규

### 설계 결정 (시니어 관점)

- **"사업자 / Owner" 라벨만 교체**: 스키마 rename (10+ 테이블 FK) 은 비용 대비 가치 0. i18n 레이어에서만 "워크스페이스 / 관리자"로 표기하고, DB·코드는 `businesses`, `business_owner` 내부 이름 유지. Slack/Linear/Notion 모두 동일 패턴.
- **Cue = 팀원 한 명**: 핸드오프 개념 제거. `users(is_ai=true)` + `business_members(role='ai')` 로 모델링. 사람 멤버와 동일한 할당·참여 시스템을 그대로 타면서 로그인만 불가. 실제 팀원이 업무 바통 터치하는 것처럼, 명시적 pause 외엔 자동 퇴장 없음.
- **플랜별 기능 차등 금지**: Cue 는 전 플랜 동일 기능. 월 **액션 수** 한도만 차등 (Free 500 / Basic 5K / Pro 25K). 한도 초과 시 Cue 조용해지고 다음 달 복귀. Q Note 에서 이미 검증된 비용 모델 (액션당 ~$0.0005) 기준 Basic 마진 91%.
- **KB 엔진은 Q Note 재사용**: `text-embedding-3-small` + 하이브리드 검색 + LLM 2차 매칭 파이프라인을 복사하지 않고 Node 서비스로 래핑 (OpenAI API 직접 호출). Q Note Python 과는 독립적으로 동작하되 동일 모델·동일 임베딩 차원.
- **민감 키워드 강제 Draft**: Auto 모드라도 환불·계약해지·법적·금액 100만원 이상 감지 시 Draft 전환. 사람이 먼저 검토 후 발송. 오작동 리스크 차단.
- **OpenAI 키 없을 때 graceful fallback**: Cue 오케스트레이터는 API 키 없어도 예외 던지지 않고 "확인 후 답변드리겠습니다" 폴백 + LLM 0 토큰 기록. 테스트/개발 환경에서 크래시 없이 전체 플로우 검증 가능.
- **Q Talk UI 는 목업까지만**: UI-First 원칙 + 저장된 `feedback_ui_first.md` 메모리 준수. Irene 승인 전 실 API 연결 금지. 대신 현실적인 목업 데이터로 화면 방향성 확인 가능하게 만듦.
- **통합 설정 페이지 (5 탭)**: 별도 5 페이지 대신 `/settings` 단일 라우트 + 내부 탭. 유지비 낮고 네비 단순.

### 검증 결과

- **헬스체크**: 27/27 ✓
- **빌드**: tsc 0 error, vite 562ms, 637.58 KB (`index-DbkEa0cN.js`)
- **Phase 0 API E2E** (test-phase0.js — 검증 후 삭제):
  - Cue 계정 로그인 차단 ✓ / 기존 유저 로그인 ✓
  - PUT brand/legal/cue ✓ / invalid value 거부 ✓
  - GET members (Cue 포함) ✓ / GET cue (사용량) ✓
- **Phase 5 백엔드 E2E** (test-phase5-backend.js — 검증 후 삭제): 13/13 ✓
  - Pinned FAQ CRUD ✓ / KB document 업로드 + 비동기 인덱싱 `ready` ✓
  - 하이브리드 검색 ✓ / Cue usage 집계 ✓
- **SPA 라우트**: `/settings` `/talk` `/notes` `/profile` 전부 200

### 미반영 / 다음 세션 (Irene 승인 후)
- **Q Talk 실 UI 바인딩**: 3 단 레이아웃에 실제 API 연결, Socket.IO 이벤트 (new_message, cue_thinking, cue_draft_ready), Draft 승인/거절 UI
- **고객 포털 뷰**: Client 역할용 간소 화면
- **KB 관리 페이지**: `/talk/kb` 문서 업로드 드래그앤드롭 + Pinned FAQ CRUD UI
- **파일 업로드 파싱**: 현재는 body 텍스트만. pdf/docx/xlsx multer 연결 + 파서 필요
- **Cue task 실행**: Phase 6 Q Task 기획과 연계
- **민감 키워드 다국어 확장**

---

## 완료: Q note 품질 전면 개선 + i18n + 편집 UX + 준비 상태 가시화 (2026-04-13)

하루 동안 i18n 기반 구축, Q note 답변 품질·속도·데이터 정합성 전면 개선,
편집 모드 신설, 준비 상태 실시간 가시화까지 대규모 리팩터링.

### 완료된 작업

| 영역 | 작업 | 상태 |
|------|------|:----:|
| **i18n** | `i18next` + `react-i18next` 전 페이지 적용 (Login/Register/MainLayout/Profile/QNotePage/StartMeetingModal). 네임스페이스 5개 (common/auth/layout/profile/qnote) × ko·en. 총 304 key 동수. 한국어 하드코딩 533 → 309 (잔여는 코드 주석). CLAUDE.md 에 "다국어 i18n — 필수" 규칙 섹션 + 감지 grep. | ✅ |
| **브랜드 네이밍** | "Q Talk/Task/Note" → **"Q talk/task/note"** 소문자 통일. locales/페이지/뱃지 전수 교체 | ✅ |
| **모달 z-index** | 공통 Modal 1000 → 2000, ConfirmDialog 1100 → 2100, StartMeetingModal 200 → 2000. 모바일 헤더(999)/사이드바(1000) 위에 덮이는 문제 해결 | ✅ |
| **번역 정렬** | SpeechBlockWrap 재구조화. 번역문이 원문과 동일한 왼쪽 위치에서 시작 (`[speaker][col: original+translation]`) | ✅ |
| **Q note 답변 tier 6단계** | `answer_service.py` 재구성: priority > custom > session_reuse > generated > rag > general. 각 tier 에 시맨틱 임베딩(OpenAI text-embedding-3-small) 재랭킹 + LLM 2차 매칭 (gpt-4.1-nano) hybrid. Priority tier 는 FTS5 우회 전수 탐색 + LLM 매칭으로 paraphrase 대응 | ✅ |
| **임베딩 서비스** | `embedding_service.py` 신규 (1536차원, cosine sim, BLOB 변환). `qa_pairs.embedding` BLOB 컬럼 + `is_priority` flag. Priority Q&A 생성 시 동기 임베딩 (race 방지) | ✅ |
| **Priority Q&A 전용 업로드** | UI 에서 "일반 자료" 와 **완전히 분리**. 단건 폼 (질문/답변/short_answer/keywords) + CSV 업로드 (BOM UTF-8, 5 컬럼). CSV 템플릿 다운로드 (apiFetch blob). 편집 모드에서 **드래그앤드롭 + 즉시 업로드** (파일 선택 = 바로 서버 반영) | ✅ |
| **short_answer + keywords 필드** | qa_pairs 컬럼 추가. `meeting_answer_length='short'` 일 때 `short_answer` 우선 반환. `keywords` 는 FTS5 인덱스에 합쳐 검색 정확도·속도 향상 + 임베딩 input 에도 포함 | ✅ |
| **답변 길이·난이도 제어** | `meeting_answer_length` (short/medium/long) → 1-2/2-3/3-4 문장, 27/55/85 단어 하드캡 (서버 `_enforce_length_cap` 후처리). 프롬프트 맨 끝 재강조. `user_language_levels` (언어별 4-skill) + `user_expertise_level` (layman/practitioner/expert). "말하기 좋은 단어" 규칙 언어별 (영어 Anglo-Saxon 우선, 한국어 순우리말/구어체 등) | ✅ |
| **회의별 스타일 프롬프트** | StartMeetingModal 에 `meetingAnswerStyle` textarea + `meetingAnswerLength` 3버튼. 세션에 저장, generate_answer 프롬프트 style prefix 주입 | ✅ |
| **빠른 질문 판정 병렬화** | `detect_question_fast` (gpt-4.1-nano, ~300ms) 신규. finalized 즉시 fast-path 로 질문 판정 + `quick_question` WS 이벤트 → 카드 즉시 승격 + prefetch answer 시작. enrichment 는 병렬로 돌며 나중에 덮어씀. 본인 발화 스킵 | ✅ |
| **어휘사전 (STT 교정)** | `generate_vocabulary_list` 프롬프트 재작성: **"TERM EXTRACTOR, NOT brainstormer"** 복사 전용. `document_excerpts` 파라미터 (인덱싱된 문서 청크가 최우선 소스). `meeting_languages` 강제 — 자료 원어로 복사, 번역 금지. 검증: brief 만 있으면 0개, 자료 있으면 verbatim 용어만 (환각 0/4, 매칭 5/5) | ✅ |
| **문서 인덱싱 후 자동 어휘 재추출** | `ingest.py` 에 post-index hook: `refresh_session_vocabulary` 자동 트리거. 기존 사용자 수동 키워드 보존하고 새 키워드 병합 | ✅ |
| **어휘 수동 재추출 API** | `POST /sessions/:id/refresh-vocabulary` 신규. 편집 모달 "📄 문서 기반 재추출" 버튼 | ✅ |
| **STT 실시간 교정** | `translate_and_detect_question` 에 `vocabulary` + `recent_utterances` 파라미터. 프롬프트 prefix 로 주입. SYSTEM_KO/EN 규칙 "원본 보존 우선, 명백한 오인식만 교체" 재강화 (과잉 교정 방지) | ✅ |
| **Deepgram 키워드 부스팅 확장** | 사용자 검토한 `session.keywords` 우선 + auto_extracted 보강. Deepgram 50개 한계 | ✅ |
| **편집 모드 (설정 버튼)** | StartMeetingModal `editMode` + `initialConfig` + `editingSessionId`. 편집 배너, 기존 Priority Q&A/문서 로드 + 삭제 버튼, 기존 어휘사전 chip 편집, "📄 재추출" 버튼. 저장 시 PUT session + 신규 items POST | ✅ |
| **초안 자동저장** | StartMeetingModal localStorage `qnote_meeting_draft_v1`. debounce 500ms, 모달 재오픈 시 복원, "초안 복원됨" 뱃지 + "초안 지우기" 버튼. 파일/CSV 는 제외 (재첨부 필요) | ✅ |
| **준비 상태 패널** | QNotePage 헤더 하단에 `prepared`/`paused` phase 에서 실시간 표시. 3초 폴링으로 문서 인덱싱 N/M, Priority Q&A 임베딩 N/M, 어휘사전 개수 + 전체 준비 완료 초록 뱃지. `qa_pairs.has_embedding` 필드 신규 | ✅ |
| **화자 라벨 수정** | 참여자 0명 또는 다수면 "화자 1/2/3" 대신 "상대"로 통일 (Deepgram ID 신뢰도 낮음) | ✅ |
| **내 발화 처리 모드 3단계** | 참여자 바에 `skip`(기본, finalized 드롭)/`hide`(렌더 필터)/`show` 토글. 답변 읽기에 집중 가능. localStorage 저장 | ✅ |
| **탭 오디오 품질 개선** | WebConferenceCapture 에 `DynamicsCompressor` + `HighShelfBiquad` (+3dB @3kHz) + `Gain` ×2. 상대 목소리 STT 정확도 향상. 48kHz sampleRate 명시 | ✅ |
| **탭 재공유 이중 표시 버그 fix** | WebConferenceCapture `stop()` async 전환: 노드 명시적 disconnect → 트랙 stop → `await audioContext.close()`. tab track 'ended' listener 제거. Chrome "공유 중" 배너가 다시 공유 시 2개 겹치는 문제 해결 | ✅ |
| **녹음 critical 버그 fix** | `live.py` Deepgram 재시도 블록 들여쓰기 실수 수정. `close + return` 이 except 블록 밖에 있어 재시도 성공 후에도 WS 닫고 종료되던 문제 | ✅ |
| **회의 생성 후 화면 사라지는 버그 fix** | URL 핸들러 경합 제거: navigate 전에 `urlSessionIdHandled.current = true` + `activeSessionRef.current = detail`. DB 기본 `status='recording'` → **'prepared'** 변경. openReview 에 prepared 케이스 추가. 사이드바 뱃지 "준비됨" 추가 | ✅ |
| **PlanQ 사용자 프로필 확장** | User 모델에 `language_levels` JSON, `expertise_level`, `answer_style_default`, `answer_length_default` 컬럼 추가. PUT /api/users/:id 검증 (언어별 4-skill 1-6, 범위 초과 거부). ProfilePage 에 "내 언어 레벨 (답변 난이도 조절용)" 카드 신규 — 7개 언어 × R/S/L/W PlanQSelect + 전문지식 4 버튼 | ✅ |
| **auto_keywords 추출** | create_session 시점에 brief/pasted/participants/profile 기반 초안 30~80개 추출 (비동기 문서 인덱싱 완료 후 refresh_session_vocabulary 로 교체·병합) | ✅ |

### 수정된 파일

**Q note 백엔드 (Python)**
- 신규: `services/embedding_service.py` (OpenAI embedding wrapper)
- 수정: `services/database.py` (qa_pairs.embedding/is_priority/short_answer/keywords, sessions.language_levels/expertise_level/meeting_answer_style/meeting_answer_length/keywords, FTS5 트리거 rebuild)
- 수정: `services/llm_service.py` (style prefix, vocab extract 복사 전용, detect_question_fast, llm_match_question, RAG/GENERAL 프롬프트 재설계, 길이 캡)
- 수정: `services/answer_service.py` (6단계 tier + hybrid semantic/LLM, refresh_session_vocabulary, short_answer 우선 반환)
- 수정: `services/ingest.py` (post-index vocab refresh hook)
- 수정: `services/qa_generator.py` (임베딩 포함)
- 수정: `routers/live.py` (fast-path 병렬, session keywords, recent utterances, Deepgram 재시도 들여쓰기 fix)
- 수정: `routers/sessions.py` (priority-qa CRUD + CSV 템플릿/업로드 + refresh-vocabulary, 편집 가능한 모든 필드, has_embedding 노출)

**PlanQ 백엔드 (Node)**
- 수정: `models/User.js` (language_levels, expertise_level, answer_style_default, answer_length_default)
- 수정: `routes/users.js` (신규 필드 검증 + 저장)

**프론트엔드 (TS)**
- 수정: `contexts/AuthContext.tsx` (User interface 확장)
- 수정: `i18n.ts` (5 네임스페이스)
- 수정: `pages/Login/LoginPage.tsx`, `pages/Register/RegisterPage.tsx`, `components/Layout/MainLayout.tsx`, `pages/Profile/ProfilePage.tsx`, `pages/QNote/QNotePage.tsx`, `pages/QNote/StartMeetingModal.tsx` (i18n 리트로핏 + 신규 기능)
- 수정: `pages/QNote/QNotePage.tsx` (편집 모드 버튼, readiness panel, self-mode 토글, 화자 라벨, URL race fix)
- 수정: `pages/QNote/StartMeetingModal.tsx` (편집 모드, CSV 드롭존, 초안 자동저장, 어휘사전 카드)
- 수정: `services/qnote.ts` (priority-qa + refresh-vocabulary + QAPair 확장)
- 수정: `services/qnoteLive.ts` (quick_question 이벤트)
- 수정: `services/audio/WebConferenceCapture.ts` (compressor/highshelf/gain + async stop)
- 수정: `services/audio/AudioCaptureSource.ts` (stop 시그니처 void|Promise<void>)
- 수정: `components/UI/Modal.tsx`, `components/Common/ConfirmDialog.tsx` (z-index 2000/2100)
- 수정: `App.tsx` (브랜드 네이밍 소문자)

**Locales**
- 신규: `public/locales/{ko,en}/{layout,profile,qnote}.json`
- 수정: `public/locales/{ko,en}/{common,auth}.json`

**문서**
- `CLAUDE.md` — "다국어 i18n — 필수" 섹션 신규, 감지 grep, 금지 사항 추가
- `dev-frontend/UI_DESIGN_GUIDE.md` — 2026-04-12 업데이트 유지

### 설계 결정 (시니어 관점)

- **i18n 먼저**: 기획·UI 작업 진행 전에 i18n 기반을 제대로 까는 것이 이후 모든 기능 개발의 부채를 덜어준다. 하드코딩된 상태에서 기능을 추가하면 나중에 갈아엎을 때 범위가 폭발한다. 사용자가 명시적으로 "i18n 제대로 구현해줘. 지금 개발한 Q note 지장없게" 를 최우선순위로 지정한 것도 이 이유.
- **Answer tier 6단계 + hybrid 매칭**: 단순 FTS5 로는 paraphrase 매칭이 불가능하고 (한국어 조사, 영어 "research" vs "researching" 접미사, 동의어), 단순 임베딩은 short 질문에 정확도가 낮다 (실측 0.27~0.5). FTS5 → 임베딩 rerank → LLM 2차 검증 → (선택) 재순위 의 3단 파이프라인이 정확도·비용 균형점. LLM 2차는 gpt-4.1-nano (~200ms, 저비용) 로 수용 가능.
- **어휘사전은 자료에서 복사만**: LLM 에게 "extract"만 시키고 "brainstorm" 을 금지하는 프롬프트 기법. "If source provides nothing, return empty list" 명시로 환각 제거. 검증 결과 자료 0건 → 0개, 자료 있음 → verbatim 5/5 매칭, 일반 용어 환각 0/4.
- **문서 인덱싱 후 vocab 재추출 hook**: 세션 생성 시점엔 문서가 없으므로 brief 만으로 초안. 실제 유용한 어휘는 문서 인덱싱이 끝나야 뽑을 수 있으므로 ingest post-hook 으로 재추출 + 기존 사용자 수동 키워드 병합. 사용자가 회의 시작 전 준비 패널에서 변화를 실시간 확인 가능.
- **길이 캡 이중 방어**: LLM 은 길이 규칙을 자주 어긴다. 프롬프트 맨 끝에 "FINAL REMINDER" 로 재강조 + 서버 후처리 `_enforce_length_cap` (문장 수·단어 수 기준 자름). "If you write N+1 words, you have failed the task" 처럼 강한 표현이 효과 있음.
- **편집 모드 데이터 정합성**: 편집 모달에서 기존 DB 자료를 보여주지 않으면 사용자가 "사라졌다" 고 오해하고 중복 업로드한다. 편집 모달 열릴 때 getSession + listQAPairs priority 호출해서 기존 목록 표시 + 개별 삭제 버튼.
- **회의 생성 후 화면 사라지는 버그 원인**: React 18 의 navigate + setState 경합. `urlSessionIdHandled.current = true` 를 navigate 전에 세팅하고 `activeSessionRef.current = detail` 동기 반영. DB 기본 status='recording' 이 "이 세션은 이미 녹음 중" 처럼 오판을 유발했던 것도 'prepared' 로 바꿔 해결.
- **탭 공유 이중 표시**: Chrome 의 "공유 중" 배너는 tab track 을 참조하는 모든 AudioNode 가 명시적으로 disconnect 될 때까지 유지된다. stop() 을 async 로 전환해 `audioContext.close()` 를 await 하고 모든 노드를 순서대로 disconnect → 트랙 stop → context close 순으로 정리.

### 검증 결과

- **헬스체크**: 27/27 ✓ (모든 개발완료 시점에서 통과)
- **빌드**: tsc 0 error, vite 500~600ms, 572~582 KB
- **i18n**: ko/en 5 네임스페이스 × 304 key 동수 매칭 ✓
- **API E2E** (여러 세션에 걸쳐 검증):
  - Priority Q&A CSV 업로드 → 동기 임베딩 ✓
  - Paraphrase 매칭 (임베딩 + LLM hybrid): 다수 케이스에서 priority tier 반환
  - 무관 질문 false positive 방지 ✓
  - short_answer 우선 반환 (length=short) vs full answer (length=medium/long) ✓
  - 길이 캡: short 18w/1s, medium 48w/4s, long 84w/8s 모두 cap 이내
  - 어휘 추출: 자료에 있는 5/5 verbatim 매칭, 자료에 없는 4/4 환각 제거, 언어별 강제 (ko→한국어, en→영어)
  - 편집 모드: PUT session + POST priority-qa + DELETE priority-qa 전부 작동
  - 보안: 익명 401, 잘못된 세션 404, IDOR 403
- **프론트 SPA**: 11개 라우트 전부 200

### 미완 / 다음 세션
- **Q Calendar 실 구현** (현재 placeholder)
- **Q Docs 실 구현** (현재 placeholder)
- **프로필 다중 페르소나** ("영업용 나" / "기획용 나" 전환)
- **Q note 세션 목록 검색** (현재 placeholder input)
- **메뉴별 기획 심화** — user feedback "메뉴 순서대로 기획설계 자세히 할게" 지시에 따라 Q talk → Q task → Q calendar → Q docs → Q file → Q bill 순으로 설계서 작성
- **운영 배포 스크립트** (지금은 dev 서버에서만 테스트)

---

## 완료: Q Note 답변 찾기 시스템 + 프로필 페르소나 + 사이드바 확장 (2026-04-12 #3)

Q Note의 "답변 찾기" 기능을 완전히 구현. 고객 등록 Q&A / AI 사전 생성 Q&A / 문서 RAG / 일반 AI
4단계 우선순위로 답변 탐색. 답변은 "AI 어시스턴트"가 아닌 "사용자 본인"으로서 생성되며,
프로필 정보(bio/expertise/organization/job_title)를 반영해 자연스러운 1인칭 답변.
사이드바에 Q Calendar/Q Docs 메뉴 추가.

### 완료된 작업

| 구분 | 작업 | 상태 |
|------|------|:----:|
| **DB 스키마** | `qa_pairs` 테이블 + FTS5 + 트리거. `detected_questions` 확장(matched_qa_id, answer_tier). `sessions`에 user 프로필 스냅샷 5개 컬럼 | 완료 |
| **answer_service.py** | `find_answer` — 4단계 우선순위 매칭 (custom > generated > RAG > general). 한국어 2자 prefix 매칭으로 조사/어미 변형 대응 | 완료 |
| **llm_service.py 재설계** | `ANSWER_SYSTEM_RAG` / `ANSWER_SYSTEM_GENERAL` 분리. "You are NOT an AI, you ARE this person" — 1인칭 관점 강제. `translate_text` 별도 함수 (답변/번역 분리) | 완료 |
| **프롬프트 프로필 주입** | `_build_context_prefix`에 `## Your Profile (You are this person)` 블록 — Name/Job/Org/Expertise/Background | 완료 |
| **qa_generator.py** | 문서 인제스트 완료 시 자동으로 예상 Q&A 생성 → `qa_pairs` 저장 | 완료 |
| **find-answer 엔드포인트** | 답변 즉시 반환 + 번역은 백그라운드. utterance_id 제공 시 detected_questions 저장 (새로고침 후 복원) | 완료 |
| **Q&A CRUD API** | `GET/POST/PUT/DELETE /qa-pairs`. 소스 필터, 부분 수정, 꼬리질문 함께 삭제 | 완료 |
| **CSV 템플릿/업로드** | BOM UTF-8 템플릿 다운로드 (실질적 긴 답변 예시). 업로드 시 중복 question 자동 UPDATE. 길이 검증 | 완료 |
| **답변 캐시/prefetch** | 라이브 질문 감지 즉시 `_prefetch_answer` 백그라운드 실행 → WS `answer_ready` 이벤트 | 완료 |
| **Korean FTS5 매칭** | SQLite unicode61 tokenizer의 조사 분리 한계 → 2자 prefix(`회의*`) + stopwords 필터링 | 완료 |
| **PlanQ 프로필 필드** | users 테이블에 `bio`(TEXT), `expertise`, `organization`, `job_title` 추가. User 모델 sync | 완료 |
| **PUT /api/users/:id 확장** | 프로필 필드 업데이트 + 길이 검증(2000/500/200/100) + IDOR 방어 | 완료 |
| **ProfilePage "내 프로필 (Q Note 답변 생성용)"** | 4개 `AutoSaveField` 입력 필드. 2초 debounce 자동저장 + 녹색 체크 뱃지 | 완료 |
| **AuthContext 확장** | User interface + normalizeUser에 프로필 필드 매핑. Q Note 세션 생성 시 user 객체에서 자동 전달 | 완료 |
| **답변 UI — 질문 카드 재설계** | 답변 생성(빨강) / 답변 보기·접기(흰) 버튼 분리. 우측 상단 고정. 아이콘 제거. 답변 영역 full-width | 완료 |
| **질문 수정 + 합치기** | 질문 클릭→인라인 수정, Enter 확정. `+`버튼→다음 문장 합쳐서 숨김, `분리`로 복원. localStorage로 새로고침 후 복원 | 완료 |
| **번역 좌측 정렬** | 원문과 번역 padding-left 통일 | 완료 |
| **세션 목록 개선** | 상태 뱃지(녹음중/일시중지/종료), 참여자 이름 표시. "발화" → "문장" 용어 교체 | 완료 |
| **회의 제목 인라인 수정** | 헤더 제목 클릭→편집→Enter 자동저장 | 완료 |
| **세션 상세 detected_questions** | 리뷰 모드 새로고침 시 답변 있는 질문 → "답변 보기" 버튼으로 시작 | 완료 |
| **사이드바 메뉴 재배열 + 신규** | Q Talk → Task → **Q Calendar**(신규) → Note → **Q Docs**(신규) → File → Bill. 업무 흐름 순 | 완료 |
| **답변 품질 수정** | "As an AI..." 자기부정 완전 제거. 자료 없어도 프로필 기반 1인칭 자연 답변 ("Can you help me?" → "Of course!...") | 완료 |
| **후속 질문 제거** | 불필요한 토큰 낭비 — 질문 나오면 그때 답하면 됨. 프롬프트/응답/UI 전부 제거 | 완료 |

### 설계 결정 (시니어 관점)

- **4단계 우선순위 (custom > generated > RAG > general)**: 고객이 직접 등록한 Q&A가 최우선 — 회사 방침/톤이 반영된 "정답"이기 때문. AI 생성은 자료 기반 자동이지만 2순위. 둘 다 없으면 문서 청크 RAG, 그것도 없으면 일반 AI. 매 단계에서 FTS5 매칭 실패 시 다음 단계로 fallback.
- **"You are this person" 프롬프트**: Q Note가 "나만의 메모, 내 능력 향상 도구"라는 정체성을 프롬프트에 반영. 공유 안 하는 사적 공간이므로, AI가 제3자 도우미가 아닌 사용자 본인의 분신이 되어야 함. "As an AI" 자기부정을 프롬프트에서 명시적으로 금지.
- **한국어 FTS5 prefix 매칭**: SQLite unicode61 tokenizer는 한국어 조사를 별개 단어로 인식 — "회의"와 "회의는"이 매칭 안 됨. 2자 prefix(`회의*`)로 해결. 영어는 stem이 길어 prefix 대신 원형 사용.
- **답변/번역 분리**: 단일 LLM 호출로 답변+번역+꼬리질문을 한 번에 생성하면 6초. 답변만 1초 → 번역 0.6초(백그라운드). 사용자 체감 1초. 번역은 "번역 중..." placeholder로 표시 후 도착 시 교체.
- **합치기 + 숨김 (+ localStorage)**: STT가 긴 질문을 문장으로 쪼갠 경우 대비. DB 삭제 대신 화면에서만 숨겨 데이터 안전성 확보. localStorage 저장으로 새로고침 후 상태 유지. 공식 기록(트랜스크립트)은 원본 보존.
- **프로필 스냅샷**: 세션 생성 시 PlanQ users → Q Note sessions에 복사. 이후 프로필 변경에 영향 받지 않음(세션마다 당시 프로필로 답변 고정). 회의 후 프로필이 바뀌어도 과거 답변은 일관성 유지.
- **검증 중 발견한 critical 버그**:
  - `_build_field_updates`/INSERT에 신규 user 프로필 필드 누락 → 저장되지 않음 → 수정
  - FTS5 매칭 임계값이 `<= -0.5`로 너무 엄격 → `<= 0`으로 완화
  - 자료 없는 general tier에서 RAG 프롬프트가 재사용되어 "자료에서 답을 찾지 못했습니다" 강제 → 프롬프트 2개로 분리

### 검증 결과

- **헬스체크 27/27** 통과
- **Q&A CRUD E2E 26/26** (길이 검증, IDOR, 401, CSV, 답변 생성, 프로필 반영, Warplo Lab 언급 확인)
- **프로필 필드 E2E**: 전체 저장 / 부분 수정 / null 설정 / 길이 초과 400 / 다른 사용자 403 / 미인증 401 / Q Note 세션 통합
- **1인칭 답변 검증**: "As an AI" 자기부정 0건. "At Warplo Lab, we focus on...", "advancing our research in NLP..." 등 프로필 정확 반영
- **빌드**: tsc 0 error, 540KB (`index-BGw3OmKv.js`)
- **SPA 라우트**: /calendar /docs 포함 11개 전체 200
- **속도**: Tier 1 custom ~860ms, Tier 4 general ~2.3초, 번역 별도 ~640ms

### 수정된 파일

**Q Note 백엔드 (Python)**
- 신규: `q-note/services/answer_service.py` — 4단계 우선순위 답변 탐색
- 신규: `q-note/services/qa_generator.py` — 문서 기반 사전 Q&A 자동 생성
- 수정: `q-note/services/database.py` — qa_pairs 테이블 + FTS5, sessions 프로필 필드
- 수정: `q-note/services/llm_service.py` — RAG/GENERAL 프롬프트 분리, translate_text, user_profile prefix
- 수정: `q-note/services/ingest.py` — 인제스트 완료 후 Q&A 생성 트리거
- 수정: `q-note/routers/sessions.py` — Q&A CRUD, CSV 템플릿/업로드, find-answer, translate-answer, cached-answer, 프로필 저장, detected_questions 응답 포함
- 수정: `q-note/routers/live.py` — _prefetch_answer 백그라운드, answer_ready WS 이벤트
- 수정: `q-note/routers/voice.py` — min_sec 파라미터 (기존 유지)
- 수정: `q-note/services/deepgram_service.py` (기존 유지)

**PlanQ 백엔드 (Node)**
- `dev-backend/models/User.js` — bio, expertise, organization, job_title 컬럼
- `dev-backend/routes/users.js` — PUT /api/users/:id 프로필 필드 처리 + 검증

**프론트엔드 (TS)**
- `dev-frontend/src/App.tsx` — /calendar /docs 라우트 추가
- `dev-frontend/src/components/Layout/MainLayout.tsx` — 사이드바 재배열 + Q Calendar / Q Docs 메뉴
- `dev-frontend/src/contexts/AuthContext.tsx` — User interface + normalizeUser 프로필 필드
- `dev-frontend/src/pages/Profile/ProfilePage.tsx` — "내 프로필 (Q Note 답변 생성용)" 카드 + AutoSaveField × 4
- `dev-frontend/src/pages/QNote/QNotePage.tsx` — 답변 UI 재설계, 질문 수정/합치기, localStorage, 세션 목록 상태 뱃지, 제목 인라인 수정, 프로필 전달
- `dev-frontend/src/services/qnote.ts` — Q&A API 함수 + 타입, translate-answer, cached-answer, 프로필 필드
- `dev-frontend/src/pages/QNote/StartMeetingModal.tsx` (기존 유지)
- 기타 오디오 관련 파일 (기존 유지)

### 미완 / 다음 세션

- **Q Calendar 실 구현**: 현재 placeholder 페이지. 일정 CRUD, 반복 이벤트, Q Task 연동
- **Q Docs 실 구현**: 현재 placeholder 페이지. 문서 에디터, 버전 관리, Q Note 답변 찾기와의 연동
- **프로필 확장 2단계**: "영업용 나" / "기획용 나" 같은 다중 페르소나
- **회의별 추가 컨텍스트**: 세션별로 `brief`를 넘는 세밀한 문맥 주입

---

## 완료: Q Note 라이브 전사 전면 개선 — LLM 재설계 + 질문 판정 + 채널 화자 + UX 재구조 (2026-04-12)

실 테스트 피드백 기반 전면 개선. LLM 프롬프트 언어별 분리, 질문 오판 대폭 감소, 채널 기반 화자 식별,
트랜스크립트 렌더링 재설계, 회의 시작 모달 단순화.

### 완료된 작업

| 구분 | 작업 | 상태 |
|------|------|:----:|
| **LLM 모델 분리** | 실시간 정제: gpt-4.1-nano (속도), 요약/답변: gpt-4o-mini (품질). `LLM_MODEL_ANSWER` env 추가 | 완료 |
| **언어별 전용 프롬프트** | `TRANSLATE_SYSTEM` 단일 → `SYSTEM_KO` / `SYSTEM_EN` / `SYSTEM_DEFAULT` 자기완결 프롬프트 | 완료 |
| **질문 판정 전면 재설계** | 한국어: ~지?/~잖아?/~할까? 등 false. 영어: tag/rhetorical/request false. "의심되면 false" 원칙 | 완료 |
| **max_completion_tokens** | 700 → 300 (속도 개선) | 완료 |
| **프론트 낙관 질문 판정 제거** | `textEndsWithQuestion` 삭제 → 서버 `is_question`만으로 판정 | 완료 |
| **enrichment → block.kind 교정** | enrichment `is_question`으로 block `kind` 실시간 전환 (speech ↔ question) | 완료 |
| **2초 merge 완전 제거** | 라이브 `commitPendingAsBlock` + 리뷰 `buildBlocksFromSession` 모두. 각 utterance 독립 블록 | 완료 |
| **블록 렌더 수평 레이아웃** | `SpeechRow`/`QuestionRow` 인라인 — 화자 + 본문 + 시간 한 줄 | 완료 |
| **"번역 중..." 제거** | 번역 미도착 시 표시 없음 | 완료 |
| **WebConferenceCapture 스테레오** | ChannelMerger — mic=Left(나), tab=Right(상대) | 완료 |
| **window.focus()** | 탭 공유 후 PlanQ 탭 자동 복귀 | 완료 |
| **PCMStreamer 스테레오** | 2채널 인터리브 모드 | 완료 |
| **Deepgram multichannel** | web_conference → channels=2, multichannel=true. diarize는 mono만 | 완료 |
| **채널별 독립 버퍼** | `pending_buffers` dict — multichannel에서 두 화자 텍스트 혼합 방지 | 완료 |
| **채널 기반 화자** | channel 0=mic=나(is_self 자동), channel 1=tab=상대 | 완료 |
| **finalized에 is_self/channel_index** | 세션 새로고침 없이 즉시 "나"/"상대" 라벨 반영 | 완료 |
| **문장 단위 화자 변경 API** | `POST /{session_id}/utterances/{utterance_id}/reassign-speaker` 신규 | 완료 |
| **speakerLabelFor 참여자 기반** | 참여자 1명→이름, 다수→"상대". 미할당 기본값 "상대" | 완료 |
| **마이크 모드 라벨 분기** | 수동 지정(participant_name/is_self)만 표시. 자동 라벨 안 붙음 | 완료 |
| **_auto_match_self 병합** | 중복 is_self → utterances 기존 speaker로 이동, 중복 speaker 삭제 | 완료 |
| **SpeakerPopover 필터링** | 이미 지정된 화자 숨김, "나" 지정됐으면 "나" 버튼 숨김, 빈 팝오버 힌트 | 완료 |
| **voiceCheck/핑거프린트 제거** | self-voice 업로드, LiveSelfMatched 이벤트, VoiceWarnBanner 전부 삭제 | 완료 |
| **/notes/:sessionId 라우트** | URL 기반 세션 접근 + 자동 열기 | 완료 |
| **ParticipantBar UI** | 헤더 아래 참여자 목록 바 (나 + 참여자 이름/역할) | 완료 |
| **StartMeetingModal 단순화** | 회의 언어 다중→단일 선택. 번역/답변 언어는 "고급 설정" 접기 | 완료 |
| **Deepgram 파라미터** | utterance_end_ms 1000→2000, endpointing=500. 연결 실패 시 키워드 없이 재시도 | 완료 |

### 설계 결정 (시니어 관점)

- **LLM 모델 2단 분리**: 실시간 정제(gpt-4.1-nano)는 속도가 관건 — 사용자가 말하는 즉시 띄어쓰기/구두점이 교정되어야 한다. 요약/답변(gpt-4o-mini)은 사용자 클릭 후 대기 가능하므로 품질 우선. 한 모델로 통일하면 속도/품질 중 하나를 포기해야.
- **언어별 자기완결 프롬프트**: 기존 단일 프롬프트는 한국어/영어 규칙이 뒤섞여 LLM이 혼동. 한국어 조사 규칙("나는", "회의를")과 영어 capitalization 규칙을 동시에 넣으면 어느 쪽도 제대로 적용 안 됨. 언어별로 해당 언어에만 집중하는 프롬프트가 정확도 훨씬 높음.
- **질문 판정 strict false**: false positive(평서문이 질문 카드로 표시)가 누락(질문 놓침)보다 훨씬 나쁨. 사용자가 보는 화면에서 "질문이 아닌 게 질문으로 뜸" = 신뢰도 하락. 반면 질문 놓침은 트랜스크립트 스크롤로 보완 가능. 따라서 의심되면 무조건 false. 한국어 ~지?/~잖아?/~할까? 같은 확인/제안/가정 어미를 명시적으로 false 패턴에 열거.
- **2초 merge 제거**: merge 로직은 "같은 화자 연속 발화를 합치면 깔끔" 이란 가정이었으나, Deepgram이 문장을 쪼개는 방식과 충돌 — 다른 사람의 발화가 같은 블록에 합쳐지거나, 질문이 이전 speech에 흡수되는 부작용. 각 utterance를 독립 블록으로 두면 서버 is_question이 block.kind를 정확히 제어 가능.
- **채널 = 화자 (web_conference)**: ML 기반 화자 식별(Resemblyzer, Deepgram diarize)은 실제로 불안정. 웹 화상회의에서는 mic=나, tab=상대가 물리적으로 보장됨. 채널 분리가 100% 정확한 유일한 방법.
- **문장 단위 화자 변경(reassign-speaker)**: 기존 speaker-merge 방식은 "화자 A의 모든 발화를 화자 B로" 이동 — 이건 Deepgram이 화자를 잘 분리했을 때만 유효. 실제로는 한 speaker 안에 여러 사람 발화가 섞여 있으므로, 문장 단위로 "이 발화는 누구 것" 지정이 더 정확.

### 검증 결과

- 실 테스트 (Irene 직접 수행)

### 수정된 파일

**Q Note 백엔드 (Python)**
- `q-note/services/llm_service.py` — LLM 모델 분리, 언어별 프롬프트, 질문 판정 재설계
- `q-note/services/deepgram_service.py` — multichannel, utterance_end_ms/endpointing, channel_index 파싱
- `q-note/routers/live.py` — 채널별 버퍼, multichannel 화자, _auto_match_self 병합, finalized is_self, 키워드 재시도
- `q-note/routers/sessions.py` — reassign_utterance_speaker API 신규
- `q-note/routers/voice.py` — min_sec 파라미터

**프론트엔드 (TS)**
- `dev-frontend/src/App.tsx` — /notes/:sessionId 라우트
- `dev-frontend/src/pages/QNote/QNotePage.tsx` — 질문 판정/merge/렌더/화자/URL 전면 재설계
- `dev-frontend/src/pages/QNote/StartMeetingModal.tsx` — 단일 언어 선택, 고급 설정, VoiceWarn 삭제
- `dev-frontend/src/services/qnote.ts` — reassignUtteranceSpeaker API
- `dev-frontend/src/services/qnoteLive.ts` — self-voice 제거, stereo 파라미터
- `dev-frontend/src/services/audio/PCMStreamer.ts` — stereo 모드
- `dev-frontend/src/services/audio/WebConferenceCapture.ts` — ChannelMerger 스테레오, window.focus()

### 미완 / 다음 세션

- **Phase B 답변 찾기 API**: 질문 카드의 "답변 찾기" 실 API 연결
- **Phase C 답변 찾기 UI**: 답변 패널 mock → Irene 승인 → 실 연결

---

## 완료: Q Note 품질 전면 개선 — 7 Phase 리팩터링 (2026-04-11 #2)

라이브 STT 품질에 대한 사용자 피드백 ("텍스트 속도 느림, 한국어 띄어쓰기 버벅임, LLM 교정 안 됨,
본인 인식 실패, 참여자 선택 안 됨") 을 7 개 근본 원인으로 해부하고 Phase 단위로 전면 재구현.

### 완료된 작업

| 구분 | 작업 | 상태 |
|------|------|:----:|
| **Phase 0 실측** | DB 실측으로 참여자 NULL 저장/capture_mode 컬럼 부재/LLM 프롬프트 제약 확정 | 완료 |
| **Phase 5 참여자** | `StartMeetingModal.handleStart` — 미반영 pName/pRole 자동 포함 (엔터/추가 버튼 없이 "회의 시작" 눌러도 저장) | 완료 |
| **Phase 1 라이브 렌더** | `live.py` 누적 버퍼 설계 — Deepgram 의 여러 `is_final=true` 청크를 `pending_utterance` 에 누적, `speech_final=true` 또는 `UtteranceEnd` 도착 시 **하나의 row 로 단일 commit**. "한 문장 = 한 row" 원칙 + 앞부분 loss 없음 (메모리 `feedback_qnote_stt_llm_quirks.md` 2번 규칙 준수) | 완료 |
| Phase 1 | Enrichment singleton — utterance_id 당 최신 태스크만 유지 (중복 리렌더 차단) | 완료 |
| Phase 1 | WS close finally 에서 누적 버퍼 강제 flush — 일시중지/종료 시 문장 중간 drop 방지 | 완료 |
| Phase 1 | `QNotePage.tsx` 터미네이터 (`?.!`) 대기 로직 전면 폐기, `finalized` 이벤트 즉시 블록 승격, 2초 gap merge 에 위임 | 완료 |
| Phase 1 | `buildBlocksFromSession` 단순화 — 각 utterance 단일 buffer flush. 데드코드 (FLICKER_TOLERANCE_SEC, SILENCE_HARD_CAP_SEC, textEndsWithTerminator) 제거 | 완료 |
| **Phase 2 LLM 교정** | `TRANSLATE_SYSTEM` 재설계 — "Do NOT change word choice" 삭제, 회의 컨텍스트 기반 phonetic mis-recognition 교정 지시 추가 | 완료 |
| Phase 2 | `deepgram_service.py` — `keywords` 파라미터 추가. nova-3 는 `keyterm`, nova-2 이하는 `keywords:2` 자동 분기. 언어별 모델 env 오버라이드 (`DEEPGRAM_MODEL`, `DEEPGRAM_MODEL_KO`) | 완료 |
| Phase 2 | `live.py._extract_keywords` — brief/participants/pasted_context 에서 고유명사 추출 (영문 대문자 연속, 한글 따옴표, 참여자 이름) → Deepgram keyword boosting | 완료 |
| **Phase 3 한국어 모델** | `_resolve_model_for_language()` — `DEEPGRAM_MODEL_<LANG>` 환경변수 오버라이드 경로 (실환경 A/B 후 `nova-2-general` 전환 가능) | 완료 |
| **Phase 4 본인 인식** | `SELF_MATCH_THRESHOLD` 0.68 → 0.62 (환경변수 `QNOTE_SELF_MATCH_THRESHOLD` 오버라이드). CLUSTER_MERGE 0.65 → 0.60 | 완료 |
| Phase 4 | `SpeakerAudioCollector.live_trigger_sec` 5.0 → 3.0 (첫 발화 빠른 매칭) | 완료 |
| Phase 4 | **이중 방어**: `_auto_match_self` — 세션 내 이미 `is_self=1` speaker 존재 시 스킵 (과거 mixed stream 에서 모든 speaker 에 is_self 찍혀 "나만 보임" 유발한 버그 재발 방지) | 완료 |
| Phase 4 | **경로 분기**: web_conference 모드는 `_auto_match_self` 스킵 → 프론트 마이크 전용 `/self-voice-sample` 만 사용 (mixed stream 매칭 품질 저하 회피). microphone 모드만 live 매칭 | 완료 |
| Phase 4 | `StartMeetingModal` — 음성 미등록 시 Rose 팔레트 경고 배너 + 프로필 링크 | 완료 |
| **Phase 6 capture_mode** | `sessions.capture_mode` 컬럼 마이그레이션 (default 'microphone') | 완료 |
| Phase 6 | `routers/sessions.py` CreateSessionRequest/UpdateSessionRequest 에 `capture_mode` 추가 + `_validate_capture_mode` (잘못된 값 400) | 완료 |
| Phase 6 | `services/qnote.ts` — `QNoteCaptureMode` 타입 + `CreateSessionPayload.capture_mode` | 완료 |
| Phase 6 | `QNotePage.openReview` — DB `capture_mode` 로 pendingConfig 복원 (하드코딩 `'microphone'` 제거) | 완료 |
| Phase 6 | `QNotePage.startRecording` — paused→web_conference 재개 시 "탭 공유 다시 선택" 안내 notice + pendingConfig 없을 때 DB 기반 fallback | 완료 |
| **이모지 클린업** | `StartMeetingModal` "스캔본 ❌" → "스캔본 불가" (메모리 규칙 `feedback_no_emoji_check.md` 준수) | 완료 |

### 설계 결정 (시니어 관점)

- **"한 문장 = 한 utterance row" — 누적 버퍼 설계**: 기존은 Deepgram `is_final=true` 이벤트를 전부 DB insert 해서 한 문장이 N 개 row 로 쪼개지고 enrichment 가 N 번 돌아 프론트 리렌더 N 번 → "버벅거림". 단순히 `speech_final=true` 만 commit 하면 Deepgram 이 한 문장을 여러 `is_final` 청크로 쪼개 보내고 **마지막 청크에만** speech_final 이 붙는 경우 앞부분이 drop (이전 세션에서 실측 확인, 메모리 `feedback_qnote_stt_llm_quirks.md` 2번에 기록). 해결: 모든 `is_final=true` 조각을 `pending_utterance` 버퍼에 누적 → `speech_final=true` 또는 `UtteranceEnd` 도착 시 전체 텍스트를 하나의 row 로 commit. 양쪽 요구 모두 충족 — 한 row = 한 문장 + 앞부분 loss 없음. 추가 안전장치로 WS close finally 에서 강제 flush.
- **LLM 프롬프트 철학 전환**: 기존은 "띄어쓰기만 고쳐라, 단어 바꾸지 마라" 로 교정을 원천 차단. 하지만 STT 고유명사 오탐은 **맥락으로만 교정 가능** 한 문제다. 회의 브리프/참여자/자료를 system prompt 앞에 붙이고 "phonetically similar but contextually wrong 이면 교체하라 (확신 없으면 원본 유지)" 로 바꾸니 gpt-4o-mini 가 회의 컨텍스트를 적극 활용. Deepgram `keyterm` 은 저수준 부스팅, LLM 은 고수준 교정 — 이중 레이어.
- **본인 인식 이중 방어**: web_conference 의 mixed stream (mic + tab) 에서 Resemblyzer 임베딩을 계산하면 발화 구간마다 user voice 가 섞여 있어 **모든 speaker 가 is_self 로 찍히는** 심각한 버그 발생. 경로를 분리해 mixed 는 live 매칭을 아예 끊고, 프론트가 별도 마이크 전용 채널 10 초 를 `/self-voice-sample` 로 업로드. microphone 모드는 audio_buf 자체가 깨끗해서 기존 경로 유지. 추가로 "세션당 is_self 1 명" 가드를 live.py 에 넣어 어떤 경로에서도 중복 마킹 불가.
- **capture_mode 영속화**: 새로고침 시 브라우저 권한 소실 + 사용자가 원래 모드를 기억하지 못하는 두 문제를 컬럼 하나로 동시 해결. Frontend 는 `openReview` 에서 DB 값으로 복원하고 `startRecording` 에서 web_conference 재개 시 명시적으로 "탭 공유 다시 선택" notice 를 띄워 사용자가 의도적으로 재선택하게 유도.

### 검증 결과

- **헬스체크 27/27** (infra / auth / security / qnote / voice / external / frontend 전 카테고리)
- **Q Note E2E 30/30** (참여자 3 명 round-trip, 빈 배열, role null, capture_mode web_conference/microphone 전환, 잘못된 값 400, LLM 한국어 띄어쓰기 복원 + 영어 번역, 영어 질문 감지 + 한국어 번역, IDOR 방어, 미인증 401, 세션 CUD + 목록 + 삭제 후 404)
- **실 LLM 검증**:
  - 입력: `안녕하세요저는루아입니다오늘회의는큐노트에대해논의하는자리입니다`
  - formatted_original: `안녕하세요, 저는 루아입니다. 오늘 회의는 큐 노트에 대해 논의하는 자리입니다.`
  - translation: `Hello, I am Lua. Today's meeting is to discuss Q Note.`
  - 영어 질문 `Could you tell me more about the Q Note feature?` → is_question=true, 한국어 번역 생성
- **빌드**: tsc 0 error, 151 modules, 537 KB, `Cq6XLQAT.js`
- **SPA 라우트**: /notes · /profile · /talk · /tasks · /files · /billing · /dashboard · /login 전부 200
- **PM2**: planq-dev-backend · planq-qnote online, 에러로그 clean
- **번들 포함 확인**: `capture_mode`, `VoiceWarnBanner`, `finalized`, "탭 오디오/재선택" 문자열 4/4
- **UI/UX**: `window.alert`/`window.confirm`/`toast.success` 0건, 이모지 0건 (❌ 1건 제거)

### 수정된 파일

**Q Note 백엔드 (Python)**
- `q-note/services/database.py` — sessions.capture_mode 컬럼 마이그레이션
- `q-note/services/voice_fingerprint.py` — threshold 환경변수화 (SELF_MATCH_THRESHOLD 0.62, CLUSTER_MERGE_THRESHOLD 0.60)
- `q-note/services/deepgram_service.py` — `keywords` 파라미터, 모델 env var 오버라이드 (DEEPGRAM_MODEL, DEEPGRAM_MODEL_<LANG>)
- `q-note/services/llm_service.py` — TRANSLATE_SYSTEM 재설계 (contextual correction)
- `q-note/routers/sessions.py` — capture_mode CRUD + `_validate_capture_mode`
- `q-note/routers/live.py` — speech_final 기반 commit, enrichment singleton, `_extract_keywords`, `_auto_match_self` 세션당 1명 가드 + web_conference 경로 분리

**프론트엔드 (TS)**
- `dev-frontend/src/services/qnote.ts` — QNoteCaptureMode 타입, CreateSessionPayload.capture_mode
- `dev-frontend/src/pages/QNote/StartMeetingModal.tsx` — participants flush, 음성 미등록 경고 배너, 이모지 정리
- `dev-frontend/src/pages/QNote/QNotePage.tsx` — 라이브 렌더 전면 재설계, openReview capture_mode 복원, startRecording web_conference resume 안내

### 미완 / 다음 세션

- **실라이브 테스트**: 실제 회의 녹음으로 띄어쓰기 1회 렌더 / 본인 1명 인식 / 참여자 popover 노출 / 고유명사 교정 확인
- **한국어 모델 A/B**: nova-3 vs nova-2-general 30초 녹음 비교 후 `DEEPGRAM_MODEL_KO` 고정
- **Threshold 튜닝**: 실 매칭 시 self-match 로그 유사도 기반 `QNOTE_SELF_MATCH_THRESHOLD` 재조정
- **Phase B 답변 찾기 API**: 질문 카드의 `답변 찾기` 버튼 실 API 연결
- **Phase C 답변 찾기 UI**: 답변 패널 mock → Irene 승인 → 실 연결

---

## ✅ 완료: Q Note Phase A + Phase D + 라이브 UX 전면 안정화 (2026-04-11)

### 완료된 작업

| 구분 | 작업 | 상태 |
|------|------|:----:|
| **Phase A — 인제스트 파이프라인** | `documents` 테이블 확장 (source_type/source_url/title/error_message/indexed_at) + 파일/URL 공통 파이프라인 | ✅ |
| Phase A | `services/url_fetcher.py` — hop별 SSRF 재검증(DNS rebinding 방어) + HTTPS 강제 + 스트리밍 10MB 캡 + 5s/15s 타임아웃 + 리다이렉트 3회 + Content-Type 화이트리스트 | ✅ |
| Phase A | `services/extractors.py` — HTML(trafilatura) / PDF(pdfplumber) / DOCX(python-docx) / TXT 다중 인코딩 fallback. asyncio.to_thread 래핑 | ✅ |
| Phase A | `services/chunker.py` — 단락+문장 hybrid 청크 (500자/50자 overlap), 약어 예외 문장 경계 | ✅ |
| Phase A | `services/ingest.py` — `ingest_document(doc_id)` 단일 진입점, file/url 공통, `pending→processing→indexed/failed`, `add_done_callback` silent drop 방지 | ✅ |
| Phase A | `sessions.py` 라우터 재배선 — POST/documents·POST/urls가 background 태스크로 ingest 트리거, `sessions.urls` JSON 컬럼 deprecated | ✅ |
| **Phase D-0 캡처 수정** | `WebConferenceCapture` 신규 — 마이크(본인) + 탭 오디오(상대) `getUserMedia + getDisplayMedia` → Web Audio API 믹싱. 탭 단독 `BrowserTabCapture.ts` 삭제 | ✅ |
| Phase D-0 | 탭 오디오 무음 감지 워치독 — 3초간 탭 트랙 신호 없으면 console.warn | ✅ |
| **D-1 언어 필터** | `live.py` enrichment에 `allowed_languages` 주입. `detected_language ∉ meeting_languages` 시 `out_of_scope=True` + 번역/질문감지 폐기. 프론트 opacity 0.45 + 언어 태그 | ✅ |
| **D-2 음성 핑거프린트** | Resemblyzer(CPU, 256-d, L2-normalized) + `services/audio_buffer.py`(RollingAudioBuffer 60s + SpeakerAudioCollector) + `routers/voice.py`(**다국어** CRUD + verify) | ✅ |
| D-2 | `voice_fingerprints` 스키마 다국어 전환 `(user_id, language) UNIQUE` + `speaker_embeddings` 테이블 신규. 기존 데이터 `'unknown'` 태그로 보존 마이그레이션 | ✅ |
| D-2 | live.py 본인 매칭 — 마이크 전용 사이드 채널(web_conference 모드) → `/self-voice-sample` 10초 업로드 → `dg_speaker_hint` + max similarity 언어별 비교 | ✅ |
| **D-3 배치 화자 병합** | `services/speaker_clustering.py` — sklearn AgglomerativeClustering (cosine, sim ≥ 0.65), PUT status='completed' 트리거, `is_self` 상속 | ✅ |
| **D-4 화자 네이밍 UI** | 발화 블록 `[화자 N ▾]` 버튼 → `SpeakerPopover` 인라인 팝오버 (나/참여자/직접 입력). 같은 이름·is_self 자동 병합. `block.id` 기반 스코프로 중복 팝오버 버그 수정 | ✅ |
| **D-5 개인정보** | 회의 종료 시 PCM 버퍼 즉시 drop. 프로필 개인정보 처리 안내 4항목. 다국어 핑거프린트 삭제 API | ✅ |
| **프로필 페이지** | `/profile` 신규 — 기본 언어 + 다국어 음성 등록/재등록/삭제 + 매칭 확인하기(verify) + `WavRecorder` (AudioContext → WAV Blob, ffmpeg 무의존). 언어 드롭다운 선택 즉시 녹음 시작 UX. 하드 상한 30초만 자동 종료, 사용자 수동 종료 권장 | ✅ |
| **본인 인식 실패 버그 수정** | `speakerLabel` 동적 계산 — 블록 렌더마다 `speakerLabelFor()` 실시간 호출. `self_matched` WS 이벤트 후 label 즉시 "나"로 전환. 실패 시 `self_match_failed` 이벤트 + 유저 친화 안내 | ✅ |
| **텍스트 중복 버그 수정** | Deepgram `is_final=true` 모든 이벤트 commit (speech_final 필터 제거 — 문장 앞부분 손실 방지) + **2중 dedup** (시간 오버랩 + 직전 3개 정규화 텍스트 비교) | ✅ |
| **한국어 띄어쓰기 복구** | GPT-5-mini(reasoning, empty response) → **gpt-4o-mini** 교체. `translate_and_detect_question failed` 에러 근절. `formatted_original` 필드로 실시간 보정 | ✅ |
| **리프레시 시 회의 종료 버그** | `openReview`에서 session.status 기반 phase 결정 (`recording→paused`, `completed→review`). `buildBlocksFromSession` 공용 헬퍼로 paused 진입 시 서버 utterances 하이드레이트 | ✅ |
| **연속 발화 merge** | `commitPendingAsBlock` + `reviewBlocks`에 `MERGE_GAP_SEC=2.0` 규칙 — 같은 화자 + 2초 이내면 speech/question 구분 없이 병합. 질문 포함 시 question 카드로 | ✅ |
| **녹음 이어하기 멈춤 대응** | `startRecording` 실패 시 `NotAllowedError`/탭 공유 취소/WS 실패를 **유저 친화 메시지**로 변환. `pendingConfig=null` 시 마이크 모드 폴백. `console.error`로 원본 에러 기록 | ✅ |
| **사이드바 언어 저장 버그** | `/api/users/language` (존재 안 함) → `/api/users/:id` 경로 수정. LanguageSelector `try/catch`로 가려져 있던 무증상 버그 | ✅ |
| **ConfirmDialog 이식** | ProfilePage의 `window.confirm` 2곳 → `ConfirmDialog` React 컴포넌트. `alert()` 금지 규칙 준수 | ✅ |
| **검증 스크립트 v2 이식** | POS `/var/www/dev-backend/scripts/health-check.js` v2 구조 차용 (CLI 옵션, 카테고리 시스템). 19 → **27 체크** 확장 (infra/auth/security/qnote/voice/external/frontend). `--category`, `--quiet`, `--verbose`, `--host` 지원 | ✅ |

### 설계 결정 (시니어 관점)

- **DB 실측 기반 디버깅**: "두 번씩 나온다" / "띄어쓰기 안 된다" / "본인 인식 못 한다" — 각 증상을 SQL로 직접 확인해 근본 원인 파악. 코드 레벨 추측 대신 데이터 검증.
- **Deepgram multi 모드의 한계 수용**: Nova-3 multi는 한국어 정확도 크게 떨어지고 같은 구간을 여러 번 재해석. 사용자에게 1개 언어 선택 권장 UX.
- **다국어 핑거프린트**: Resemblyzer는 영어 편향이 있어 cross-language 매칭 시 유사도 하락. 사용자가 언어별 등록 → max similarity로 대응.
- **reasoning LLM 금지**: gpt-5-mini (reasoning)는 max_completion_tokens 700에서 reasoning 토큰만 소진 → empty response → json.loads 실패. gpt-4o-mini (non-reasoning)로 교체.
- **dedup 2중 방어**: 시간 오버랩(start < last_end - 0.1) + 텍스트 정규화(직전 3개 공백 제거 비교). 어느 하나만으론 다양한 Deepgram 이벤트 패턴 전부 못 잡음.
- **UI-First + ConfirmDialog**: CLAUDE.md의 alert 금지 규칙 일관 적용. window.confirm까지 동일 범주로 간주.
- **speakerLabel 동적 계산**: 블록 데이터 구조에 문자열 스냅샷 저장은 state 업데이트 시 stale. 렌더 시 `activeSession.speakers`에서 실시간 lookup.

### 검증 결과

- **헬스체크 27/27** (7 카테고리: infra·auth·security·qnote·voice·external·frontend)
- **Ingest E2E 12/12** (Phase A)
- **Voice Fingerprint E2E 10/10**
- **Speaker Merge E2E 5/5**
- **턴 검증 E2E 12/12** — 한국어 띄어쓰기 실 LLM 4건 전부 복구 확인
- 빌드: tsc 0 error, 151 modules, 536KB, `iQIgwuc5`
- 백엔드 에러로그 clean (gpt-4o-mini 전환 후)

### 수정된 파일

**Q Note 백엔드 (Python)**
- 신규: `services/voice_fingerprint.py`, `services/audio_buffer.py`, `services/speaker_clustering.py`, `services/url_fetcher.py`, `services/extractors.py`, `services/chunker.py`, `services/ingest.py`, `routers/voice.py`
- 수정: `services/database.py`, `services/llm_service.py`, `services/deepgram_service.py`, `routers/sessions.py`, `routers/live.py`, `main.py`, `requirements.txt`, `.env` (LLM_MODEL=gpt-4o-mini)

**Q Note 프론트엔드 (TS)**
- 신규: `pages/Profile/ProfilePage.tsx`, `services/audio/WebConferenceCapture.ts`, `services/audio/recordToWav.ts`
- 수정: `pages/QNote/QNotePage.tsx`, `pages/QNote/StartMeetingModal.tsx`, `services/qnote.ts`, `services/qnoteLive.ts`, `services/audio/index.ts`, `services/audio/AudioCaptureSource.ts`, `services/audio/PCMStreamer.ts`, `components/Layout/MainLayout.tsx`, `components/Common/Icons.tsx`, `components/Common/LanguageSelector.tsx`, `contexts/AuthContext.tsx`, `App.tsx`
- 삭제: `services/audio/BrowserTabCapture.ts`, `pages/QNote/mockData.ts`

**기타**
- `scripts/health-check.js` (v2 구조 이식)

### 미완 / 다음 세션

- **실라이브 본인 인식 튜닝**: Resemblyzer 매칭 임계값(0.68) 실 회의 데이터 기반 조정 필요
- **모달 participants 재사용 UX**: localStorage 캐시 → 다음 회의 모달에 기본값 제안
- **Deepgram 세션 split (4시간 한계)**: 재연결 로직과 묶어서 구현
- **Phase B 답변 찾기 API**: utterance_id + 컨텍스트 5개 → BM25 top-K → GPT-4o-mini 답변
- **Phase C 답변 찾기 UI**: 답변 표시 패널 mock → Irene 승인 → 실 API 연결

---

## ✅ 완료: Q Note B-3 Step 8 — 프론트 실 API 연결 + 라이브 UX 재설계 (2026-04-10)

### 완료된 작업

| 구분 | 작업 | 상태 |
|------|------|:----:|
| **API 클라이언트** | `services/qnote.ts` 신규 — 세션 CRUD / 문서 / URL / 화자 매칭 + `buildLiveSocketUrl` (JWT query) | ✅ |
| **WebSocket 라이브** | `services/qnoteLive.ts` 신규 — `LiveSession` (캡처 + WS + PCM 파이프 + 이벤트 라우팅) | ✅ |
| **PCM 스트리머** | `services/audio/PCMStreamer.ts` 신규 — MediaStream → 16kHz mono PCM16 (ScriptProcessorNode + muted gain) | ✅ |
| **QNotePage 재설계** | mock 완전 제거 + 실 API 연결 + WebSocket 통신 | ✅ |
| **상태 머신** | `empty → prepared → recording ⇄ paused → review` — 자동 녹음 방지, 일시중지/재개/종료 분리 | ✅ |
| **터미네이터 기반 커밋** | Deepgram finals를 pending 버퍼에 누적, `? . !` 도착 시 한 번에 커밋 → 한 문장이 여러 카드로 쪼개지는 문제 해결 | ✅ |
| **Pending 유령 블록** | 미완성 문장을 opacity 0.55 이탤릭 + `…` 로 라이브 표시 | ✅ |
| **카드 패러다임 전환** | 일반 발화 → flat transcript 블록 (보더 없음). **질문만 카드** — 공간 밀도 4-5배 | ✅ |
| **질문 카드 수평 레이아웃** | 좌측 본문 + 우측 답변 찾기 버튼 → 높이 ~120px → ~70px (42% 감소) | ✅ |
| **플리커 내성 병합** | 같은 dg_speaker 또는 갭 < 1.5초 → 병합 (Deepgram diarize 플리커 무시). 20초 침묵 → 강제 flush | ✅ |
| **낙관 질문 감지** | 문장 끝 `?` + wh-word + 한국어 의문 어미 즉시 감지 → GPT enrichment 기다리지 않음 | ✅ |
| **번역 부분 표시** | 일부 segment만 번역 도착해도 있는 부분 렌더 + 끝에 `…`. 전체 없음 시 "번역 중…" placeholder | ✅ |
| **자동 하단 스크롤** | 라이브 모드에서 블록/interim 업데이트 시 transcript 영역 하단으로 smooth scroll | ✅ |
| **모달 state 리셋** | `StartMeetingModal` 열릴 때마다 모든 입력 초기화 (이전 회의 데이터 잔존 방지) | ✅ |
| **live.py `finalized` 이벤트** | DB insert 후 utterance_id 즉시 클라이언트 통지 → enrichment와 정확 상관관계 | ✅ |
| **live.py WS 종료 정리** | WS close 시 자동 status=completed 제거 → pause/resume 가능, 명시적 PUT으로만 종료 | ✅ |
| **Deepgram `smart_format=true`** | 구두점 + 숫자/날짜/시간 자동 포맷 → 터미네이터 감지 정확도 향상 | ✅ |
| **speaker 라벨 fallback** | DB 매칭 실패해도 dg_speaker_id로 "화자 1", "화자 2" 즉시 라벨링 | ✅ |
| **mockData.ts 삭제** | — | ✅ |

### 설계 결정 (시니어 UX 관점)

- **카드 → Flat transcript + 질문 카드**: Otter/Fireflies 패턴 차용. 모든 발화 카드화는 공간 낭비 + scanning 방해
- **터미네이터 기반 커밋**: Deepgram final은 문장 단위가 아니라 VAD 단위. 문장 경계(`.!?`)에서만 커밋해야 한 질문이 여러 카드로 찢어지지 않음
- **플리커 1.5초 내성**: Deepgram 실시간 diarize의 speaker_id는 말 중간에도 튐. 1.5초 미만 갭 내 speaker 변경은 무조건 플리커로 간주
- **시간/길이 캡 제거**: 인위적 카드 분할은 맥락 단절. 유일한 분할 기준은 침묵(20초), 질문, 진짜 화자 교체
- **답변 찾기 수평 배치**: 풀스크린 사용 가능성 고려, 카드 높이 최소화

### 검증

- 빌드: tsc 0 error, vite 147 modules, 497KB 번들
- 헬스체크: **19/19 통과**
- Step 8 E2E: **14/14 통과** (CRUD + round-trip + PUT 부분 업데이트 + 문서 업로드 + 확장자 블랙리스트 + SSRF 3종 + 인증 + pagination + CASCADE)
- 유저 플로 E2E: **6/6 통과**
- 페이지 서빙 200, 번들 내 실 API 경로 + 신규 UI 문자열 검증

### 수정/생성된 파일

**생성:**
- `dev-frontend/src/services/qnote.ts`
- `dev-frontend/src/services/qnoteLive.ts`
- `dev-frontend/src/services/audio/PCMStreamer.ts`

**수정:**
- `dev-frontend/src/pages/QNote/QNotePage.tsx` (대폭 재설계 — 1063줄)
- `dev-frontend/src/pages/QNote/StartMeetingModal.tsx` (open 시 state reset)
- `q-note/routers/live.py` (finalized 이벤트 + WS 종료 로직)
- `q-note/services/deepgram_service.py` (smart_format=true)

**삭제:**
- `dev-frontend/src/pages/QNote/mockData.ts`

### 미완 / 다음 세션

- **Step 6**: URL Fetcher (trafilatura + https 강제 + SSRF 재사용 + 10MB/15s + sessions.urls status 갱신)
- **Step 7**: B-5 RAG 기초 (PDF/DOCX/TXT 추출 + 500자 청크 + SQLite FTS5 + 답변 찾기 API)
- **실제 회의 테스트**: 라이브 녹음 UX 추가 튜닝 (pending 동작, 질문 감지 정확도 관찰)
- **프로필 페이지**: language 변경 UI, 음성 핑거프린트
- **연결 끊김 처리**: WebSocket 재연결 + 오디오 버퍼
- **4시간 한계 처리**: Deepgram 세션 split
- **법적 동의 모달**: 녹음 동의, AI 데이터 처리 안내

---

## 완료: Q Note B-3 Backend Wiring Step 1–5 (2026-04-10)

### 완료된 작업

| 구분 | 작업 | 상태 |
|------|------|:----:|
| **Step 1 DB 스키마** | sessions 컬럼 6종 추가 (brief, participants, urls, meeting_languages, translation_language, answer_language) | 완료 |
| **Step 1 DB 스키마** | sessions.pasted_context 컬럼 추가 | 완료 |
| **Step 1 DB 스키마** | speakers 신규 테이블 (session_id, deepgram_speaker_id, participant_name, is_self) | 완료 |
| **Step 1 DB 스키마** | utterances.speaker_id FK 추가 | 완료 |
| **Step 1 DB 스키마** | documents.session_id FK + 인덱스 추가 | 완료 |
| **Step 1 DB 스키마** | 기존 데이터 보존 마이그레이션 (PRAGMA table_info 체크 → ALTER) | 완료 |
| **Step 2 세션 API** | POST /api/sessions — brief/participants/언어3종/pasted_context 수신 | 완료 |
| **Step 2 세션 API** | PUT /api/sessions/:id — 모든 필드 부분 업데이트 + JSON 역직렬화 | 완료 |
| **Step 2 세션 API** | GET /api/sessions/:id — utterances + documents + speakers 포함 | 완료 |
| **Step 2 문서** | POST /api/sessions/:id/documents — multipart 업로드 (10MB, 확장자 화이트리스트) | 완료 |
| **Step 2 문서** | DELETE /api/sessions/:id/documents/:doc_id — DB + 디스크 파일 정리 | 완료 |
| **Step 2 URL** | POST /api/sessions/:id/urls — https + SSRF 방어 (내부 IP/loopback/link-local 차단) | 완료 |
| **Step 2 URL** | DELETE /api/sessions/:id/urls/:url_id | 완료 |
| **Step 3 Deepgram** | deepgram_service.py `diarize=true` 추가 | 완료 |
| **Step 3 Deepgram** | 단어 리스트 다수결로 deepgram_speaker_id 추출 | 완료 |
| **Step 3 Deepgram** | meeting_languages → language 파라미터 매핑 (1개=단일, 여러개=multi) | 완료 |
| **Step 4 화자 매칭** | POST /api/sessions/:id/speakers/:speaker_id/match | 완료 |
| **Step 4 화자 매칭** | is_self=true 소급 적용 — 해당 화자의 is_question 플래그 해제 + detected_questions 삭제 | 완료 |
| **Step 4 화자 매칭** | live.py speaker upsert (WebSocket utterance 수신 시 자동) | 완료 |
| **Step 5 LLM 컨텍스트** | `_build_context_prefix()` — brief/participants/pasted_context → system prompt 접두 | 완료 |
| **Step 5 LLM 컨텍스트** | translate/summary/answer 모두 meeting_context 파라미터 지원 | 완료 |
| **Step 5 LLM 컨텍스트** | live.py 세션 시작 시 컨텍스트 로드 → 모든 enrichment 호출에 주입 | 완료 |
| **Step 5 LLM 컨텍스트** | /api/llm/translate, /summary 에 session_id 옵션 추가 (소유 검증 후 컨텍스트 로드) | 완료 |
| **부수 수정** | SQLite FK 활성화 — services/database.py `connect()` 헬퍼, 모든 커넥션에 PRAGMA foreign_keys=ON | 완료 |
| **부수 수정** | aiosqlite.connect(DB_PATH) → db_connect() 일괄 교체 (sessions/live/llm 라우터) | 완료 |
| **부수 수정** | python-multipart 의존성 추가 | 완료 |
| **프론트 UX** | 모달 "녹음 시작" → "회의 진행" 변경, 회의 준비 / 녹음 분리 | 완료 |
| **프론트 UX** | 메인 헤더 녹음 시작/중지 버튼 state 분기 | 완료 |

### 검증 결과

- **Step 1 DB 마이그레이션**: PRAGMA table_info 로 모든 컬럼/테이블/인덱스 존재 확인
- **Step 2 세션 API E2E (13/13)**: 생성/조회/업데이트 round-trip, 파일 업로드/삭제 + 디스크 검증, 확장자 블랙리스트, URL 4종 SSRF 차단(http/loopback/private/link-local), 인증 미적용 401
- **Step 3-5 E2E (10/10)**: 화자 seed/매칭, is_self 소급 (본인 질문 제거, 타인 질문 보존), GET 에 speakers 포함, 404 처리, LLM 컨텍스트 주입, CASCADE 삭제 검증
- **헬스체크 19/19 전체 통과** (변경 전후 유지)

### 수정된 파일

**백엔드 (Q Note):**
- `q-note/services/database.py` — 마이그레이션 로직 + speakers 테이블 + connect() 헬퍼 (FK 활성화)
- `q-note/services/deepgram_service.py` — diarize + speaker_id 추출
- `q-note/services/llm_service.py` — `_build_context_prefix` + meeting_context 파라미터
- `q-note/routers/sessions.py` — 전면 재작성 (세션 CRUD 확장 + 문서/URL/화자 매칭)
- `q-note/routers/live.py` — 컨텍스트 로드 + 화자 upsert + is_self 필터링
- `q-note/routers/llm.py` — session_id 옵션 + _load_meeting_context
- `q-note/requirements.txt` — python-multipart==0.0.12 추가

**프론트엔드:**
- `dev-frontend/src/pages/QNote/QNotePage.tsx` — 녹음 시작/중지 분리
- `dev-frontend/src/pages/QNote/StartMeetingModal.tsx` — 버튼 "회의 진행"

---

## ✅ 완료: Q Note Phase 8 — B-1, B-2 + B-3 mock UI + 인프라 정비 (2026-04-10)

### 완료된 작업

| 구분 | 작업 | 상태 |
|------|------|:----:|
| **B-1 백엔드** | Q Note FastAPI 구조 (routers/services/middleware/data) | ✅ |
| **B-1 백엔드** | SQLite 6 테이블 + FTS5 (sessions, utterances, documents, document_chunks, summaries, detected_questions) | ✅ |
| **B-1 백엔드** | JWT 인증 미들웨어 (PlanQ 백엔드 SECRET_KEY 공유) | ✅ |
| **B-1 백엔드** | Deepgram WebSocket 프록시 (Nova-3, language=multi) | ✅ |
| **B-1 백엔드** | 세션 CRUD API (POST/GET/PUT/DELETE /api/sessions) | ✅ |
| **B-1 백엔드** | WebSocket /ws/live 엔드포인트 | ✅ |
| **B-1 인프라** | Nginx WebSocket 프록시 헤더 추가 | ✅ |
| **B-2 백엔드** | OpenAI GPT-5-mini 연동 (translate, summary, answer) | ✅ |
| **B-2 백엔드** | LLM 서비스 (translate_and_detect_question, generate_summary, generate_answer) | ✅ |
| **B-2 백엔드** | /api/llm/translate, /api/llm/summary 엔드포인트 | ✅ |
| **B-2 백엔드** | live.py에 background enrichment 통합 (utterance → 번역+질문감지) | ✅ |
| **B-2 검증** | 실제 한→영 / 영→한 번역 + is_question 감지 동작 확인 (19/19 헬스체크) | ✅ |
| **헬스체크** | scripts/health-check.js — 19개 체크 (Infra/Auth/B-1/External/B-2/Frontend Lint) | ✅ |
| **헬스체크** | /검증 + /개발완료 명령어에 0단계 헬스체크 통과 강제 추가 | ✅ |
| **헬스체크** | 토큰 캐시 (rate limit 회피) | ✅ |
| **린트** | Frontend 린트 3종 (POS 컬러 잔재 / raw <select> / react-select 직접 import) | ✅ |
| **컴포넌트** | PlanQSelect (react-select 기반 검색 가능 통합 셀렉트, 사이즈/multi/icon 지원) | ✅ |
| **컴포넌트** | Icons.tsx (Feather-style stroke SVG, MicIcon/MonitorIcon/StopIcon 등 11개) | ✅ |
| **POS 정리** | POS 보라색 잔재 17개 파일 약 30곳 일괄 정리 (#6C5CE7→#14B8A6 등) | ✅ |
| **POS 정리** | theme.ts brand 컬러 PlanQ 딥틸로 교체 + Point 컬러 추가 | ✅ |
| **POS 정리** | legacy SelectComponents.tsx 삭제, ThemedSelect/FormSelect 제거 | ✅ |
| **컬러 시스템** | Point 컬러 Coral/Rose #F43F5E 정의 (CTA + AI 감지 강조용) | ✅ |
| **컬러 시스템** | COLOR_GUIDE.md §2.5 Point 컬러 섹션 신규 추가 | ✅ |
| **DB** | users.language 컬럼 추가 (사용자 모국어, ISO 639-1) | ✅ |
| **DB** | PUT /api/users/:id에 language 업데이트 + 검증 추가 | ✅ |
| **B-3 mock UI** | Q Note 페이지 (사이드바 + 라이브/리뷰 모드 + 트랜스크립트) | ✅ |
| **B-3 mock UI** | StartMeetingModal — 회의 시작 입력 폼 | ✅ |
| **B-3 mock UI** | 회의 시작 모달 — 제목, 회의 안내(brief), 참여자, 메인/답변/번역 언어, 자료(파일/텍스트/URL), 캡처 방식 | ✅ |
| **B-3 mock UI** | 메인 언어 멀티 셀렉트 (pill + "+ 언어 추가") — 빈 상태 시작 | ✅ |
| **B-3 mock UI** | 답변 언어 (메인 언어 중 선택), 번역 언어 (모든 언어, 디폴트 사용자 모국어) | ✅ |
| **B-3 mock UI** | 참여자 입력 (이름 + 역할/메모, 그룹 표현 가능) | ✅ |
| **B-3 mock UI** | 자료 — 파일 업로드 (10MB 검증) + 텍스트 붙여넣기 (10만자) + URL (http/https 검증) | ✅ |
| **B-3 mock UI** | 본인 발화 질문 제외 (isSelf 필드, 좌측 코랄 보더 + "질문" 라벨 + "답변 찾기" 버튼 제외) | ✅ |
| **B-3 mock UI** | 질문 발화 텍스트 굵게 + 코랄 좌측 보더 강조 | ✅ |
| **B-3 mock UI** | 사이드바 접기 토글 (미팅 풀스크린) | ✅ |
| **B-3 mock UI** | AudioCapture 추상화 인터페이스 (마이크/탭, 미래 데스크톱 앱 대응) | ✅ |
| **B-3 mock UI** | LANGUAGES.ts 상수 (23개 언어, ISO 639-1 + Deepgram 지원 정보) | ✅ |
| **워크플로우** | UI-First 개발 원칙 영구 규칙화 (CLAUDE.md + 메모리) | ✅ |

### 미완료 / 다음 단계 (B-3 backend wiring + B-4~B-6)

| 작업 | 상태 |
|------|:----:|
| Deepgram WebSocket에 `diarize=true` 옵션 추가 (화자 분리) | ⏳ |
| sessions 테이블에 brief, participants(JSON), urls 컬럼 추가 | ⏳ |
| speakers 테이블 신규 (session_id, speaker_id, participant_name, is_self) | ⏳ |
| 화자 매칭 API (POST /api/sessions/:id/speakers/:speaker_id/match) | ⏳ |
| LLM 호출 시 brief + participants를 system prompt에 prefix 주입 | ⏳ |
| isSelf 자동 마킹 (사용자가 "나"로 매칭한 speaker_id 발화 모두) | ⏳ |
| 본인 발화는 detected_questions 테이블에 INSERT 안 함 | ⏳ |
| URL fetcher (trafilatura/readability) + SSRF 방어 (내부 IP 차단, HTTPS 강제) | ⏳ |
| 문서 업로드 + 텍스트 추출 + 청크 분할 + FTS5 인덱싱 (B-5 RAG) | ⏳ |
| 회의 음성 캡처 → WebSocket 전송 (PCM16 16kHz mono) | ⏳ |
| 라이브 모드 mock 데이터 → 실 WebSocket 연결로 교체 | ⏳ |
| 리뷰 모드 → 실 세션 데이터로 교체 | ⏳ |
| 사용자 프로필 페이지 (language 필드 변경 UI) | ⏳ |
| 회의 도중 연결 끊김 처리 (재연결 + 버퍼 + 이어쓰기) | ⏳ |
| 4시간 회의 한계 처리 (Deepgram 세션 split) | ⏳ |
| 음성 핑거프린트 등록/매칭 (선택 기능) | ⏳ |
| 법적 동의 1회 모달 (녹음 동의, AI 데이터 처리 안내) | ⏳ |

### 수정/생성된 파일 (이번 세션)

**생성:**
- `dev-frontend/src/components/Common/PlanQSelect.tsx`
- `dev-frontend/src/components/Common/Icons.tsx`
- `dev-frontend/src/constants/languages.ts`
- `dev-frontend/src/services/audio/AudioCaptureSource.ts`
- `dev-frontend/src/services/audio/MicrophoneCapture.ts`
- `dev-frontend/src/services/audio/BrowserTabCapture.ts`
- `dev-frontend/src/services/audio/index.ts`
- `dev-frontend/src/pages/QNote/QNotePage.tsx`
- `dev-frontend/src/pages/QNote/StartMeetingModal.tsx`
- `dev-frontend/src/pages/QNote/mockData.ts`
- `q-note/middleware/auth.py`
- `q-note/services/database.py`
- `q-note/services/deepgram_service.py`
- `q-note/services/llm_service.py`
- `q-note/routers/live.py`
- `q-note/routers/sessions.py`
- `q-note/routers/llm.py`
- `q-note/.env` (개인 키 — git 제외)
- `scripts/health-check.js`

**수정:**
- `q-note/main.py`, `q-note/requirements.txt`
- `dev-backend/models/User.js` (language 컬럼 추가)
- `dev-backend/routes/users.js` (language 업데이트 검증)
- `dev-frontend/src/styles/theme.ts` (PlanQ 컬러 + Point 컬러)
- `dev-frontend/COLOR_GUIDE.md` (Point 컬러 §2.5 추가)
- `dev-frontend/src/App.tsx` (Q Note 라우트 활성화)
- `CLAUDE.md` (UI-First 워크플로우 명시)
- `.claude/commands/검증.md`, `.claude/commands/개발완료.md` (헬스체크 0단계 추가)
- POS 컬러 잔재 17개 파일 (보라색 → 딥틸)

**삭제:**
- `dev-frontend/src/components/UI/SelectComponents.tsx` (가짜 SearchableSelect)

---

## Phase 1: 서버 분리 + PlanQ 초기 세팅 ✅

**완료: 2026-04-08**

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 디렉토리 구조 (`/opt/planq/`) | ✅ |
| 2 | MySQL DB + 유저 (planq_dev_db / planq_admin) | ✅ |
| 3 | 백엔드 (Express + Sequelize + 13 모델 + 8 라우트) | ✅ |
| 4 | 프론트엔드 (Vite + React + TypeScript) | ✅ |
| 5 | Nginx + SSL (dev.planq.kr) | ✅ |
| 6 | Q Note (FastAPI, port 8000) | ✅ |
| 7 | Git (github-planq:ireneceo/planq) | ✅ |
| 8 | CLAUDE.md + DEVELOPMENT_PLAN.md | ✅ |
| 9 | 개발 인프라 명령어 (/개발시작, /개발완료, /저장, /검증, /배포, /복원) | ✅ |
| 10 | 보안 미들웨어 POS 수준 업그레이드 (SSRF, CSP, SQL Injection, Socket.IO 인증) | ✅ |
| 11 | 설계 문서 정리 (docs/ — 아키텍처, ERD, IA, API, 기능정의서, 보안, 로드맵) | ✅ |

---

## ✅ 완료: Phase 2 최소 세트 — 인증 시스템 (2026-04-08)

### 완료된 작업

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | POST /api/auth/register (User+Business+Member 트랜잭션 생성, JWT 발급) | ✅ |
| 2 | POST /api/auth/login (이메일/username 둘 다 지원, Access 15분 + Refresh 7일) | ✅ |
| 3 | POST /api/auth/refresh (HttpOnly Cookie, Refresh Token rotation) | ✅ |
| 4 | POST /api/auth/logout (Refresh Token DB 무효화 + cookie 삭제) | ✅ |
| 5 | POST /api/auth/forgot-password + reset-password | 미구현 (나중에) |
| 6 | AuthContext (메모리 토큰 + 14분 자동갱신) + ProtectedRoute | ✅ |
| 7 | LoginPage + RegisterPage (PlanQ 컬러, pill shape, placeholder only) | ✅ |
| 8 | MainLayout (딥틸 사이드바 + LanguageSelector + PlanQ 브랜딩) | ✅ |

### 추가 구현
- User 모델: username, refresh_token, reset_token 필드 추가
- COLOR_GUIDE.md 전면 재작성 (딥 틸 컬러 시스템, 11개 섹션)
- cookie-parser 추가, CORS credentials 설정

### 수정된 파일
- `dev-backend/models/User.js` — username, refresh_token 등 필드 추가
- `dev-backend/routes/auth.js` — register/login/refresh/logout 전면 재작성
- `dev-backend/server.js` — cookie-parser 추가
- `dev-backend/.env` — JWT_REFRESH_SECRET, JWT_EXPIRES_IN=15m
- `dev-frontend/src/pages/Login/LoginPage.tsx` — 신규
- `dev-frontend/src/pages/Register/RegisterPage.tsx` — 신규
- `dev-frontend/src/contexts/AuthContext.tsx` — 전면 재작성
- `dev-frontend/src/components/ProtectedRoute.tsx` — PlanQ 컬러
- `dev-frontend/src/components/Layout/MainLayout.tsx` — 딥틸 사이드바
- `dev-frontend/src/components/Common/LanguageSelector.tsx` — 다크 사이드바 대응
- `dev-frontend/src/App.tsx` — 실제 라우팅 연결
- `dev-frontend/COLOR_GUIDE.md` — 전면 재작성

---

## ✅ 완료: Q Note 설계 문서화 (2026-04-09)

### 완료된 작업

| 작업 | 설명 | 상태 |
|------|------|:----:|
| Q Note 구조 변경 확정 | 배치(Whisper) → 실시간(Deepgram) 전환, 라이브+리뷰 2모드 | ✅ |
| FEATURE_SPECIFICATION.md | Phase 8 전면 재작성 — F8-1~F8-5, 아키텍처, 비용 예측 | ✅ |
| DEVELOPMENT_ROADMAP.md | Phase 8 프롬프트 재작성 — B-1~B-6 단계, 프로젝트 구조 | ✅ |
| DEVELOPMENT_PLAN.md | Phase 8 작업 목록 B-1~B-6으로 교체 | ✅ |

### 수정된 파일
- `DEVELOPMENT_PLAN.md` — Phase 8 작업 목록 변경
- `docs/FEATURE_SPECIFICATION.md` — Phase 8 전면 재작성
- `docs/DEVELOPMENT_ROADMAP.md` — Phase 8 프롬프트 재작성

---

## Phase 3: 사업자 + 고객 관리

> 사업자 프로필 + 멤버 초대 + 고객 초대 (초대 링크로 간편 가입) + 대화방 자동 생성

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 사업자 정보 조회/수정 API | |
| 2 | 멤버 초대/목록/제거 API + 이메일 발송 | |
| 3 | 고객 초대 API (Client 생성 + Conversation 자동 생성 + 초대 이메일) | |
| 4 | 초대 수락 페이지 (/invite/:token → 간편 가입) | |
| 5 | 고객 목록/상세 페이지 | |
| 6 | 팀 관리 페이지 (Owner만) | |
| 7 | 사업자 설정 페이지 (프로필, 구독, 알림) | |

---

## Phase 4: Q Bill (청구서)

> 청구서 작성 + 이메일 발송 + 입금 확인 + 상태 관리

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 청구서 CRUD API (자동 번호생성, 부가세 자동계산) | |
| 2 | 청구서 이메일 발송 (Nodemailer + HTML 템플릿) | |
| 3 | 입금 확인/취소 API | |
| 4 | 청구서 목록 페이지 (전체/미결/완료 탭) | |
| 5 | 청구서 작성 폼 (항목 동적 추가/삭제) | |
| 6 | 청구서 상세 페이지 (발송/입금확인 버튼) | |

---

## Phase 5: Q Talk (대화)

> Socket.IO 실시간 채팅 + 메시지 수정/삭제 + 파일 첨부 + 할일 연결

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 대화 목록 API + 메시지 목록 (페이징) | |
| 2 | 메시지 전송 + Socket.IO 실시간 | |
| 3 | 메시지 수정 (is_edited) + 삭제 (is_deleted 마스킹) | |
| 4 | 첨부파일 업로드 (MessageAttachment) | |
| 5 | 3단 레이아웃: 대화목록 / 채팅 / Q Task 패널 | |
| 6 | MessageInput (텍스트 + 📎 첨부 + Enter 전송) | |
| 7 | typing 표시, 스크롤 자동 하단 | |
| 8 | 메시지에서 할일 만들기 버튼 (Phase 6과 연결) | |

---

## Phase 6: Q Task (할일)

> 할일 CRUD + 메시지↔할일 양방향 링크 + 필터/정렬 + 마감 지연 표시

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 할일 CRUD API (필터: status, assignee, client, due) | |
| 2 | 메시지 → 할일 생성 (source_message_id 양방향 링크) | |
| 3 | 상태 변경 API + Socket.IO emit | |
| 4 | 할일 목록 페이지 (오늘/이번주/전체 탭, 필터) | |
| 5 | 마감 지연 🔴 / 오늘 마감 🟠 / 임박 🟡 표시 | |
| 6 | Q Talk 우측 패널 (해당 고객 할일) | |
| 7 | 원문 메시지 ↔ 할일 상호 이동 | |

---

## Phase 7: Q File (자료함)

> 고객별 파일 관리 + 업로드/다운로드 + 용량 제한

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 파일 업로드 API (Multer, UUID 파일명, 확장자 검증) | |
| 2 | 파일 목록/다운로드/삭제 API | |
| 3 | 자료함 페이지 (고객별 폴더/탭) | |
| 4 | 드래그 앤 드롭 업로드 UI | |
| 5 | 스토리지 사용량 표시 (요금제별 제한) | |

---

## Phase 8: Q Note (실시간 회의 전사 + AI 분석)

> 실시간 STT (Deepgram Nova-3) + 번역/질문감지 (GPT-5-mini) + 문서 기반 답변 (RAG)
> 상세 설계: `docs/FEATURE_SPECIFICATION.md` Phase 8

| # | 작업 | 상태 |
|---|------|:----:|
| B-1 | FastAPI 구조 + Deepgram WebSocket 프록시 + 실시간 STT | ✅ |
| B-2 | GPT-5-mini 연동 (번역 + 질문 감지) | ✅ |
| B-3 | 프론트엔드 라이브 모드 UI (mock + 실 백엔드 연결) | 🔄 mock UI 완료, 백엔드 연결 대기 |
| B-4 | 세션 저장 + 리뷰 모드 (기록 열람, 요약 생성) | |
| B-5 | 문서 업로드 + 답변 찾기 (RAG, SQLite FTS5) | |
| B-6 | 결과 연동 — Q Task 할일 전환 + Q Talk 공유 (2차) | |

---

## Phase 9: 알림 시스템

> 인앱 알림 + 이메일 알림

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 알림 모델 + API | |
| 2 | 인앱 알림 (헤더 벨 + 드롭다운) | |
| 3 | 이메일 알림 (새 메시지, 할일 배정, 마감 임박, 청구서) | |
| 4 | 알림 설정 (카테고리별 on/off) | |

---

## Phase 10: 구독 관리

> 요금제(Free/Basic/Pro) + 결제 + 미납 처리

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 플랜 페이지 (비교 테이블) | |
| 2 | 결제 연동 | |
| 3 | 구독 관리 (업그레이드/다운그레이드/취소) | |
| 4 | 사용량 기반 제한 (스토리지, 멤버 수, Q Note 횟수) | |
| 5 | 미납 처리 흐름 (유예 → 읽기전용 → 차단 → 삭제) | |

---

## Phase 11: 운영 배포 + Landing

> 배포 스크립트 + 랜딩 페이지 + SEO

| # | 작업 | 상태 |
|---|------|:----:|
| 1 | 운영서버 배포 스크립트 | |
| 2 | 랜딩 페이지 (Hero, Features, Pricing, CTA) | |
| 3 | SEO 메타태그 + OG 이미지 | |
| 4 | Platform Admin 대시보드 | |
