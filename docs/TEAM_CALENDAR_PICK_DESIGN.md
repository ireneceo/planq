# 팀 Google 캘린더 «고르기» · 캘린더 화면 개인/팀 구분 설계

- 설계: [Fable] 2026-10-12 · 상태: **설계 — Irene 승인 전 구현 안 함**
- Irene 원문: *"개인설정에서 캘린더 설정>캘린더 고르기 … 하나만 선택하게 되어 있어? 왜?? 멀티선택이 되어야지. 팀캘린더도 마찬가지고. 그리고 캘린더 화면에서는 개인과 팀이 잘 알게 해야 하고."*
- 개인 쪽은 끝났다(23e9adf0 — «보일 캘린더 여러 개» + «올릴 캘린더 하나»). 이 문서는 **팀(회사 공용) 연결**과 **캘린더 화면 구분**만 다룬다.

## 0. 지금 사실(저장소)
- 팀 연결은 `business_cloud_tokens(provider='gcal')` 한 행 = **대표가 연결한 구글 계정**(대개 대표 개인 계정). 토큰 권한은 `calendar.events` + openid/email 뿐 — **캘린더 목록을 볼 권한이 없다**(개인은 «고르기» 누른 사람에게만 `calendarlist.readonly` 를 더 받는다 — `personalOauth.js:78`).
- 쓰는 곳이 전부 `'primary'` 고정: `google_calendar.js`(insert 301·patch 344·delete 354·회의 248) · `calendarOrphanCleanup.js`(40·94) · `calendarReverseSync.js:230` · `calendarSync.js`(pushTo·linkMeeting·removeAt 의 workspace 분기).
- 링크 표 `calendar_event_gcal_links.gcal_calendar_id` 는 이미 캘린더별이다(개인이 쓰고 있다). 팀 링크는 늘 `'primary'` 가 적혀 있다.
- 팀 연결은 **읽어서 보여 주는 표면이 없다** — 역방향 동기화는 «PlanQ 가 올린 일정이 구글에서 고쳐졌나» 만 본다. 팀원 Q calendar 의 «팀» 층은 PlanQ 일정 자체다.
- 화면: 개인 구글 일정 색 = 구글 캘린더 색(없으면 틸 `#14B8A6`), 팀 일정 «개인» 분류도 틸 계열(`categoryColors.ts`) → 같은 색이 섞인다. 칩 자체에 출처 표식 없음, 상세에만 «개인 캘린더» 배지.

## 1. 결정 — 팀 연결의 «멀티선택» 은 무엇인가
**팀에서 «여러 개» 는 두 가지로 갈린다. 하나만 한다.**

| | (a) **올릴 캘린더를 고른다** — 팀 일정을 대표 primary 가 아니라 공유 «팀» 캘린더 등 **하나**로 | (b) 회사 계정의 다른 캘린더들을 **팀원 전원 Q calendar 에 읽어 온다** |
|---|---|---|
| 뜻 | 한 일정 = 한 캘린더라 쓰기는 본질상 하나. 지금 «대표 개인 캘린더에 팀 일정이 쌓이는» 문제를 푼다 | 개인 «보일 캘린더» 와 같은 체크 목록을 팀에 |
| 위험 | 공유 캘린더를 고르면 **그 캘린더를 보는 사람 모두**에게 PlanQ 팀 일정이 보인다 → 고르는 화면이 그 사실을 말한다. L1/L2/personal 은 종전처럼 안 나간다(`isPrivateForGcal` 그대로) | **토큰이 대표 개인 계정**이다. 그 계정의 캘린더를 팀에 읽어 오면 대표의 사적 일정·참석자가 멤버 전원에게 간다. 고객 역할 격리·새 읽기 표면·쿼터(팀원 수 × N캘린더) 도 새로 생긴다 |
| 판정 | **한다(1단계)** | **지금 안 한다.** 같은 결과는 이미 있는 길로 된다 — 팀이 볼 공유 캘린더는 각자 구글에서 구독하고 **개인 «보일 캘린더»** 에서 켠다(23e9adf0). PlanQ 팀 일정은 (a) 로 그 공유 캘린더에 올라가므로 구글 쪽에서도 한 곳에 모인다 |

> 그래서 팀 설정 화면의 글자는 «캘린더 고르기» 가 아니라 **«팀 일정을 올릴 Google 캘린더»** 다 — 여러 개를 고르는 칸이 아님을 이름이 말한다. 개인 쪽 «보일 캘린더 여러 개» 와 헷갈리지 않게 한 줄 안내: «팀원이 볼 구글 캘린더는 각자 개인 연동에서 고릅니다».

## 2. 데이터·권한·엔드포인트 (개인 쪽을 그대로 비춘다)
- **컬럼 2개** `business_cloud_tokens.gcal_calendar_id VARCHAR(255) NULL` · `gcal_calendar_summary VARCHAR(255) NULL`. NULL = primary(옛 행 전부 그대로 — 백필 없음). 멱등 스크립트 `dev-backend/scripts/migrate-gcal-team-calendar.js`, 배포 슬롯 등록(모델이 SELECT 하므로 코드보다 먼저).
- **판정 함수 하나** `google_calendar.calendarIdOf(token)` = `token.gcal_calendar_id || 'primary'`. 위 0절의 `'primary'` 고정 **전부**를 이 값 또는 **링크의 `gcal_calendar_id`** 로 바꾼다:
  - 새로 올릴 때(insert·회의 생성·push-to-gcal·백필) → `calendarIdOf(token)`, 링크에 그 id 를 적는다(`pushTo` 가 workspace 도 `calendarId` 를 돌려준다).
  - 이미 올린 일정의 수정·삭제(patch·delete·removeAt·`routes/calendar.js:946` 옛 단일컬럼 삭제) → **링크의 `gcal_calendar_id`**. 사람이 캘린더를 바꿔도 옛 일정은 옛 캘린더에서 계속 고치고 지운다(개인과 같은 계약, `calendarSync.js:169`). 옮기지 않는다 — 옮기면 참석자 초대·Meet 링크가 흔들린다.
  - 역방향 동기화 → `calendarIdOf(token)`. 바꾸는 순간 `gcal_sync_token = NULL`(새 캘린더를 처음부터 읽는다). 옛 캘린더에 남은 일정의 구글 쪽 수정은 더 이상 돌아오지 않는다(개인과 같다, `calendarReverseSync.js:229`) — 설정 화면이 바꿀 때 이 한 줄을 말한다.
  - 고아 정리 → 훑는 캘린더 = `{calendarIdOf(token)} ∪ {그 워크스페이스 팀 링크들의 gcal_calendar_id}`. 지우는 쪽도 그 캘린더에서. 옛 캘린더만 훑으면 새 곳의 고아를, 새 곳만 훑으면 옛 고아를 놓친다.
- **권한** — 연결·해제와 같은 사람: `requireOwnerForCloud`(대표). 화면도 `isOwner` 그대로(아래 D2).
- **권한 범위** — 팀 토큰에 목록 권한이 없으므로 [고르기] 를 누르면 먼저 **«캘린더 목록 권한을 포함해 다시 연결»** 로 보낸다: `buildAuthUrl(businessId, userId, { withCalendarList: true })` 가 `calendar.calendarlist.readonly` 를 더 묻는다. 판정은 `services/googleScopes.js` 한 곳(개인과 같은 상수). 받은 scope 에 없으면 `can_list:false` 로 화면이 이유를 말한다.
- **엔드포인트 2개** (`routes/cloud.js`, 둘 다 `authenticateToken + checkBusinessAccess + requireOwnerForCloud` + `perUserLimiter` 분당 30):
  - `GET /api/cloud/gcal/:businessId/calendars` → `{ can_list, selected, selected_summary, calendars:[{id, summary, primary, access_role, color}] }` — **writer/owner 권한 캘린더만**(`minAccessRole:'writer'`, `freeBusyReader` 제외 — 개인 `listCalendars` 와 같은 필터).
  - `PUT /api/cloud/gcal/:businessId/calendar-id { calendar_id }` → 목록에 있는 id 만(손으로 넣은 id 를 믿지 않는다 — `calendar_not_writable` 400) · primary 면 NULL 저장 · 바뀌면 `gcal_sync_token=null` · 감사 `cloud.calendar_select {old:{calendar_id}, new:{calendar_id}}`(이름·일정 내용 없음) · `business:<id>` 방에 `cloud:updated` 신호만.
  - 새 라우트를 하나 더 만들지 않는다 — `GET /api/cloud/status` 와 `/video/status` 응답에 `workspace_calendar_summary`(NULL = «기본 캘린더»)만 더한다. 캘린더 화면 배너(`CalendarSyncNotice`)·설정 카드가 같은 값을 읽는다.
- **화면** `StorageSettings.tsx` Google Calendar 카드에 한 줄: «팀 일정을 올릴 캘린더: **[이름 ▾]**» — `ChipPopover` 로 값은 칩, 목록은 누를 때(팝오버 안 `PlanQSelect` 금지). 공유 캘린더를 고르면 칩 아래 경고 한 줄 «이 캘린더를 보는 사람 모두에게 PlanQ 팀 일정이 보입니다 · 이미 올린 일정은 원래 캘린더에 남습니다». 대표 아니면 칩만 보이고 바꿀 수 없다. 자동저장(선택 즉시 PUT, `AutoSaveField type="select"`).

## 3. 캘린더 화면 — 개인/팀 구분 (최소 규칙, 색·레이아웃 임의 변경 아님)
층 칩(개인/팀/업무/Google)은 **켜고 끄는 도구**라 «이 칩이 어디서 왔나» 를 한 칸 한 칸에서 말해 주지 않는다. 더하는 것 셋, 바꾸는 것 하나:
1. **구글에서 온 일정 칩은 왼쪽에 작은 점(●, 10px, 그 캘린더 색)** — PlanQ 일정 칩에는 점이 없다. 색이 아니라 **모양**으로 가른다(색만 믿으면 틸끼리 섞인다). 접근성: `aria-label` 에 «Google · <캘린더 이름>».
2. **Google 층 칩 옆에 계정 이메일**(이미 `googleWhich` 로 힌트에 있다 → 폰에서는 힌트가 안 뜨므로 **보이는 글자**로 «Google · irene@…» 짧게; 둘 이상이면 «Google 2계정»).
3. **PlanQ «나만 보기»(L1) 칩은 기존 자물쇠 표식 그대로**, 팀 일정은 표식 없음. 상세 서랍에 «팀 일정 → Google «팀» 캘린더에 올라감 / 개인 Google 「캘린더 이름」」 한 줄(링크의 `gcal_calendar_id` 와 2절 `selected_summary` 로).
4. **바꾸는 것 하나** — 구글 캘린더 색이 없을 때의 대체색 `#14B8A6`(틸) → 분류 팔레트에 없는 회청 `#64748B`. 같은 틸 두 벌이 섞이는 원인이 이 기본값이다(실측 D절). 분류 팔레트 자체는 건드리지 않는다.
- 범례를 따로 만들지 않는다 — 층 칩 줄이 곧 범례다(점 = Google, 자물쇠 = 나만 보기, 나머지 = 팀). 셋째 밴드 금지 계약 그대로.

## 4. 단계·파일·검증
| 단계 | 내용 | 파일 |
|---|---|---|
| 1 | 컬럼·`calendarIdOf`·고정 `'primary'` 전부 교체·sync token 리셋·고아 정리 범위·엔드포인트 2·status 필드·설정 카드 칩·재연결(목록 권한) | `models/BusinessCloudToken.js` · `scripts/migrate-gcal-team-calendar.js` · `services/google_calendar.js` · `calendarSync.js` · `calendarReverseSync.js` · `calendarOrphanCleanup.js` · `routes/cloud.js` · `routes/calendar.js`(946·1308·status) · `googleScopes.js` · `StorageSettings.tsx` · `CalendarSyncNotice.tsx` · locales `settings`/`qcalendar` ko·en |
| 2 | 화면 구분 3절(점·계정 글자·대체색·상세 한 줄) | `calendarLayers.tsx` · `taskToEvent.ts` · 일정 칩 컴포넌트 · `PersonalEventDrawer.tsx`/팀 상세 서랍 |
| (보류) | 1절 (b) 팀 읽기 — Irene 가 다시 원하면 별도 설계(고객 격리·쿼터·대표 동의 화면) | — |

검증(자체 — 기계로 갈리는 것 / Fable 게이트 — 2절 쓰기 경로는 되돌리기 어려움):
- 마이그레이션 2회 실행 = 같은 결과. 옛 행 `NULL` → 동작 변화 0(`calendarIdOf` = primary).
- 실호출(대표 토큰): GET 목록 → PUT 공유 캘린더 → 팀 일정(L3) 생성 → 링크 `gcal_calendar_id` = 고른 id, 구글 `events.get(그 캘린더)` 200 · **바꾸기 전 만든 일정** 제목 수정 → 옛 캘린더에서 patch(새 캘린더엔 없음) · 삭제 → 옛 캘린더에서 사라짐 · L1 일정은 어느 캘린더에도 안 생김(양성: L3 는 생김) · 멤버 PUT 403 · 목록에 없는 id 400 · 역방향: 바꾼 뒤 첫 폴링이 새 캘린더를 전수로 읽고 자기 insert 를 변경으로 오인하지 않음(etag).
- 고아 정리: 옛 캘린더의 **링크 있는** PlanQ 일정은 안 지움 / 링크 없는 표식 일정은 지움(양성 대조군).
- `health-check --category=secrets`(응답에 토큰 0) · `guard-invariants`(duproute·i18n·parity·autosave) · `npm run build` EXIT 0.
- 화면 3폭(390·768·1440): 설정 카드 칩·경고 줄 · 캘린더 화면에서 구글 칩 점 ≥1 · PlanQ 칩 점 0 · 색 없는 구글 일정이 틸이 아님(대체색) · Google 층 칩 옆 계정 글자가 폰에서 **보임**(`elementFromPoint`).

## 5. Irene 가 정할 것 (둘)
**D1. 팀 연결에서 «여러 캘린더 보기(읽기)» 를 팀원 전원에게 열까요?**
- A) **안 열고, «올릴 캘린더 하나 고르기» 만 한다** — 팀이 볼 공유 캘린더는 각자 개인 연동 «보일 캘린더» 에서 켠다 → **권고** (대표 개인 계정이 팀에 새지 않는다 · 새 읽기 표면·쿼터 없음)
- B) 대표가 고른 캘린더만 팀 전원에게 읽어 온다 — 별도 설계(동의 화면·고객 제외·캘린더당 비용) 뒤에.

**D2. 팀 «올릴 캘린더» 를 바꿀 수 있는 사람은 누구로 할까요?**
- A) **대표만** — 연결·해제와 같은 선(`requireOwnerForCloud`) → **권고** (토큰 주인의 계정 안 캘린더를 고르는 일이다)
- B) 대표 + 관리자(admin)
