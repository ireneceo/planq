# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-06-28 (/개발시작 세션)
**작업 상태:** **#63 Phase3+U4+job삭제 운영 배포 완료** (deploy `20260628_111031` · v1.46.0 · planq.kr 헬스200 · prod-backend+qnote online · export_jobs 18컬럼 생성 · **운영 qnote 포트 8001 QNOTE_INTERNAL_URL fix**). 이전: #90·#95·#96 배포완료 (deploy `20260628_090725` · commit `6b40ffe` · 145s · planq.kr 헬스 200 · PM2 prod online · exit1 부수신호). #96 표 기능 5/5 서브버그 전부 해결.

### 진행 중인 작업
- 없음 (#90·#95·#96 운영 라이브)

### 이번 세션 완료 (#90 — 자동추출 개선, 미배포)
Irene 선택 "#90 진행 — 자동추출 개선". 근본원인 3개 수정:
- **Part A 담당자 (backend `services/task_extractor.js`):**
  - A1. **standalone 대화 담당자 해석** — 옛 버그: `resolveAssignees` 가 `project_id` 있을 때만 실행 → 1:1·다이렉트 채팅(project_id NULL)은 담당자 항상 null. 신규 `buildAssigneePool({businessId,projectId,conversationId})` 가 **프로젝트 멤버 ∪ 대화 참여자** 풀 빌드 → standalone 도 1:1 상대·@멘션·이름 매칭 해석.
  - A2. **표시명(닉네임) 매칭** — 옛 매칭은 `User.name`(계정명)만 → 채팅에서 부르는 워크스페이스 닉네임 불일치 시 null. pool 이 `getMemberNameMap`(BusinessMember.name) 표시명 포함, 매칭은 표시명→계정명→role 순. 발신자명·멤버목록·메시지텍스트도 표시명으로 LLM 입력.
  - email 경로도 동일 pool 시그니처로 정합. note 는 개인툴이라 null 유지(설계).
- **Part B 원본 링크 (backend `routes/tasks.js` + frontend):**
  - B1. `GET /:id/detail` 에 **`source_ref`** 추가 — `buildSourceRef(task)` 가 대화/메일/노트 출처를 라벨+상대경로로 resolve(business 격리). 대화→`/talk/:id`, 메일→`/mail?thread=:id`, 노트→라벨만. 고객(isClient)엔 미노출.
  - `TaskDetailDrawer.tsx` — 이월 배너 아래 **"원본 대화/메일/노트 보기"** 링크(클릭→onClose+navigate). `SourceRefLink` styled + i18n `detail.source.*` ko/en.
  - `TaskCandidateCard.tsx` — standalone 은 members 빈 배열이라 해석된 담당자 미표시 갭 → `guessed_assignee` 를 옵션에 보강(members 무관 표시·등록 가능).
- **검증:** 담당자 E2E 9/9(standalone pool·닉네임 매칭"아이린"→user3·계정명 보조·보수적 null) / source_ref HTTP 통합 5/5(임시멤버 생성→직접토큰→/detail 200·route=/talk/74·정리완료) / 빌드 EXIT0·TS0 / i18n qtask ko/en 819/819 / dev /q-task 200.
- **디버그 export:** task_extractor 에 `buildAssigneePool`·`resolveAssignees` 노출(buildExtractionPrompt 패턴).
- **회귀주의:** dev DB `business_members.role` enum 은 `('owner','member','ai')` — **admin 미동기화**(CLAUDE.md 는 admin 박제). 운영엔 있음. 로그인은 `email`+password(username 아님), rate-limit 5회/15분.

### 완료된 작업 (이번 세션)
- **#93-ⓐ/ⓑ** (`cfaf5c3`, 배포) — Q helper 팝아웃 재로그인 방지 + 업무 우측패널 워크플로 전수 깜빡임 제거(callAction 전체refetch→인플레이스, body/description prev 유지).
- **#94** (`403509d`, 배포 + 백필) — 주간 진척 그래프 실제선 187h 비현실값 차단. 포커스 방치세션이 8일(190h) 누적하던 근본버그 → `computeActualSeconds` last_activity+grace 캡. 운영 481.7h→8h 증명. 박제 [[feedback_focus_session_abandoned_cap]].
- **실작업률(%) 입력 UI** (`583f6bb`, 배포) — participation_rate 백엔드 완비분 프론트 연결.
- **§6 통계 재설계 6청크** (`b1558b6`·`6d0af8b`·`c610604`·`9381d53`·`5922fd3`·`3f0673e`, 전부 배포):
  - A1 가용 잔여기반 + 부하구성(이월/신규) + 이월 배지
  - A2 주간그래프 판정칩(EVM→일상어, SPI·CPI)
  - U5 실작업률 자동제안(포커스 실측, 신뢰성 게이트 40%)
  - **§6-C 스코핑 fix** — daily-progress 진척선 153h버그(전체 합산) → task_ids 이번주 스코핑(운영 153.6→8.8 증명)
  - §6-B 드로어 이월 배너 + 이번주/전체 시간(`/api/focus/task-time`)
- **설계 박제:** `docs/WORK_FLOW_DESIGN.md §6` (단일엔티티+주별렌즈, EVM, 잔여기반). 박제 [[project_qtask_weekly_stats_redesign]].
- **운영 워프로랩 실데이터 체크:** 잔여29.2h·이월7.2+신규22·활용률97%·왜곡제거·#94캡 라이브 확인.
- **테스트 잔존물 정리(dev) + 운영 피드백 17건 트리아지.**

### 이번 세션 추가 — 검증 + 신규 피드백 트리아지 (2026-06-28)
- **검증 통과:** 헬스 29/29 · 빌드 EXIT0/TS0 · 담당자 E2E 9/9 · source_ref HTTP 5/5 · cross-tenant 403 3/3 · i18n 819/819 · aiTaskPlanner #90 실증 4/4.
- **#90 진실 규명:** 운영 원문(#90)은 채팅추출이 아니라 **`aiTaskPlanner`(Cue AI 업무 추가)** 경로. 커밋 `e6e9e7a`(6/22)로 **이미 수정·운영 배포됨**(닉네임 담당자 matchMemberByName + 링크 보존 프롬프트). dev 실증: "아이린"→user3 배정 + URL 보존 4/4 PASS. **#90 = 사실상 해결**(사용자가 배포 전 테스트). 이번 세션 task_extractor 작업은 **형제 기능 보강**(채팅/메일 추출의 standalone·표시명·원본링크 — aiTaskPlanner엔 없던 구멍).
- **#95 (프로젝트 채팅방, 신규 6/26) — 부분 수정·미배포:** 확정버그 = **QTalkPage `handleCreateProject` 가 `channels` 누락**(QProjectPage 는 전달) → Q Talk 경로에서 채널 토글 완전 무시(항상 0개). `CreateProjectInput.channels` 추가 + 전달로 수정(빌드 EXIT0). **잔여 의문**: "해지했는데 생성됨" 증상은 프로젝트 생성 코드(양 경로 모두 channels.length>0 가드)로 재현 불가 → **고객 초대 시 자동 환영 대화방**(`clientOnboarding.ensureWelcomeConversation`, project_id=null, invite 수락 시) 가능성 높음. **Irene 재현경로 확인 필요**(어디서 생성·고객 추가 여부).
- **#96 (문서 테이블, 신규 6/27) — 진행 중·미배포.** 실제 기능 = **Q docs 표 kind 문서**(`PostsPage` + `PostTableGrid`), records 메뉴는 폐지(흡수). Explore 초기 매핑은 폐지된 `QRecordDetailPage` 오진 → 바로잡음. 5개 서브버그:
  - **② 기본테이블 없음 → ✅수정·검증** `routes/posts.js` kind=table 생성 시 빈 q_record(columns:0)였던 것을 **기본 컬럼 3개(제목 text/상태 select+옵션3/메모 longtext) + 빈 행 1개** 시드(언어별 ko/en). API E2E 6/6.
  - **① 생성 후 나가버림 → ✅수정** `PostAiModal.submitTable` navigate 에 `&new_table=1` + `PostsPage` 로드 effect 가 표면 edit 모드 진입(플래그 1회 소비). 빌드 EXIT0.
  - **③④ [첨부] 적용안됨/에러 → ✅수정·검증** 근본원인 = `PostTableGrid.ColumnSettingsPopover.commit` 이 이름·타입·옵션을 **각각 별도 updateColumn 호출** → 같은 stale rec.columns 스냅샷 동시저장 race(마지막만 반영). "type=attach 적용 안됨, 다시 설정하면 됨"의 원인. **단일 patch onCommit 으로 합침.** attach 셀은 Array.isArray 가드라 크래시 아님(④=③의 결과). API E2E 5/5(type=attach+이름 동시적용·attach 셀 배열 지속).
  - **⑤ 프로젝트>문서 표 없음 → ✅수정** 프로젝트 'docs' 탭을 `ProjectPostsTab`(표 미지원) → **`PostsPage`(scope=project)** 로 교체. `ProjectDocsWrap` 경계높이 래퍼(calc(100vh-210px), margin -20). submitTable 은 `onTableCreated` 콜백으로 in-place(페이지 이탈 없음, 워크스페이스·프로젝트 공통). 핀 문서 편집 `?editPost`→`?post`. **레이아웃은 Irene dev 육안확인 권장**(2컬럼 임베드).
- **#89(랜딩 푸터 카피·소) 미착수.**

### 피드백 큐 상태 (2026-06-28 종합 점검)
- **자율 처리 가능 피드백 전부 해소·배포.** 운영 pending 13건은 대부분 **이미 코드 수정·배포됐으나 DB done 마킹만 안 된** 것(#85·#86·#87·#89·#90·#91·#92·#95·#96). → done 위생 마킹은 Irene 확인 후.
- **#87 닉네임 재점검:** 표시명 헬퍼 전수 audit — 라우트 15개 중 invoices.js 만 미적용이나 `creator` 는 화면 미표시(발행자=워크스페이스/담당자=멤버목록 표시명) → **라이브 #87 잔존 버그 없음**.
- **남은 진짜 작업 = 외부 의존 + 대규모뿐:**
  - **#60** iOS 푸시 (Capacitor 네이티브앱 — Irene 결정)
  - **#72/#88** Google OAuth 검증 제출 (GCP 콘솔 — Irene)
  - **#63 Phase 3** 자료 이동(이동방식)·Qnote 포함·비동기 (대규모 → /기능설계 필요)
  - **#96-⑤ 레이아웃** 프로젝트>문서 PostsPage 임베드 — Irene dev 육안 확인 권장(헤드리스 픽셀 검증 불가)


### #63 Phase 3 — 자료 이동 & 비동기 내보내기 (2026-06-28, dev 완료·검증·미배포)
/기능설계 6단계 완료. 결정: 자가이동(본인 L1+원본정리)·Q Note 본인세션→문서·DB job+cron.
- **DB:** `export_jobs` 테이블(models/ExportJob.js). dev sync 완료.
- **API:** routes/export.js +5 (transfer-job/export-job/jobs/jobs:id/download) + qnote `/api/sessions/internal/export`(x-internal-api-key).
- **워커:** services/exportJobWorker.js (cron 30s 드레인, copy/move+Q Note→문서, export zip 토큰 30일, notify, 재시도3·만료cleanup). server.js 등록.
- **UI:** DataExportSettings 이전카드(복사/이동 라디오+Q Note 토글, move=danger+확인)·내데이터(Q Note 백그라운드)·작업내역(상태+다운로드, 3s 폴링). export.ts +5 fn. i18n ko/en 45키.
- **검증:** 백엔드 E2E 17/17(copy·move soft delete/archived·export+download·qnote 56세션·권한) · 빌드EXIT0/TS0 · 헬스29/29 · i18n403/403 · **운영 INTERNAL_API_KEY 패리티 확인(배포 준비완료)**.
- **설계:** docs/DATA_EXPORT_PHASE3_DESIGN.md.
- **배포 주의:** export_jobs sync 자동생성 · planq-prod-qnote 재시작 필요(qnote endpoint) · INTERNAL_API_KEY 운영 일치 확인됨.


### U4 + Phase3 cron 검증 (2026-06-28 추가, 미배포)
- **U4 (`1a4b563`)** — 주간 진척 그래프 되돌림(▽ 주황) 마커. computedBurndown 에 reverted 플래그(progress 하락 감지), SVG 상단 ▽ + 조건부 범례 + i18n chart.reverted/revertedTip ko/en. 빌드 EXIT0·TS0·qtask 821/821.
- **Phase 3 cron 실경로 검증** — export-job queued → 30초 cron 자동 드레인 → done (직접 drainOnce 아닌 운영 코드 경로). 2/2.
- **§6-C 델타(carry-in 차트 분리)** — 의도적 보류. 무엇을 보여줄지가 차트 디자인 판단(이월 progress baseline 시각화는 부하구성 패널과 중복·clutter 위험)이라 Irene 시각방향 확정 후 진행 권장.
- **job 삭제 (`f46091a`)** — DELETE /:biz/me/jobs/:id (본인·running제외·zip정리) + UI 삭제버튼. DELETE E2E 5/5. 미배포.
- **미배포 누적:** #63 Phase 3(`91e7962`) + U4(`1a4b563`) + job삭제(`f46091a`). /배포 시 함께 반영(export_jobs sync + qnote 재시작).


### Phase3 운영배포 후속 (2026-06-28, /배포 이후 계속개발)
- **운영 배포 완료** deploy `20260628_111031` — #63 Phase3 + U4 + job삭제. export_jobs 18컬럼 운영 생성, prod-backend+qnote online, 헬스 200.
- **★ 운영 qnote 포트 fix (LIVE):** 운영 qnote=**8001**(dev=8000), worker 폴백 8000 하드코딩 → 운영 include_qnote silent 0세션. 운영+dev `.env` 에 `QNOTE_INTERNAL_URL` 명시(운영 8001/dev 8000)+재시작. worker→qnote fetch 200 확인. 박제 [[feedback_qnote_internal_url_prod_port]].
- **★ 쿼터 버그 fix (`b97db0d`, 미배포):** move 시 출발 워크스페이스 BusinessStorageUsage 차감 누락 → 용량 부풀려짐. softDeleteSourceFile 을 files.js 정식 정책과 정합. E2E 4/4. **운영 Phase3 에 이 버그 존재 → 다음 /배포 필요(경미: 이동 시 출발지 용량 카운터만).**
- **★ 타겟 쿼터 우회 fix (`f7d3cbb`, 미배포):** transfer copy/move 시 신규 물리 복사가 **타겟 워크스페이스** 스토리지 쿼터를 우회하던 문제 수정(b97db0d 는 출발지, 이건 도착지). exportJobWorker 가 plan.js 업로드 정책과 동일하게 타겟 effective limit-bytes_used 예산 검사 → 초과 시 skip(reason='quota'), result.skipped_quota 카운트. dedup-share(0바이트) 무영향, move 라도 쿼터부족 시 원본 보존(유실 방지). E2E 11/11(drainOnce 실경로 — 거부/통과 양쪽 + 소스무손상·완전원복).
- **★ 품질점검 fix (`f667308`, 미배포):** 전체 실검증 중 transfer 워커 2건 결함 발견·수정. ① **[데이터 유실, move]** copyFileToTarget skip 이 no_hash·no_file(타겟에 사본 없음)인데도 move 시 원본 soft-delete → 유실. skip reason(no_hash/exists/no_file) 명시 후 move 원본 제거를 reason==='exists'(타겟에 본인 사본 존재)일 때만. ② **[file_count]** 타겟 usage 갱신 가드 bytesAdded>0 → dedup-share 만 복사 시 file_count 미증가, filesCopied>0 으로 수정.
- **★ #90 Cue 알림 누락 fix (`b65e5a4`, 미배포):** `registerCandidate`(후보→업무 승격, chat/email/qnote 공용)가 Task.create 후 **notify 미호출** → Cue 추출 업무 등록 시 담당자가 인박스/푸시/링크 알림 0. 수동 생성 라우트(tasks.js)와 동일하게 notify 추가 — 담당자≠등록자일 때만(self noise 방지), link `/tasks?task=:id`+entityType/entityId+ioApp, 중첩 try/catch(트랜잭션 무영향). E2E 7/7(타인배정→인박스알림·link·entity·actor / self→무알림). 담당자는 fallback(userId)로 항상 배정되므로 "미배정"의 실체는 알림부재였음.
- **★ #90 계열 notify 공백 보강 (`6a3ea26`, 미배포):** #90 수정 후 task 배정 notify 전수 감사 → 공백 2건 추가 수정. ① **AI 일괄 생성**(POST /api/tasks/ai-create/confirm) — 여러 task 일괄 생성 시 담당자(≠생성자) notify 미호출(broadcast만). ② **정기업무 자동생성**(recurringTaskGenerator cron) — 새 회차 인스턴스 담당자 notify 미호출. 둘 다 수동/재배정 라우트와 동일 패턴(link/entity/ioApp) 추가. E2E 8/8(recurring 직접호출 + ai-create 실 HTTP 200 — 인스턴스/task 생성·담당자 인박스알림·link 검증). **감사로 확인된 이미-정상:** 재배정 PUT(tasks.js:1223)·후보등록(registerCandidate)·task_workflow 8라우트 ✅. **보류(noise 우려, 재량):** task_workflow 컨펌자제거(DELETE)·정책변경(PATCH) notify — Irene 판단 필요.
- **★ 일정 수정 참석자 알림 fix (`112ae15`, 미배포):** notify 감사 확장 — 일정 생성(POST)은 참석자 초대 알림 보내나 수정(PUT)으로 참석자 추가 시 미발송(생성/수정 비대칭). destroy 전 기존 멤버 참석자 캡처 → commit 후 신규 추가분(이전없음·본인제외)만 초대 알림. E2E 6/6(실 HTTP — 신규 참석자 알림·link `/calendar?event=:id` / 동일 참석자 재수정 무알림). 리스케줄 기존참석자 알림은 noise 우려 보류. **감사로 확인된 이미-정상:** task 댓글 notify(assignee+creator+requester+reviewer+멘션·visibility게이팅)·일정 생성/참석응답·invoice notify-paid. notify link 는 normalizeLink 가 절대URL→상대경로 변환(notification_link.js:60)이라 `/tasks·/calendar` 라우트 정상 resolve(App.tsx 실재).
- **미배포:** `b97db0d`+`f7d3cbb`+`f667308`(transfer) + `b65e5a4`+`6a3ea26`(#90 task 배정 알림) + `112ae15`(일정 수정 알림) + `3703ad7`+`da69a27`(Invoice 상태이력) + `9920d9d`(Project 상태이력) + `3e47769`(BillEvent writer 버그 fix) **10건**. 다음 /배포 시 함께 반영.

### 완성도 발굴 로드맵 (2026-06-28, Irene "빠진/부실 페이지 다 찾아 하나씩, 기본 히스토리·통계 제대로")
4축 병렬 감사(라우트·완성도·히스토리·통계)로 갭 도출. **하나씩 구현 진행 중.**
- **P0 기본 히스토리** (저장O·API/UI 없는 "숨은 이력"):
  - ✅ **#1 Invoice 상태 이력** (`3703ad7`+`da69a27`) — GET `/api/invoices/:biz/:id/status-history` + 드로어 "상태 이력" 타임라인. E2E 7/7(owner/admin/비멤버403/404·created_at·표시명). 빌드 EXIT0/TS0. **함정 박제: invoice_status_history 는 underscored 모델 → 인스턴스 created_at 접근자는 `r.createdAt`(r.created_at=undefined).**
  - ✅ **#2 Project 상태 이력** (`9920d9d`) — GET `/api/projects/:id/status-history` (loadProjectOrForbidden) + 상세정보(details)탭 "상태 이력" 카드(active/paused/closed 전이, status 변경 시 effect 자동갱신). E2E 6/6(멤버200/비멤버403/404·created_at·표시명"아이린"). 빌드 EXIT0/TS0.
  - 🔁 **#3 Bill 이벤트 타임라인 — 재분류.** 검증 결과 `bill_events` **0행 + 유일 writer(plan.js addon-apply)가 스키마 불일치로 silent 실패** = 사실상 죽은 기능. 빈 테이블에 타임라인 UI는 무의미. **(a) 깨진 writer 수정 완료** (`3e47769` — BillEvent.create→auditService.logAudit, addon.apply audit. E2E 4/4). **(b) 진짜 Bill 이벤트 타임라인(고객 열람/부분결제 등)은 lifecycle writer 신규 계측 필요한 대형 작업으로 별도 분류** — Invoice 상태이력(#1)이 sent/paid 핵심 전이는 이미 커버. 공개 결제페이지 view 추적·accept·partial 이벤트 계측은 향후 /기능설계.
- **P0 통계 제대로 구성** ("파일로 말고"):
  - ⬜ **#4 ReportsTab PDF다운로드→대화형 통합보고서** (`/api/reports/:biz/integrated` API 존재, UI만). 
  - ⚠️ **#5 상단 3탭 IA(통합/프로젝트별/개별)** — `project_reporting_structure` Irene 확정구조라 임의변경 금지 → Irene 정렬 필요.
- **P1 mock/완성도:** QProject/DocsTab MOCK_PROJECT_FILES(사용중 확인 필요)·`/signatures/received` 메뉴 진입로·QTask 담당자변경 실패 원복 TODO·`/admin/dashboard` 플랫폼 대시보드(stub).
- **전체 실검증 (2026-06-28):** transfer 워커 실 E2E **39/39** — copy 11(타겟쿼터 거부/통과) + move 16(출발지쿼터 반환·소프트삭제·물리unlink + 타겟풀 유실방지) + 품질 12(no_hash/no_file 원본보존·exists 제거·dedup file_count). drainOnce 실 코드경로, 테스트워크스페이스(88→6)만 사용해 실 사용자 데이터(file78) 무손상·완전원복. 헬스 29/29.

### 다음 할 일
1. **§6-C 델타(carry-in 분리)** — 차트 SVG 라인 계산. 단일엔티티 스코핑으로 차트는 이미 현실값이라 **선택적 폴리시**. Playwright 시각검증 권장.
2. **U4 단조완화(되돌림 ↓마커)** — 차트 SVG, 되돌림 희귀라 저우선.
3. **운영 미해결 피드백:** ~~#90 Cue 인식 품질(담당자 미배정·링크 누락)~~ → **dev 수정 완료 `b65e5a4`(미배포)**. 운영 feedback_items done 위생 마킹(처리된 #71·#79·#86·#87·#90·#92·#93 등, Irene 확인 후).
4. **[검토 예정]** 피드백/문의 자동 트리아지·응답 시스템(자동회신=가능, 자동코드수정=제안까지만). 정식 /기능설계 필요.
5. **별개 후속:** status_history in_progress live inflation(task 수주 방치 시 1152h) — 작업시간 정의 product 결정 필요.

### 외부의존 (자율 불가)
- **#60** iOS 푸시 — Capacitor 네이티브앱 결정 (Irene)
- **#72/#88(ⓑ)** Google OAuth 검증 제출 — GCP 콘솔 (Irene)

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
