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
- health-check 41/41 · DEVELOPMENT_PLAN 1B 기록 완료 → **1B 커밋 → 1A+1B Fable 한 번**
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
