# 운영 피드백 백로그 — 전수 실측 + 실행 설계

> 작성: 2026-07-11 (Fable 검증/설계 게이트). 코드 무수정 · 운영 DB read-only SELECT 만.
> 원천: 운영 `feedback_items` (planq.kr, 87.106.78.146). 판정 근거는 전부 HEAD(`2400358`) 코드 실측 + git commit + 운영 DB/번들 실측.

---

## ① 실측 요약

### 집계 (운영 DB, 2026-07-11 기준)

| status | 건수 |
|---|---|
| done | 118 |
| pending | 16 |
| reviewing | 3 |
| wontfix | 1 |
| **총계** | **138** |

- **미해결(pending+reviewing) = 19건.** DEVELOPMENT_PLAN 의 "미처리 50건" 기록은 **과대(정정 필요)** — 실측 19.
- **dev DB `feedback_items` 는 테스트 행 5건뿐**(P6/P7 verify 등) — 운영이 단일 원천. 동기화 이슈 없음.
- 미해결 19건 전부 category=`improve`, priority=`normal`. 스레드(자식) 0건.
- 작성자: irene 17건 / 한수정 2건(#60, #134).
- 위생 참고: done 118건 중 **admin_response 없는 done 28건** (답변 없이 종결 — 정책상 허용이면 무시 가능).

### 4분류 결과

| 분류 | 건수 | 건 |
|---|---|---|
| **A. 이미 해결 (status 만 미갱신)** | 4 | #115, #129, #133, #60 |
| **B. 진짜 미해결** | 7 | #127, #128, #130, #131, #134, #135, #136, #138 → 8건* |
| **C. 부분 해결** | 6 | #81, #85, #99, #112, #125, #126 |
| **D. Irene 결정 필요** | 1(+3 겹침) | #137(가격) — 겹침: #81(Cue 범위), #99(공개링크 정책), #126(OAuth 검증 제출) |

\* B 는 8건: #127, #128(부분이나 핵심 미해결이라 B 로 배치), #130, #131, #134, #135, #136, #138.

---

## ② 판정 테이블 (미해결 19건 전건)

| # | 제목(요지) | 판정 | 근거 (파일:라인 / commit / 실측) | 난이도 | 영향도 |
|---|---|---|---|---|---|
| **60** | Q talk 모바일 알림 안 옴 (한수정, 6-18) | **A** | 발송 배관 완비: `routes/conversations.js:638-727`·`routes/projects.js:638-731` notifyMany(`62b2eb8`), 네이티브 APNs/FCM 배선(`bcc1141`·`5526e56`, 7-03). **운영 실측: 한수정(user 3) 7월 push `sent` 125건, Apple(web.push.apple.com)+FCM 활성 구독 2개. 7월 미발송은 no_subs 12건뿐.** 잔여는 기기 표시상태(박제 `feedback_ios_push_presentation_device_state`). ⚠️ 비고: 운영 .env `APNS_*` 0건 — 현재 네이티브 구독 0이라 무해하나 **네이티브 앱 운영 출시 전 선행 필수**(미설정 시 `status='skipped', no_apns_key` silent) | — | — |
| **81** | Cue 가 실제 작업 수행 (문서/업무/일정 생성) | **C+D** | 됨: Task 담당자=Cue 지정 시 4종(summarize/draft_reply/categorize/research) 실행 `services/cue_task_executor.js:178-184`(`b5d2786`), admin 답변 6-21 존재. **안 됨: Q helper 대화→실행 액션 0** — `routes/cue.js:214-360` 은 답변만, 코드베이스 전체 LLM function-calling 0 hit. `Task/CalendarEvent/Document.create` 를 Cue 가 호출하는 코드 없음. 구현=LLM tool-use 레이어 신규(신규 아키텍처) | 대 | 상 |
| **85** | 보고서 SCR(상황·문제·해결) 구조 | **C** | 백엔드 전 scope 지원 `routes/reports.js:203-227`+`services/reportNarrative.js:15-79`(`e4577e8`). 프론트 적용 2곳: 개인(`WeeklyReviewTab.tsx:29`)·프로젝트(`ProjectReportTab.tsx:25`). **갭: 워크스페이스 통합보고서(`IntegratedReportView.tsx`)만 SCR 버튼 없음** — 백엔드 이미 지원, 버튼+호출 수십 줄 | 소 | 중 |
| **99** | 공개 업무링크 품질 + 존재 정책 | **C+D** | 라우트/페이지/공유정책 정상: `App.tsx:508`, `PublicTaskPage.tsx`, `share.js:22-95`(만료·비번·보안등급 게이트). **갭: `PublicTaskPage.tsx:120` description raw HTML 리터럴 노출**(다른 공개페이지는 `dangerouslySetInnerHTML`+sanitize 패턴 기존재: `PublicDocPage.tsx:106`), `:140/:146` 날짜 로케일 포맷 없음. + D: "업무에 웹미리보기가 있어야 하나" 자체는 정책 질문 | 소 | 중 |
| **112** | 수정요청 첨부 / 댓글 이미지 / 승인 코멘트 | **C** | (a)해결: revision 첨부 `TaskDetailDrawer.tsx:316-321,1427-1461`+`task_workflow.js:379-400`(#112 주석, `35ac300`). (b)부분: 로컬 저장분은 공개 서빙으로 해결(`task_attachments.js:371-386`), **gdrive 저장분 410 → #134 와 같은 뿌리**. (c)부분: 백엔드 note 수용 완비(`task_workflow.js:318-343`, system_approve 댓글 생성) — **프론트 approve 가 body 없이 호출**(`TaskDetailDrawer.tsx:625`), 입력 UI 없음 | 소(c)/중(b) | 상 |
| **115** | AI 업무추가 "요청내용" 라벨 혼동 | **A** | `fa607bd`(7-06, 운영 배포됨): "요청 내용"→"추가할 업무" `AiTaskCreateModal.tsx:217`+`ko/qtask.json:1005`(en 동시). 담당자 기본=나(`tasks.js:726`), 타인 지정 시 internal_request+요청자 컨펌자 자동(`tasks.js:727,745-752`) — 제보의 두 질문 모두 코드로 응답됨 | — | — |
| **125** | 구캘 연동 완료창 멈춤 + 제목 누락 | **C** | (a)미해결: 네이티브 경로 — Capacitor `Browser.open` 창은 `window.close()` no-op + **콜백에 딥링크 리다이렉트 0건**(`external_connections.js:34-63`, `planq://` grep 0) → 정확히 "자동으로 닫힙니다" 멈춤 재현. 웹도 COOP 로 close 차단(`cloud.js:12-15` 주석 자인). (b)제목 매핑은 정상(`google_calendar.js:170,203`; 호출 3곳 title 전달) — push 경로가 워크스페이스+Meet 생성 이벤트 한정인 것이 "안 들어감" 체감의 근본(→#126) | 중 | 중 |
| **126** | 기존 일정 미동기 + 보내기 + 날짜피커 | **C+D** | (a)연동 시 backfill push 코드 0건. (b)수동 "구글로 보내기" 없음(Meet 회의실 생성 `calendar.js:1090-1134` 이 우회 유일). (c)**실버그: `CalendarPicker.tsx:67-69` viewMonth 가 항상 오늘 고정** — 선택값 달로 안 열림(`setViewMonth` 호출처 prev/next 뿐). (d)개인 연동 scope=`calendar.readonly`(`personalOauth.js:19`), 개인 push 설계상 불가 — 양방향은 scope 변경+**Google OAuth 검증 제출(Irene 몫, 박제 `project_google_oauth_verification_pending`)** 선행 | (c)소 / (a,b,d)대 | 상 |
| **127** | Q note 메모 편집 풀블리드 | **B** | `MemoView.tsx:553-562` Body padding 24/28 + `:359-371` PostEditor 박스(borderless 아님, `PostEditor.tsx:284-294`). 7-07 이후 fix 커밋 없음 | 소 | 중 |
| **128** | 개인 보관함 레이아웃 프로젝트와 통일 | **B**(부분재사용) | 파일 탭은 `DocsTab` 재사용 OK(`PersonalVaultPage.tsx:228`), 문서 탭은 wrap 모드 불일치(`PostsPage.tsx:1569` $projectFull 분기), 정보 탭 구조 상이(`KnowledgePage` embedded vs `ProjectKnowledgeTab`), **대시보드=커스텀 리스트, 캔버스 아님**(`PersonalVaultPage.tsx:155-217`) | 중~대 | 중 |
| **129** | 내 문의·피드백 레이아웃 + 답변 안 보임 | **A**(재확인부) | 이미 마스터-디테일+검색/필터 완비 `MyFeedbackPage.tsx:167-323`(`c9eff31` 6-16). 답변 렌더 정상 `:242-250`, API 도 admin_response 반환(`routes/feedback.js:87-121`). **운영 번들 라이브 실측**(`frontend-build/assets/MyFeedbackPage-CYB0xE-Y.js` 에 admin_response 존재). 제보(7-07)가 반영 이후라 — Irene 이 본 표면(팝아웃 문의 탭 vs 페이지) 재확인 1회 필요 | — | — |
| **130** | Q Mail 좌측 리스트 다름 | **B** | `MailPage.tsx:713-740` Panel 340px+상단 FolderTabs vs Q docs 300px 카테고리 트리(`PostsPage.tsx:1569`)·접기(`CollapsibleSidebar`, Q Mail 좌측엔 없음 — collapse 는 우측 전용 `:127-150`) | 중 | 중 |
| **131** | 월보기 날짜칸 클릭=일정 생성 | **B** | week/day/agenda 는 onCreateAt 완비(`TimeGridView.tsx:130-140`, `ecd888d` #102) — **month 만 `MonthView.tsx:75` onSelectDate(그날 이동)뿐**, Props 에 onCreateAt 자체 없음 | 소 | 중 |
| **133** | 모바일 캘린더 안 보임 | **A** | AgendaView 257줄 실존+폰 기본뷰 자동(`QCalendarPage.tsx:32-34`)+오늘 스크롤(`AgendaView.tsx:81-91`). `9d994d1`+`732a386`, **운영 배포 20260708_182034**. Irene 폰 시각확인만 잔여 | — | — |
| **134** | 업무 이미지 첨부가 안 보임 (한수정, 7-09) | **B** | **근본원인 특정: `task_attachments.js` 서빙·preview_url 발급(:222/:278/:318/:371-386)에 storage_provider 분기 0** — Drive 연동+프로젝트 소속 업무는 업로드 시 로컬 unlink(:144-149) 후 로컬 경로 서빙 → **410 → `<img>` 깨짐**. 워크스페이스 직속 업무는 정상(로컬 저장) = "어떤 건 되고 어떤 건 안 됨" 패턴 정합. 대조군 `files.js:152-153,207-208` 은 이미 provider 분기 보유. 인접 잠복 4건: link 라우트 동일 410(:246-270), `TaskAttachment` ENUM 's3' 없음, RichEditor 인라인 업로드 gdrive 분기 preview_url 미반환(`files.js:470`), public-image `storage_provider='planq'` 하드필터(:169-181). #121(`e02ff25`)은 paste UX 만 고쳐 재발과 정합 | 중 | **상** |
| **135** | Meet 링크 복사에 제목+시간 | **B** | `EventDrawer.tsx:134-136` meeting_url 단독 복사. 조합 텍스트 없음 | 소 | 하 |
| **136** | 프로젝트 상세정보/설정 분리 | **B** | `QProjectDetailPage.tsx:390` 탭에 settings 없음, details 본문(:427-771)에 편집폼·멤버관리·채팅연결(설정성)과 이슈·메모·이력(정보성) 혼재 | 중 | 중 |
| **137** | 요금제 가격 + 추가슬롯 크래시 + 그리드 | **A(기술)+D(가격)** | 크래시+빈열: `e5a0561`(7-10) — **운영 라이브 실측**(오늘 배포 20260711_120337, `WorkspaceSettingsPage-DXfoA_7d.js` 에 `prorated_amount_krw`+신규 문구 존재). 실 HTTP 7/7 검증 이력. **가격 29,000→39,000 판단은 Irene** | — | — |
| **138** | 메시지 이모지 리액션 (7-11 신규) | **B** | reaction/emoji 개념 백·프론트 0 hit, `Message.js` 에 저장 필드 없음. 신규: MessageReaction 모델+마이그레이션+라우트(conversations/projects 2곳 중복 주의)+socket `message:reaction`+ChatPanel(3,623줄) 칩 UI | 중 | 중 |

---

## ③ 클러스터 (공통 근본원인 묶음)

| 클러스터 | 근본원인 | 포함 건 | 한 번의 수정으로 죽는 건수 |
|---|---|---|---|
| **K1. 첨부 저장소 provider 무인지** | `task_attachments.js` 서빙/URL 발급이 storage_provider 를 모름 (files.js 는 이미 해결한 패턴) | **#134 + #112(b)** + 잠복 4건(link 410·ENUM s3·인라인 업로드·public-image) | **2건 + 잠복 4건** |
| **K2. 캘린더 소품(독립 소형 버그 4개)** | 각각 독립이나 전부 QCalendar 표면 | **#131**(month 클릭) · **#135**(복사 텍스트) · **#126c**(CalendarPicker viewMonth) · **#125a**(OAuth 창 닫힘) | 4건 (반나절~1일 일괄) |
| **K3. 구글 캘린더 양방향 동기화 부재** | 개인 scope=readonly + push 경로가 Meet 생성 이벤트 한정 → "연동했는데 안 보임/안 감" 체감 전부 여기서 발생 | **#126(a,b,d)** + #125(b 체감분) | 2건 (단, 설계+Irene OAuth 검증 의존) |
| **K4. 워크플로우/공개페이지 마감 누락** | 백엔드는 완비인데 프론트 마지막 한 조각 미부착 | **#112(c)** 승인 코멘트(백엔드 note 완비) · **#85** 통합보고서 SCR 버튼(백엔드 완비) · **#99(b)** PublicTask 렌더(패턴 기존재) | 3건 (전부 소형) |
| **K5. 페이지별 bespoke 레이아웃** | 공통 컴포넌트(assetTabLayout·CollapsibleSidebar·캔버스) 미채택 표면 잔존 — 박제 `feedback_uiux_unified_master` 계열 | **#127** 메모 풀블리드 · **#130** Q Mail 패널 · **#136** 프로젝트 탭 분리 · **#128** 보관함 통일 | 4건 |
| **K6. 신규 기능** | 기능 부재 (버그 아님) | **#138** 리액션 · **#81** Cue 대화형 실행 | 2건 (별도 설계) |
| **K7. status 위생** | 코드 완료·배포됐는데 feedback status 미갱신 | **#115, #129, #133, #60, #137(기술분)** | 5건 (DB 갱신+답변만) |

---

## ④ 배치 실행 계획

우선순위 = (실사용 고통×빈도)÷난이도. 돈/보안/데이터손실 해당 건 없음(전건 improve) — 최고 고통은 K1(이미지 깨짐, 두 사용자 반복 제보 #112→#134).

### 배치 0 — Quick Win (즉시, 코드 0~수십 줄) → ⑤ 참조

### 배치 1 — K1: 첨부 provider 분기 (최우선 코드 사이클)
- **목표:** Drive/S3 저장 첨부의 preview/서빙/link 전면 provider-aware. #134·#112(b) 종결 + 잠복 4건 동시 제거.
- **범위:** `dev-backend/routes/task_attachments.js`(서빙 2경로 프록시/redirect + preview_url 발급 3곳 + link 복사), `models/TaskAttachment.js`(ENUM s3 — **운영 ALTER 사전 수동**, `feedback_sync_alter_too_many_keys` 주의), `routes/files.js`(gdrive 분기 preview_url + public-image 필터). 주의: gdrive `external_url`=webViewLink 라 `<img>` 직결 불가 → Drive API 스트리밍 프록시.
- **검증:** 실 HTTP — 프로젝트 소속 업무(Drive 연동 워크스페이스)에 이미지 업로드→preview 200·바이트 일치, 워크스페이스 직속(로컬) 회귀 200, Q File Drive 파일 link→표시, **운영 옛 데이터 sample 1건**(기존 410 첨부 재조회). e2e `--suite l1`(공개 서빙 확장이므로 L1 누출 카나리 필수).
- **Fable 게이트: 필요** — 공개 서빙 라우트(`/public/attach`) 동작 변경 + ENUM 마이그레이션(기준 3·5 인접).

### 배치 2 — K2+K4: 소형 버그 일괄 (1일 사이클)
- **포함:** #131(MonthView onCreateAt) · #135(복사=제목+시간+링크) · #126c(CalendarPicker viewMonth=선택값) · #112c(승인 시 코멘트 입력 — revision 폼 패턴 복제) · #99b(PublicTask sanitize HTML+날짜 포맷) · #125a(OAuth 콜백 네이티브 딥링크 리다이렉트+웹 fallback 문구).
- **규모:** 프론트 6파일 + 백엔드 1파일(external_connections.js) 내외. 전부 난이도 소.
- **검증:** 빌드 EXIT0/TS0 + 건별 실측(월칸 클릭→모달, 클립보드 텍스트, 피커 열림 달, approve note→system_approve 댓글 실 HTTP, 공개 업무 페이지 HTML 렌더, 네이티브 딥링크는 시뮬+웹 경로 실측). i18n ko/en.
- **Fable 게이트: 불필요** (일상 /검증). 단 #99b 는 sanitize 라이브러리 사용 — XSS 방향 확인 항목 포함.

### 배치 3 — K5: 레이아웃 통일 사이클
- **포함(순서):** #127(소: MemoView padding+borderless) → #136(중: details 탭→상세정보/설정 분리, SettingsTab·InfoTab 신설) → #130(중: MailPage 좌측을 PanelGridLayout+CollapsibleSidebar+300px+카테고리 구조로) → #128(중~대: 보관함 대시보드 캔버스화+정보 탭 수렴 — **와이어 텍스트로 Irene 합의 후 구현**, 박제 `feedback_copy_existing_design_not_bespoke`).
- **검증:** 빌드 + `scripts/e2e run.js --suite mobile,crosscut` + visual-audit 스크린샷 대조. guard-invariants(god-file 래칫 — QProjectDetailPage 분리는 오히려 감소 방향).
- **Fable 게이트: 불필요.**

### 배치 4 — K6-1: #138 메시지 리액션
- **범위:** MessageReaction 모델+마이그레이션(운영 ALTER 선행), conversations/projects 라우트 공용 핸들러, GET include+집계, socket `message:reaction`, ChatPanel 칩+피커(모바일 tap-to-reveal 재사용). 알림 미발송(스팸 방지) 권장.
- **검증:** 2브라우저 실시간(16번 체크리스트), 멀티테넌트 403, 모바일 e2e.
- **Fable 게이트: 필요** — 운영 DB 마이그레이션 포함 배포(기준 3).

### 배치 5 — K3+K6-2: 설계 선행 건 (Irene 의존)
- **#126 양방향 캘린더:** scope `calendar.readonly`→`calendar.events` 확장 + 연동 시 backfill push + 일정별 "구글로 보내기". **선행 = Google OAuth 검증 제출(Irene, 박제 잔존 과제)**. `/기능설계` 후 진행.
- **#81 Cue 대화형 실행:** LLM tool-use 레이어(create_task/create_event/create_document + confirm 게이트) — 신규 아키텍처. `/기능설계` + **Fable 게이트 필요**(기준 4) + 비용 게이트(costGuard·`plan.can('use_cue')`).

---

## ⑤ Quick Win (지금 30분~1시간)

1. **status 갱신 5건** (운영 DB, admin UI 로): 
   - **#115 → done** (라벨 교체 배포 완료, fa607bd)
   - **#137 → done + 답변** "크래시·레이아웃 수정 배포 완료(7-11). 가격은 검토 중" (가격분은 ⑥으로)
   - **#133 → done + 답변** "모바일 아젠다 뷰 배포(7-08) — 폰에서 확인 부탁"
   - **#60 → done + 답변** "발송 정상 확인(7월 125건 도달) — 안 오면 기기 알림설정 확인" 
   - **#129 → done + 답변** "리스트+검색/필터+답변표시 반영 라이브 — 다르게 보이면 위치 알려달라"
2. **#85 통합보고서 SCR 버튼** — `IntegratedReportView.tsx` 에 버튼+`generateNarrative` 호출(백엔드 완비, 수십 줄) → 붙이면 #85 done.
3. **DEVELOPMENT_PLAN "미처리 50건" → "미해결 19건(실측 2026-07-11)" 정정.**
4. (선택) done 118건 중 무응답 28건 — 일괄 답변 필요 여부는 Irene 정책 판단.

---

## ⑥ Irene 결정 대기

| # | 결정할 것 (한 줄) |
|---|---|
| **#137** | 베이직 플랜 29,000 → 39,000원 인상 여부 (기술분은 배포 완료) |
| **#81** | Cue 대화형 실행(채팅으로 업무/일정/문서 생성) 도입 여부 — 신규 tool-use 아키텍처 + LLM 비용 증가 vs "AI 최소 사용" 원칙 |
| **#99** | 업무 공개 공유링크 유지 여부 (유지 시 렌더 품질만 배치 2 에서 수정) |
| **#126** | Google OAuth 검증 제출 (양방향 캘린더의 선행, GCP 콘솔 = Irene 몫) |
| (인프라) | 네이티브 앱 운영 출시 전 운영 .env `APNS_*` 4종 입력 (현재 0건 — 미설정 시 iOS 네이티브 push silent skip) |

---

### 부록 — 실측 방법 기록
- 운영 DB: SSH `irene@87.106.78.146` → `/opt/planq/backend` Sequelize raw SELECT (read-only).
- 운영 반영: 프론트 번들 grep(`frontend-build/assets`) — #137 `prorated_amount_krw`, #129 `MyFeedbackPage-CYB0xE-Y.js` 확인. 배포 스냅샷 `backups/20260711_120337`.
- 코드 판정: HEAD `2400358` 기준, 4개 병렬 실측(캘린더/QTask/레이아웃/기능·인프라) — 각 판정에 파일:라인 명시.
- git 커밋 "#99"(프로젝트 정렬/그룹, `361d33a` 등)는 **DB #99 와 무관한 오표기** — DB #99(공개 업무링크)에는 관련 커밋 없음.
