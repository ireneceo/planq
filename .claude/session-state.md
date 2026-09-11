# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-09-11 (Opus 5, 1M)
**작업 상태:** 🔄 진행중 — **입력 임시저장 라운드 1A 구현 · 자체 검증 중 (미커밋)**
**Git:** HEAD `08740629` · 미커밋 소스 있음(아래 목록) · Fable 게이트 마커는 옛 커밋 기준
**운영:** 이번 세션 워크스페이스 격리 2차·단계 3~5·Q Note 권한·Node 주소 수정까지 배포 완료. 라운드 1A 는 미배포

### 진행 중인 작업 — 입력 임시저장 라운드 1A (Irene "다해")
설계 `docs/DRAFT_PERSISTENCE_DESIGN.md` v5. **Fable 판정: F=1(가드 반증·실브라우저 카나리가 참/거짓을 가른다) · R=0 → 자체 검증, 보고에 "Fable 미검증(자체 검증)"**
(Irene 2026-09-11 "쓸데없이 fable을 계속 남용하는 거 아니야?" — 설계 게이트 4회 연속은 남용이었다. 이번 라운드는 올리지 않는다.)

구현 완료(미커밋):
- 새 파일: `hooks/draftKinds.ts`(kind 등록표·TTL·owners) · `services/draftStore.ts`(v2 레코드·툼스톤·cleared·이관·청소·센티널·정지) · `hooks/useDraftText.ts`(정본 훅 — 편집 시각 단조·flush 조건·같은 문서 이벤트+storage·IME 보류·같은 키 복귀 재조정) · `components/Common/DraftRestoredNote.tsx`
- 연결: TaskDetailDrawer 6입력(댓글·댓글수정 edit·수정요청·승인·확인요청·보류 사유 + 여는 버튼 testid) · NoteThread(bind+복원 줄) · MailContextPanel · QTalk RightPanel · MailPage 전달 초안 · StartMeetingModal 키 · useLocalDraft 재작성 · AuthContext(isImpersonatingNow·정체 확정 청소·센티널·로그아웃 삭제)
- QNotePage `FindAnswerBtn` 비소유자 숨김
- q-note `sessions.py` 1584/1619 `_node_base()` 접기 — **실호출 확인 완료**(없는 파일 → Node 404 `workspace_file_not_found`, 세션 상세 200)
- 가드 `--category=draft` 신설(`scripts/guard-invariants.js checkDraft`) — kind 등록제·손으로 쓴 키·민감 화면 HARD / 6입력 LOCK / 자유 텍스트 래칫. **양성 대조군 4건 전부 FAIL 로 뒤집힘 확인 후 원복(cmp OK)**
- 카나리 `scripts/e2e/canary-drafts.js` 신설 · `run.js` 에 `drafts` 등록

검증 수치:
- 빌드 EXIT 0 · error TS 0 (⑩5 수정 전 빌드) · health-check EXIT 0 · uispec 739/739
- 카나리 1차: 24항목 중 19 ✅ / 5 ❌ → 판정 수정 2(① 페이지 reindex 를 복원 쓰기로 셈 · ⑧ Esc 취소가 초안을 지우는 것이 정상) · 계측 1(④(a) `planq_tabs_spike` 플래그 필요) · **실제 버그 1(⑩5 같은 키가 정지에서 돌아오면 빈 저장본이 화면 글을 지움 → useDraftText 재조정 분기로 수정)** · 미확정 1(⑩2 — 단독 재현은 통과, 전 구간에서만 실패 → 진단 출력 추가)

### 2026-09-11 오후 이어서 (새 세션) — 진행 기록
- 가드 기준선: 전체 `--update-baseline` 이 **godfile 줄 수까지 올려** 되돌리고 **draft 블록만** 추가(HEAD 값으로도 godfile 통과) · 가드 EXIT 0 · health 41/41
- 카나리 2차(⑩5 수정 빌드): 24/25 — ⑩5 PASS(수정 증명) · ⑩2 PASS · ④(a) 대조군만 FAIL
- **④(a) 대조군은 판정기 결함이었다** — window capture 리스너 + stopImmediatePropagation 은 at-target 이라 먼저 등록된 훅 리스너가 받는다(차단 3회 찍혔는데 숨은 탭 A1B). `window.dispatchEvent` 가로채기로 교체 + 끝나면 원복 → 4차에서 **뒤집힘 확인**(숨은 탭 A1 · 최종 A1x)
- **실제 버그 2건 발견·수정(미커밋)**:
  ① `TaskDetailDrawer` 업무 전환 이펙트의 `revisionDraft.clear()` — 그 순간 키는 떠나는 업무 것이라 **다른 업무 누르면 수정요청 메모 삭제**. 카나리 새 항목 4차(옛 빌드) **FAIL(저장본 undefined) = 양성 대조군** → 제거
  ② `NoteThread` 가 `await onAdd()` 뒤 **무조건 clear** — onAdd 셋(Q Talk handleAddNote·메일 addIssue/addNote)이 실패를 삼켜 **저장 실패해도 메모 초안 삭제**. `onAdd: Promise<boolean>` 타입 계약 + true 일 때만 비움 · `note-input`/`note-send` testid · 카나리 ②-메모(400 → 남음 / 성공 → 비움 + DB 1건, dropFixtures 가 project_notes 정리)
- 빌드 EXIT 0 · error TS 0 (16:51) · 카나리 5차 실행 중(기대: 업무 전환 PASS · ②-메모 2건 PASS)
- ★ pkill -f "npm run build" 는 **자기 셸도 죽인다**(명령줄에 같은 문자열) — 그 빌드는 tsc 단계에서 끊겨 산출물 무손상 확인

### ✅ 1A 커밋 `457343b6` (Irene "남은 거 해" — 1A 자체 검증 커밋 · Fable 은 1A+1B 묶어 한 번)
- 카나리 drafts 28/28 · e2e tenant·detailopen·wssync 59/0 · guard EXIT 0 · health 41/41 · build EXIT 0

### 🔄 라운드 1B 진행 중 (미커밋)
구현:
- `services/pendingSaves.ts`(flush 프로토콜 `planq:drafts:flush` · waitUntil · 상한 3초) · `services/keepaliveFetch.ts`(pagehide raw fetch keepalive · 토큰+X-Workspace-Id · 60KB)
- `AutoSaveField` 재작성 — pending/inflight · 순차(동시 2 PUT 금지) · 언마운트·pagehide 저장 · `data-form-dirty` · flush 등록
- `hooks/useLeaveSave.ts` — single-flight(메모 생성 중복 차단) + 언마운트·active false·pagehide·flush. `MemoView`·`MemoPopup` 이 쓴다(leaving 저장은 onCreated/onUpdated 안 부름 — 떠난 메모로 끌려오지 않게)
- `MemoPopup` 802→773줄: 아이콘 `MemoPopupIcons.tsx` 분리(god-file 래칫)
- `AuthContext` logout 단일 실행 + flush 후 POST + `{flush:false}`(계정 삭제) · switchWorkspace POST 전 flush · `WorkspaceSyncGuard` 전환 클릭 시 flush · `useDraftText` flush 수신
- `MailPage` 답장·새 메일 초안 스냅샷(pending ref) → 스레드 전환·취소·✕(`closeCompose('user'|'sent')`)·flush·pagehide keepalive·언마운트에서 보냄
- `TaskDetailDrawer` 설명·결과물 pending 기록 → flush·pagehide keepalive (드로어 닫기는 원래 타이머가 살아 있어 OK · 반복 업무 공유 필드는 보내지 않음 — 로컬 폴백은 다음)
- testid: profile-account-name · mail-compose-close · user-menu-open/logout · task-desc-editor · 카나리 `canary-leave-save.js`(`--suite leavesave`, ⑤⑥⑥-메일⑥-설명⑦) 등록
검증 상태: guard EXIT 0 · 빌드 1회 실패(MainLayout `onClick={logout}` 이 MouseEvent 를 옵션으로 넘김 → `() => logout()` 수정) → **재빌드 → leavesave → drafts 회귀 → 커밋 → 1A+1B Fable 한 번**
- 재빌드 EXIT 0 / error TS 0 · **leavesave 7/7**(⑥-설명 판정 DB + keepalive 차단 대조군 뒤집힘 · 메모 정리 2건) · **toggles 6/0**
- 가드 `autosavekey` 신설 · 베이스 52 · 반증 key 붙이면 51 통과 / key 없는 칸 넣으면 53 FAIL · 원복 cmp 동일 · 전체 guard EXIT 0
- **drafts 회귀 1차 FATAL** — ⑩2 까지 18 PASS 뒤 ⑩3 `null.focus()`(full goto 뒤 댓글 입력칸 없음). ⑩3 에 url·화면 진단 추가 → **재실행 28/28**(같은 순서 — leavesave 로그아웃 뒤). 재현 안 됨 · 원인 미확정 · 진단은 남김
- health-check 41/41 · DEVELOPMENT_PLAN 1B 기록 완료 → **1B 커밋 `08f39490` 완료**
- **🐛 Irene 새 신고(2026-09-11)** "구글드라이브 파일첨부에 있는 기능이 팝업에 있을 경우 드라이브 창이 팝업 뒤로 떠버리네. 파일 선택이 안돼."
  원인 확정(실브라우저 DOM 실측): Google Picker 가 body 에 `.picker-dialog-bg`(iframe+div, z 1000, absolute) · `.picker-dialog`(z 1001) 를 붙인다, 인라인 z 없음. 앱 모달 1100 · 드로어/오버레이 9000~99999 → 뒤에 깔림. 모달 backdrop 클릭·useFocusTrap(Tab 만)·TaskDetailDrawer document click(댓글 메뉴만)은 무관.
  ✅ 수정 완료: `index.css` 두 클래스 2147482000/2147482001 !important · `googlePicker.ts` 주석 → build EXIT 0 / error TS 0 · 실브라우저 4/4(덮개 1100·99999 위 Picker + 대조군 뒤집힘) · guard EXIT 0 · 자체 검증(F=1 UI 쌓임) · 커밋 예정. 실제 구글 계정 첨부 끝단은 Irene dev 확인 필요
- **✅ Fable PASS (1A+1B, 08740629..08f39490)** — 차단 0 · 격리 누수 0 · 유실 회귀 0 · 중복 0 · 가드 양방향 반증. drafts 추가 2회 ⑩3 재현 0. 마커 by:fable 기록.
  결함 A(설계 미구현·회귀 아님, 라운드 2 필수): 시리즈 설명 입력 직후 새로고침/로그아웃 → 어디에도 안 남음(`TaskDetailDrawer.tsx:386 if (p.series) continue` · draftKinds 에 task-description/task-body 없음 · keepaliveFetch 60KB 초과 조용히 false). 운영 반영 시 `pm2 restart planq-qnote` 필요(sessions.py 1줄)
- (이전) ⏳ Fable 게이트 진행 중

### 🔄 입력 초안 라운드 2 — 결함 A (Irene "1번 해" · 로그아웃 시 "로그아웃 전에 확인" 선택)
- Drive Picker CSS `297ef407` 은 **라운드 2 Fable 에 묶는다**(docs/FABLE_GATE_QUEUE.md §8 기록)
- 사실: `TASK_SERIES_FIELDS` 에 description 은 있고 **body 는 없다** → 범위 선택 대상은 설명뿐. 반복 업무는 **드로어 닫기만으로도** 설명이 사라지고 있었고, 업무 전환 뒤 늦은 범위 물음이 **새 업무에 저장**될 수 있었다
- 구현(미커밋): draftStore(label·series·listDraftRecords·parseDraftKey biz/entity) · draftKinds `task-description`/`task-body`(edit) · pendingSaves `LOGOUT_BLOCKED_EVENT` · AuthContext.logout(flush 뒤 series 초안 있으면 멈춤 · `discardUnsaved`) · TaskDetailDrawer(pending base/title · series 는 flush·언마운트·업무 전환·pagehide 에서 로컬 본 · 일반은 pagehide keepalive+로컬 백업 · 다시 열면 D-C1d 복원 줄 · 저장 성공 시 로컬 본 삭제) · `components/Common/LeaveDecisionGuard.tsx`(App 루트 · 범위 골라 저장 — 서버 원문==base 일 때만 · 버리고 로그아웃 · 취소 · 전부 저장되면 로그아웃 이어감) · i18n common draft.leave* ko/en · 카나리 leavesave ⑧(새로고침 복원·지우기) ⑨(확인창·취소·범위 저장→로그아웃) + 재로그인 뒤 ⑦
- guard EXIT 0 · build EXIT 0 · **leavesave 13/13**(첫 실행 ⑨ 3 FAIL = 범위 물음 취소 시 유실 구멍 → 로컬 본으로 넘겨 수리 · SeriesScopeDialog testid) · drafts 27/28(⑩2 간헐) → 재실행 28/28
- 문서 반영(CLAUDE.md 입력 초안 절 · 설계 §2-3 · DEVELOPMENT_PLAN) → **라운드 2 커밋 `59ec48de` 완료**
- **❌ Fable 라운드 2 FAIL** (마커 없음) — ①④ PASS · ② draft 가드 반증 실패(등록 줄 지워도 초록 — 삼항·배열 kind 를 못 봄) · ③ 결함1[비가역] 업무 전환 뒤 옛 업무 설명이 새 업무 DB·로컬 본으로(seriesAsk 에 업무 id 없음) · 결함2 범위 물음 뜬 채 새로고침 유실. Picker·동시수정 금지·격리·일반 업무 백업은 통과. ⑩2 는 제품 버그 근거 없음(원인 미확정)
  수리(미커밋): seriesAskMetaRef(물음이 가리키는 업무) · saveFields 가 지금 보이는 업무(taskIdPropRef) 아니면 묻지 않고 그 업무 로컬 본 · onPick/onClose 도 meta 기준 · parkSeriesRef 가 물음도 옮기고 닫음 · flush·pagehide 가 parkSeriesRef 호출 · RichEditor key=업무 id · `listLeaveBlockers` 한 함수(AuthContext·Guard 공용) · 가드: 초안 API 호출 인자 안 kind 문자열 전부 대조 + draftStore 도 대조 · 카나리 ⑧-전환·⑧-물음(S2 픽스처)
  **커밋 `57d45f89`** · **❌ Fable 재검증 FAIL**(PDF 만) — 입력 초안 결함 1·2·가드 반증·로그아웃 확인창·격리·Picker 전부 PASS. 남은 결함: 누수 수정 disposeBrowser 를 실패 요청이 곧바로 불러 **동시 렌더 연쇄 실패**(5건 중 1건 타임아웃 → 1/5)
  수리(미커밋): pdfService 은퇴(refcount) — retainBrowser/releaseBrowser/retireBrowser(렌더 다 끝나면 닫음·끊겼으면 즉시·90초 상한) · isBrowserDeadError 에 detached · wikiScreenshot retain/release
  검증: in-process 동시 5건 5/5·옛 Chrome 렌더 후 종료·SIGKILL 중 3/3 · 대조군 57d45f89 연쇄 실패 재현 · 08f39490 누수 재현 · dev 재시작·실라우트 단건+동시6 전부 200·자식 Chrome 1 · health 41/41
  **커밋 `f208323c`** · **✅ Fable PASS**(08f39490..f208323c — Picker·라운드 2·FAIL 수리·PDF 은퇴 전부) · by:fable 마커 기록
  **🔄 후속 3건 진행 중(Irene "응")** — ① wikiScreenshot retain 을 newPage 앞으로(+실패 시 release) ✅ ③ server.js SIGINT+SIGTERM → await closeBrowser → server.close(4초 강제) · disposeBrowser 가 Promise 반환·closeBrowser 가 끝까지 기다림 ✅(미검증) ② 유휴 34.5초 **원인 확정: `--single-process`** — 200초 유휴 뒤 current·noProxy 는 newPage 30초 Timed out(다음 요청도 계속 실패), noSingleProcess 만 82ms 정상. → pdfService 에서 --single-process·--no-zygote 제거. crashpad handler 는 브라우저 close 시 함께 사라짐(누적 없음)
  자체 검증: 동시 5건 중 1건 에러 5/5 · 교체 브라우저 트리 9개 전부 종료 · 본체 SIGKILL 뒤 하위 9개 고아 0 · 사망 중 3/3 · await closeBrowser 69ms 트리 종료 · 백엔드 Chrome 트리 9개 PSS 271MB(RSS합 841MB) · 재시작 2회 옛 트리 전부 종료 · **`Shutting down... (SIGINT)` 로그 확인**(/opt/planq/logs/dev-backend-out.log) · health 41/41 · guard EXIT 0 · ★ PM2 는 자식 트리를 통째로 죽여 옛 코드로도 재시작 뒤 Chrome 0 이었다 — Fable 후속 ③ 은 PM2 밖 종료 대비 보강. **실 pdfService 200초 유휴 뒤 첫 렌더 2,045ms · 교체 없음**(전 34.5초) · test 파일 rm 완료 · DEVELOPMENT_PLAN 기록 · **커밋 `11492759`** · **❌ Fable FAIL**(종료 정리만) — 유휴 뒤 첫 PDF 2.3초 ×2·고아 0·동시 5/5·위키 경합(양성 대조군 포함)·운영 메모리 여유 모두 PASS. 그러나 server.js 종료 핸들러는 **실제로 안 돈다**: puppeteer 기본 `handleSIGINT:true` 가 SIGINT 에 Chrome 그룹 kill + 동기 `process.exit(130)` → PM2 종료코드 늘 130. 수정(미커밋): pdfService launch 에 handleSIGINT/SIGTERM/SIGHUP false. 자체 검증(pm2 종료코드 0·closeBrowser 완주·트리 0) 뒤 **Q sale 설계 검토 Fable 라운드에 짧게 묶는다**(Irene: "fable 토큰 거의 없어")
  운영 메모(Fable): 은퇴 브라우저가 2개 이상 겹치면 +200MB 씩 — 배포 후 하루 관찰

### 🔄 Q sale 설계 재확인 (Irene 2026-09-11 "Q sale 설계를 다시 확인해줘. fable이 확인해주면 개발하자. 이제 fable 토큰 거의 없어")
- 설계 `docs/Q_SALE_DESIGN.md` v2(2026-09-02, 942줄, Irene 승인 대기) · 대기열 §4: Fable 에게 물을 것 = §12 횡단 12항목이 이후 코드 변화로 낡았는가 · §13 사이클 분할 · §12-12 ENUM append 멱등
- ✅ PDF 종료 FAIL 수리 **커밋 `07732a85`**(자체 검증): handleSIG* false + io.close/closeIdleConnections — 열린 소켓 1개로 재시작 → 정리 75ms·정상 종료 252ms·exit 0·옛 트리 9개 종료·PDF 200. 대조: 수정 전 exit 130, 1차 수정만 4초 상한
- ✅ 설계 전문 읽음 · 근거 대조(서브에이전트): 줄 번호 절반 이동 + 계약 충돌 → **설계에 §16 "구현 직전 갱신" 추가(미커밋 docs)** — U1 배지 합산(assigned_member_id=나·미지정 owner/admin·saleCount) · U2 clients.status NULL 보존 · U3 ENUM 3건(notifications 도, 두 테이블 순서 다름) · U4 onboarding.js prospect 제외 · U5 cueLabels statuslabel · U6 sessions.py access='write'(사이클3) · 16.2 횡단 12종. 운영 ENUM SSH 읽기 = dev 동일(MySQL 8.0.46, clients 5·notifications 1720·prefs 16)
- ✅ **Fable 라운드 완료** — A PASS(PDF 종료 3회 실측, by:fable 마커 commit 07732a85) · 참고: 소켓 클라이언트가 close 에 응답 못 하면(백그라운드 모바일) 4초 강제 경로(exit 0·Chrome 정리는 됨) — 원하면 io.close 1초 뒤 closeAllConnections 한 줄(미적용, 범위 밖)
- ✅ B CHANGES → §16 반영: U1 saleOwnerWhere(퇴사 담당·qsale none→[]·메일/업무/일정 걸린 문의 제외) · U2 NULL→NOT NULL 은 INPLACE 허용 주의 · U3 sync 가 먼저 append·migrate no-op 백스톱·schemacol ENUM 순서 비교를 구현 게이트에 · U7 롤백 prospect→archived · **사이클 1 → 1a 문의가 보인다 / 1b 배지 / 1c 요약·연결** · FABLE_GATE_QUEUE §4 닫음
- ⏭ 다음: Irene 에게 1a 착수 확인 → 1a 구현(설계 §3·§4·§5.2·§5.3·§12 필수·§16.2·U2~U5·U7)
- 계획: 내가 먼저 파일:줄 근거 낡음 대조(Fable 조사 반복 방지) → Fable 한 라운드(설계 구현 직전 검토 + PDF SIGINT 짧게) → 승인·개발 · ★ Fable 이 "고아 Chrome pid 2890994" 라 한 것은 **earlyoom** 이었다(건드리지 말 것) · ppid 1 은 chrome_crashpad_handler(브라우저당 2개) — 누적 여부 확인 예정 · 검증 스크립트 dev-backend/test-pdf-followup.js · scratchpad/verify-restart-cleanup.sh
  Fable 이 남긴 후속(비차단): ① wikiScreenshot `retainBrowser` 를 `newPage` 앞으로 한 줄 ② **선행 결함: 유휴 ≥180초 뒤 첫 PDF 34.5초**(newPage waitForTarget 30s → 교체 — 9개 누적의 진짜 발생원 추정, --single-process/--proxy-server 의심) ③ closeBrowser 가 shutdown 훅에 없음 → PM2 재시작마다 고아 Chrome(06:54 고아 1개 남음). 운영 배포는 Irene "배포" 명령 때(q-note 재시작 포함)
  ✅ 수리 검증: leavesave **15/15**(⑧-전환·⑧-물음) · drafts 28/28 · toggles 6/6 · PDF 누수 수정본 5/5 + 양성 대조군(수정 전) FAIL · dev 백엔드 재시작·누수 Chrome 9개 정리·health 41/41 · guard EXIT 0 · 문서(DEVELOPMENT_PLAN·설계 §2-3·CLAUDE.md)·메모리(feedback_singleton_reset_must_dispose) 반영 → **커밋 → Fable 재검증(297ef407 + 59ec48de + 이번 수리·PDF 누수)**
  진행(이전): guard EXIT 0 · build EXIT 0 · **가드 반증 통과** — task-description·task-body 등록 줄을 각각 지우면 draft 가드 EXIT 1(TaskDetailDrawer:478 삼항 적발) · 원복 cmp 동일
  ★ 체인이 **메모리 부족으로 시스템 kill**(leavesave 시작 직후). 원인: 부모 없는 헤드리스 Chrome 잔재 ~10개(26분~4시간, 스왑 3.5GB — 앞선 끊긴 검사·프로브들). draftKinds.ts 는 백업과 동일 확인. PPID 1 인 puppeteer Chrome 만 정리 후 카나리 3종 재실행 중 → 문서·커밋 → **Fable 재검증**
- **🐛 발견: 백엔드 PDF Chrome 누수** — 메모리 kill 의 원인. 헤드리스 Chrome 9개(26분~4시간)의 부모가 **`node /opt/planq/dev-backend/server.js`**(카나리 아님). `services/pdfService.js` 가 `isBrowserDeadError`('Timed out'·'Protocol error' — 살아 있어도 나는 에러)에서 싱글톤 참조만 null 로 지우고 새로 띄워 옛 Chrome 이 영구히 남았다. 문서·게시글·청구서·KB PDF·위키 캡처 공용.
  수리(미커밋): `disposeBrowser`(close 3초 상한 → SIGKILL) 를 재시도 리셋·끊긴 브라우저 교체·closeBrowser 에 적용. 검증 스크립트 `dev-backend/test-pdf-leak.js`(살아 있는 브라우저에 Protocol error 주입 → 옛 pid 종료·재시도 PDF·closeBrowser) — **카나리 끝난 뒤 실행 → rm** → pm2 restart planq-dev-backend → dev 잔재 Chrome(ppid 옛 백엔드) 정리. 운영(87.106.78.146) SSH 읽기: 백엔드 자식 헤드리스 Chrome **1개**(3.3시간, 228MB — 정상 싱글톤), 누적 없음. 코드는 같아 PDF 타임아웃 때마다 늘 수 있다(배포 재시작이 매번 초기화). 운영 반영은 Irene "배포" 명령 때
- (이전) ⏳ Fable 라운드 2 진행 중 — 범위 08f39490..59ec48de(Drive Picker 297ef407 + 라운드 2). 확인: 반복 업무 설명 유실 4경로 · 로그아웃 확인창(멈춤·취소·저장·버리기·원문 변경 시 덮어쓰기 금지·다중 항목·flush:false) · 격리 · 일반 업무 백업 조용한 삭제 · Picker 실모달 · drafts ⑩2 제품 버그 여부(창 복귀 시 포커스 BUTTON). PASS 면 by:fable 마커 · FAIL 이면 수정 후 재검증. **판정 중 소스·빌드·e2e 금지** — 범위 08740629..08f39490(1A+1B 한 번). PASS 면 `/fable-검증` 절차대로 `.claude/.fable-gate.json` by:fable 마커 · FAIL 이면 마커 금지하고 지적 수정 후 재검증. 판정 중에는 빌드·e2e·소스 수정 금지(같은 dev 빌드·계정을 쓴다)
- 카나리 잔여 0 · user5 이름 원복 확인 · 문서: CLAUDE.md 자동저장 절(나갈 때 확정 저장) · DRAFT_PERSISTENCE_DESIGN §2-2 작성 완료 · DEVELOPMENT_PLAN 1B 는 drafts 결과 뒤
- 곁에서 본 것(미조치): planq-dev-backend 가 1분마다 google_calendar external_connections 조회를 "DB Query Error" 로 로그
남은 1B 항목: 반복 업무 설명 로컬 edit 폴백 · AutoSaveField key 규칙 가드 · `--suite toggles`

### 다음 할 일 (이 순서로)
**⏸ Irene 답 대기** — Stop 훅(fable-gate-stop.sh)은 `by:fable|unavailable` 마커만 받는데 CLAUDE.md 판정은 F=1 자체 검증. 물어본 것: "1A 를 자체 검증 수치로 커밋할지, 1A+1B 묶어 마지막에 Fable 한 번 돌릴지". 답 전에는 unavailable 마커·skip 파일 쓰지 않는다.

**A. 라운드 1A 마무리**
1. ⑩5 수정 반영 빌드는 끝났다(EXIT 0 · error TS 0, dev 반영됨) → `node scripts/e2e/canary-drafts.js` 재실행 — ⑩5 는 수정 전 FAIL → 수정 후 PASS 여야 한다(양성 대조). ⑩2 진단 출력 보고 원인 확정
2. draft 래칫 베이스라인 — 전체 가드에서 실패가 draft 래칫 **하나뿐**임을 확인했다(요약줄 `✗ 1개 카테고리 실패` 를 2건으로 잘못 셌을 뿐). 전체 실행 `node scripts/guard-invariants.js --update-baseline` 으로 기록(현재 88건 / 55파일 수준)
3. 전체 가드 · health-check · e2e `tenant,detailopen,wssync,drafts` → 커밋(메시지에 "Fable 미검증(자체 검증)" + 수치)
4. 문서: DRAFT_PERSISTENCE_DESIGN.md 에 구현 노트(⑩5 재조정 규칙, 카나리 판정 교정 2건), CLAUDE.md 자동저장 절 옆에 초안 계약 한 단락, DEVELOPMENT_PLAN.md

**B. 라운드 1B (1A 커밋 뒤)** — AutoSaveField pendingRef·순차·언마운트/pagehide 저장·`data-form-dirty` · key 규칙 가드(현재 `<AutoSaveField` 125곳 / 24파일, key= 0곳) · flush 프로토콜 `planq:drafts:flush`(로그아웃·switchWorkspace POST 전·원격 재부팅) · 메일 `closeCompose(reason)`(MailPage 1846) · MemoView/MemoPopup 언마운트 persist(MemoPopup handleClose 591 은 이미 flush) · 업무 설명·결과물 pagehide keepalive + edit 로컬 폴백(시리즈 제외, debouncedSave 710) · 카나리 ⑤⑥⑦로그아웃 ⑩6~9·12·14 · `--suite toggles`

**C. Irene 새 요청 (2026-09-11, 다른 세션에서 연다고 함 — 원문)**
> "Q note 팝아웃에 이 버튼들이 메모 검색보다 아래에 있는게 맞아? 탭은 어딨어? 메모랑 음성메모 탭으로 해달라고 했잖아. 그리고 검색은 아래에 나와야 하지. 제목에 나오는게 아니라. 음성 노트 (대화형) / 녹음 파일 이 버튼들도 위치가 이게 맞을까? 이렇게 혼란줄 바에 없는게 낫겠어. 그리고 데스크탑에서 타임존이랑 근태, 업무표시 부분은 아래로 내렸다 올렸다 못할까? 좌측메뉴. 좌측 메뉴에서 메뉴가 중요한데 이게 너무 자리를 많이 차지해서 중요하지 않은 사람은 내려두는게 나을 듯 해서. 접었다 폈다 기능 있으면 어때?"
- ① Q Note 팝아웃: [메모 | 음성메모] **탭**(예전 요청 — 아직 없음) · 검색은 제목 줄이 아니라 탭 **아래** · "음성 노트(대화형)"·"녹음 파일" 버튼 위치 재검토(혼란스러우면 제거)
- ② 데스크탑 좌측 메뉴: 타임존·근태·업무표시 영역 **접기/펼치기**(상태 기억)

**D. 운영 관찰 뒤 (워크스페이스)**
- `[wsctx] summary` legacy 0 → 옛 번들 분기 삭제 · Q3 mismatch 409 · Q5 보류 중 읽기 정지 · onWorkspaceSocket(C7) · today-review 소속 0 사용자 헤더-only 200

**E. Irene 차례**
- iOS 앱 재빌드 · #409·#410 답글 · platform_admin 비소속 알림 범위 · 관리자 모드 알림 벨 · PublicSignPage 이메일 선노출 · 보고서 공유 링크 무만료 · 운영 메일 백필·백로그

### 미커밋 파일
- M `dev-frontend/public/locales/{ko,en}/common.json` · `components/Common/NoteThread.tsx` · `components/QTask/TaskDetailDrawer.tsx` · `contexts/AuthContext.tsx` · `hooks/useLocalDraft.ts` · `pages/QMail/{MailContextPanel,MailPage}.tsx` · `pages/QNote/{QNotePage,StartMeetingModal}.tsx` · `pages/QTalk/RightPanel.tsx` · `q-note/routers/sessions.py` · `scripts/e2e/run.js` · `scripts/guard-invariants.js`
- ?? `components/Common/DraftRestoredNote.tsx` · `hooks/draftKinds.ts` · `hooks/useDraftText.ts` · `services/draftStore.ts` · `scripts/e2e/canary-drafts.js`
- 참고: dev q-note(planq-qnote) 는 sessions.py 변경으로 재시작해 둠

---

## 복구 가이드

새 Claude 세션 시작 시 아래 내용을 붙여넣으세요:

```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
