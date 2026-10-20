# 근태 자정 분할 — 설계 초안 (Fable 판정 대기)

> 상태: **초안 [Opus] — Fable 설계 판정 전. 이 문서대로 구현하지 않는다.**
> Irene 2026-10-21: «12시가 지나면 미출근 상태가 되는 거야? 그냥 12시에 퇴근 찍히고 다시 출근하는 걸로 기록할 수 없어? … 아까 업무에서 진행시작 누르면서 출근 되었는데»

## 1. 지금 무슨 일이 나는가 (코드 사실)
- 하루 = `attendance_days` 행(work_date = 워크스페이스 tz 날짜). `GET /api/attendance/today` 는 **오늘 행만** 본다 → 0시에 «미출근».
- 매시 5분 `services/attendanceAutoClose.runAttendanceAutoClose` 가 어제 이전 열린 행을 `clockOut(source auto_close, at=guessCloseAt)` 로 닫는다
  (`auto_closed=true` → «자동 마감됨 · 정정 요청» 경고 뱃지, 통계 `auto_closed_count`).
- ★ `clockOut` 끝의 `stopActiveFocus(userId,'clock_out')` 가 **업무 측정까지 멈춘다** → 자정 넘어 일하던 사람은 00:05 에 근태도 타이머도 끊긴다.
- 오늘 행은 출근 버튼·업무 «진행 시작»(auto_focus) 때만 생긴다.
- 급여는 근태 행을 읽지 않는다(AttendanceDay 사용처: attendance 라우트·autoClose·cue_context·cueLabels).

## 2. 제안 (Fable 이 판정할 것)
1. **술어 «아직 일하고 있다»** — 어제 행이 `working` 이고 (a) active FocusSession 의 `last_activity_at` 이 tz 자정 이후, 또는 (b) 어제 행의 마지막 이벤트가 자정 전 N시간(안: 4h) 안. 그 밖은 종전 auto_close.
   쟁점: 출근만 누르고 업무 측정 없이 일하는 사람을 (b) 로 살릴지 — 퇴근 안 누르고 집에 간 사람과 구별 불가.
2. **기록** — 어제 행: `clock_out at = tz 자정` · 오늘 행: `clock_in at = tz 자정`. source 새 값 `auto_midnight`(ENUM 끝 append, 운영 멱등 마이그레이션 + 배포 슬롯) 안.
   `auto_closed` 는 **켜지 않는다**(정정할 일이 아니다) — 화면 라벨 «자정 이어서».
3. **휴게 중 자정** — 안: 분할하지 않고 종전 auto_close(휴게 중 밤을 넘긴 것은 대개 퇴근 누락).
4. **00:00~00:05 공백** — 안: `/today` 에서 오늘 행이 없고 어제 행이 working 이면 그 자리에서 분할(같은 함수, 멱등) → cron 은 놓친 것만.
   분할 경로는 `stopActiveFocus` 를 부르지 않는다(clockOut 에 `keepFocus` 옵션 또는 분할 전용 함수).
5. **통계(최소 범위)** — 이어진 날(첫 clock_in 이 auto_midnight)은 `work_days` 에서 세지 않고 `avg_clock_in` 표본에서 뺀다. 이어 보낸 날의 auto_midnight clock_out 은 `avg_clock_out` 표본에서 뺀다. overtime 은 행 단위 그대로(쟁점).
6. **동시성** — `lockDay` 두 행(어제·오늘) 한 트랜잭션, 오늘 행 이미 있으면 clock_in 생략(already_working 무시). autoClockInOnFocus 와는 같은 잠금으로 직렬.
7. **검증 사례** — 23:59 근무중+heartbeat → 어제 clock_out 00:00·오늘 clock_in 00:00·/today 근무중·업무 타이머 계속 · 두 번 실행 멱등 · 멈춘 사람(마지막 활동 22:10) → 종전 auto_close 22:10 · 휴게 중 자정 · 00:01 /today 즉시 분할 · tz 다른 두 워크스페이스 · 통계 work_days/avg 표본 · 양성 대조군(분할 끄면 «미출근» 재현).

## 3. 운영
`migrate-attendance-midnight.js`(ENUM append, 멱등) — 코드 배포 전 슬롯. 옛 데이터 백필 없음.
