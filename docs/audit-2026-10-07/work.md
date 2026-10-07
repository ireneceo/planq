# 제품 감사 — `work` (업무·프로젝트·일정·확인필요·근태·인사이트·보고서) · 2026-10-07

> 독립 감사자(Fable). 저장소·DB 무변경. 근거는 코드 `파일:줄` + dev DB SELECT(2026-10-07 시점). 운영 데이터는 보지 않았다.
> 이미 박제된 결정(승인완료 단계 부활·상담=고객 기록·HIGH 위험 AI 도구 금지·선불 체험 등)은 존중하고 다시 제안하지 않는다.

## 요약 (5줄)

1. **업무 흐름의 뼈대는 완성도가 높다** — 상태 10종·전이 단일 원천(`services/taskTransition.js`·`services/actions/task_actions.js`)·컨펌 정책·보류/외부컨펌·승인완료→최종완료가 서버·화면 같은 술어로 묶여 있고 i18n 은 전 네임스페이스 ko/en 100% 패리티. 그러나 **드로어 한 장(3,441줄)에 9개 메타 + 8개 섹션**이 480px 안에 쌓여 "다음에 뭘 누르면 되는지" 가 액션 카드까지 스크롤해야 보인다.
2. **확인필요 숫자는 구조적으로 믿을 만하다**(13개 수집기 → `all` 한 배열 → `total=all.length`, 배지는 전부 `all.filter(type)`). 다만 «요청 확인(ack)» 버킷이 **이미 컨펌 중인 업무까지** 집는다(dev 실측 3건) — 숫자가 틀린 게 아니라 **동사가 거짓**이 되는 자리가 있다. 그리고 목록은 «여는 것» 뿐이라 승인·확인·완료가 **최소 3클릭**이다.
3. **프로젝트 상세는 13탭 + 고정문서탭**(고객에겐 4탭). 탭이 «자료 종류» 로 나뉘어 있어 "이 프로젝트 지금 어디까지 왔나" 가 개요(캔버스)·거래(단계)·업무·히스토리·보고서 **다섯 군데**에 흩어진다. 캔버스는 설계 문서상 전략 프레임이라 소규모 외주에게는 비어 있는 채 남는다(dev 워크스트림 7건/프로젝트 39개).
4. **캘린더는 끌어 놓기가 없고**(onDrag* 0건) 업무는 읽기 전용 파생 이벤트로만 얹힌다 — 마감을 캘린더에서 옮길 수 없다. 주간 그리드는 폰 규칙 0건이라 390px 에서 7열 그대로다(미측정).
5. **보고서는 입구 6곳·저장소 4개**(report_units·weekly_reviews·business_weekly_reports·reports). dev 실측 — 단위보고서 682건 중 **사람이 확정한 것 0**, 서술 3, 수정 0; 개인 주간결산 363건 전부 자동, 회고 메모 3. 즉 «자동으로 만들어지지만 아무도 안 읽고 안 고치는 보고서» 상태다. 쓸모를 되찾으려면 «보내는 보고서(고객용)» 하나로 수렴시켜야 한다.

---

## 1. 구현 상태

| 영역 | 기능 | 상태 | 근거 · 빠진 것 |
|---|---|:-:|---|
| **Q Task** | 상태 머신(10종: not_started·waiting·in_progress·reviewing·revision_requested·done_feedback·completed·canceled·on_hold·external_review) | ✅ | DB ENUM(tasks.status) · 진입 매트릭스 `dev-backend/services/taskTransition.js:82-86,100-120` · 컨펌 정책 all/any → done_feedback `services/actions/task_actions.js:317-341` · 최종완료 예외 `:1063-1078`. ★ `CLAUDE.md` 의 ENUM 목록(8종)은 on_hold·external_review 가 빠져 **문서가 낡았다** |
| | 워크플로 라우트(ack·submit/cancel-review·approve·revision·revert·revert-status·hold·resume·complete·policy·reviewers·deliverable-versions·workflow) | ✅ | `dev-backend/routes/task_workflow.js:70-449` — 전부 행동 계층(task_actions) 경유, 감사·이력·알림·브로드캐스트 포함 |
| | 상세 드로어 액션 게이트(담당자/컨펌자/보류/외부컨펌/최종완료) | ✅ | `dev-frontend/src/components/QTask/TaskDetailDrawer.tsx:1515-1545` — 서버 FIELD_RULES 와 같은 집합이라고 주석에 명시, 외부컨펌 잠김 상태는 비활성+이유(`:1540`) |
| | 업무 추가 폼 한 벌(제목·프로젝트·담당자·기간·예측h+AI·업무그룹·태그·반복·설명·첨부) | ✅ | `components/QTask/TaskCreateForm.tsx:354-464`; Q Task·프로젝트 업무탭·팝아웃 퀵추가·Cue 바·AI 분해·템플릿 모두 같은 폼/행동 계층 (`pages/QProject/TasksTab.tsx:97-99,215-221`) |
| | 목록: 내 업무(오늘·이번 주·전체·요청·나의 보고서) / 전체 업무(업무·주간·월간) · 리스트/칸반 · 필터(검색·상태·담당자·완료숨김) · 우선순위 번호 · 우측 패널(받은요청·확인요청·보낸요청) | ✅ | `pages/QTask/QTaskPage.tsx:79,221-222,1324,1738-1790,1809-1850,2440-2470,2971-3002` |
| | 빈 상태 + CTA(«업무 추가»·«Cue 에게 묻기») | ✅ | `QTaskPage.tsx:2403-2424` |
| | 반복 업무(부모/회차 · 범위 단일 판정 · 캘린더와 같은 RecurrencePicker) | ✅ | `services/recurringTaskGenerator.js` 헤더 · `services/taskSeriesScope.js` 헤더 · `TaskCreateForm.tsx:125,444-448`. dev 부모 7/회차 75 |
| | 템플릿 · 태그 · 관련업무 · 결과물 버전 · 일일진척 · 실제시간 자동누적 | ✅ | `routes/task_templates.js`·`task_tags.js`·`tasks.js:2726-2801`·`task_workflow.js:220-340`·`services/taskActualHours.js`. dev: 템플릿 9(전역)+1, **태그 0건**, 관련업무 1건, 실제시간 기록 업무 13/277 |
| | 고객 컨펌 컬럼(`requires_client_review`·`client_share_custom`·`client_share_content`) | 🔴 | 모델엔 있으나 백엔드 라우트·행동 계층 참조 **0건**(`grep requires_client_review routes/ services/actions/` = 0). dev 전부 0. 죽은 컬럼 |
| | `GET /api/tasks/my-month`·`/my-year`·`/backlog`·`POST /snapshot`·`GET /:taskId/estimations` | 🔴 | `routes/tasks.js:193,271,320,2534` · `routes/task_estimations.js:145` — 프론트 호출 0 |
| | `components/QTask/WorkspaceFinalizeBanner.tsx` | 🔴 | import 0 (죽은 컴포넌트, i18n 키만 남음) |
| **확인필요** | `GET /api/dashboard/todo` 13 수집기 · `total=all.length` · 배지 = `all.filter(type)` 한 공식 | ✅ | `routes/dashboard.js:87,279,371,417,483,549,605,740,826,868,927,984,1054` · 합산 `:1226-1264` |
| | 업무 5버킷(ack·revise·confirm·awaiting_confirm·finish) + «한 업무 = 한 버킷» | 🟡 | ack 버킷 `:113-121` 이 `status NOT IN (completed,canceled,on_hold)` 라 **reviewing·revision_requested·done_feedback 도 포함** → revise(`:150`)·finish(`:167`) 와 같은 업무가 두 버킷에 들 수 있다. dev 실측: reviewing 인데 ack 안 된 업무 3건(id 785·695·363)이 «요청 확인» 으로 뜬다 (§5-1) |
| | 확인필요 화면(탭 7: 전체·업무·메일·영업·채팅·서명·청구 · 우선순위/범주 그룹 · 드로어 열기 · 초대 수락/거절 인라인) | ✅ | `pages/Todo/TodoPage.tsx:5-25,231-247,372-405` · `components/Dashboard/TodoList.tsx:179-193,293-298` |
| | 목록에서 바로 처리(확인·승인·완료·미루기·무시) | 🔴 | 없음 — 초대·업무후보 외엔 전부 «열기» 뿐 (`TodoList.tsx:179-193`) |
| | 대시보드(확인필요 카드+분해·퀵액션 4·오늘 일정·온보딩 체크리스트·조직 범위·사용량 경고) | ✅ | `pages/Dashboard/DashboardPage.tsx:94-200` |
| **Q Project** | 목록(상태·종류·정렬·그룹 · 카드: 진행%·완료/전체·지연·최근활동·PM·고객수 · 복제 · 새 프로젝트 모달) | ✅ | `pages/QProject/QProjectPage.tsx:107-184,130-134,288,330,410` |
| | 목록 빈 상태 CTA | 🟡 | `QProjectPage.tsx:441` 이 `navigate('/talk')` — 문구 «Q talk 로 이동해 프로젝트 만들기». 같은 화면 머리줄에 이미 «+ 새 프로젝트»(`:330`)가 있다. **첫 사용자를 다른 메뉴로 보낸다** |
| | 상세 13탭(개요·업무·일정·문서·노트·파일·정보·보고서·히스토리·거래·고객·상세정보·설정) + 고정문서탭 · 고객에겐 4탭 | ✅ | `pages/QProject/QProjectDetailPage.tsx:146,150,742-760` |
| | 진입 시 선행 호출 8건(project·conversations·tasks·issues·notes·members·clients·email-threads) | 🟡 | `:438-442,465-466,476` — 탭과 무관하게 전부 선로드. 탭별 지연 로드는 캔버스·보고서·히스토리만 |
| | 개요 = 설명 + 캔버스(읽기) / 상세정보 = 편집 캔버스 + 이슈·메모·상태이력 / 설정 = 기본정보·멤버·채팅방 | ✅ | `:762-772,1077-1172,790-1077` · `canvas/ProjectCanvas.tsx:25,147,154` (편집은 상세정보 탭) |
| | 거래 단계(견적→계약→청구→세금계산서, 템플릿 4종 자동 시드, 다음 할 일 CTA, 구독 정기청구 설정) | ✅ | `TransactionsTab.tsx:143-427` · `services/actions/project_actions.js:178-182`(생성 시 seedStages). dev: 프로젝트 39개 중 견적 완료 1 — 대부분 «견적 active» 에서 멈춤 |
| | `POST /:id/stages/init` · `GET /:id/report`(#64 v1) | 🔴 | `routes/projects.js:1750,2323` 프론트 호출 0 |
| | 프로세스(테이블) 탭 | 🔴 | `ProcessPartsTab.tsx` import 0 · `?tab=process` 는 docs 로 리다이렉트(`QProjectDetailPage.tsx:248`) 인데 `routes/project_process.js` 는 여전히 마운트(`server.js:462`), i18n `tab.process:'테이블'` 잔존. dev 행 16건 |
| | 프로젝트 비용(`ProjectExpense`) | ⬜ | 모델 존재, 프론트 `/expenses` 호출 0, dev 0행. 손익 통계 입력인지 미확인 |
| **Q Calendar** | 월/주/일/안건 4뷰 · 프로젝트 필터 · 개인 구글 오버레이 토글 | ✅ | `pages/QCalendar/QCalendarPage.tsx:317-345,497-604,107,513` |
| | 일정 모델(반복 rrule+예외·종일·공개범위 vlevel·참석자 멤버/고객·알림·Meet·gcal 2축 동기·예약상태·업무연결) | ✅ | DB `calendar_events` 컬럼 · `routes/calendar.js:134-1362` |
| | 반복 수정/삭제 범위(이 회차/이후/전체) | ✅ | `routes/calendar.js:366-485` · `EventDrawer.tsx:298-305,1078-1084` |
| | 업무 ↔ 일정 | 🟡 | 업무는 **읽기 전용 파생 이벤트**(`taskToEvent.ts:6`, 클릭→업무 열기 `QCalendarPage.tsx:364-367`), 일정→업무 연결 `services/eventTaskLink.js`. **캘린더에서 마감을 옮기거나 업무를 만드는 길은 없다** |
| | 끌어 놓기(이동·길이 조절) | 🔴 | `onDragStart|draggable|onDrop` 0건(`pages/QCalendar/*.tsx`) |
| | 폰 대응 | 🟡 | `QCalendarPage.tsx` 640px 규칙 4곳(헤더 축소) · `TimeGridView.tsx` 반응형 0건 · 폰에서 뷰 강제 전환 로직 0건 → 주간 7열이 390px 에 그대로(미측정) |
| | 등록 모달 vs 상세 드로어 두 벌 | 🟡 | `NewEventModal.tsx`(참석자·알림·Meet·gcal·자료·반복·업무연결) / `EventDrawer.tsx`(참석자·알림·gcal·Meet·공유·반복·범위). 알림 목록이 갈라졌던 전력 `reminderOptions.ts:1-8` |
| | 구글 동기(양방향: push + PlanQ 발 일정만 역동기·개인 읽기 오버레이) · 상담 예약 · 알림 cron · 공휴일(워크스페이스 수동 등록) | ✅ | `services/calendarSync.js` 헤더 · `calendarReverseSync.js` 헤더 · `services/booking.js`·`BookingActions.tsx` · `calendarReminderCron.js` · `routes/business_holidays.js`+`pages/Settings/HolidaySettingsSection.tsx`. dev 예약 0건 |
| **근태** | 출퇴근/휴게(사이드바 위젯·확인필요·근태 페이지) · 포커스 복귀 자동 출근(옵션) · 정정 · 자동 마감 · 휴가 부여/잔여/신청/승인 | ✅ | `routes/attendance.js:62-460` · `routes/leave.js:42-184` · `components/Attendance/AttendanceWidget.tsx` (`MainLayout.tsx:22`) · `hooks/useAttendance.ts:148` · 승인은 확인필요(`dashboard.js:371`) |
| | 팀 근태/현황/월 통계 화면 | 🟡 | 근태 페이지 탭은 «내 근태·휴가» 둘뿐(`AttendancePage.tsx:28`); 팀 보기는 **설정 > 근태 관리**(`pages/Settings/AttendanceAdminSettings.tsx:15,54-57`)에 산다 — 매니저가 팀 출근을 보려면 설정으로 간다 |
| | 내보내기(CSV/급여 연동) | 🔴 | `csv|export|download` 0건 |
| **인사이트** | `/stats/*` 8탭(개요·업무·주간추이·수익·팀·재무·유입·보고서) · recharts · requireMenu(insights) · 멤버도 열람 | ✅ | `routes/stats.js:103-266` · `pages/Insights/InsightsPage.tsx:23-24,122-129` · `config/navMenus.ts:71-74` |
| | Cue 능동 카드(확인필요 상단) | ✅ | `routes/insights.js` · `TodoPage.tsx:389` |
| **보고서** | (a) 단위 보고서 member/project/department × 주/월 — 자동 초안·서술 AI·확정/재개 | ✅ | `routes/reports.js:142-254` · `services/reportUnitSnapshot.js` · 입구: Q Task «나의 보고서»(`components/QTask/WeeklyReviewTab.tsx:14-25`), 프로젝트>보고서(`ProjectReportTab.tsx`), 전체>프로젝트별/개별(`ReportsList`) |
| | (b) 통합 보고서(워크스페이스 롤업·공유 링크·초안/확정) | ✅ | `routes/reports.js:276-460` · `IntegratedReportView` |
| | (c) 개인 주간 결산 «이번 주 마무리»(스냅샷+회고 메모, 자동 cron) | ✅ | `routes/weekly_reviews.js:50-130` · `WeeklyReviewModal`(`QTaskPage.tsx:1700,3113`) · `services/weeklyReviewCron.js` |
| | (d) 워크스페이스 주간보고(`business_weekly_reports`) | 🟡 | `routes/weekly_reviews.js:331-466` · 프론트 `services/weeklyReview.ts` → 쓰는 화면은 Insights «주간 추이» 뿐(`WeeklyTrendTab.tsx`). 전용 화면 없음 |
| | (e) Insights 보고서(월/분기/연 PDF + 공유) | ✅ | `routes/stats.js:225-266` · dev 월 29·분기 1 생성, 공유 0 |
| | 단위 보고서 자동 확정 | 🟡 | `services/reportUnitCron.js:39-41` 미확정분을 `finalized_by='auto'` 로 **사람 없이 확정**. dev: 682건 중 사람 확정 0 · 서술 3 · 수정 0 → «확정» 이 뜻을 잃었다 |
| **문서** | 설계 문서 상태 머리말 | 🟡 | `docs/ATTENDANCE_LEAVE_DESIGN.md:4` «설계 확정 대기», `docs/PROJECT_STAGE_SUBSCRIPTION_DESIGN.md:3` «Irene 승인 후 구현» — 둘 다 구현됐는데 머리말이 안 바뀜. `docs/QPROJECT_AUDIT.md`(04-20)는 13탭 이전 상태 |

dev DB 단면(2026-10-07): 업무 277(미진행 146·진행 55·컨펌중 12·완료 50) · 컨펌자 붙은 업무 23 · 댓글 14 · 상태 전이 상위 = 미진행→진행 61, **진행→미진행 45**(되돌림이 둘째로 많다 — 진행률 0 으로 자동 전환되는 양방향 sync 흔적) · 승인완료(done_feedback) 전이 총 4 · `review_policy` 274/274 가 'all'('any' 사용 0) · 예측시간 222/277(AI 자동) · 실제시간 13/277.

---

## 2. UX 점수 · 격차

| 영역 | 점수 | 근거 | 최고 수준(Linear·Notion·Asana·HubSpot)과의 격차 |
|---|:-:|---|---|
| Q Task 목록 | **7** | 오늘/이번 주/전체/요청 탭이 «내가 할 일» 을 잘 가른다(`QTaskPage.tsx:1058-1070` 이번 주 정본 규칙). 빈 상태 CTA 있음. 칸반·우선순위 번호·Cue 바·팝아웃 다 있다 | 일괄 선택/일괄 변경 없음(체크박스는 완료 토글뿐 `:2040`) · 키보드 단축키는 `/`·`\` 패널 토글뿐(`:313`) · 그룹(프로젝트별/담당자별) 없음 · 저장되는 뷰(내 필터 조합) 없음 · 열(컬럼) 숨기기 없음 |
| Q Task 상세·흐름 | **6** | 액션 카드가 역할·상태로 정확히 버튼을 고른다(`TaskDetailDrawer.tsx:2183-2330`). 승인완료→최종완료 분리, 외부컨펌 잠김 이유 표시. 수정요청은 사유 필수 | **480px 드로어 안에 9 메타(`:1795-1995`)+설명·첨부·관련업무·결과물·버전·액션·컨펌자·댓글** → 첫 화면에 «다음 액션» 이 안 보인다(액션 카드는 결과물 아래 `:2183`). Linear 는 상태 변경이 머리줄 한 칸. 컨펌 흐름이 «ack → 시작 → 제출 → 승인 → 최종완료» 5단계라 담당자 클릭 5회·컨펌자 2회 — 소규모 외주팀엔 과하다(dev 전이 데이터가 증명: 컨펌 경로 11건 vs 직접 완료 57건) |
| 확인필요 | **6** | 숫자는 한 공식(`dashboard.js:1226-1264`), 탭·그룹·드로어·실시간 다 있다 | **인라인 처리 0**(`TodoList.tsx:179-193`) — 승인 하나에 «열기→스크롤→승인→메모→확인» · 미루기/무시 없음 · «요청 확인» 동사가 컨펌 중 업무에도 붙음(§5-1) · 항목이 «왜 나한테 왔는지»(요청자·기한)는 칩으로만. Slack/Linear inbox 는 행에서 바로 처리·스누즈·읽음 |
| Q Project 목록 | **7** | 카드 정보 밀도 적절, 그룹/정렬/복제 | 빈 상태가 다른 메뉴로 보낸다(`QProjectPage.tsx:441`) · 보드(칸반) 뷰 없음 · 상태가 active/paused/closed 3종뿐(파이프라인 단계 없음, Q sale 의 영업단계와 단절) |
| Q Project 상세 | **5** | 탭마다 껍데기 2종으로 정렬(CLAUDE.md 박제) · 캔버스 AI 초안 · 거래 «다음 할 일» CTA 는 좋은 패턴 | **13탭**이 «자료 종류» 축(문서·노트·파일·정보)과 «관리» 축(설정·상세정보·고객·거래·보고서·히스토리)이 섞여 있고, 멤버는 설정에·고객은 고객탭에·이슈는 상세정보에 있다. 첫 사용자가 «이 프로젝트 지금 상태» 를 보려면 개요(전략)·거래(단계)·업무(진척)·히스토리(최근)를 돌아야 한다. 진입 시 8 호출 선로드. 폰에서는 13탭이 가로 스크롤(`QProjectDetailPage.styles.ts:24`). Notion/Asana 는 «개요 한 장(상태·다음 마일스톤·최근 활동·담당·고객)» 으로 시작 |
| Q Calendar | **6** | 반복·범위 편집·종일·알림·Meet·동기·예약·공휴일 — 기능 폭은 넓다 | 끌어 놓기 없음 · 업무 마감 조정 불가 · 폰 주간뷰 미대응 · 등록/상세 두 폼 · 미니 캘린더·«오늘» 점프 외 키보드 없음 · 팀원 가용/겹침 표시 없음. Google/Notion 캘린더 대비 «만지는 느낌» 이 없다 |
| 근태 | **6** | 위젯 상시·자동 출근·휴가 잔여·정정·승인 흐름 완결 | 팀 현황이 설정 메뉴에 숨어 있다 · 월 집계/내보내기 없음 · 업무 실제시간·포커스와 무관(근태 ≠ 공수) |
| 인사이트 | **7** | 8탭·실데이터·차트·권한·Cue 카드 | 기간 비교(전기 대비)·CSV 내보내기는 설계서(`docs/INSIGHTS_DESIGN.md §2`)에 있으나 화면 확인 못 함(⬜) · 탭 8개는 소규모 팀에 과다 |
| 보고서 | **4** | 자동 초안·AI 서술·확정·롤업·PDF·공유 링크 — 기계는 다 있다 | 입구 6곳·저장소 4개·«확정» 이 자동으로 찍힘(사람 확정 0/682) · 고객에게 보내는 보고서가 없다(통합/PDF 는 내부용) · 어느 보고서를 언제 쓰는지 화면이 말하지 않는다 |

공통 격차: ① 되돌리기(Undo) 가 상태 되돌리기 외에는 없다(삭제·이동·일괄). ② 로딩은 스켈레톤이 있으나 **오류 상태의 «다시 시도»** 는 화면마다 다르다(미측정). ③ 폰 3폭은 Q Task·프로젝트 목록·드로어는 대응, 캘린더 주간·근태·인사이트는 규칙 0건.

---

## 3. 확장 기능 제안

| # | 문제(사용자 말) | 제안 | 기대효과 | 규모 | 위험 | 우선 |
|---|---|---|---|---|---|---|
| E1 | "확인필요에서 승인 하나 하려고 다섯 번 눌러요" | **확인필요 행 인라인 처리** — 업무 ack/승인/최종완료, 일정 참석응답, 휴가 승인은 행의 버튼으로. 수정요청(사유 필수)만 드로어. + «나중에»(스누즈 1일/다음주) | 하루 10건 처리 시 클릭 40회 절감. 확인필요가 «받은편지함» 으로 완성 | M | R=0 (같은 행동 계층 호출) | **P0** |
| E2 | "업무 상세 열면 뭘 눌러야 할지 모르겠어" | **드로어 머리줄에 «다음 액션» 1개 + 상태 칩** 고정(sticky). 메타는 ChipPopover 로 접고, 결과물·댓글·버전은 탭으로 | 첫 화면에서 처리 가능. 3,441줄 드로어의 정보 위계 복구 | M | R=0 | **P0** |
| E3 | "프로젝트 열면 지금 어디까지 왔는지 한 눈에 안 보여" | **개요 탭을 «상태 한 장»으로**: 단계(거래) 진행 바 · 다음 마일스톤/마감 · 지연 업무 N · 최근 7일 활동 5건 · 담당·고객 · 미결 이슈. 전략 캔버스는 접힌 카드 | 5탭 순회 → 1화면. 소규모 외주팀이 매일 여는 화면이 된다 | M | R=0 | **P0** |
| E4 | "보고서가 여러 개인데 뭘 보내야 할지 모르겠어" | **보고서 입구 통합**: Q Task «보고서» 하나(나의/프로젝트/전체 는 범위 셀렉트), 자동 확정 기본 OFF→«초안» 상태로 두고 확정은 사람만. + **고객용 보고서**(프로젝트 단위 보고서를 공개 링크/PDF 로 고객에게 발송, 서명본과 같은 `shareDenied` 술어) | 입구 6→1, «확정» 복원, 고객 보고가 PlanQ 안에서 끝남(에이전시 핵심 니즈) | L | **R=1**(외부 발송·공개 표면) → Fable | **P1** |
| E5 | "캘린더에서 마감을 끌어서 옮기고 싶어" | **끌어 놓기**: 일정 이동/길이 조절(DnD) + 업무 파생 이벤트 드롭 시 `due_date` PATCH(담당/작성/owner 만, 반복 회차는 범위 물음) | 캘린더가 계획 도구가 됨 | M | R=0 (기존 PUT/PATCH) | **P1** |
| E6 | "같은 걸 10개 업무에 바꾸려면 하나씩 열어야 해" | **다중 선택 + 일괄 변경**(담당·마감·프로젝트·상태·태그·삭제) — `resolveBulkTargetIds` 식으로 서버가 id 를 거른다 | 운영 정리 시간 1/10 | M | R=1 가능(일괄 삭제·남의 업무) → 삭제 제외 시 R=0 | **P1** |
| E7 | "컨펌 받을 사람 없으면 그냥 끝내고 싶은데 단계가 많아" | **경량 모드**: 컨펌자 0 + 요청자=담당자 → «시작·완료» 2단계만 보여주고, ack 는 요청받은 업무에만(이미 그렇다) + 승인완료 단계는 `review_policy` 와 같이 워크스페이스 설정으로 ON/OFF | dev 전이 데이터(직접 완료 57 vs 컨펌 11)에 맞는 기본값 | S | R=0 (표시만, 전이 규칙 불변) | **P1** |
| E8 | "팀 누가 출근했는지 보려면 설정에 들어가야 해" | 근태 페이지에 **팀 탭 복귀**(owner/admin/팀장) + 월 집계 CSV | 매니저 동선 정상화 | S | R=0 | **P2** |
| E9 | "프로젝트 템플릿으로 같은 구조를 반복하고 싶어" | 프로젝트 **복제 시 업무 템플릿 묶음 선택**(이미 있는 task_templates + duplicate 결합) | 반복 외주 세팅 5분→30초 | S | R=0 | **P2** |
| E10 | "팀원 누가 여유 있는지 모르겠어" | 전체 업무 탭에 **담당자별 주간 부하(예측h 합/가용h)** 막대(기존 `CapacityWorkdays`·`AiLoadSummary` 재사용) | 배정 판단 근거 | S | R=0 | **P2** |

이미 있어서 제안하지 않은 것: 반복 업무·템플릿·태그·관련업무·결과물 버전·보류/외부컨펌·공유 링크·팝아웃·Cue 생성·AI 예측·구글 양방향 동기·상담 예약·공휴일·휴가·자동 출근·프로젝트 복제·히스토리 원장·PDF 보고서.

---

## 4. 개선 설계 (바로 구현 가능 수준)

### 4-1. 확인필요 인라인 처리 (E1)

**문제** — `TodoList.tsx:179-193` 은 항목 클릭 = 드로어 열기뿐. 업무 ack/승인/최종완료·일정 응답·휴가 승인이 전부 «열고 스크롤».

**와이어(행 1줄, 폰은 2줄)**
```
[아이콘] 요청 확인 · 로고 시안 수정           김PM · 내일 마감   [확인]  [열기]
[아이콘] 승인 요청 · 제안서 v2               박디자이너 · 오늘   [승인] [수정요청▸] [열기]
[아이콘] 최종 완료 · 랜딩 카피               (승인완료)          [최종 완료] [열기]
[아이콘] 참석 응답 · 킥오프 미팅 10:00         내일               [참석] [불참] [열기]
[아이콘] 휴가 승인 · 이수진 10/14~15          잔여 7일            [승인] [반려▸] [열기]
```
«수정요청▸»·«반려▸» 는 사유 필수 → 행 아래 인라인 입력 펼침(드로어 아님). 성공 시 행이 0.3초 민트로 반짝이고 사라짐(토스트 금지).

**건드릴 곳**
- 서버: `routes/dashboard.js` 각 업무 항목에 `actions: ['ack'|'approve'|'revision'|'complete']` 를 **수집기가** 싣는다(verb 에서 파생하지 말 것 — 동사와 가능한 행동은 다르다). 일정은 `rsvp`, 휴가는 `approve|reject`.
- 화면: `components/Dashboard/TodoList.tsx` 행 우측에 `ActionButton`(sm 36px) — 호출은 기존 `callAction` 과 같은 경로 `POST /api/tasks/:id/{ack|reviewers/me/approve|reviewers/me/revision|complete}`, 일정 `PUT /api/calendar/by-business/:biz/:id/attendees/:attendeeId`, 휴가 `POST /api/leave/requests/:id/{approve|reject}`. 입력은 `useDraftText`(kind 등록).
- «나중에»: `todo_snoozes`(user×item_id×until) 새 표 1개 — 수집기 결과에서 빼지 말고 `snoozed_until` 을 실어 화면이 접는다(숫자 계약: total 은 그대로, 접힌 수를 따로 표시).
- ko/en: `dashboard.json` `todo.action.{ack:'확인'/'Acknowledge', approve:'승인'/'Approve', revision:'수정요청'/'Request revision', complete:'최종 완료'/'Finalize', attend:'참석'/'Attend', decline:'불참'/'Decline', later:'나중에'/'Later'}`.
- 검증: `--suite inboxcount` 확장 — 행 버튼 클릭 → DB status 변화 + `total` 감소 1 + 드로어 열리지 않음(음성 대조군: 드로어 `aria-modal` 0). 3폭.

### 4-2. 업무 드로어 «다음 액션» 머리줄 (E2)

**문제** — 액션 카드가 `TaskDetailDrawer.tsx:2183` (메타 9개·설명·첨부·관련업무·결과물 아래).

**와이어(밴드 2 = DetailMetaBar 안)**
```
[← ] 로고 시안 수정                                   [⋯]
[진행중 ▾] [담당 김디자인] [마감 10/9]     [컨펌 요청 보내기]  (Primary 1개)
──────────────────────────────────────────────
탭: 내용 · 결과물(v2) · 댓글 3 · 활동
```
- Primary 1개 = `assigneeHasAction`/`reviewerCanAct` 가 고르는 **첫 번째 가능 액션**(ack > start > submit > approve > completeFinal > completeSimple). 나머지는 `⋯`.
- 메타(프로젝트·태그·중요도·기간·예측/실제/진행·마일스톤)는 `ChipPopover` 칩으로 밴드2 좌측에 가로 흘림(flex-wrap 금지 — CLAUDE.md 두 밴드 계약).
- 본문은 탭 4개로 분할(현재 세로 나열 8섹션) — 탭 상태는 `localStorage` 편의.

**건드릴 곳** — `TaskDetailDrawer.tsx` 렌더 구조만(게이트 변수 `:1515-1545` 그대로 재사용, API 0 변경). 공용 `components/Layout/PanelHeader`(`DetailMetaBar`)·`components/Common/ChipPopover`·`OverflowMenu`. ko/en `qtask.json` `detail.tabs.{content,deliverable,comments,activity}` = 내용/결과물/댓글/활동 · Content/Deliverable/Comments/Activity.
**검증** — 480px 에서 Primary 버튼 `getBoundingClientRect().top` < 160(스크롤 0) · 역할×상태 조합 표(담당/컨펌자/요청자 × 10상태)마다 Primary 가 기존 액션 카드의 첫 버튼과 **같은 라벨**인지 양성 대조 · 폰 100vw.

### 4-3. 프로젝트 개요 «상태 한 장» (E3)

**문제** — 개요 탭 = 설명 + 전략 캔버스(`QProjectDetailPage.tsx:762-772`). 진척·단계·최근 활동·지연은 각각 업무·거래·히스토리 탭.

**와이어**
```
┌ 진행 54% ▓▓▓▓▓░░░░  완료 8 / 진행 6 / 지연 3      단계: 견적 ✓ → 계약 ● → 청구 ○ → 세금계산서 ○ ┐
│ 다음 할 일: [계약서 서명 요청]  (거래 next_action 그대로)                                       │
├ 이번 주 마감 (3)                      │ 최근 활동 (히스토리 상위 5)                          │
│ · 로고 시안 수정 — 김디자인 · 10/9     │ · 10/7 박PM 이 계약서 v2 업로드                        │
│ · …                                  │ · …                                                 │
├ 담당 PM 박PM · 멤버 4 · 고객 ACME(이메일) │ 미결 이슈 2 · 보류 업무 1                           │
└ ▸ 전략 캔버스 (접힘)                                                                         │
```
**건드릴 곳** — 새 컴포넌트 `pages/QProject/ProjectOverview.tsx`(`ProjectTabPane` 안). 데이터는 **이미 내려온 것**만: `sortedTasks`(진척·이번 주 마감), `GET /:id/transactions`(단계·next_action — `TransactionsTab` 이 쓰는 같은 응답), `GET /:id/history?limit=5`, project.members/clients, issues. 새 API 0. 전략 캔버스는 `<details>` 접힘으로 유지(ProjectCanvas readOnly).
**ko/en** `qproject.json` `overview.{progress:'진행',thisWeek:'이번 주 마감',recent:'최근 활동',nextAction:'다음 할 일',openIssues:'미결 이슈',strategy:'전략 캔버스'}` / Progress·Due this week·Recent activity·Next action·Open issues·Strategy canvas.
**검증** — `--suite projecttabs` 12탭×3폭 규격 그대로 통과 + 개요 탭 첫 화면(1440×900 스크롤 0)에 진행%·단계·다음 할 일·최근 활동 1건이 모두 **보이는지**(`elementFromPoint`).

### 4-4. 보고서 입구 통합 + 사람 확정 (E4, 1단계 R=0 부분만)

**문제** — 입구 6곳(`WeeklyReviewTab.tsx`·`ProjectReportTab.tsx`·`WeeklyReviewModal`·`ReportsTab.tsx`·`WeeklyTrendTab.tsx`·프로젝트 보고서 탭), 자동 확정(`reportUnitCron.js:39-41`)으로 사람 확정 0.

**설계(1단계, 발송 제외)**
- Q Task 좌측 탭을 «나의 보고서 / 전체 주간 / 전체 월간» 3개 → **«보고서» 1개** + 상단 `segmentedToggle`[주간|월간] + 범위 셀렉트[나 · 프로젝트 ▾ · 전체(통합)]. `WeeklyReviewTab` 을 범위 prop 하나로 통일(이미 `reviewScope` 가 있다).
- «이번 주 마무리» 모달(weekly_reviews) 은 **개인 주간 보고서의 «회고 메모» 칸**으로 흡수 — `retro_note` 를 `report_units(member)` 의 `narrative` 와 한 칸으로 보여주고 저장은 종전 두 표 그대로(데이터 이동 없음, 표시 통합만). 2단계에서 표 통합은 R=1(백필) → Fable.
- 자동 확정: `businesses.monthly_finalize_enabled` 와 같은 자리에 `weekly_auto_confirm` 토글(기본 **OFF**), OFF 면 cron 은 초안만 만들고 `status='draft'` 유지 + 확인필요에 «보고서 확정» 항목(수집기 1개 추가, verb `confirm_report`).
- 프로젝트>보고서 탭은 그대로(출처에서 편집 — `docs/REPORTING_REDESIGN.md §1` 결정 유지).

**건드릴 곳** — `QTaskPage.tsx:1756-1790`(탭), `components/QTask/WeeklyReviewTab.tsx`, `services/reportUnitCron.js:39`(토글 분기), `routes/dashboard.js`(수집기), `routes/businesses.js`(설정 PUT 한 필드). ko/en `qtask.json` `tab.reports:'보고서'/'Reports'`, `reports.scope.{me:'나',project:'프로젝트',all:'전체'}`, `dashboard.json` `todo.verb.confirm_report:'보고서 확정'/'Confirm report'`.
**검증** — 토글 OFF 워크스페이스에서 cron 수동 호출(`finalizeUnitsForPeriod(..., {autoConfirm:false})`) → `status='draft'` 유지 + todo `total` +1(양성 대조군: ON 이면 confirmed·+0). 입구 수: 라우트 `/tasks?tab=` 값 집합이 3→1.

### 4-5. 캘린더 끌어 놓기 + 업무 마감 조정 (E5)

**와이어** — 월/주 뷰에서 일정 블록 drag → 날짜/시간 이동, 하단 손잡이 → 길이. 업무 파생 블록(점선)은 drop 시 «마감일 변경: 10/9 → 10/11 [변경] [취소]» 인라인 확인(반복 회차면 `SeriesScopeDialog` 그대로).
**건드릴 곳** — `MonthView.tsx`·`TimeGridView.tsx` 에 HTML5 DnD(공용 `docs/folderDrop.ts` 의 MIME 분기 선례 — `Files` 와 구분). 일정은 `PUT /api/calendar/by-business/:biz/:id`(`start_at/end_at`, 반복이면 scope 물음 `EventDrawer.tsx:298` 로직 재사용), 업무는 `PUT /api/tasks/by-business/:biz/:id`(`due_date`, FIELD_RULES 가 권한을 정한다 — 화면은 `canEditDatesFor` 와 같은 술어). 폰(≤640)은 길게 누르기 대신 **끄기 비활성 + 드로어**(오탐 방지).
**검증** — `--suite` 신규: drop 후 DB `start_at`/`due_date` 일치 · 권한 없는 사용자 drop 403 → 블록 원위치(음성 대조군) · 반복 회차 drop → 범위 창 표시.

### 4-6. Q Project 빈 상태 CTA 정정 (소, 즉시)

`QProjectPage.tsx:441` `navigate('/talk')` → `setNewProjectOpen(true)`. ko `empty.desc/cta` «Q talk 에서 프로젝트를 만들면…/Q talk 로 이동해 프로젝트 만들기» → «첫 프로젝트를 만들어 업무·문서·청구를 한 곳에 모으세요» / «새 프로젝트 만들기» (en: "Create your first project to keep tasks, documents and billing together" / "Create a project"). 검증: 빈 워크스페이스 계정(카나리 임시 계정)에서 CTA 클릭 → `NewProjectModal` `aria-modal` 1.

---

## 5. 버그 · 위험 발견

| # | 심각도 | 내용 | 근거 |
|---|:-:|---|---|
| 5-1 | **중** | 확인필요 «요청 확인(ack)» 버킷이 컨펌 중·수정요청·승인완료 업무까지 집는다 → 담당자에게 «요청을 확인하세요» 라고 뜨는데 이미 제출한 업무다(동사 거짓). revision_requested/done_feedback 이면 revise/finish 와 **같은 업무가 두 항목**(«한 업무 = 한 버킷» 계약 위반, 배지 ≠ 목록 재발 경로). dev 실측 reviewing+미ack 3건(id 785·695·363; 전이 경로는 Cue/PUT 로 ack 없이 reviewing 진입) | `routes/dashboard.js:113-121` (`status NOT IN [completed,canceled,on_hold]`) vs `:150`·`:167`. 수정: ack 버킷을 `stageWhere` 밖 상태(not_started·waiting·in_progress)로 좁히거나, revise/finish 수집 뒤 id Set 으로 제외 |
| 5-2 | 중 | 단위 보고서 자동 확정이 사람 확정을 대체 — 682건 중 사람 0, `finalized_by='auto'`. «확정본만 통합에 롤업» 원칙(`docs/EXECUTION_REPORTING_MASTER_DESIGN.md` P3)이 데이터상 무의미 | `services/reportUnitCron.js:39-41`, dev SELECT |
| 5-3 | 하 | Q Project 빈 상태 CTA 가 Q Talk 로 보낸다(같은 화면에 생성 버튼 있음) | `QProjectPage.tsx:330,441` |
| 5-4 | 하 | 죽은 코드·라우트: `tasks.js` my-month/my-year/backlog/snapshot(`:193,271,320,2534`) · `task_estimations.js:145` · `projects.js:1750(stages/init),2323(/report v1)` · `ProcessPartsTab.tsx`+`routes/project_process.js`(마운트 `server.js:462`) · `WorkspaceFinalizeBanner.tsx` · 업무 컬럼 `requires_client_review/client_share_*`. 공격 표면은 아니지만(전부 인증) 유지보수 혼선 | 각 파일 · 프론트 grep 0 |
| 5-5 | 하 | `CLAUDE.md` «Q Task 상태 ENUM» 8종 표기 — 실제 10종(on_hold·external_review). 새 코드가 문서를 믿고 삼항 기본값으로 떨어뜨릴 위험(상태값 규약 박제와 같은 계열) | DB ENUM · `taskTransition.js:82-86` |
| 5-6 | 하 | 상태 이력 상위 2위가 «진행→미진행 45건» — 진행률 0 입력 시 자동 되돌림(양방향 sync) 으로 보이며, 담당자 의도와 다를 수 있다(«시작했는데 다시 미진행이 됐다»). 운영 재현은 못 했다(미확인) | dev `task_status_history` 집계 · CLAUDE.md «진행률 ↔ status 양방향 sync» |
| 5-7 | 정보 | `review_policy='any'` 사용 0/274 · 태그 0 · 관련업무 1 · 실제시간 13/277 · 예약 0 · 휴가 신청 0 · 보고서 공유 0 — 기능은 있으나 dev 에서조차 안 쓰인다. 운영 수치로 재확인 뒤 **접거나 기본 노출에서 내리는** 판단 필요 | dev SELECT |
| 5-8 | 정보 | 설계 문서 머리말 낡음: `ATTENDANCE_LEAVE_DESIGN.md:4`·`PROJECT_STAGE_SUBSCRIPTION_DESIGN.md:3`(«승인 대기» 인데 구현됨), `QPROJECT_AUDIT.md`(6탭 시절) | 각 파일 |

미측정(⬜): 폰 390px 캘린더 주간뷰 실제 렌더 · 인사이트 기간 비교/CSV 존재 여부 · 오류 상태 «다시 시도» 일관성 · 운영 데이터 기준 기능 사용률. 실브라우저는 서버 메모리 사유로 쓰지 않았다.
