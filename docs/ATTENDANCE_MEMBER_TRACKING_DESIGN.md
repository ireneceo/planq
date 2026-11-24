# 멤버별 «출퇴근 안 함» — 근태 대상 여부 (2026-11-24)

> Irene: *"내가 출퇴근을 하는 워크스페이스가 있고 출퇴근 안하는 그냥 일만 봐주거나 연결되어 있는 경우가 있어. 멤버별로 출퇴근 설정을 다르게 할 수 없어?"*

## 0. 지금 있는 것 / 없는 것
| 있는 것 | 범위 | 모자란 점 |
|---|---|---|
| 근태·휴가 끄기(`services/modules` attendance) | 워크스페이스 전체 | 한 사람만 뺄 수 없다 |
| 근무 일정 사람별 «따름 / 적용 안 함(유연) / 따로»(45ac5f8f) | 지각·미출근 **판정**만 | 출근 묻기·자동 출근·위젯은 그대로 — «유연» 은 «출퇴근은 한다, 시간만 자유» |
| 개인 설정 자동 출근(`users.auto_clock_in_on_focus`)·출근 묻기(`users.attendance_prompt_on`) | **계정 전체**(모든 워크스페이스) | A 에서는 출근, B 에서는 안 함 을 못 한다 — 이 요청의 핵심 |

→ 빠진 것: **«이 워크스페이스에서 이 사람은 출퇴근을 기록하지 않는다»** 한 칸.

## 1. 결정
| # | 결정 | 이유 |
|---|---|---|
| D1 | 칸 `business_members.attendance_tracked BOOLEAN NOT NULL DEFAULT TRUE` | 사람 × 워크스페이스 단위가 바로 이 행. 기본 true = 지금 동작 그대로 |
| D2 | **바로 적용**(효력일 이력 아님) | 판정 규칙이 아니라 «기록을 만들지 말지» 다. 근무 일정(내일부터 이력)과 다른 칸 |
| D3 | 정하는 사람 = 대표·관리자(owner/admin). 본인은 못 바꾼다 | 근태 관리 정책이다(본인이 빠지면 관리가 안 된다). 대표 본인은 자기 것도 바꾼다(관리자이므로) |
| D4 | 끄면 그 사람·그 워크스페이스에서만: 출근/휴게 시작 403 `attendance_not_tracked` · 자동 출근(업무 몰입) 안 함 · 자정 분할 안 함 · 출근 묻기·어제 퇴근 확인 안 함 · 사이드바 위젯/요약 안 그림 · 동료 근무 점 없음 · 지각·미출근 판정 없음 | «출퇴근 안 함» 의 뜻 그대로 |
| D5 | 끄는 순간 열린 하루(근무중·휴게중)가 있으면 **그 시각으로 퇴근 처리**(source `admin`, 원장 이벤트·감사 남김) | 열린 채 두면 자동 마감이 밤에 엉뚱한 시각으로 닫고 «확인» 을 묻는다 — 더 이상 출퇴근 안 하는 사람에게 |
| D6 | 휴가는 그대로(신청·승인·잔여) · 지난 출퇴근 기록은 지우지 않고 관리자 화면에서 그대로 보인다 · 퇴근/휴게 끝은 막지 않는다(D5 뒤 레이스로 열린 행을 닫을 수 있게) | 기록 보존 · 휴가는 출퇴근과 별개 |
| D7 | 판정(judgeDays)은 **지금 꺼져 있는 사람을 통째로 뺀다**(과거 날짜 포함) | 이력 칸을 두지 않으므로(D2) 과거 날짜별 상태를 모른다. 꺼진 사람의 과거 지각이 통계에 남아 있으면 «대상 아닌데 지각» 으로 읽힌다. 다시 켜면 **켠 다음 날부터** 판정한다 — 켜기 전 날짜의 판정은 돌아오지 않는다(§5-2 · since 가 앞으로만 움직임 · 기록 원장은 그대로) |
| D8 | 술어 한 곳 `services/attendanceTracking.js` — `isTracked(bizId, uid)` · `untrackedSet(bizId)` · `setTracked(...)` | 라우트·서비스가 칸을 직접 읽지 않는다 |
| D9 | 화면이 아는 길: `/api/auth/me` 의 `attendance_tracked`(현재 워크스페이스) · `GET /today` 응답 `tracked:false` · 바뀌면 소켓 `attendance:tracking`(그 사람 `user:` 방, 신호만) → `refreshUser` | 위젯·묻기 창은 /me 값으로 숨는다 |

## 2. 서버
- 모델 칸 + `scripts/migrate-attendance-tracked.js`(멱등, 배포 슬롯 — 모델이 SELECT 하므로 코드보다 먼저).
- `PUT /api/attendance/members/:userId/tracking` {business_id, tracked} — owner/admin · 대상은 그 워크스페이스 직원 멤버(owner/admin/member) · 감사 `attendance.tracking_change`(old/new) · D5 · 소켓 신호. rate limit(writeLimiter 재사용).
- `GET /schedule` 관리자 응답 members[] 에 `tracked` 추가. 멤버 응답 `mine.tracked`.
- 막는 곳: `routes/attendance.js` clock-in(두 길)·break-start · `attendanceTransition.autoClockInOnFocus`·`ensureMidnightSplit` · `attendancePrompt.promptFor`(prompt_status `not_tracked`) · `/today` `tracked` · `/presence` 꺼진 사람 행 빼기 · `attendancePunctuality.judgeDays` 꺼진 사람 빼기(todayFlags·attachToDays·통계가 따라온다).
- `/stats` 관리자 목록: 꺼진 사람에 `tracked:false` 표시(행은 남김 — 지난 기록·휴가 집계).

## 3. 화면 (ko/en)
- 설정 › 근태 관리 › 근무 일정 «사람별 일정» 줄마다 스위치 «출퇴근 기록» (켬 기본). 끄면 «출퇴근 안 함» 꼬리표 + 그 줄 일정 선택 흐리게. 끄기는 `ConfirmDialog`(열린 근무가 있으면 지금 퇴근 처리된다고 적음). 켜기는 바로.
- 본인 근태 페이지: 꺼져 있으면 오늘 카드 자리에 «이 워크스페이스에서는 출퇴근을 기록하지 않아요» 한 줄(휴가 탭 그대로).
- 사이드바 출퇴근 위젯·상태 요약·출근 묻기 창: /me `attendance_tracked === false` 면 안 그림.
- 팀 현황: presence 에서 빠지므로 근무 점·지각/미출근 합계에서 자연히 빠짐.

## 4. 검증
- 실HTTP: 끄기 → clock-in 403 · break-start 403 · clock-out 200(열린 행) · /today tracked false·prompt null · presence 에서 빠짐 · todayFlags/stats 지각 0 · 관리자 아님 403 · 남의 워크스페이스 사용자 404 · 다시 켜기 → 정상 · D5 열린 하루 퇴근 처리 · 감사 로그.
- 자동 출근: autoClockInOnFocus 가 null.
- 화면 3폭(owner 설정 스위치 / member 위젯 사라짐).

## 5. Fable 설계 판정 반영 (2026-11-24 · NEEDS-CHANGE 6건 → 반영)
1. **D5 닫기**: `clockOut()` 을 쓰지 않는다(범위 없는 `stopActiveFocus` 가 다른 워크스페이스 업무 측정을 끊는다). `attendanceTransition.closeOpenDayQuietly` — source `admin_fix` + 고정 사유 «출퇴근 기록 안 함으로 바뀜» · 측정 안 건드림. 그 사람×워크스페이스의 열린 행 **전부**: 오늘 것은 지금, 지난 날 것은 `guessCloseAt`(그날 자정 상한).
2. **D7 다시 켜기**: `business_members.attendance_tracked_since DATE` — 켤 때 오늘(워크스페이스 날짜). `judgeDays` 의 판정 시작 = max(합류+1, since+1). 꺼 둔 동안이 미출근으로 뜨지 않는다. `todayView` 는 꺼졌으면 기준 시각도 없다.
3. **presence**: 꺼진 사람 행을 빼지 않고 `tracked:false`(state null · 휴가 유지 · 판정 없음). 화면 `PresenceState 'untracked'` — 점 없음, 팀 현황 «출퇴근 안 함».
4. **활동 흔적**: `/today` 는 꺼졌으면 자정 분할·첫 진입·묻기·판정 전에 끝낸다(`notTrackedToday`) · `attendancePrompt.touch` 가 건너뛴다 · `POST /prompt-answer` 403.
5. **Cue 문맥**: `getHrSnapshot` `me.not_tracked` → «출퇴근을 기록하지 않는 사람 — 출근 여부를 말하지 않는다».
6. **D3**: 자기 것은 대표(owner)·플랫폼 관리자만. 관리자(admin) 본인은 403 `self_change_not_allowed`.
- 비차단 반영: 자동 마감 cron 은 그대로(레이스로 남은 행은 auto_close, 확인 묻기는 promptFor 가 막음) · 사유 쓰기/인정은 판정이 없어 자연히 409 `no_issue` · 끄기 확인 문구에 «꺼 둔 동안 통계에서 빠짐 · 다시 켜면 다음 날부터» · 화면 게이트는 `utils/workspaceModules.attendanceTrackedHere` 한 헬퍼(위젯·상태 요약·묻기 창 — 동료 점은 각 사람의 tracked 로).
- 운영: `migrate-attendance-tracked.js`(배포 슬롯 등록, 두 칸) · 회귀 `node scripts/e2e/run.js --suite attntracking`.
- 완료 검증(Fable) PASS — 차단 0. 비차단 반영: `/stats` members[].tracked 추가 · dev 시험 잔여 since NULL 로 · D7 문장 정정. 남김: `untrackedSet`(빠진 멤버 포함)과 `isTracked`(활성만) 범위 차이 — 유니크 키(business_id,user_id)라 영향 없음.
