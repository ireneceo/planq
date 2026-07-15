# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-07-15 (Opus, 1M) — **운영 피드백 45건 트리아지 + P0 배포 + 모바일 반응형 ② (dev)**

### 운영 피드백 구현 진행 (트리아지 `docs/qa/FEEDBACK_TRIAGE_2026-07-15.md`)
- ✅ **① P0 배치 — 운영 배포됨** (timestamp `20260715_123520`, commit `54705a1`, 3점 실측): #173/174/159/178 모바일 Q Mail 흰화면(data-panel-main) · #165 Q Talk 리스트 FAB · #171/172 업무드로어 닫기 z-index · #181 업무추가 FAB
- ✅ **② 모바일 반응형 — dev 커밋(미배포)** `4a9b347`+`7eb878b`: #176/177/160 프로젝트 탭 가로스크롤 · #169 KPI 2열 · #175 달력 팝오버 · #161 새일정 바텀시트 · #170(a) 통계 제목. **#170(b) 모바일 하위탭 스위처는 후속**
- ✅ **③ Q Mail 로직/AI** — #153 답장언어(운영배포) · #179 요약실패 표면화(운영배포) · #164 미리보기주소(운영배포) · **#154 일괄버튼**(dev — bulk-dismiss/read 라우트+리스트 상단바) · **#180 revert**(서버 이미 스코프됨, 검증서 회귀 검출)
- ✅ **④ 기획 (Fable verdict대로 전부 반영)**:
  - **#167 개요/상세 반전** (🚀운영배포) — 개요=readOnly 캔버스 / 상세=편집. ProjectCanvas+3하위(Workstream·Metrics·RelatedProjects) readOnly prop. #148 단일원천 유지
  - **#166 진척 문구** (🚀운영배포) — 40% 전 behind 봉인 + behindPace(주중)/behind(주말) 이원화
  - **#162(a) page_url 팝아웃 보정** (🚀운영배포) + **#162(b) client_env·is_popout 컬럼**(dev — ⚠️DB 마이그레이션, Fable 게이트)
- **미배포 dev**: #154(`d1bdeba`) · #162(b)(`c51c7a4`, sync-database 컬럼 생성됨 dev). 배포 시 운영 sync-database 확인 필요
- ✅ **이미해결 13건**(v1.47.0) close 대상 · **미확인 2건**(#179 last_error·#164 실물메일) · **#170(b) 모바일 통계 하위탭 스위처** 후속
- **결정 질문은 Fable 판단 동반** ([[feedback_decisions_with_fable_opinion]])

### (이전) v1.47.0 운영 배포 완료 🚀 (timestamp `20260715_112033`, commit `08c8216`)
**작업 상태:** 배포 완료·검증 통과 (3점 실측: 외부 헬스 200 · PM2 backend/qnote/**mcp** online fresh · D-6 activity 401 · 번들 11:23 · 백엔드 에러 0 · api_tokens 테이블 생성)

### 이번 배포 포함 (v1.46.2 → v1.47.0)
- **D — KB 정리 + 이벤트 스트림** (읽기 전용, Fable 불필요): D-5 작은 KB(<100KB) 임베딩 skip·전량 주입(`kb_service`) · D-6 워크스페이스 활동 타임라인(`services/event_stream.js` 6원장 UNION + owner 게이트 `GET /api/activity/:businessId`). 검증 22/22.
- **패널 핸들 좌우 통일**: 데스크탑 경계선 세로바(`PanelEdgeHandle`) **폐기·삭제** → 뷰포트 변 플로팅(`FloatingPanelToggle`) 하나로 좌/우 대칭·전 폭·전 화면(Q Talk·Task·Mail·Note·docs). `side`+`offsetOpen`+`hideBelow`+**`--pq-content-left`**(앱 네비 폭 오프셋 — 좌측 핸들이 콘텐츠 좌변에 붙게). guard PANELHANDLE 새 불변식(좌우대칭 강제+EdgeHandle 재유입 차단). 카나리 0.
- **Google 심사 대응**: Gmail 원클릭(`GMAIL_ONECLICK_ENABLED=false`)·Google 로그인 버튼(`GOOGLE_LOGIN_ENABLED=false`) **숨김** — 심사 통과 시 각 한 줄 `true`. 메일 연결 UX: 회사메일(Custom) 단계 안내 신설 + 앱비번 중심 hint(ko/en).
- 이전 세션분 동반 배포: `1e5694e`(#81 전이 툴) · `29d308b`(#D-4 MCP 읽기 서버 — planq-prod-mcp 127.0.0.1:3005).

### Google OAuth 검증 (진행 중 — Irene)
- 검증 대상 = **`calendar.events`**(워크스페이스 캘린더, 생성/수정/삭제+Meet). 데모 영상 촬영 가이드 전달됨(운영 planq.kr, 10단계 전수 코드검증 통과).
- 운영 gcal 설정 확인: REDIRECT=planq.kr · CLIENT_ID/SECRET 설정됨.
- **Irene 준비:** 촬영 계정을 GCP 테스트 사용자 추가(External+Testing이라 조직메일도 필수) · owner 권한 · 승인 리디렉션 URI `https://planq.kr/api/cloud/callback/gcal` 확인 · 영상 업로드/제출.
- Gmail(`mail.google.com` 제한 scope)·개인캘린더(`calendar.readonly`)는 **이번 라운드 제외**(Gmail은 CASA 별도 트랙 — 앱비번 IMAP로 대체 가능).

---

## (이전) #81 Cue 대화형 실행
**작업 상태:** 완료·배포됨(v1.46.2)

---

## ✅ 이번 세션 완료 (2026-07-15) — #81 Cue 대화형 실행

행동 계층(전이+생성 카탈로그) + LLM 게이트웨이 위에 **툴 시그니처 + confirm 게이트**만 얹음(별도 개발 아님, 설계 §D-2.5). `/기능설계` 6단계 + 시니어 설계 검증.

- **신규:** `services/cue_tools.js`(카탈로그·검증·담당자해석·dispatch) · `POST /api/cue/execute-action` · `CueActionCard.tsx` · guard `cuetools` · docs 2개(DESIGN·TESTS)
- **확장:** `routes/cue.js /help`(tools+로스터+tz+킬스위치) · `CueHelpDrawer.tsx`(Turn.proposedAction) · i18n ko/en(qhelper.action 34키)
- **안전:** actor=사용자 본인(새 권한상승 0) · 재무 영구 봉쇄 · 킬스위치 `CUE_TOOLS_ENABLED` · 담당자 못 찾으면 본인 fallback
- **검증:** 빌드 EXIT0/TS0 · guard 20/20 · 헬스 30/30 · 실HTTP 24/24 · LLM 스모크("박개발에게 다음주 수요일까지…" → assignee=17·due=07-22) · 데이터 원복
- **함정 기록:** cue_tools 의 BusinessMember→User include 에 `as:'user'` 필수(다중 연관). pm2 restart 잊으면 옛 코드 물고 alias 에러.

**커밋 완료:** `d06c580`(#81) + `f3a0c9b`(Fable F1 수정) + `de654c6`(docs). **운영 배포 완료 v1.46.2** (2026-07-15, timestamp `20260715_080941`, backup `/opt/planq/backups/20260715_080941`).
- **배포 사고:** 1차 시도가 프론트 빌드 중 **2분 타임아웃 SIGTERM**(exit 0 거짓 신호 · 부분 배포: 새 백엔드 파일+옛 PM2 5h+옛 번들). 3점 실측으로 검출 → **10분 타임아웃 재실행 완주**. 박제: 배포는 명시적 timeout 600000 + run_in_background.
- 3점 실측: 헬스 200 · PM2 uptime 30s · 번들 08:12 갱신 · #81 라우트 401 · POS 무접촉.

**Fable 게이트 판정 = CONDITIONAL (통과).** #81 신규 코드는 재무 봉쇄·confirm 게이트·권한·cross-tenant businessId·킬스위치 전부 독립 무결. 발견 F1(선재 결함): `createTask` 가 project/client 소속 미검증 → 다른 워크스페이스 project_id·client_id 첨부 가능. **즉시 봉합**(createTask·createDocument 에 project_id·client_id ∈ business_id 검증, cross-tenant 400·정상 통과 실증). 모든 createTask 진입점 공통.

**다음 세션: 배포는 Irene "/배포" 시에만.**

---

## 🔖 재개 지점 (2026-07-15 후반 — "다 하고 배포하자" 진행 중 일시정지)

**"모두 하자" 로드맵 진행:**
- ✅ **A. #81 전이 툴** — submit_review·complete_task·add_task_comment. dev 완료·커밋 `1e5694e`. 검증 11/11 + LLM 스모크.
- ✅ **B. #D-4 MCP 읽기 서버** — 커밋 `29d308b`. planq-mcp(127.0.0.1:3005) + api_tokens 테이블(dev 생성됨) + 읽기 4툴 + ApiTokenSection UI + guard mcpreadonly(21). 검증 9/9(cross-tenant 격리·401·감사). **@modelcontextprotocol/sdk + zod 신규 deps.** 배포 스크립트에 planq-prod-mcp 추가(외부 노출은 nginx /mcp 별도 — 미적용).
- 🔨 **D. KB 정리 + 이벤트 스트림 뷰** — **미착수(스키마 조사만, 코드 0).**
  - D-5: `kb_service.hybridSearch`(147) 진입부 — 워크스페이스 청크 < 100KB 면 임베딩 skip, 전량 주입. `limit:200`(212)은 임계초과 경로에만.
  - D-6: 신규 `services/event_stream.js` `getWorkspaceStream(bizId,{since,actor,kinds})` — 6테이블 UNION. business_id: audit_logs·invoice_status_history·project_status_history 직접 / task_status_history→tasks.task_id / bill_events→(invoice_id FK 확인 필요) / messages→conversations.conversation_id. actor 정규화 user_id·actor_user_id·changed_by·sender_id→actor_user_id, users.is_ai 파생. 읽기 전용·Fable 불필요.
- ⏸ C(#146 스크린샷 대기) · ❌ #126(Irene GCP 콘솔)

**⚠️ 미배포 (v1.46.2 이후):** `1e5694e`(전이툴) + `29d308b`(MCP). Irene 이 "다 하고 배포하자" → **D 완료 후 배포 예정**(일시정지로 보류). **MCP 는 api_tokens CREATE TABLE 운영 선행 필요**(신규 테이블 — sync-database 가 CREATE 는 처리하나 배포 후 확인). 외부 노출 원하면 nginx /mcp→127.0.0.1:3005 + Fable 게이트(신규 공개 표면).

---

## ✅ 이번 세션 완료 (2026-07-15) — 행동 계층 3사이클

일정 생성(calendar.js)·문서 생성(docs.js)이 라우트에만 인라인 → 라우트 안 지나는 실행자(Cue·워커)가 가드 우회. 게다가 **두 라우트 모두 메뉴 쓰기 권한(qcalendar/qdocs)을 안 봤다** — none 멤버도 생성 가능(task_actions 가 qtask 봉합한 것과 같은 갭).

- 신규 `services/actions/_subject.js`(공용 resolveSubject+assertMenuWrite) · `event_actions.js`(createEvent) · `document_actions.js`(createDocument)
- `calendar.js`·`docs.js` 라우트 얇게 + task_actions 는 공용 모듈 import
- 정기일정 분할·예외(2) + 전송 복사(3)는 **의도적 인라인 유지**(편집 메커닉·배치 가드). guard `createlayer` 확장으로 동결
- **발견/보존:** docs `successResponse(res,doc,201)` 는 201 을 message 로 넘겨 실제 HTTP 200 + `{message:201}` (옛 잠재버그, 1:1 보존). 소규모 수정 후보
- 검증: 헬스 30/30 · guard 19/19 · 실HTTP+서비스 25/25(고객·none멤버 403 · Cue 위임/AI세탁차단 포함) · 데이터 전량 원복

**다음 세션: 커밋 필요(미커밋). 배포는 Irene "/배포" 시에만.**

---

## ✅ 이번 세션 완료

### 먼저 드러난 건 코드가 아니라 배포였다
운영 미해결 피드백 15건을 전수 실측하니, 운영이 dev 보다 **19커밋 뒤처져** 있었다.
Irene 이 "왜 돌아갔냐"던 것들이 **이미 고쳐졌으나 미배포**였다 — 답변 불필요 버튼 · 진척 그래프(#145) ·
프로젝트 헤더 채팅/메일 버튼(#144) · Q Bill 탭 뱃지(#140). 배포로 해소.

### ★ 가장 나빴던 것 — 저장 실패를 아무도 몰랐다 (#147)
`apiFetch` 는 4xx/5xx 여도 **throw 하지 않는다.** 그런데 프로젝트 설정 어디에서도 `res.ok` 를 안 봤고
`saveMembers` 는 `catch {}` 로 에러를 삼켰다 → **저장이 실패해도 화면은 성공한 척했다.**
자동저장 뱃지가 없던 것(9필드 중 8개)보다 이게 더 위험했다.

### 고친 피드백 11건
| # | 요지 |
|---|------|
| #147 | 자동저장 뱃지 + **저장 실패 가시화**(saveProject 단일 착지점 · 에러 삼킴 제거) |
| #150 | 프로젝트명이 채팅방 제목에 **구워져 저장**돼 rename 전파 안 됨(운영 실사례 2건). 사용자가 지은 이름은 보존 |
| #148 | 이슈·메모가 **Enter 없이는 등록 불가**였다(버튼 없음 → 태블릿 차단). 버튼·Enter 같은 문 |
| #140 | Q Bill 개요 — 기간 토글이 **아무 일도 안 했다**. 매출을 발행일 → **결제일** 버킷으로. 회차 결제 110만원 누락 복구 |
| #151 | 마크다운 붙여넣기 — TipTap 규칙은 타이핑에만 발동. RichEditor 엔 **표 확장 자체가 없었다**. `markdownPaste.ts` 공용 헬퍼 |
| #149 | 메일 제목 `[PlanQ]` 13곳 하드코딩 → `subjectPrefix()` 단일 원천. 체험판은 접두어 **세 겹**. 프리헤더 8종 명시 |
| #145 | 확정 보고서 진척 그래프 — 스냅샷에 필드 없음(운영 60건). 숫자 그대로 두고 빠진 필드만 백필 |
| #139 | 프로젝트 참여 외부 인력 담당자 — 백엔드·Q Task 는 이미 됐는데 **TasksTab 만** 누락 |
| #143 | Q info 리스트 = 조회·복사 전용, 편집은 우측 패널 (Irene 요청) |
| #142 | 개인 보관함 — 카드화·KPI 열 수·파일 탭이 220px 칸에 갇혀 1열로 떨어지던 것 |
| #141 | 첫 탭 '캔버스' → '개요' (ko/en) |
| #146 | 랜딩 인사이트 검색 (Features 랜딩은 **미완** — 아래 참조) |

### 그 외
- 패널 핸들 통일(`panelHandleStyle.ts` + guard `PANELHANDLE` + `canary-panel-handles`)
- god-file 래칫: `QProjectDetailPage.styles.ts` 분리 (1460 → 1311줄)
- **불변식 가드가 내 코드의 신규 위반 2건을 잡았다** (i18n 하드코딩 +3, god-file 초과) — 베이스라인 안 올리고 정리

### 배포 (완료)
- 1차: `f2cacf7` → `f63e616` (19커밋, 밀린 것 해소). 배포 전 운영 ALTER `email_messages.triage_headers` 선행
- 2차: → **`6a1ed50`** (피드백 11건)
- **사고 기록:** 첫 시도가 프론트 빌드 중 타임아웃 강제 종료(exit 143) → 백엔드 파일만 새 코드 + PM2 는 옛 프로세스(96분) + 프론트 옛 번들인 **부분 배포**. 백그라운드 재실행으로 완주(172초). 3점 실측(PM2 uptime · 번들 시각 · 커밋)으로 반영 증명. 메일 cron 정상 복귀 확인
- **운영 백필 실행 완료(멱등):** `backfill-conversation-titles.js` 2건 · `backfill-report-progress-series.js` 53건

### 검증
헬스 30/30 · 불변식 19/19 · e2e tenant 0 · 핸들 카나리 0 · 빌드 EXIT0/TS0 ·
실HTTP 10/10 + 6/6 (데이터 전량 원복) · 메일 제목·프리헤더 실측 · 위키 커버리지 exit 0

---

## 다음 할 일

1. **#146 나머지 절반 — Features 랜딩** (`/features`): 캡처 이미지 추가(현재 `<img>` 0건, 가짜 브라우저 목업뿐) +
   **빠진 기능 8종** 반영 — 전자서명 · 통합 인박스 · Q지식/위키 · 개인 보관함 · 업무보고(주간/월간) ·
   포커스 · 회의록/녹취 · 고객관리. 스크린샷 촬영 + 소개 문구(ko/en) 작성 필요.
2. ~~행동 계층 3사이클 (event_create / document_draft)~~ — **✅ 2026-07-15 완료**(위 참조). 생성 계열 카탈로그 완성(task·comment·event·document). invoice 전이는 의도적 영구 제외.
3. **#81 Cue 대화형 실행** — 행동 계층 3사이클까지 완료로 선행 조건 충족(일정·문서까지 같은 문). `/기능설계` + Fable 게이트 필요.
4. **#126 구글 캘린더 양방향** — 선행 = Irene 의 Google OAuth 검증 제출(GCP 콘솔).
5. KB 과잉 제거.

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
