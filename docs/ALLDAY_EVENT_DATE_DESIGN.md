# 종일 일정의 날짜 — 설계 (2026-10-07 · [Opus] 초안 → Fable 설계 판정)

> 작업기록 «다음 할 일 4»: *종일 일정 시간대(기기 자정 저장 → 다른 시간대에서 하루 밀림) — 구글 동기화·알림까지 걸려 Fable 설계부터*
> 관련 결정: 2026-10-07 Irene *"캘린더 화면 표시도 설정대로 당연히. 서울기준이 아니라. 워크스페이스 설정기준."* (시간 일정은 이미 반영 — `pages/QCalendar/calTz.ts`)

## 1. 문제 (실측)

종일 일정은 «날짜» 인데 **실제 시각(instant)** 으로 저장한다. 그 시각을 만드는 기준과 읽는 기준이 곳마다 다르다.

| 실측 | 결과 |
|---|---|
| 운영 종일 3건 전부 `start 15:00:00Z / end 14:59:59Z`, 워크스페이스 Asia/Seoul | = 서울 기기 자정에 저장됨 |
| 운영 사용자 1명 `Asia/Kuala_Lumpur` | 그 사람이 보면 15:00Z = KL 23:00 **전날** → 8일 종일이 7~8일 이틀로 그려진다 |
| rrule 전개(서버 UTC 라이브러리): 10/7(수) 종일 서울 저장 `dtstart=10-06T15:00Z` + `FREQ=WEEKLY;BYDAY=WE` | 회차 `10-07T15:00Z`(=서울 **목** 10/8) · 10/14 · 10/21 → **매주 목요일**로 보이고 첫 회 10/7 이 사라진다. `BYMONTHDAY=7` 도 같은 모양(서울 8일) |
| 회차 식별자 = `inst.toISOString().slice(0,10)` (서버·EventDrawer occurrenceKeyOf) | 서울 저장 종일의 회차 키가 **전날 날짜** — 사람이 읽는 날짜와 다르다 |
| `eventNotify.whenText` 종일 = 서버(UTC) `toLocaleDateString` | 서울 저장 종일 8일 → 메일·알림 본문에 **«7일»** |
| `calendarReverseSync.toPlanqTimes` (구글 → PlanQ) | `new Date('YYYY-MM-DDT00:00:00')` = **서버 UTC 자정**. 화면 쓰는 쪽(기기 자정)과 다른 규약이 이미 섞여 있다 (dev 실측 1건 `00:00:00Z`) |
| `PublicCalendarEventPage` | `timeZone:'Asia/Seoul'` 하드코딩 |

## 2. 표면 전수 (쓰기 · 읽기)

| 구분 | 위치 | 지금 |
|---|---|---|
| 쓰기 | `NewEventModal.handleSubmit mkISO` | 기기 자정 / 기기 23:59:00 |
| 쓰기 | `EventDrawer mkISO`(saveSchedule) | 기기 자정 / 기기 23:59:00 |
| 쓰기 | `services/actions/event_actions.createEvent`(AI create_event · 음성은 NewEventModal 경유) | 받은 ISO 그대로 |
| 쓰기 | `routes/calendar.js` POST · PUT · 이 회차만(child) · 이후 모두(새 master) | 받은 값 그대로 / 새 master 시작 = targetDate+원래 시각 |
| 쓰기 | `services/calendarReverseSync.toPlanqTimes` | 서버 UTC 자정 / 23:59:59Z |
| 읽기 | `routes/calendar.js` 목록 범위 겹침 + rrule 전개 | instant 비교 · UTC 라이브러리 |
| 읽기 | `services/calendarReminderCron` nextOccurrence · reminderTimeFor | 회차의 **워크스페이스 tz 날짜** 09:00 |
| 읽기 | `services/google_calendar` insert/update · `personalCalendar.planqBody` | `localDateStr(value, 워크스페이스 tz)` → `{date}` |
| 읽기 | `services/eventNotify.whenText` | 서버 UTC |
| 읽기 | `routes/today_review` · `routes/dashboard` · `services/agent/tools/{calendar,directory}` · `services/searchScope` | instant 그대로 |
| 읽기(화면) | `calTz.useWallEvents`(종일은 변환 안 함) → MonthView·TimeGridView·AgendaView · `EventDrawer.wallOf` · Dashboard · TodayReview | 기기 로컬 |
| 읽기(화면) | `PublicCalendarEventPage` | Asia/Seoul 고정 |
| 겹침 | `taskToEvent`(업무 마감 → 종일 표시, 저장 안 함) | 기기 자정 — 화면 전용 |
| 겹침 | 개인 구글 오버레이(`personalCalendar.normalize`) | `YYYY-MM-DDT00:00:00`(Z 없음) 문자열 — 브라우저 로컬 해석 |

## 3. 선택지

### U (권고) — **종일 = 날짜. UTC 자정으로 부호화한다**
- 저장: `start_at = <첫날>T00:00:00Z`, `end_at = <마지막 날>T23:59:59Z`. 날짜는 언제나 `iso.slice(0,10)`.
- 한 벌: 백엔드 `utils/allDayDate.js`(`allDayRange(firstDate,lastDate)` · `allDayDates(ev)` · `isAllDayEncoded`) /
  프론트 `utils/allDayDate.ts`(같은 이름). 모든 쓰기·읽기가 이 함수만 부른다.
- 왜:
  ① 기기 시간대·**워크스페이스 시간대를 나중에 바꿔도** 날짜가 안 움직인다(W 안은 tz 를 바꾸는 순간 옛 종일 전부가 밀린다).
  ② rrule 라이브러리가 UTC-floating 이라 BYDAY·BYMONTHDAY 가 사람이 고른 요일·일자 그대로 나온다(§1 의 목요일 버그가 사라진다).
  ③ 서버·화면의 회차 식별자(`toISOString().slice(0,10)`)가 **실제 날짜와 같아진다** — 6169cbfe 의 occurrenceKeyOf 주석이 말하는 «한국 아침 = UTC 전날» 어긋남이 종일에서는 0.
  ④ 구글 `{date}` 가 그냥 slice — tz 인자가 필요 없다. 역동기화는 **이미 이 부호화**다.
- 읽는 쪽 규칙:
  - 화면: 종일은 `useWallEvents` 에서 «그 날짜의 로컬 자정 ~ 마지막 날 로컬 23:59:59» Date 로 바꿔 넘긴다(격자는 로컬 필드를 읽는다). 표시 문구도 같은 함수.
  - 목록 범위: 범위(워크스페이스 벽시계 경계 → instant)와 UTC 부호화 날짜는 최대 ±14시간 어긋난다 → **종일 행만 범위를 ±1일 넓혀** 가져오고, 화면이 날짜로 자른다(지금도 날짜로 배치한다). rrule 전개도 같은 넓힘.
  - 알림: 회차 날짜 = slice → 그 날짜 09:00 **워크스페이스 tz**(지금 규칙 유지).
  - 알림·메일 문구(`whenText`), 공개 페이지, 대시보드·오늘 리뷰·AI 도구 출력: 종일은 `allDayDates` 로 날짜 문자열.
  - 오늘 리뷰 «오늘»: 워크스페이스 tz 의 오늘 날짜와 날짜로 비교(종일), 시간 일정은 지금대로.
- **옛 행 재부호화(백필)** `scripts/migrate-allday-utc-date.js` — 멱등:
  - `all_day=1` 이고 `start_at` 이 UTC 자정이 아닌 행 → 그 행 **워크스페이스 tz** 의 날짜로 읽어 UTC 자정/23:59:59Z 로 다시 쓴다
    (기기 자정 저장의 «기기» 를 모르므로 워크스페이스 tz 가 최선의 추정. 운영 3건은 전부 서울 워크스페이스·서울 자정이라 정확).
  - 같은 행의 `exception_dates`·자식(`recurrence_id`) 키는 옛 UTC slice(=전날) → 같은 날짜 이동을 적용(운영 종일 반복 0건, dev 확인 필요).
  - 롤백: 같은 스크립트 `--revert`(워크스페이스 tz 자정으로 되돌림). 운영은 배포 슬롯 «코드보다 먼저».
  - 운영 대상: 3행(읽기 실측). 구글에 이미 올라간 종일은 0건(`gcal_event_id` 없음) — 재동기 불필요.
- 읽기 관용: 백필 전 행·외부에서 들어온 행이 UTC 자정이 아니면 `allDayDates` 가 워크스페이스 tz 로 읽는다(한 함수 안의 분기) — 배포 순서가 어긋나도 하루 밀리지 않게.

### W — 종일 = 워크스페이스 tz 자정
- 화면 변경은 작다(종일도 toWall). 그러나 ① 워크스페이스 tz 를 바꾸면 옛 종일 전부가 밀린다 ② rrule 이 UTC 라이브러리라 BYDAY 목요일 버그가 **남는다**(tzid 전개를 새로 넣어야 한다) ③ 회차 식별자 어긋남 유지 ④ 역동기화(이미 UTC)도 바꿔야 한다. — 고치는 양은 비슷하고 남는 결함이 많다.

### D — DATEONLY 새 컬럼(start_date/end_date)
- 의미상 가장 깨끗하나 운영 스키마 변경 + 모든 쿼리·직렬화 이중 경로. U 는 같은 성질(날짜 = UTC 자정)을 기존 컬럼으로 얻는다.

## 4. 범위 밖 (기록만)
- **시간 일정의 반복**도 같은 UTC 전개 문제가 있다 — 서울 08:00 매주 수요일 = UTC 화 23:00 → BYDAY=WE 로 전개하면 **목 08:00**. 종일과 다른 고침(tzid 전개)이 필요하다. 이번엔 손대지 않고 따로 올린다.

## 5. 검증 계획
- 단위: `allDayRange`/`allDayDates` 왕복 · 월·연·윤년 경계 · 옛 부호화(서울 자정) 관용 읽기.
- 실HTTP(dev): 서울 워크스페이스에 종일 생성(화면 경로와 같은 바디) → DB `00:00:00Z` → 목록 범위 첫날·마지막 날 포함 · 매주 수 반복 회차가 수요일 · 이 회차만/이후 모두 키 일치 · 알림 cron 의 발송 예정 시각 = 그날 09:00 KST · 구글 insert 바디 `{date}` (모의 cal 객체로 바디만 캡처, 실제 구글 호출 없음) · whenText 날짜.
- 실브라우저 3폭 × 기기 tz 3개(Asia/Seoul · Asia/Kuala_Lumpur · America/Los_Angeles, CDP `Emulation.setTimezoneOverride`): 같은 종일이 같은 날짜 칸에 하루만 · 상세 날짜 칸 · 생성 → 다시 열기 왕복. 양성 대조군: 옛 mkISO(기기 자정) 되살리면 KL/LA 에서 판정이 뒤집힌다.
- 백필: dev 에 옛 부호화 행을 만들어 실행 → 결과 → 재실행 0건(멱등) → `--revert` 원복.

---

## 6. Fable 설계 판정 (2026-10-07) — «U 로 진행 + 수정 17건» 반영 결과

초안과 달라진 것:
- **날짜 함수는 반올림 하나** — `allDayDateOf(v)` = `YYYY-MM-DD…`(오프셋 없는) 문자열이면 앞 10자, 아니면 가장 가까운 UTC 자정.
  서버 쓰기 정규화·관용 읽기·백필이 같은 함수다(`dev-backend/utils/allDayDate.js` · `dev-frontend/src/utils/allDayDate.ts`).
  «워크스페이스 tz 로 추정» 은 틀렸다 — 운영에 기기가 워크스페이스보다 동쪽인 조합(ws 5 = KL, 사용자 = KL, 서울 저장)이 실존한다.
- **목록 범위 ±1일은 rrule `between` 에만** — 비반복은 |offset|<24h 면 항상 겹친다.
- **배포 순서: 코드 → 재시작 → 백필**(`scripts/deploy-planq.sh post_restart_backfills`). 반대면 옛 코드가 새 행을 «구글 end D+2» 로 읽는다.
- 백필은 `updated_at` 을 보존한다(알림 cron 의 «저장 시각보다 앞선 발송은 버린다» 판정이 읽는다).
- 시간 일정 반복의 UTC 전개(서울 08:00 매주 수 → 목 08:00)는 **따로** — 회차 키 이동·자기 백필이 따라오는 별도 R=1.

반영 위치: 서버 쓰기(`event_actions.createEvent` · `calendar.js` PUT·회차 분기) · 구글(`google_calendar.allDayStartDateStr/allDayEndDateStr` ·
`personalCalendar` · `calendarReverseSync` Z 명시) · 알림(`calendarReminderCron` 날짜·그 시간대 날짜 끝·지난 회차 다음으로 · 표시 UTC) ·
`eventNotify.whenText` · `today_review` · AI(`create_event` 입력 = 앞 10자, 출력 `date`/`end_date`) · 공개 페이지(워크스페이스 tz) ·
화면(`calTz.useWallEvents` 종일 변환·회차 back 맵 · `EventDrawer`·`NewEventModal`·`PersonalEventDrawer`·`taskToEvent`) ·
헬스체크 `--category=calendar` «옛 부호화 0건» · 카나리 `--suite allday`.

자체 검증(2026-10-07): 실HTTP 21/21 · AI 도구 오프셋 입력 · 백필 dev 왕복(키 이동·updated_at 보존·멱등·--revert) ·
실브라우저 서울·KL·LA × 3폭 10/10 · **양성 대조군**(옛 표시 코드 빌드를 가로채기로 끼움) → LA 3폭 하루 일정이 «19·20일» 로 번져 5건 실패.
