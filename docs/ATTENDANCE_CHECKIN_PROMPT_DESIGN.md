# 출근 묻기 · 시각 수정 표시 · 관리자 확인 설계

> Irene 2026-11-20: «그 날 솔루션에서 소통하거나 뭔가 하면 너 출근했냐고 물어보면 안돼? 꼭 업무진행할 때만 물어보는게 아니고 로그인 움직임 포착 등 포인트에서. 그리고 몇 시부터인지 표시하고 수정도 하면 좋겠어. 찍히는 시간이 항상 팩트가 아니잖아. 대신 수정을 했다고 표시하고 수정한 거 확인하는 걸 관리자가 체크하는 거지. 설정에서 승인할지 말지 표시하고. 뭔가 데이터가 지금 엉망으로 쌓여.»
> 정본 관계: `docs/ATTENDANCE_LEAVE_DESIGN.md` §4.1 전이·§4.3 자동마감·§6 열람범위를 바꾸지 않고 더한다. 상태를 바꾸는 길은 계속 `services/attendanceTransition.js` 한 곳.
> 판정: Fable design · DESIGN-READY (2026-11-20, 방 b6a57761) · 상태: **Irene 진행 승인 대기**

확인 못 한 것(구현 방이 먼저 확인): 운영 DB 실측(이 방에서 권한 막힘) · `businesses.work_hours` JSON 실제 모양(가용시간 계산이 이미 읽는 함수를 쓴다) · 화면이 자동으로 부르는 쓰기 요청 전체 목록(§4.2).

## 1. 진단 — 왜 엉망인가

| 증상 | 원인 (코드로 확인) | 이 설계가 푸는 방법 |
|---|---|---|
| 출근 시각이 실제보다 늦다 | 출근을 찍는 길이 사실상 «업무 측정 시작» 하나(`autoClockInOnFocus`). 그 전에 대화·메일·문서로 일한 시간이 빠진다 | 그날 처음 들어온 시각을 기억해 두고 «09:12 부터 출근하셨어요?» 로 묻는다 |
| 퇴근 시각이 사실과 다르다 (개발 DB 자동마감 92%) | `guessCloseAt` 이 «마지막 근태 이벤트»와 «마지막 업무 측정 활동» 중 늦은 쪽만 본다. 버튼으로 출근하고 측정을 안 쓴 사람은 퇴근 = 출근 시각이라 0시간, 측정을 일찍 멈춘 사람은 오후가 통째로 빠진다 | 마지막으로 뭔가 한 시각을 추정에 더하고, 다음 날 첫 진입 때 «어제 19:42 에 닫았어요. 맞나요?» 를 한 번 묻는다 |
| 고쳐도 계속 «자동 마감됨» | `recomputeDay` 가 `auto_closed` 를 내리지 않고, 통계 `auto_closed_count` 도 고친 날을 계속 센다 | «본인이 확인/수정한 자동마감» 구분 칸 하나. 통계는 «미확인 자동마감» 만 센다 |
| 본인 정정이 관리자 정정과 구별 안 됨 | 본인 정정도 원장에 `admin_fix` 로 남고 화면 뱃지도 하나(`admin_fixed`) | 정정 요청 표 하나로 «본인 수정 · 원래 값 → 고친 값 · 확인 상태» 를 보여 준다 |

출근만 묻고 퇴근을 그대로 두면 근무시간 합계는 계속 틀리므로 2단계로 같이 넣는다.

## 2. 원칙

1. **기계가 본 값과 사람이 말한 값을 구분해 남긴다.** 기계가 본 시각을 그대로 받으면 수정이 아니다. 다른 시각을 넣으면 «본인 수정».
2. **묻는 것은 하루 한 번, 일을 막지 않는다.** 답을 안 해도 모든 기능은 그대로.
3. **답은 서버에 남긴다.** 폰에서 답하면 컴퓨터에서 또 묻지 않는다.
4. **첫 진입·마지막 활동 시각은 본인 것이다.** 관리자·동료에게 보여 주지 않는다(§6 FocusSession 계약과 같은 선). 본인이 받아들여 출근 시각이 된 뒤에만 근태 기록으로 보인다.
5. **기본값은 지금 동작 그대로.** 승인 설정 기본 끔(#392 유지), 자동 출근 유지.

## 3. 출근 묻기

### 3.1 «첫 움직임» 을 한 곳에서 판정
- 판정 자리: 서버 `GET /api/attendance/today`(위젯·모바일 카드가 앱 시작·화면 복귀 때마다 부른다). 응답에 `prompt` 를 더하고, 화면은 값이 있으면 묻기만 한다.
- **로그인은 신호로 쓰지 않는다** — 로그인이 7일 유지되므로 `last_login_at` 은 매일 생기지 않는다. «로그인·움직임 포착» 의 실체 = «그날 처음 앱을 보이는 상태로 연 것».
- 화면은 `document.visibilityState === 'visible'` 일 때만 `visible=1` 을 붙인다. 서버는 그때만 첫 진입 시각을 기록(숨은 탭이 소켓 신호로 다시 읽어 새벽 2시가 첫 진입이 되는 것을 막음).
- 묻는 창은 메인 창에서만(팝아웃 제외). 판정 함수 `services/attendancePrompt.js` `promptFor({businessId, userId, now})` 하나.

### 3.2 묻는 조건 (전부 참일 때만 `prompt.kind = 'check_in'`)

| 조건 | 값 |
|---|---|
| 근태 기능 켜짐 | `moduleOnFor(biz, 'attendance')` |
| 멤버(고객·AI 제외) | 기존 `requireMember` |
| 개인 설정 «출근 묻기» 켬 | `users.attendance_prompt_on` 기본 true |
| 오늘 근태 행 없음 | 퇴근 뒤 다시 들어온 사람은 묻지 않음 |
| 오늘 승인된 종일 휴가 아님 | 반차·시간 단위 휴가는 묻는다 |
| 근무일·근무시간대 | 그 요일 `work_hours` 시작 2시간 전 ~ 끝. 쉬는 요일·공휴일 제외. 비어 있으면 평일 07:00~20:00(워크스페이스 시간대) |
| 오늘 답 상태 | «오늘은 안 해요» 면 끝. «아직이에요» 면 1시간 뒤 다음 진입 때 다시. 하루 최대 3번, 3번째 «아직» = «오늘은 안 해요» |

조건 밖에서도 위젯 «근무 시작» 버튼과 자동 출근은 그대로.

### 3.3 묻는 모양 — 작은 확인 창 한 번
기존 자동 출근 알림과 같은 `StandardModal`(Irene 2026-08-24 «계속 남는 배너 말고 팝업으로 알리고 닫게»).

```
출근하셨어요?
오늘 09:12 에 처음 들어오셨어요.
[ 09:12 부터 출근 ]   [ 시각 고치기 ]   [ 아직이에요 ]   오늘은 안 해요
```
- 09:12 부터 출근: 기계 값 그대로, 수정 표시 없음.
- 시각 고치기: 창 안 시각 칸(오늘 0시 ~ 지금). 사유는 서버가 «출근 확인 때 시각 고침» 자동. «본인 수정» 표시(§5).
- 아직이에요: 1시간 조용 · 오늘은 안 해요: 오늘 끝.
- 처음 들어온 지 5분 안이면 «지금(09:12) 출근으로 기록할까요?».
- `submitting` 두 번 눌림 방지 · ko/en `attendance` 네임스페이스 · 모바일 버튼 높이 48 이상.

### 3.4 자동 출근(auto_focus)과의 관계 — 유지
- 앱을 열면 묻는 창이 먼저 뜨므로 대부분 측정 전에 출근이 끝나고, 자동 출근은 «아직»·«안 물은 날»·«묻기 끔» 의 안전망.
- 다른 기기에서 출근되면 소켓 `attendance:updated` → `/today` 재조회 → `prompt` 없어져 창 닫힘.
- 자동 출근 알림 창에 «시각 고치기» 버튼(기존 `CorrectDayModal`). 첫 진입이 자동 출근보다 10분 넘게 이르면 «오늘 09:05 부터 들어와 계셨어요» + 출근 칸 미리 채움.

### 3.5 API

| 경로 | 바뀌는 것 |
|---|---|
| `GET /today?business_id=&visible=1` | `prompt: { kind:'check_in', proposed_at, first_seen_at } \| null`, `close_check`(§4) 추가. `visible=1` 이면 첫 진입 기록 |
| `POST /clock-in` | `{observed:true}` → 서버가 기록한 첫 진입 시각(화면 값 안 믿음). `{at}` → 본인 수정(오늘 0시 ≤ at ≤ 지금+1분). 둘 다 없으면 종전대로 |
| `POST /prompt-answer` `{business_id, answer:'later'\|'not_today'}` | 답 기록. `clockLimiter` · `requireModule` |
| `GET/PUT /settings` | `attendance_prompt_on` 추가 |

## 4. 퇴근 — 같이 다룬다

### 4.1 다음 날 첫 진입 때 한 번 확인
`/today` 가 `close_check: { day_id, work_date, clock_out_at }` — «가장 최근 근무일 하나가 자동 마감 ∧ 미확인·미정정 ∧ 14일 이내». 가장 최근 하루만, 나머지는 근태 페이지에서. 출근 묻기와 같은 창 윗칸.

```
어제(11/19) 퇴근을 안 누르셔서 19:42 에 닫아 두었어요.
[ 맞아요 ]   [ 시각 고치기 ]
```
- 맞아요 → `POST /days/:id/confirm-close` → `close_confirmed_at = 지금`.
- 시각 고치기 → 마지막 퇴근만 바꿔 본인 정정(§5), 사유 «퇴근 누락 — 다음 날 확인» 자동.
- 근무시간대 조건과 무관하게 그날 첫 진입에 한 번. «나중에» 는 1시간 규칙.

### 4.2 자동마감 추정 고치기
`guessCloseAt` = max(마지막 근태 이벤트, 마지막 업무 측정 활동, **그날 마지막으로 뭔가 한 시각**), 다음 자정 상한 유지.
- `last_act_at` 은 **사람이 직접 한 쓰기**에서만: 메시지 보내기 · 업무 만들기/고치기/상태 · 댓글 · 문서 저장 · 메일 보내기 · 업무 측정 시작. 각 라우트가 워크스페이스 확인 뒤 `attendanceActivity.touch({businessId, userId})` 한 줄.
- **전역 훅 금지** — 숨은 탭 주기 호출·토큰 갱신·heartbeat 가 활동으로 잡혀 퇴근이 자정으로 밀린다. AI 앱·에이전트·cron 쓰기도 제외.
- `touch` 는 (워크스페이스·사람)당 5분에 한 번만 DB 쓰기, 실패해도 던지지 않음.
- 구현 방 선조사: 위 라우트 중 화면이 자동으로 부르는 쓰기(자동저장·읽음)를 가려 사람이 누른 것만.

### 4.3 통계
`auto_closed_count` = **미확인 자동마감**(`auto_closed ∧ close_confirmed_at IS NULL`), 라벨 «확인 안 된 자동 마감». 읽는 화면(TeamTab·통계) 문구와 e2e 를 같은 커밋에서.

## 5. «몇 시부터» 표시 · 본인 수정 · 수정 표시
- 표시: 위젯·모바일 카드 근무중 줄에 «09:12 부터 ✎» → 기존 `CorrectDayModal`(`PATCH /days/:id/correct`, 가드 종전대로).
- **수정 표시의 원천 = 새 표 `attendance_fix_requests`.** 본인이 시각을 바꾸는 세 길(묻는 창 / 어제 퇴근 / 정정 창)이 모두 한 행: 원래 값 스냅샷 · 고친 타임라인 · 사유 · 상태.
- 화면: 근태 페이지·팀 표 출근/퇴근 칸에 «본인 수정» 뱃지 → «원래 10:12 → 09:05 · 사유 · 미확인 / 확인함(김오너 11/20) / 승인 대기 / 반려(사유)». `admin_fixed` 뱃지는 «관리자 정정» 뜻으로만. 모르는 상태값은 값 그대로 보인다.
- 원장 `source` ENUM 은 늘리지 않는다(본인 정정 = `admin_fix` + `actor_user_id = 본인`, 구분은 요청 표).
- 옛 본인 정정은 채워 넣지 않는다.

## 6. 관리자 «확인» 체크 · 설정 «본인 수정은 승인 후 반영»

### 6.1 두 모드

| | **끔 (기본 · 지금과 같음)** | **켬** |
|---|---|---|
| 본인이 고치면 | 바로 반영, `applied`(미확인) | 반영 안 됨, `pending`. 통계·화면은 기계 값 |
| 묻는 창에서 출근 시각을 고치면 | 고친 시각으로 출근 | 기계 시각으로 출근 + 고친 시각은 승인 대기 |
| 관리자 | «확인함»(`confirmed`), 여러 건 한 번에. 동의 안 하면 관리자 정정으로 고침 | 승인(`approved`, `applyAdminFix` 로 반영) / 반려(`rejected`, 사유 필수) |
| 본인에게 | «본인 수정 · 미확인/확인함» | «승인 대기 — 지금은 10:12 로 계산돼요» / 반려 사유 |

- 급여는 근태 시간을 읽지 않는다(`docs/PAYROLL_DESIGN.md` 는 승인된 무급휴가만) — 영향은 근태 통계·Cue 문맥까지. 급여가 근무시간을 읽게 되면 유효 타임라인만 읽고 대기 남은 달은 마감 전 경고(그때 별도 설계).
- **#392 와의 관계**: 이유(«승인자가 사실을 확인할 방법이 없다 · 실무가 막힌다»)는 여전히 맞아 기본 끔. 선택지를 더한 것. `routes/attendance.js` #392 주석에 이 문서 링크.
- 한 날에 대기 한 건 — 다시 고치면 앞 요청 `withdrawn`. 본인이 대기를 거둘 수 있다.
- 자기 것은 자기가 못 정한다 — 관리자 본인 요청은 다른 관리자가. 대표(owner)는 즉시 반영 + 감사 로그(휴가 승인 §4.2 선례).
- 켬→끔: 대기 건은 그대로 대기(승인/반려 가능), 설정 화면에 «대기 n건». 끔→켬: 지난 `applied` 불변.

### 6.2 데이터 모델 — 새 표 2개 · 새 칸 3개

**`attendance_fix_requests`**: id · business_id · user_id · attendance_day_id · work_date · origin VARCHAR(16)(`prompt_in`·`prompt_out`·`manual`) · before JSON(`{clock_in_at, clock_out_at, work_total_sec}`) · events JSON(`applyAdminFix` 입력) · reason VARCHAR(300) · status VARCHAR(16)(`applied`·`pending`·`confirmed`·`approved`·`rejected`·`withdrawn`, 문자열 + 서버 상수) · decided_by · decided_at · decide_note · created_at · updated_at. 인덱스 `(business_id, status, work_date)` · `(attendance_day_id)`.

**`attendance_activity`** ((business_id, user_id, work_date) 유일): first_seen_at · last_act_at · prompt_answer VARCHAR(16) · prompt_count · prompt_snooze_until. 본인 전용 — 팀·통계·presence 응답에 싣지 않는다. 90일 지난 행은 자동마감 cron 이 지운다.

**새 칸**: `attendance_days.close_confirmed_at DATETIME NULL` · `businesses.attendance_fix_approval BOOLEAN NOT NULL DEFAULT 0` · `users.attendance_prompt_on BOOLEAN NOT NULL DEFAULT 1`.

마이그레이션은 표 만들기 + 칸 더하기뿐(멱등), 기존 행 불변. 배포 슬롯 등록 · `.claude/rules/db-schema.md` 에 한 줄씩.

### 6.3 API (`authenticateToken` + `requireModule('attendance')` + 멤버 확인)

| 경로 | 권한 | 동작 |
|---|---|---|
| `PATCH /days/:id/correct` (기존) | 본인 | 끔: 반영 + `applied`. 켬: `pending`, 응답 `pending:true` |
| `POST /days/:id/confirm-close` | 본인 | §4.1 |
| `GET /fix-requests?business_id=&status=&scope=mine\|all` | mine 본인 / all 대표·관리자 | `parsePagination`. 이름은 워크스페이스 표시명 |
| `POST /fix-requests/confirm` `{ids:[]}` | 대표·관리자 | `applied → confirmed`(다른 상태는 건너뛰고 건수 반환) |
| `POST /fix-requests/:id/approve` · `/reject` `{decide_note}` | 대표·관리자(자기 것 불가, 대표 예외) | 승인 = 요청자 이름으로 `applyAdminFix` + `approved` 한 트랜잭션. before ≠ 지금 값이면 409 `day_changed` |
| `POST /fix-requests/:id/withdraw` | 본인 | `pending → withdrawn` |
| 근태 설정 `attendance_fix_approval` | 대표·관리자 | 설정 › 근태 관리 기능 스위치 아래, 자동 저장 |

`guard-invariants --category=duproute` · `modulegate` 로 확인.

### 6.4 관리자 화면
설정 › 근태 관리(`AttendanceAdminSettings.tsx`)에 **«확인할 정정»**: 사람 · 날짜 · 원래 → 고친 값 · 사유 · [확인함] 또는 [승인][반려], 맨 위 «모두 확인함»(끔 모드). 알림 링크 `/business/settings/attendance?date=` 그대로.

## 7. 실시간 · 알림 · 감사 · 권한
- 실시간: 하루가 바뀌는 길은 기존 `broadcast(day)`(`attendance:updated`). 정정 요청은 `attendance:fix_updated {request_id}`(신호만)를 **요청자와 대표·관리자 개인 방(`user:<id>`)에만**. 받는 화면 250ms 모아 재조회 + `useVisibilityRefresh`·`socket:reconnected`.
- 알림(인앱만, `previewPolicy:'internal_only'` — #407): 끔 모드는 정정 창(`manual`)만 종전대로 관리자 알림, 묻는 창 수정(`prompt_in`/`prompt_out`)은 목록에만. 켬 모드는 대기 → 관리자, 승인·반려 → 요청자. 메뉴 배지는 켬 모드 «승인 대기» 만(`.claude/rules/badges.md` 먼저 읽기).
- 감사 로그: `attendance.fix_request` · `fix_confirm` · `fix_approve` · `fix_reject` · `fix_withdraw` · `close_confirm` · 설정 변경. 묻기 답은 남기지 않는다.
- 권한: 확인·승인·반려·설정은 대표·관리자(`isManager`). 멤버 403, 다른 워크스페이스 403/404, 기능 꺼짐 404, 고객·AI 403. 조직 팀장에게는 넓히지 않는다.

## 8. Irene 에게 물을 것 — 없음 (Fable)
기본값(설정으로 바꿀 수 있고 데이터를 되돌릴 일 없음): 승인 필요 끔 · 승인 켬일 때 대기 중 값 = 기계 값 · 첫 진입·마지막 활동 시각 본인에게만 · 묻는 시간대 근무시간 2시간 전 ~ 끝(쉬는 날·종일 휴가 제외) · 자동 출근 유지.

## 9. 단계 — 각 단계가 그 자체로 끝난다

### 1단계 — 출근 묻기 + «몇 시부터» + 수정 표시
범위: `attendance_activity`(first_seen·묻기 답) · `attendance_fix_requests`(끔 모드 `applied`) · `users.attendance_prompt_on` · `/today` `prompt` · `/clock-in` observed/at · `/prompt-answer` · 묻는 창 · 위젯 «09:12 부터 ✎» · 자동 출근 알림 «시각 고치기» · «본인 수정» 뱃지 · 개인 설정 토글 · ko/en.
증명(포트 3003, ws 6): `/today?visible=1` → `prompt.kind=check_in`, 재호출에도 `first_seen_at` 불변 · `visible` 없으면 기록 안 됨(음성 대조군) · `clock-in {observed:true}` → `clock_in_at == first_seen_at`, 요청 행 0 · `{at: 30분 전}` → 그 시각 + 요청 행 `applied`(before 채움) + 원장 일치 · 경계(`at` 미래 400 · 어제 400 · «아직» 1시간 안 null · 3번째 null · «오늘은 안 해요» null) · 제외(종일 휴가·쉬는 요일 null · 기능 끔 404 · 고객 403 · 개인 설정 끔 null) · 두 세션 동기 · 화면 3폭(`elementFromPoint` + 스크린샷, 사이드바 접힘에서도 뜸, 팝아웃은 안 뜸).

### 2단계 — 퇴근 확인 + 추정 개선
범위: `close_confirmed_at` · `close_check` · `confirm-close` · 어제 퇴근 고치기 · `touch` 호출처 · `guessCloseAt` last_act · 통계 «미확인 자동마감» · 90일 정리.
증명: 어제 열린 날 + `runAttendanceAutoClose()` → 버튼 출근 + 메시지만 보낸 사람 퇴근 = 마지막 메시지(±5분), `touch` 뺀 대조군은 0시간(양성 대조군) · 자정 상한·자정 분할 그대로 · «맞아요» 뒤 사라짐 + 미확인 −1 · 고치기 → 재계산 일치 + `prompt_out` · 자동 쓰기·AI 앱 쓰기 뒤 `last_act_at` 불변 · 팀 API·presence 원문에 `first_seen_at`·`last_act_at` 0건.

### 3단계 — 관리자 확인 + 승인 설정
범위: `attendance_fix_approval` · fix-requests 목록/확인/승인/반려/거두기 · 켬 모드 분기 · «확인할 정정» · 알림 · 실시간 · 감사.
증명: 끔 — 정정 즉시 반영 → owner confirm → `confirmed`·decided_by, member confirm 403 · 켬 — 정정 `pending` 값 불변 → approve 반영(원장 요청자 이름), reject 값 불변 + 알림 1, 재요청 → 앞 건 `withdrawn` · 켬 + 묻는 창 수정 → 기계 시각 + 대기 1 · 관리자 자기 승인 403, 대표 즉시 + 감사 · 409 `day_changed` · 켬→끔 뒤 대기 승인 가능 · ws7 관리자 403/404 · 2탭 1초 안 · member2 소켓에 `attendance:fix_updated` 없음 · 메일·푸시 로그 0 · 가드(health-check · build · guard-invariants · e2e tenant).
**Fable 완료 검증 1회**(3단계 끝, 묻는 창 화면 점검 묶음). 1·2단계는 자체 검증.

## 10. 깨질 수 있는 곳
1. 묻는 창이 하루 종일 따라다님(2026-09-07 자동 출근 알림 선례) — 답은 서버, `prompt` 있을 때만 그림, 접힘 분기보다 위에서 렌더.
2. 숨은 탭·자동 호출이 활동으로 잡힘 — `visible=1` 과 명시 `touch` 만.
3. 켬 모드 승인 시점 충돌 — before == 지금 값일 때만, 아니면 409.
4. `auto_closed_count` 뜻 변경 — 읽는 화면·검사 같은 커밋.
5. 겸직 멤버 — 묻기·활동은 워크스페이스별.
