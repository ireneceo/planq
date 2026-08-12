# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-08-12 (Opus 5, 1M) — 2회차 세션
**작업 상태:** 업무추가 묶음 + UI/UX 2차 묶음 **구현 완료, 미커밋**. Fable 구현 검증 게이트 **진행 중**

> ## ⚠️ 이 파일이 낡으면 Fable 이 오판한다
> 지난 세션에서 Fable 이 옛 내용을 읽고 잘못 판정한 전례가 있다. 청크를 끝낼 때마다 갱신할 것.

---

## 🔴 다음 세션에서 가장 먼저 볼 것

### 1. 미커밋 변경 34파일 (+신규 2) — Fable 구현 검증 결과부터 확인
검증 PASS 면 커밋 → Irene 의 `/배포` 명령 대기. FAIL 이면 지적 항목 수정 후 재검증.
**마이그레이션 0건**(스키마 무변경). 롤백 = revert + 재빌드 + pm2 restart.

### 2. ★ 배포 결합 조건
백엔드 담당자 체인 커밋 `f1985f1`·`bb1e9d8` 이 **운영 미배포**다.
이번 프론트 변경(`|| myId` 제거)은 **반드시 그 백엔드와 같은 배포 스택**으로 나가야 한다 —
프론트만 먼저 나가면 운영에서 assignee null 이 옛 라우트 동작과 만난다.
미배포 커밋: `f1985f1` `bb1e9d8` `9b62a86` `186942b` + 이번 미커밋 덩이.

### 3. Irene 확인 필요 (남아 있음)
- **AI 업무추가 카드가 우선순위를 보여주는데 저장되지 않는다** — `tasks.priority` 컬럼 자체가 없다
  (`priority_order` 는 주간 랭킹용). 죽은 write 는 이번에 제거했고, **표시를 없앨지 / 컬럼을 만들지**는 미결.
  Fable 판정: `priority_order` 승격은 비권장(정렬 체계 오염).
- 운영 프로젝트 10번 "IRENE KIM Operating System" 대체/보존 (지난 세션 이월)
- 월 루틴 "N주차" → "매월 N번째 X요일" 요일 지정 4건 (지난 세션 이월)

### 4. 캘린더 / Google 심사 — **영상 촬영 가능** (운영 DB 실측 2026-08-12)
- 개인 연동 #1 `irene@irenewp.com`: `calendar.events` + `calendar.readonly` + `drive.file` **보유**, 오류 없음
- 개인 연동 #13 `lua`: `calendar.events`, 역방향 커서 발급됨(폴링 정상)
- ⚠️ 워크스페이스 gcal 토큰 #3: scope `openid email` 뿐 + `insufficient authentication scopes`
  → **폴링 제외**. 팀 캘린더 링크 6건 역동기화 안 됨. 오너 재연결 필요(동의화면 "캘린더" 체크)
- 심사 대상 스코프는 `calendar.events` 하나 → **워크스페이스 재연결을 기다릴 필요 없다**
- 영상 순서: 동의화면 → PlanQ 일정 생성(구글 반영, `gcal_sync_personal` 기본 ON) → 구글에서 수정 → **5분 내** PlanQ 반영
  ※ irene 계정은 개인 링크 0건이라 아직 폴링 대상이 아니다. 2번(일정 1건 내보내기) 하는 순간 링크 생겨 그다음 주기부터 역방향 작동

### 5. 장부만 pending 인 피드백 5건 (운영 코드 대조로 확인 — Irene 이 닫아야 함, platform_admin 전용)
`#241`(Q Note 번역 게이트) · `#244`(앱모드 강제 로그아웃, DB 컬럼·ENUM 실측 확인) ·
`#252`(문서 자동저장, posts datetime(3) 마이그레이션도 운영 반영 확인) ·
`#257 前`(조회수 silent 증가로 정렬 안 흔들림) · `#262 #263`(지난 세션 배포)

---

## ✅ 이번 세션 구현분 (미커밋)

### 업무추가 묶음 (Fable 설계 게이트: A 조건부PASS · B/C PASS · D 조건부PASS)
- **P3** `TasksTab.tsx` 폼에 workstream select + `RecurrencePicker` 재사용 + 설명(textarea)
- **`|| myId` / `?? myId` 제거** (TasksTab · QTaskPage workspace 분기) → 서버 체인 위임
- **`pickProjectAssignee` 절출** (`task_actions.js`) — 선정 루프까지 포함한 단일 술어.
  `resolveProjectDefaultAssignee` 는 후보 배열만 준다 → 화면이 `[0]` 을 쓰면 미리보기≠실제
- `GET /api/projects/:id` 에 `resolved_default_assignee {user_id,name,from_chain,is_me}` (+ `taskActions` require 추가)
- 담당자 placeholder 를 실제 배정자 이름으로 (문구가 거짓이 되는 것 차단)
- 명시적 타인 담당 시 예측시간·반복 UI 숨김 (서버가 §5.7 로 조용히 버리는 조합)
- ProjectTaskList 인라인 quick-add 2경로는 `myId` **의도적 유지** + 이유 주석
- `priority` 죽은 코드 제거 (task_actions create + routes/tasks.js POST·PUT 구조분해)
- **#256** 생성 시 첨부 `context: 'task'` → `'description_attach'`
- **#265** `CreateDrawer` 표준 제목(18px/700/-0.2px) — 사용처 6곳 일괄
- **#266** `DetailDrawer` Panel mediaPhone safe-area 이중 적용 제거

### UI/UX 2차 묶음 (Fable 설계 게이트 통과, 진단 2건은 Fable 이 교정)
- **#268** 랜딩 태그라인 띄어쓰기 5곳
- **#272** (a) sent 폴더 `[보낸]` 숨김 (b)(d) **fragment 판별을 정화 전 원문으로** — DOMPurify
  `WHOLE_DOCUMENT` 라 정화 후 판별은 죽은 코드였다. fragment 에만 sans-serif + 우/하단 padding
  (c) `MsgChevron` 회전 + 접힌 프리뷰 카드 배경
- **#270** `utils/linkify.tsx` 신설 → ChatPanel 이관(멘션은 renderSegment 주입) + 댓글 적용 + word-break
- **#236** ProjectTaskList 업무명 셀 `$flex`(100px) → `$flex2`(240px)
- **#245** ChatPanel PinnedList 가로 잠금 (MessageList 는 이미 수정돼 있었음)
- **#264** WorkspaceSwitcher 생성 모달 `createPortal(document.body)` + `--vvh` + safe-area
  + `useEscapeStack`/`useFocusTrap`. 원인 = 사이드바 `transform` 이 fixed 기준 박스를 바꾼 것
- **#232** `AttachmentField.hideExistingSearch` prop 신설. 피드백 첨부(CueHelpDrawer) base64 배열 →
  `File[]` + 드롭존(제출 시 base64 변환, 서버 계약 불변). PostTableGrid 문구 거짓("끌어다 놓으세요"인데
  drop 없음) 해소. 로고·증빙 2곳 drop 추가. **죽은 파일 삭제**: `Common/FileUpload.tsx`,
  `Docs/InlineAttachPicker.tsx` + index.ts export 정리

### 가드·구조
- **`guard-invariants.js` i18n 검사에 번역 함수 별칭 인식 추가** — `const { t: tp } = useTranslation(...)`
  의 `tp('키','기본값')` 을 하드코딩으로 오탐하던 결함. **카나리로 탐지력 반증 완료**
  (베이스라인 조이기 전엔 slack 아래 숨었고, 조인 뒤 0→1 로 정확히 FAIL). 베이스라인 426 → 382
- `ProjectTaskList.tsx` styled 55개 → `ProjectTaskList.styles.ts` 절출 (주석 추가로 god-file 800줄
  초과 → **주석을 깎지 않고 절출로 해소**)
- `.claude/settings.json` 편집·조회 권한 allow 추가 (승인창 반복 제거)

---

## 이번 세션에서 배운 것 (재발 방지)

1. **★ 정화기가 입력 형태를 바꾼다.** DOMPurify `WHOLE_DOCUMENT: true` 는 조각도 `<html><body>` 로
   감싸 돌려준다 — **정화 후 결과로 "조각이냐" 를 판정하면 그 분기는 영원히 안 탄다.** 판별은 원문으로.
2. **★ 가드 오탐은 진짜 부채를 통과시킨다.** i18n 검사가 별칭 `tp(` 를 몰라 25건을 오탐하고 있었고,
   그 오탐을 없애자 그만큼 **slack** 이 생겨 진짜 하드코딩 카나리가 통과됐다. 오탐 수정 후에는
   **반드시 베이스라인을 조이고 다시 카나리로 반증**해야 한다.
3. **★ 후보 나열 함수 ≠ 선정 함수.** `resolveProjectDefaultAssignee` 는 배열만 준다. 실제 배정은
   본인 short-circuit + 배정가능 폴백까지 거쳐야 정해지고 **보는 사람마다 다르다.**
   화면이 `[0]` 을 쓰면 미리보기≠실제 사고.
4. **★ 라우트 경로를 추측하지 말 것.** task 삭제는 `/api/tasks/:id` 가 아니라
   `DELETE /api/tasks/by-business/:businessId/:id` 다. 404 를 "삭제됨" 으로 오해하면 검증 데이터가 남는다
   (이번에 9건 잔재 → 실제 삭제로 정리).
5. **★ 로그인 응답 필드는 `data.token`** 이다(`accessToken` 아님). 검증 스크립트가 조용히 401 을 냈다.
6. **주석도 god-file 래칫을 깨뜨린다.** 주석을 깎아 통과시키는 건 속이는 것 — 절출로 해소한다.
7. **plan 한도가 검증을 막는다.** dev biz6 는 프로젝트 한도 초과라 신규 생성 불가 →
   기존 프로젝트 설정을 잠시 바꾸고 **원복**하는 방식으로 케이스를 만들었다.

---

## 운영 미처리 피드백 (2026-08-12 기준 40건 조회)

이번 세션에서 다룬 것: #232 #236 #245 #256 #264 #265 #266 #268 #270 #272 (+P3)
**컨펌 필요해 손대지 않은 것**(기능 설계 규모): #227 Cue 우측패널 · #229 프로젝트 히스토리 ·
#230 Today 브리핑 · #233 통합 검색 · #237/#258 오늘 내 업무 탭·팝아웃 · #239 문서 외부 컨펌 ·
#240 프로젝트 완료 알림 · #259 채팅방 링크(고객 로그인 없이) · #271 결과물 버전 · #274 고객 청구서 화면
**대기열**: #254 #255 (주간 진척 그래프 불일치·미표시 — 데이터 정합 버그)

---

## Git 상태
- 브랜치 main, `origin/main` 과 동기 (마지막 커밋 `e5a2ffa`)
- 미커밋: 34 수정 + 2 신규(`ProjectTaskList.styles.ts`, `utils/linkify.tsx`) + 2 삭제
- 운영 백업: `/opt/planq/backups/20260812_041709`

## 복구 가이드
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
