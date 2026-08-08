# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-08-08 06:05 UTC (Opus 5, 1M)
**작업 상태:** **1~3단계 완료·운영 배포 완료** (`baa3483`, 3점 실측 통과) → **#250/#252 착수, 1청크 미완(Fable FAIL) — 다음 섹션에서 이어감** (Irene: "나머지 다음 섹션에 할게")

> ## ⛔ 배포 금지 — 지금 트리를 배포하면 문서 저장이 깨진다
> `#252 자동저장`이 **Fable 구현 게이트 FAIL** 상태다. BLOCKER 3건 중 1건만 고쳤다.
> **운영은 이미 최신** — 게이트 통과분은 전부 `baa3483` 으로 배포됐고 새로 배포할 항목이 없다.
> 다음 섹션에서 아래 잔여 BLOCKER 를 끝내고 **Fable 재검 PASS 후에만** 배포할 것.

---

## ✅ 이번 섹션 완료 — 운영 배포됨 (`baa3483`)

### 1단계 — spalink 가드 재작성 + 죽은 링크 9건 (Fable R1·R2 FAIL → R3 PASS)
옛 가드는 `navigate(`/`to=` **문법을 열거**해서 래퍼 `navTo('/qbill')` 을 통째로 놓치고 "0건" 을 선언했다.
프론트 src·백엔드 routes|services 의 **모든 경로 리터럴**을 라우트 대장 패턴에 **전체 경로** 매칭하는 방식으로
재작성(`:param`·`*` 지원). 판정 방향을 **"기본 검출, 명시적 제외"** 로 뒤집었다.

교정된 죽은 링크 9건 중 눈에 띄는 것:
- `TermsReacceptModal` `/legal/terms`·`/legal/privacy` — **약관 재동의를 강요당한 사용자가 정작 약관을 못 봤다**
- `auth_oauth.js`+`OAuthCallbackPage` `/onboarding` — 페이지가 아예 없어 catch-all → RootRoute(로그인 무관 마케팅 홈).
  **구글 신규 가입자가 앱이 아니라 랜딩에 떨어졌다**
- `DashboardPage /qbill` · `notificationLink.ts`+`notification_link.js` `/bill` · `dashboard.js /qdocs` ·
  `files.js /file` · `tasks.js /task` · `routePrefetch.ts /clients` · `VoiceCaptureSheet /memo`
- 음성 캡처는 라우트만 고치면 반쪽이었다 — QNotePage 가 `?prefill=` 을 안 읽어 텍스트가 버려졌다.
  QNotePage prefill effect → MemoView `prefillText` → 초기 doc 연결(Fable 실브라우저로 SQLite 착지 확인)

**★ Opus 과장 1건을 Fable 이 정정:** "`/bill` 청구서 알림 전건 사망" 은 틀렸다. 옛 `/bill?` row **0건**
(notify 호출자가 전부 명시 link 전달 → 죽은 건 fallback 매핑뿐). 백필 불요.

### 2단계 — 개인정보처리방침 Google 스코프 (Fable 설계 게이트 BLOCKER)
- 캘린더 "읽기 전용" → 실제 `calendar.events`(읽기·쓰기) 로 정정
- **★ Gmail 이 방침에 한 줄도 없었다** — 개인 메일 연동은 **`https://mail.google.com/`(restricted scope,
  메일함 전체 접근)**. 구글이 가장 엄격히 대조하는 등급. 캘린더만 고쳤으면 다음 반려는 여기서 왔다. ko/en 신설
- `privacy_version` 미인상 — 처리 범위 확대가 아니라 기재 정정. 올리면 무관한 전 사용자에게 재동의 모달

### 3단계 — OAuth 콜백 관측성 + 배너 축 분리
- `utils/oauthLog.js` 단일 착지점 — gcal 3 + gdrive 3 + 개인 7경로. `code`·토큰·`state` 원문 화이트리스트 차단.
  콜백은 비인증 공개 라우트라 `?error=` 는 공격자 제어 입력 → 개행 제거 + 64자 절단(로그 인젝션)
- 배너 2종이 둘 다 오너 전용 `/business/settings/storage` 로 보내 **직원에겐 눌러도 403 인 죽은 안내**였다.
  `video/status` 에 `personal_connected`/`personal_can_write` 추가(원천 = Meet 이 실제 고르는 `pickPersonalConn`)
  → 배너는 그 사용자가 스스로 할 수 있는 경로만. StorageSettings 비-오너 버튼 disable

### 운영 배포 실측 (`baa3483`, 208초)
| 항목 | 결과 |
|---|---|
| 외부 헬스 | `https://planq.kr/api/health` **200** (`node_env: production`) |
| PM2 | prod-backend/qnote/mcp **uptime 97s** (리셋 확인) |
| 프론트 청크 | `index-BmI4RGnK.js` **dev = 운영 일치** |
| 배포 PDF 실렌더 | OK (11,821 bytes, `%PDF-`) |
| 라이브 확인 | 방침에 Gmail 항목 실재 · 번들에 `/qbill`·`/legal/terms`·`/qdocs?post=` **0건** |
백업: `/opt/planq/backups/20260808_044401`

---

## 🚧 진행 중 — #250 / #252 (다음 섹션)

### 운영 신고 원문 (운영 DB `feedback_items` 직접 조회 — 요약본 말고 이걸 볼 것)
**#250** (8-03)
> 우측 하단에서 들어가는 Q task 업무관리하는 거 태그기준대로 나열이랑 우선순위 관리도 여기서도 해야 해.
> 업무태그는 아예 개발이 안되어 있네. 리스트에도 태그들 볼 수 있게 하기로 하지 않았어? 검토

**#252** (8-05)
> 문서에 글 쓸 때도 메모처럼 임시저장되면 안되나? 날라갈까봐 불안한데

### Fable 설계 게이트 = **조건부 승인** → 3청크 분할 지시
설계서: `/tmp/.../scratchpad/design-250-252.md` (세션 종료 시 소실 — 아래 요지가 정본)

| 청크 | 내용 | 상태 |
|---|---|---|
| **① D** | #252 문서 자동저장 + 낙관적 잠금 | **구현 중 · Fable FAIL · BLOCKER 2건 잔존** |
| **② B** | 우선순위 재인덱스 백엔드 단일화 (팝아웃에서도 관리) | 미착수 |
| **③ A+C** | 업무 태그 신설 + 리스트·팝아웃 표시·필터 | 미착수 |

### ★ Fable 이 설계에서 잡은 것 (다음 섹션에서 그대로 지킬 것)
1. **tie-break `→ id` 를 앞에 두지 말 것** — 이 저장소가 "옛 실버그" 로 주석에 박제한 패턴이다
   (`TaskPopoutView.tsx:258` — "id tie-break 을 쓰면 두 화면의 번호가 갈릴 뿐 아니라 같은 팝아웃
   안에서도 행 순서와 칩 번호가 역전됐다"). 정본 사슬 = `priority → doneRank → due(null last)
   → title(localeCompare)` , id 는 **맨 끝 절대 tie-break 로만**
2. **정본 집합 조회는 `services/weekTaskSet.js` `myWeekWhere()` 재사용 강제** — 사본 금지(파일 헤더 원칙).
   새로 만들려던 것이 이미 있었다
3. **기간 파라미터 필수** — 메인은 PeriodPicker 로 임의 기간을 본다. 팝아웃(`/my-week`)과 집합이 다르다
4. **`QTaskPage.tsx:1152-1163` 갭 자동정리 effect 도 같이 이관** — 안 하면 프론트 재인덱스가 부활해 단일화 무의미
5. **팝아웃 PrioChip `span→button` 금지** — `RowMain`(button) 내부라 button-in-button 무효 HTML
   (같은 파일 394-395 주석이 이미 경고). `RowLead` 와 형제 버튼으로 빼야 한다
6. **태그 API 는 신규 `routes/task_tags.js`** (tasks.js 는 godfile 한도 2,449 근접). `/tags` 리터럴 경로를
   `/:id` 보다 **앞에** 마운트. `PUT /:id/tags` 는 per-task 권한(title/category 축), `GET tags` 는 read 권한
7. **"태그기준 나열" 의 지시 대상은 팝아웃** ("여기서도"). 다대다 정렬 모호성은 **대표 태그(사전순 최소) 1회 표시** 로 확정

### ⛔ 1청크(#252) — Fable 구현 게이트 FAIL, 잔여 작업

**고친 것 (이번 섹션)**
- ✅ **BLOCKER-1** `GET /:id` 의 `post.increment('view_count')` → **`{ silent: true }`** (2곳).
  문서를 **열기만 해도** `updated_at` 이 바뀌어 낙관적 잠금이 거짓 409 를 냈다.
  **부수 소득: 목록 정렬(`updated_at DESC`)이 남의 열람만으로 뒤바뀌던 것도 같이 해소**
- ✅ **MAJOR-2** draft→published 승격 PUT 을 `post.create` 로 감사 기록 (draft 생성 시 억제분 보전)
- ✅ **BLOCKER-2 (부분)** `editEpoch` + `beginEditSession()` 도입 — 자동저장의 `setDetail(created)` 가
  스냅샷 effect 를 재발화시켜 `autoDraftIdRef`·`autoState` 를 리셋하던 근본 원인 제거.
  진입 5지점(빈 문서·AI·템플릿·슬롯·기존 편집)에 `beginEditSession()` 부착 완료
  → **미확인: `PostsPage.tsx:363` `setMode(isNewTable ? 'edit' : 'view')` (표 신규 자동 편집 진입)
     에는 아직 안 붙었다. 다음 섹션 첫 작업.**

**남은 BLOCKER / MAJOR**
- ⛔ **BLOCKER-3a** 내 목록의 draft 행에 **"임시저장" 뱃지 미구현**
- ⛔ **BLOCKER-3b** **draft 재열람 후 저장 시 승격 안 됨** — `submit` 의 edit 분기가 `status` 를 안 보낸다.
  사용자는 저장 성공으로 믿는데 그 문서는 **L1 draft 라 남에게 영영 안 보인다**
- ⛔ **BLOCKER-3c** 편집 중 다른 문서 클릭(취소도 저장도 아님) 시 **고아 draft 잔존**
- 🔸 **MAJOR-1** `post:updated` 수신측 dirty 가드 미구현 — `refetchOpenDetail`(PostsPage:318)이 편집 중에도
  무조건 `setDetail`
- 🔸 **MINOR** ① `base == cur`(동일 초, DATETIME 초 정밀도) 통과 → 같은 초 덮어쓰기 창
  ② `AutoSaveMark` 가 `≤640px` 에서 `display:none` — **실패·충돌 표면화가 모바일에서 사라진다**(조용한 실패 금지 위반)
  ③ 이미 `mode='new'` 인데 템플릿/AI 재진입 시 — `editEpoch` 도입으로 해소됐는지 재확인 필요

**Fable 이 제시한 재검증 통과 조건 5**
1. 실브라우저에서 **기존 문서** 열람 → 편집 → 자동저장/명시 저장 성공 (409 오발 0)
2. 신규 → 자동저장 → 명시 저장 → **같은 제목 post 정확히 1개** + published
3. 신규 → 자동저장 → 취소 → **DB draft 0**
4. draft 재열람 → 저장 → published 승격
5. 목록 draft 행 임시저장 뱃지 표시

**이미 실증된 정상 항목 (재검 시 회귀만 확인)** — Fable 실 HTTP 31/31:
draft 격리(vlevel L1 강제·타 계정 목록/검색/필터 미노출·직접조회 403) · 부수효과 억제(audit 196→196,
broadcast·stage skip, 승격 시 발화) · `base_updated_at` 미전달 하위호환 200 · 반증 2건 성공
(잠금 제거 시 실제 덮임 / draft 필터 제거 시 실제 누출)

---

## 다음 우선순위

| 순위 | 내용 |
|---|---|
| **1** | **#252 잔여 BLOCKER 3건 + MAJOR·MINOR** → Fable 재검 PASS → 배포 |
| **2** | ②청크 우선순위 백엔드 단일화 (위 Fable 지시 1~5 준수) |
| **3** | ③청크 업무 태그 신설 (위 지시 6~7 준수) |
| **4** | **i18n 가드 오탐 수정** — 여러 줄 JSX 주석의 둘째 줄을 하드코딩으로 잡는다(`{/*` 로 시작하는 첫 줄만 주석 인식). 오탐은 `--update-baseline` 유인이 되어 진짜 부채를 통과시킨다 |
| **5** | Document 뷰어 라우트 부재 — `pages/QDocs/DocumentEditorPage.tsx`(235줄)가 한 번도 마운트된 적 없다(git -S 0건) |
| **6** | 음성 캡처 `voice=` 잔여 3경로(task/event/mail)는 여전히 텍스트 미소비. memo 만 살렸다 |
| **7** | #217(QBillPage socket 미청취) · #221 · #241 · iOS 트랙 |

## Irene 확인 대기
1. **방침 변경 공지** — s10 이 "시행 7일 전 공지" 를 자기 약속으로 둔다. `announcement_text` 1건 권고(Fable)
2. Google Cloud Console 재제출 — **이번 정정으로 캘린더·Gmail 기재 불일치 해소**. 반려 메일 원문 주시면 대조
3. Mac Chrome 쿠키 삭제 설정(#244) · #245 뒤로가기 화살표 유무 · 수동 청구서 `taxOn` 기본값
4. **운영 `/api/internal/*` 가 인터넷에서 백엔드까지 도달** — `INTERNAL_API_KEY` 단일 방어층.
   `scripts/nginx-planq.kr.conf:52` deny 를 운영 라이브에 반영 (**root 필요 → Irene**)

---

## 이번 세션에서 배운 것 (재발 방지)

1. **★ 패턴을 열거하는 가드는 반드시 뚫린다.** 옛 spalink 가 래퍼 하나에 통째로 뚫렸다.
   **"기본 검출, 명시적 제외"** 로 두어야 새 문법이 생겨도 침묵하지 않는다. 제외 목록은 읽고 반박할 수 있지만
   포함 목록의 빈틈은 아무도 못 본다.
2. **★ 가드는 여러 형태로 깨뜨려 봐야 한다.** 통과는 아무것도 증명하지 않는다. 오탐 방향 반증도 같이 돌려야
   제외 규칙이 너무 넓지 않음을 안다.
3. **★ 라우트만 고치고 소비를 안 만들면 "고친 척" 이다.** `/notes?prefill=` 은 죽은 라우트를 없앴지만
   텍스트 소실은 그대로였는데 주석은 고쳤다고 적혀 있었다.
4. **★ 스코프 정정은 한 항목만 보면 안 된다.** 요청 스코프 전수와 방침을 대조해야 한다 — Gmail restricted
   scope 가 통째로 누락돼 있었다.
5. **★ 자기 주장을 실측으로 낮출 것.** "청구서 알림 전건 사망" 은 과장이었다(옛 row 0건). 심각도를 부풀리면
   다음 판단의 근거가 오염된다.
6. **★ 조회가 `updated_at` 을 건드리면 낙관적 잠금과 정렬이 동시에 무너진다.** `increment()` 는 기본이
   non-silent 다. 읽기 경로의 부수 write 는 항상 `{ silent: true }` 를 의심할 것.
7. **★ effect deps 에 "내가 갱신하는 값" 을 넣으면 세션이 리셋된다.** 스냅샷 effect 에 `detail?.id` 를 걸었더니
   첫 자동저장이 그 effect 를 재발화시켜 글이 두 개 생기고 취소가 무력화됐다. 진입 카운터(`editEpoch`)로 분리.
8. **★ 빌드 exit 1 이 항상 빌드 실패는 아니다.** 체인 마지막 `grep -c` 가 0 을 세면 exit 1 이다.
   `REAL_EXIT` 를 따로 찍어 판정할 것 (memory `feedback_false_fail_suspect_the_judge`).
9. **idle autosave 가 Fable 반증 편집을 또 커밋했다** (`be67d4e` → revert `39edfd8`). **누적 5회.**
   이번엔 무력화된 보안 sanitizer 가 HEAD 에 실릴 뻔했다. Fable 프롬프트에 "반증 편집은 최대한 짧게 +
   복원 후 `git log` 확인" 을 매번 명시할 것.

---

## Git 상태
- 운영 배포 커밋: **`baa3483`** (게이트 통과분 전부 반영 완료)
- 이후 커밋: `d1baaf0` 외 auto-save — **#252 미완분 포함, 배포 금지**
- Fable 게이트 마커: `.claude/.fable-gate.json` — `baa3483` 기준 PASS (그 이후 변경은 미검증)

## 복구 가이드
새 Claude 세션 시작 시:
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
