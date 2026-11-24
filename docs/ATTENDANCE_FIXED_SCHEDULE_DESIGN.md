# 근태 — 고정 근무 일정·지각 관리 설계 (Fable DESIGN-READY · 2026-11-24)

> Irene 2026-11-24: «출퇴근 시간이 정해진 경우 관리도 해야지. 지각도 체크되어야 하고. 출퇴근 시간 픽스된 경우. Fable 검토»
> 바꾸는 전제: `docs/ATTENDANCE_LEAVE_DESIGN.md` :13 «유연근무제 기준(고정 출근시각 강제 없음)» · :318 «avg_clock_in … 지각 판정 아님».
> → **워크스페이스가 «고정 근무» 를 고른 경우에만** 지각·조퇴·미출근을 판정한다. 고르지 않으면 지금과 한 글자도 다르지 않다.
> 판정: Fable design · DESIGN-READY (2026-11-24, 방 99d9a7b1) · Irene 에게 물을 것 없음(§10 기본값) → 1차 구현 같은 방.

## 0. 한눈에 — 결정 7개

| # | 결정 | 이유 |
|---|---|---|
| D1 | 근무 일정은 **근태 전용 새 표** `attendance_schedules` 에 둔다. `businesses.work_hours` 는 재사용하지 않는다(모양과 편집기만 같이 쓴다) | work_hours 는 예약 받는 시간·공개 영업시간·Cue 자동응답이 같이 쓴다. 가게가 9~21시 연다고 직원이 9시 출근은 아니다. 한 칸에 두 뜻을 실으면 한쪽을 고칠 때 다른 쪽이 조용히 바뀐다 |
| D2 | 일정은 **적용 시작일이 붙은 이력**(effective_from)이다. 바꾸면 **내일부터** 적용, 지난 날로는 못 넣는다 | 일정을 바꿔도 지난 판정이 안 바뀐다. 행이 없는 «미출근» 날도 같은 방법으로 고정된다 |
| D3 | 판정은 **저장하지 않고 조회 때 계산**한다 — 함수 한 벌 `services/attendancePunctuality.js` | 원장 정정·휴가 뒤늦은 승인·휴일 변경은 판정에 바로 반영돼야 한다(의도). 일정만 이력으로 고정하면 스냅숏 칸·백필이 필요 없다 |
| D4 | 미출근(결근)은 **계속 «행 없음»**. 근무 달력 − 근태 행 − 승인 휴가로 계산한다. 빈 행을 만들지 않는다 | 기존 원칙 유지. 기계는 행을 안 만들고, **사람이 사유·인정을 남길 때만** 새 표 `attendance_exceptions` 에 행이 생긴다 |
| D5 | 사람별 예외를 1차에 넣는다 — «워크스페이스 따름 / 적용 안 함(유연) / 따로 정한 시간» | 대표·파트타이머·시차 출근자가 첫날부터 «지각» 으로 찍히면 기능이 못 쓰게 된다 |
| D6 | 사유·인정 흐름은 **최소로** — 본인 사유 한 줄, 관리자 «인정» 토글. 인정된 날은 지각 횟수·분에서 빠지고 «인정» 으로 따로 센다 | 병원·교통 지연을 구별 못 하면 숫자가 관리에 쓸모없다. 승인 단계·결재선은 만들지 않는다 |
| D7 | 멤버는 **남의 지각을 어디서도 못 본다**. 팀 뱃지(presence)에도 넣지 않는다 | 근태 열람 범위 기존 계약 그대로(본인 + owner/admin) |

기본값: 새 표에 행이 없으면 = 유연 = **지금 동작 그대로**(기존 응답 칸 diff 0).

## 1. 범위 / 하지 않을 것

**1차**: 일정 설정(워크스페이스 + 사람별) · 지각/조퇴/미출근 판정 · 관리자 오늘 현황·날짜별 표·월 통계 · 본인 화면 표시 · 사유/인정 · 감사 로그.

**하지 않는다**: 급여 공제·수당 연결 · 지각 N회 = 연차 차감 같은 자동 불이익 · 법정 근로시간·연장근로 판정 · 위치·IP 출근 제한 · 외출·휴게 초과 판정(첫 출근·마지막 퇴근만 본다) · 교대·야간(자정 넘는 일정)·주차별 다른 일정 · 30분보다 잘게 · 메일·SMS(앱 알림도 2차) · AI 에이전트 표면 추가(`services/agent/registry.js` 무변경).

## 2. DB — 새 표 2개 (기존 칸 변경 0)

### 2.1 `attendance_schedules` — 근무 일정 이력
| 칸 | 형 | 뜻 |
|---|---|---|
| id | INT PK | |
| business_id | INT NOT NULL | |
| user_id | INT NULL | NULL = 워크스페이스 기본 · 값 있음 = 그 사람 예외 |
| effective_from | DATEONLY NOT NULL | 이 날부터 적용(워크스페이스 tz) |
| mode | STRING(10) NOT NULL | 워크스페이스 행: `flex`·`fixed` / 사람 행: `inherit`·`flex`·`fixed` |
| schedule | JSON NULL | `{mon:[9,18],…}` — work_hours 와 같은 모양(0.5h, 없는 요일 = 쉬는 날). `fixed` 일 때 필수 |
| grace_min | INT NOT NULL DEFAULT 0 | 유예(분). 0·5·10·15·30 만 |
| half_day_at | DECIMAL(3,1) NULL | 반차 경계 시각. NULL = 자동(§3.3) |
| created_by | INT NOT NULL | |

- unique `(business_id, user_id, effective_from)` — user_id NULL 은 MySQL unique 가 못 막으므로 **쓰기는 서비스 한 곳**(`attendanceSchedule.save`)에서 트랜잭션 + 잠금으로 upsert. 인덱스 `(business_id, effective_from)`.
- 검증 `services/booking` `normalizeWorkHours/serializeWorkHours` 재사용.

**그 날의 일정 찾기** `resolveSchedule(businessId, userId, date)` 한 함수: ① 사람 행 중 `effective_from ≤ date` 최근 것이 `flex`/`fixed` 면 그것 ② 없거나 `inherit` 면 워크스페이스 행 최근 것 ③ 그것도 없으면 `flex`.

### 2.2 `attendance_exceptions` — 사유·인정 (사람이 남길 때만 생김)
| 칸 | 형 | 뜻 |
|---|---|---|
| business_id, user_id, work_date | | unique 세 칸 |
| reason / reason_at | STRING(300) / DATE | 본인 사유 |
| excused | BOOLEAN DEFAULT false | 관리자 인정 |
| excused_by / excused_at / excuse_note | | |

하루 한 행 — 그날의 지각·조퇴·미출근을 한꺼번에 인정한다.

## 3. 판정 정의 — `judgeDays({businessId, userIds, from, to, now})` 한 벌

모든 시각은 **워크스페이스 tz 의 벽시계 분**(초 버림: 09:00:59 = 09:00). `/stats` 의 `minutesOf`(서버 로컬 시각)도 이번에 tz 기준으로 고친다.

### 3.1 판정 대상일 (하나라도 아니면 `applicable:false`)
- 그 날 일정이 `fixed` 이고 그 요일에 시간이 있다
- 워크스페이스 휴일이 아니다(`workspace_holidays` is_off — 날짜로)
- 승인된 **종일** 휴가가 없다
- 멤버로 있던 날(합류한 다음 날부터 ~ 빠지기 전날까지)

### 3.2 기준 기록
- **출근** = 유효 출근 기록 중 **`auto_midnight` 아닌 첫 것**(통계 «사람 출근» 과 같은 술어, 한 함수). 본인 수정은 **지금 원장에 유효한 값** — 승인 켬이면 승인 전까지 기계 시각, 끔이면 넣은 시각 + `self_fix_unconfirmed`.
- **퇴근** = 상태 `done` 일 때 마지막 퇴근. 자정 분할 24:00 은 조퇴 아님.

### 3.3 기준 시각
| 경우 | 기준 출근 | 기준 퇴근 |
|---|---|---|
| 보통 | 일정 시작 | 일정 끝 |
| 오전 반차 | 반차 경계 | 일정 끝 |
| 오후 반차 | 일정 시작 | 반차 경계 |

반차 경계 = `half_day_at`, 비면 `시작 + (끝−시작)/2 + 0.5h`(9~18 → 14:00), 일정 안쪽으로 자름.

### 3.4 결과
```
punct = { applicable, expected_in, expected_out, grace_min,
  in_status: on_time|late|not_yet|missing|no_show, out_status: ok|early|open|unverified|null,
  late_min, early_min, excused, reason, flags:{ self_fix_unconfirmed, midnight_tail } }
```
- 지각: 출근 분 > 기준 + 유예 → late, `late_min = 출근 − 기준`(유예는 문턱).
- 조퇴: 퇴근 분 < 기준 퇴근 → early(유예 없음). 근무 중 open · 자동 마감 미확인 unverified(추정으로 조퇴 세지 않음).
- 기록 없음: 오늘 기준+유예 전 not_yet · 그 뒤 missing · 지난 날 no_show · 자정 이어받기뿐이면 no_show + midnight_tail.
- 시간 휴가(시작 시각 칸 없음): 승인 시간 합 H 를 late_min 에서 먼저, 남으면 early_min 에서 뺀다.
- 승인 대기 휴가는 안 친다(승인되면 조회 때 저절로 바뀜).

### 3.5 일정이 바뀌면 — 지난 날·오늘 판정 모두 안 바뀐다(저장은 내일부터만).

## 4. API (모두 `requireMember` 뒤 · 고객·AI 403)

| 메서드·주소 | 누가 | 내용 |
|---|---|---|
| `GET /api/attendance/schedule?business_id=` | 멤버 자기 것 / 관리자 전부 | `{ mine, workspace:{current, upcoming}, members:[…] }` — upcoming·members 는 관리자만 |
| `PUT /api/attendance/schedule` | 관리자 | `{business_id, mode, schedule, grace_min, half_day_at, effective_from}` — 내일 이후만(400 `effective_from_must_be_future`), 같은 날짜면 덮어씀 |
| `PUT /api/attendance/schedule/members/:userId` | 관리자 | mode inherit·flex·fixed |
| `DELETE /api/attendance/schedule/:id` | 관리자 | 시작 전 행만, 시작된 행 409 |
| `GET /api/attendance/punctuality?business_id=&from=&to=&user_id=` | 멤버 본인 / 관리자 전원 | 최대 62일, **문제 있는 날만** — 행 없는 미출근 포함 |
| `POST /api/attendance/exceptions/reason` | 본인 | 14일 안, 판정 대상이고 문제 있는 날만 |
| `POST /api/attendance/exceptions/excuse` | 관리자(자기 자신 ✕, owner 는 가능) | `{business_id, user_id, work_date, excused, note}` |

기존 응답에 더하는 칸(유연이면 null): `/today` `schedule`+`punct` · `/my`·`/team` 행 `punct` · `/stats` `applicable_days, late_count, late_minutes, early_count, early_minutes, no_show_count, excused_count`(인정은 빼고 excused 로) · `/presence` 관리자만 `punct_today` · `/fix-requests` `punct_before/after`.
같이 고침: `attendancePrompt.workWindow` — 그날 일정이 fixed 면 근태 일정으로 묻는 창, 그 요일에 없으면 쉬는 날.

## 5. 화면
- 설정 › 근태 관리 «근무 일정»: 유연/고정 라디오 · 요일별 시간(기존 근무시간 편집기) · [예약 시간에서 가져오기] · 유예 · 반차 경계 · 적용 시작(내일~) · [저장] · «지금 적용 중 / ~부터 예정 [예정 취소]» · 사람별 일정(따름 / 적용 안 함 / 따로).
- 관리자 TeamTab: 오늘 현황 지각·미출근 수와 뱃지 · 날짜별 표 상태 열(+미출근 줄은 `/punctuality`) · [인정] · 월 통계 지각(횟수·분)·조퇴·미출근·인정. 유연이면 열이 아예 없다.
- 본인: 오늘 카드 «기준 09:00~18:00», 출근 뒤 «12분 늦음» · 내 기록 뱃지 + [사유 쓰기] · 미출근 날 줄 · 내 통계.
- 조용히 넘어가지 않기: 판정이 바뀌는 정정은 «확인할 정정» 에 «지각 25분 → 정상». 숫자 배지는 1차에 안 건드림.

## 6. 권한·감사·실시간
| 일 | 멤버 | owner/admin | 고객·AI |
|---|---|---|---|
| 내 일정·판정 | ○ | ○ | 403 |
| 남의 판정·사유 | ✕ | ○ | 403 |
| 일정 바꾸기 | ✕ | ○ | 403 |
| 사유 쓰기 | 본인 | 본인 | 403 |
| 인정 | ✕ | ○(자기 자신 ✕, owner 가능) | 403 |

감사: `attendance.schedule_change` · `schedule_member_change` · `schedule_cancel` · `exception_reason` · `exception_excuse`.
실시간: 판정 값을 소켓에 싣지 않는다. 일정 변경 → `business:` 방 `attendance:schedule` 신호 · 사유·인정 → 본인+관리자 `user:` 방. **기존 `broadcast(day)`(워크스페이스 전원) 페이로드에 punct 를 넣지 않는다.**

## 7. 단계
1차 — 위 전부 + 묻기 창 연결 + `minutesOf` tz 수정 + 회귀 검사. 2차 — 알림(본인 «출근 기록 없어요» 하루 1회 · 관리자 하루 1회 묶음, 앱 알림만) · 주간 보고·CSV.

## 8. 검증 사례 (월~금 09:00~18:00 · 유예 10 · 반차 경계 14:00 · Asia/Seoul)
| # | 상황 | 기대 |
|---|---|---|
| 1 | 09:00:59 출근 | on_time 0 |
| 2 | 09:10:59 | on_time |
| 3 | 09:11:00 | late 11 |
| 4 | 유예 0, 09:01 | late 1 |
| 5 | 오전 반차, 14:00 / 14:11 | on_time / late 11 |
| 6 | 오후 반차, 퇴근 14:00 / 13:40 | ok / early 20 |
| 7a | 시간 휴가 2h, 10:30~18:00 | on_time, ok |
| 7b | 2h, 11:30 출근 | late 30 |
| 7c | 2h, 10:00~16:30 | late 0, early 30 |
| 8 | 종일 휴가 날 출근 | applicable false |
| 9 | 휴일·토요일 | applicable false |
| 10 | 오늘 기록 없음 09:05 / 09:11 / 다음 날 | not_yet / missing / no_show |
| 11 | 10 의 날에 뒤늦게 종일 휴가 승인 | applicable false |
| 12 | 어제 01:30 까지 근무 → 오늘 09:20 출근 | 어제 ok · 오늘 late 20 |
| 13 | 12 에서 오늘 다시 안 옴 | no_show + midnight_tail |
| 14 | 자동 마감 15:00 미확인 → «맞아요» → 18:05 로 고침 | unverified → early 180 → ok |
| 15 | 기계 09:25, 본인 09:00 — 승인 끔 | on_time + self_fix_unconfirmed |
| 16 | 15 를 승인 켬으로 | 승인 전 late 25 → 뒤 on_time |
| 17 | 12/01 9~18, 12/15 10~19 · 12/10·12/15 09:30 출근 | late 30 · on_time |
| 18 | effective_from 오늘 PUT | 400 |
| 19 | 사람 예외 flex 12/08 부터 | 12/05 그대로, 12/08~ false |
| 20 | 08:55 출근·12:00 퇴근·13:00 재출근·17:30 퇴근 | on_time, early 30 |
| 21 | 18:30 근무 중 | open |
| 22 | 지각 인정 → 취소 | late_count 0·excused 1 → 되돌아옴 · 감사 2 |
| 23 | 12/10 합류 멤버 12/09·12/10 | 판정 안 함, 12/11 부터 |
| 24 | America/New_York, 14:05Z(현지 09:05) + 서머타임 | on_time |
| 25 | 멤버가 남 user_id · 멤버 presence · 고객 · 다른 ws · 모듈 끔 | 403 · 칸 없음 · 403 · 403 · 404 |
| 26 | 유연 워크스페이스 전후 | 기존 칸 diff 0, 새 칸 null |

양성 대조군: 유예 0 이면 2 가 late 로 뒤집힘 · punct 를 방송에 실으면 25 빨강.

## 9. 운영 마이그레이션
`scripts/migrate-attendance-fixed-schedule.js` — `CREATE TABLE IF NOT EXISTS` 두 개 + 인덱스(멱등). 배포 슬롯 코드보다 먼저, 백필 없음. 롤백은 코드만.

## 10. Irene 에게 물을 것 — 없음 (기본값)
1. 지각 유예 기본 0분 2. 고정 근무 켜면 대표 포함 전원(사람별 «적용 안 함» 가능) 3. 알림은 2차.

## 11. 구현 전 확인 (작업 모델, 2026-11-24)
1. `broadcast(day)` = `business:` 방 전원, 페이로드 user_id·work_date·state 뿐 → punct 안 싣는다.
2. 합류일 = `business_members.joined_at`(없으면 created_at) · 빠진 날 = `removed_at`.
3. `leave_requests` 에 시간 휴가 시작 시각 칸 없음(unit·half_kind·hours 뿐) → §3.4 합 빼기 그대로.

## 12. 완료 검증 (2026-11-24)
- **Fable 완료 검증 PASS** (방 99d9a7b1) — 판정 함수 37/37 · 실HTTP 권한·쓰기·사유/인정 · 빌드 EXIT 0 · health 101/101 · guard 86/87 · 실브라우저 3폭 39/39. 차단 0.
- 비차단 반영(작업 모델, 자체 검증): ① 인정에 멤버 확인 먼저(없는 사람 404 — 빈 행 안 만듦) ② 빠진 멤버도 «빠지기 전날까지» 판정(defaultScope 를 풀고 기간 시작 전에 빠진 사람만 뺌 — 11-20 에 빠진 사람: 11-19 late · 11-20~ not_member) ③ 사유·인정 쓰기 한도를 일정 저장과 따로(분당 120) ④ 사유·인정 감사 로그 target_type `attendance_exception`.
- 남긴 것: ⑤ 정정 목록 `punct_before` 는 시간 휴가 차감을 반영하지 않는 표시용 값 · 확인 못 함: §8-16(승인 켬 본인 수정 전후)·모듈 끔 404·소켓 실수신·운영 옛 데이터 대조.
- 구현에서 정한 작은 것: 화면은 «퇴근 시각 미확인» 뱃지를 따로 그리지 않음(같은 행에 «자동 마감됨» 이 있다) · 사유/인정 버튼은 지각·조퇴·미출근일 때만 · /stats 에 기록 없이 미출근만 있는 멤버도 행 · 부서 묶음에 late_count·no_show_count · 요일별 시간 편집기는 예약 설정에서 `components/Common/WeekHoursEditor` 로 떼어 둘이 같이 씀.
- 확인용 데이터(dev ws6): 워크스페이스 일정 «2026-11-16 부터 고정 월~금 09~18 · 유예 10»(API 는 내일 이후만 받아 DB 로 심음) · member1 11-19 사유 «[확인용] 병원».
