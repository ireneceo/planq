# PlanQ 세션 상태

## 현재 작업 상태
**마지막 업데이트:** 2026-08-08 04:30 UTC (Opus 5, 1M)
**작업 상태:** **1~3단계 완료 · 커밋 `7f0979d`** — Fable 3게이트 통과(설계 조건부승인 → 구현 PASS → spalink R3 PASS).
**⚠️ 운영 미배포.** Irene 의 명시 `/배포` 지시 대기. **미배포 누적 4덩이** (아래 참조).

가드: guard 23/23 · health 34/34 · build REAL exit 0 · error TS 0 · 작업트리 클린

---

## 이번 세션 완료 (Irene 지시: "1~3단계 다 진행 · fable 검증 철저히")

### ✅ 1단계 — spalink 가드 재작성 + 죽은 링크 9건 (Fable R1 FAIL → R2 FAIL → R3 PASS)

**옛 가드가 왜 거짓 통과했나 (Fable R1 BLOCKER)**
- `navigate(` / `to=` / `location.href` **문법을 열거**하는 방식이라 래퍼를 못 봤다 —
  `navTo('/qbill')`(대시보드 청구서 타일)이 살아있는 죽은 링크인데 가드는 "0건" 을 선언했다
- **첫 세그먼트만** 비교해 `/memo`(라우트는 `/memo/:id` 뿐) 같은 2단계 오류를 구조적으로 못 잡았다

**재작성 — 판정 방향을 뒤집었다**
- 프론트 `src` 전체 + 백엔드 `routes|services` 의 **모든 경로 문자열 리터럴**을 뽑아
  라우트 대장 패턴(`:param`·`*` 지원)에 **전체 경로**를 매칭
- **"기본 검출, 명시적 제외"** — 새 래퍼가 생겨도 침묵하지 않는다.
  제외는 API 호출 인자 · 경로 비교(`includes`/`startsWith`/`===`) · 접두목록 상수 ·
  정적자산(확장자) · 외부 HTTP · 네이티브 딥링크뿐
- Fable R2 지적 반영: lookbehind 로 `showBudget(`·`location.replace(` **오제외** 차단
- 실행 0.24초(spalink 단독) — 전 src 스캔 전환에도 파이프라인 부담 없음

**가드가 새로 찾아낸 죽은 링크 9건 (전부 교정)**
| 위치 | 옛 → 새 | 실제 증상 |
|---|---|---|
| DashboardPage:170 | `/qbill` → `/bills` | 빠른작업 "청구서" 타일 클릭 무반응 |
| notificationLink.ts + services/notification_link.js | `/bill` → `/bills` | link null 시 fallback 매핑 |
| **TermsReacceptModal:71,81** | `/legal/terms`·`/legal/privacy` → `/terms`·`/privacy` | **약관 재동의를 강요당한 사용자가 정작 약관을 못 봤다** |
| dashboard.js:533 | `/qdocs?post=` → `/docs?post=` | 서명 반려 알림 |
| files.js:138 | `/file?file=` → `/files?file=` | 단수형 |
| tasks.js:2030 | `/task?task=` → `/tasks?task=` | 단수형 |
| routePrefetch.ts:28 | `/clients` → `/business/clients` | prefetch 미발화 |
| VoiceCaptureSheet:177 | `/memo?voice=` → `/notes?prefill=` | 아래 별도 |
| **auth_oauth.js:117 + OAuthCallbackPage:28** | `/onboarding` → `/inbox` | **온보딩 페이지가 아예 없어 catch-all → RootRoute(로그인 무관 마케팅 홈). 구글 신규 가입자가 앱이 아니라 랜딩에 떨어졌다** |

**★ Opus 의 과장 1건을 Fable 이 실측으로 정정**
"`/bill` 청구서 알림 클릭 **전건 사망**" → **틀렸다.** dev DB 실측 옛 `/bill?` row **0건**,
`/bills?` **368건**. `invoices.js` notify 호출자 8곳이 전부 **명시 link** 를 넘겨서
죽어 있던 건 **link 가 비었을 때의 fallback 매핑뿐**이고 그 경로를 탄 알림이 없었다.
교정은 올바른 위생이지만 **피해는 없었다. 백필 불요.**

**음성 캡처 — 라우트만 고치면 반쪽 (Fable R2 MAJOR)**
`/notes?prefill=` 로 바꿨는데 **QNotePage 가 `?prefill=` 을 읽는 코드가 없어**
페이지만 뜨고 받아쓴 텍스트는 그대로 버려졌다(주석은 고친 것처럼 서술).
→ QNotePage prefill effect → `composingText` → MemoView `prefillText` → 초기 doc.
→ MemoView 의 session 변경 effect 는 **첫 실행을 건너뛴다**(`didInitRef`) —
  안 그러면 mount 시 빈 doc 으로 prefill 을 덮어쓴다.
Fable 실브라우저 실증: 개행·한글·`%`·`&`·`+` **원형 착지** → 2.5초 자동저장 →
**SQLite `sessions.body` 확인** → URL `?prefill=` 제거 → 재발화 0 → 메모 A↔B 전환 무회귀.

### ✅ 2단계 — 개인정보처리방침 Google 스코프 정정 (Fable 설계 게이트 **BLOCKER**)

- 캘린더를 "**읽기 전용**" 으로 적어놨는데 실제는 `calendar.events`(**읽기·쓰기**).
  PlanQ 는 구글에 일정을 **생성·수정·삭제**하고 Meet 링크를 발급한다.
- **★ 더 심각 — Gmail 이 방침에 한 줄도 없었다.** 개인 메일 연동은
  **`https://mail.google.com/`(restricted scope, 메일함 전체 접근)** 를 요청한다.
  구글이 가장 엄격하게 처리방침을 대조하는 등급. **캘린더만 고쳤으면 다음 반려는 여기서 왔다.**
  ko/en 양쪽 항목 신설.
- `privacy_version` 은 **올리지 않는다** — 처리 범위 확대가 아니라 **기재 정정**이고,
  올리면 `TermsReacceptModal` 이 무관한 **전 사용자**에게 재동의를 강제한다.
  실질 동의는 구글 동의 화면에서 항목별로 이미 받고 있다(`hasWriteScope` 미충족 토큰은 저장 거부).
- Fable 권고: 방침 s10 이 "변경 시 7일 전 공지" 를 자기 약속으로 두고 있으니
  `platform_settings.announcement_text` 공지 1건 — **Irene 조치 권고**

### ✅ 3단계-A — OAuth 콜백 관측성

- 연동 실패 신고("연결했는데 안 돼")에 **서버 흔적이 전무**했다. 조기 return 들이
  실패 HTML 만 띄우고 끝났다
- `utils/oauthLog.js` **단일 착지점** — gcal 3 + **gdrive 3**(Fable MAJOR) + 개인 콜백 7경로
  (`fail()` 헬퍼 **안에서 1회** — 호출부에 흩뿌리면 다음에 경로가 늘 때 또 빠진다)
- **보안**: `code`·`access_token`·`refresh_token`·`state` 원문은 **화이트리스트로 차단**.
  콜백은 **비인증 공개 라우트**라 `?error=` 는 공격자 제어 입력 — 개행 제거 + **64자 절단**
  (로그 인젝션). Fable 반증: sanitizer 무력화 시 **위조 로그 줄이 실제로 생성**됨을 확인

### ✅ 3단계-B — 배너가 어느 연동을 가리키는지

- 배너 2종이 **둘 다 `/business/settings/storage`** 로 보냈는데 워크스페이스 연동은
  `requireOwnerForCloud`(owner/platform_admin) — **직원에겐 눌러도 403 인 죽은 안내**였다.
  `StorageSettings` 에 프론트 오너 게이트도 없어 버튼이 그대로 노출됐다
- `GET /calendar/video/status` 에 `personal_connected`/`personal_can_write` 추가.
  **원천은 Meet 이 실제 고르는 `pickPersonalConn` + `hasCalendarWrite`**(Fable MAJOR —
  `/me/external-connections` 리스트는 cross-workspace 폴백이 달라 두 화면이 어긋난다)
- 배너 원칙: **그 사용자가 스스로 할 수 있는 경로만 가리킨다.**
  주 CTA = `/profile/integrations`(누구나) / 오너 + 워크스페이스 권한 없음일 때만 보조 1줄
- `StorageSettings` 비-오너 연결·해제·동기화 토글 disable + 사유 안내(ko/en)

---

## Fable 게이트 기록

| 게이트 | 라운드 | 판정 |
|---|---|---|
| 설계 (2·3단계) | R1 | **조건부 승인** — BLOCKER 1(Gmail 방침) + MAJOR 4 |
| 구현 (2·3단계) | R1 | **PASS** — 조건 5건 전부 실HTTP/실로그 확인 |
| spalink (1단계) | R1 | **FAIL** — 래퍼 미검출(BLOCKER) · 세그먼트 한계 · Document 링크 |
| spalink | R2 | **FAIL** — `/notes?prefill=` 텍스트 미소비(MAJOR) · 정규식 경계 2 |
| spalink | R3 | **PASS** — 실브라우저 착지 실증 · 반증 13종(검출 8 / 정상침묵 5) · 신규 오탐 0 |

**실측 근거:** video/status 3상태 6/6 · 멀티테넌트 403 · 테스트데이터 잔존 0 ·
콜백 9경로 로그 발화 · code/state 유출 0건 · prefill SQLite body 확인 ·
guard 23/23 · health 34/34 · build REAL exit 0 · TS 0 · i18n·parity PASS

---

## ⚠️ 운영 미배포 누적 (Irene `/배포` 대기)

| # | 내용 | 커밋 | Fable |
|---|---|---|---|
| 1 | **Meet 개인 연동 우선** — 직원이 자기 계정 연결해도 Meet 이 안 되던 것 | autosave `0c4c8bf`~`8c9a9fb` | ✅ PASS(R3) |
| 2 | 운영 신고 5건 (#246·247·248·249·251) | `7a3895a` | ✅ PASS |
| 3 | 1~3단계 (이번 세션) | `7f0979d` | ✅ PASS |

> 3덩이 모두 게이트 통과 상태 — 한 번의 `/배포` 로 같이 나갈 수 있다.

---

## 다음 우선순위

| 순위 | 내용 |
|---|---|
| **1** | **`/배포`** — 위 3덩이 (Irene 지시 필요) |
| **2** | 직원 신고 잔여 — **#250**(업무 태그 미개발) · **#252**(문서 임시저장) · #246 후속 |
| **3** | **Document 뷰어 라우트 부재** — `pages/QDocs/DocumentEditorPage.tsx`(235줄, 주석에 `/docs/d/:id`)가 **한 번도 마운트된 적 없다**(git -S 0건). 그래서 프로젝트 deliverables 의 document 링크가 `?tab=docs`(post 전용 탭)로 착지 — 문서를 특정해 열 수단이 없다. dev DB 실사용 0건이라 무증상 |
| **4** | 음성 캡처 `voice=` 잔여 — task/event/mail 3경로는 여전히 텍스트 미소비(`/tasks?create=1&voice=` 등). memo 만 이번에 살렸다. `attachFileIds` 도 QNotePage 미소비(ShareReceivePage 주석에 기지 갭으로 박제) |
| **5** | #217(QBillPage socket 미청취) · #221 · #241 · iOS 트랙 |
| **P2+** | 캘린더 에코백 동기화(구글→PlanQ, 대규모) |

---

## Irene 확인 대기
1. **방침 변경 공지** — s10 이 "시행 7일 전 공지" 를 약속. `announcement_text` 1건 권고 (Fable)
2. Google Cloud Console — Data Access 요청 스코프 정리 / 심사팀 반려 메일 원문.
   **이번 정정으로 캘린더·Gmail 기재 불일치는 해소**됐으니 재제출 조건이 나아졌다
3. Mac Chrome "모든 창 닫을 때 쿠키 삭제" 설정 (#244 삭제 주체)
4. #245 흔들릴 때 화면 가장자리 뒤로가기 화살표(←) 유무
5. 수동 청구서 모달 `taxOn` 기본 ON 여부
6. **운영 `/api/internal/*` 가 인터넷에서 백엔드까지 도달**(dev 는 nginx 차단). 방어는
   `INTERNAL_API_KEY` 단일층뿐 — `scripts/nginx-planq.kr.conf:52` deny 를 운영 라이브에 반영
   (**root 필요 → Irene 조치**)

---

## 이번 세션에서 배운 것 (재발 방지)

1. **★ 패턴을 열거하는 가드는 반드시 뚫린다.** 옛 spalink 가 `navigate(`/`to=` 만 세어서
   래퍼 하나(`navTo`)에 통째로 뚫렸다. **판정 방향을 "기본 검출, 명시적 제외" 로 두어야**
   새 문법이 생겨도 침묵하지 않는다. 제외 목록은 읽고 반박할 수 있지만, 포함 목록의
   빈틈은 아무도 못 본다.
2. **★ 가드는 반드시 여러 형태로 깨뜨려 봐야 한다.** 통과는 아무것도 증명하지 않는다.
   이번에 13종을 심어 8검출/5정상침묵을 확인했고, **오탐 방향 반증**(멀쩡한 링크가
   조용한지)도 같이 돌려야 제외 규칙이 너무 넓지 않음을 안다.
3. **★ 라우트만 고치고 소비를 안 만들면 "고친 척" 이 된다.** `/memo?voice=` → `/notes?prefill=`
   는 죽은 라우트를 없앴지만 텍스트 소실은 그대로였는데 **주석은 고쳤다고 적혀 있었다.**
   Fable 이 "소비자가 코드베이스에 3곳뿐, QNotePage 는 useSearchParams 0건" 으로 잡았다.
4. **★ 스코프 정정은 캘린더만 보면 안 된다.** 요청 스코프 전수와 방침을 대조해야 한다 —
   Gmail 의 `mail.google.com`(restricted)이 통째로 누락돼 있었다. 한 항목만 고치면
   다음 반려가 온다.
5. **★ 자기 주장을 실측으로 낮출 것.** "청구서 알림 전건 사망" 은 과장이었다(옛 row 0건).
   Fable 이 DB 로 반박했다. 심각도를 부풀리면 다음 판단의 근거가 오염된다.
6. **★ 소스에 NUL 바이트가 들어가면 git 이 바이너리로 판정한다.** Edit 로 넣은 치환
   자리표시자가 실제 NUL 이 되어 있었다 — `` 이스케이프로 교체. 편집 직후
   `grep -c $'\x00'` 확인 습관.
7. **idle autosave 가 Fable 반증 편집을 또 커밋했다** (`be67d4e` → revert `39edfd8`).
   **누적 4회.** 이번엔 무력화된 `safeParam`(보안 sanitizer)이 HEAD 에 실릴 뻔했다.
   Fable 프롬프트에 "반증 편집은 최대한 짧게 + 복원 후 `git log` 확인" 을 명시할 것.

---

## Git 상태
- HEAD: **`7f0979d`** fix: 죽은 SPA 링크 전수 차단 + Google 스코프 방침 정정 + OAuth 콜백 관측성
- 직전: `39edfd8`(autosave 오염 revert) · `be67d4e`·`ce6fc78`·`60907e0`·`82a3148`(autosave)
- 작업 트리: 클린
- Fable 게이트 마커: `.claude/.fable-gate.json` — PASS(head `7f0979d`)

## 복구 가이드
새 Claude 세션 시작 시:
```
이전 세션 이어서 작업하고 싶어.
/opt/planq/.claude/session-state.md 읽어줘.
```
