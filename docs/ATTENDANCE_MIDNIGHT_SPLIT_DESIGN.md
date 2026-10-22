# 근태 자정 분할 — 설계 (Fable DESIGN-READY · 2026-10-22)

> Irene 2026-10-21: «12시가 지나면 미출근 상태가 되는 거야? 그냥 12시에 퇴근 찍히고 다시 출근하는 걸로 기록할 수 없어? … 아까 업무에서 진행시작 누르면서 출근 되었는데»
> 초안 [Opus] 2026-10-21 → Fable 설계 판정 2026-10-22 (한도로 두 번 미뤄졌다가 세 번째에 받음). 아래 §2 가 판정 원문 정리다.

## 1. 지금 무슨 일이 나는가 (코드 사실)
- 하루 = `attendance_days` 행(work_date = 워크스페이스 tz 날짜). `GET /api/attendance/today` 는 **오늘 행만** 본다 → 0시에 «미출근».
- 매시 5분 `services/attendanceAutoClose.runAttendanceAutoClose` 가 어제 이전 열린 행을 `clockOut(source auto_close, at=guessCloseAt)` 로 닫는다(`auto_closed=true` → «자동 마감됨 · 정정 요청» 경고 뱃지, 통계 `auto_closed_count`).
- ★ `clockOut` 끝의 `stopActiveFocus(userId,'clock_out')` 가 **업무 측정까지 멈춘다** → 자정 넘어 일하던 사람은 00:05 에 근태도 타이머도 끊긴다. 범위가 없어 **00:02 에 새로 시작한 오늘 세션까지 끊는다**(지금도 있는 결함).
- 오늘 행은 출근 버튼·업무 «진행 시작»(auto_focus) 때만 생긴다.
- 급여는 근태 행을 읽지 않는다.

## 2. 결정 (Fable)
1. **«아직 일하고 있다» 술어** `stillWorkingAcrossMidnight({businessId,userId,midnight,now})` =
   ① 같은 ws·사람의 `FocusSession state='active' ∧ last_activity_at ≥ now − GRACE_SEC(300)` 존재 **그리고**
   ② 같은 ws·사람의 세션이 자정을 걸쳤다: `started_at < midnight ∧ (ended_at IS NULL ∨ ended_at ≥ midnight)`.
   `GRACE_SEC` 은 `FocusSession.computeActualSeconds` 와 같은 상수. paused 는 살아 있지 않다. 측정 없이 출근 버튼만 누른 사람은 퇴근 누락과 구별 불가 → 종전 auto_close.
2. **source `auto_midnight`**(ENUM 끝 append) — 어제 clock_out·오늘 clock_in 둘 다. `auto_closed`·`admin_fixed` 안 켠다. 화면은 i18n `fix.source.auto_midnight` 만(ko «자정 이어서» / en «Continued past midnight»). `autoClockInNotice` 는 auto_focus 만 보므로 자정 행에 되돌리기 모달이 뜨지 않는다(검증으로 못 박음).
3. **휴게 중 자정** — 분할 안 함(`day.state==='working'` 일 때만). 종전 auto_close.
4. **즉시 분할** — `ensureMidnightSplit({businessId,userId,now})` 한 함수. 부르는 곳: `GET /today`(오늘 행이 없을 때) · `autoClockInOnFocus`(clockIn 앞) · `runAttendanceAutoClose`(auto_close 전에 먼저, 분할됐으면 건너뜀). heartbeat 엔 안 건다.
   한 트랜잭션: 어제 → 오늘 순으로 잠금, 어제 `working` 재확인 → 어제 `clock_out(at=midnight)` → 오늘 행 없으면 생성 + `clock_in(at=midnight)`(있으면 오늘은 그대로) · 둘 다 `recomputeDay` · audit `attendance.midnight_split` · broadcast 두 행.
   **`clockOut()` 을 부르지 않는다**(업무 측정 유지) — `appendEvent`+`recomputeDay` 직접.
   ★ 같이 막는 구멍: `stopActiveFocus(opts.startedBefore)` — auto_close 는 `{businessId, startedBefore: nextMidnight}` 로만 끊는다(사람이 누른 퇴근은 종전대로 전부). `guessCloseAt` 은 `started_at < nextMidnight` 세션만 보고 `min(best, nextMidnight)` 로 캡(어제 퇴근 > 오늘 출근 역전 방지).
   자정 시각은 `utils/datetime.startOfDayInTz(dateStr, tz)`(오프셋 손으로 쓰지 않는다, DST 날 한 번 더 보정).
5. **통계(`GET /stats`) 최소 범위** — 기간 내 `source='auto_midnight'`(무효 제외) 이벤트를 day 별로 묶어:
   `work_days` = 그날 clock_in 이 전부 auto_midnight 이면 안 센다 · `avg_clock_in` 표본 = 첫 비-auto_midnight clock_in(없으면 제외) ·
   `avg_clock_out` 표본 = clock_out_at 이 auto_midnight clock_out 과 같으면 제외 · work/break 초 합·overtime(행 단위)·auto_closed_count 불변.
   범위 밖(기존 결함): `minutesOf` 가 서버 로컬 시각.
6. **동시성·멱등·tz** — 잠금 어제→오늘, 재확인으로 두 번째는 no-op · 오늘 행 생성이 unique 에 걸리면 롤백 후 null(상대가 이김) · `now` 인자 주입 · tz 는 `workspaceTz` 한 곳 · 어제보다 오래된 열린 행은 종전 auto_close.
7. **검증 사례** ① 본안 ② 멱등 ③ 업무 전환(switch) ④ 대조군: 죽은 세션 → 분할 없음·auto_close·미출근 재현 ⑤ 대조군 2: 자정 뒤 시작한 세션만 → 분할 없음·그 세션은 살아남음·어제 퇴근 ≤ 자정 ⑥ 휴게 중 ⑦ 오늘 행 이미 있음 ⑧ tz 두 곳 + DST ⑨ 통계 ⑩ 옛 데이터 불변 ⑪ 화면 라벨·위젯. 회귀 health-check `attnmidnight`(①④).
8. **운영** — `scripts/migrate-attendance-midnight.js`(ENUM append, 멱등) · 배포 슬롯(코드보다 먼저). 백필 없음. 롤백 = 코드만.
