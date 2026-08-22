# 출퇴근·휴가 (#208 · #285) — 배포 메모

구현 완료일 2026-08-22 (dev). 설계 원본: `docs/ATTENDANCE_LEAVE_DESIGN.md`.

## 운영 배포 시 필요한 것

### 1. 신규 테이블 4개 — `node sync-database.js` 로 생성된다
`attendance_days` · `attendance_events` · `leave_grants` · `leave_requests`.
전부 신규라 백필 없음. 과거 데이터가 애초에 존재하지 않는다.

### 2. ENUM append 2건 — **수동 ALTER 준비**

sync-database 가 ENUM 을 다시 쓰다가 실패하는 전례가 있어(BusinessMember.role) 배포 후 확인한다.
값은 **반드시 끝에 append** — 중간에 끼우면 기존 row 의 정수 인덱스가 밀려 데이터가 통째로 어긋난다.

```sql
-- 현재 값 확인
SHOW COLUMNS FROM notification_prefs LIKE 'event_kind';
SHOW COLUMNS FROM notifications LIKE 'event_kind';

-- 'leave' 가 없으면 (기존 순서를 그대로 두고 끝에만 추가)
ALTER TABLE notification_prefs MODIFY event_kind
  ENUM('signature','invoice','tax_invoice','task','event','invite','message','mention',
       'comment_mention','inquiry','signup','payment','subscription','trial','feedback',
       'share_expiry','mail','system','leave') NOT NULL;

ALTER TABLE notifications MODIFY event_kind
  ENUM('signature','invoice','tax_invoice','task','event','invite','message','mention',
       'comment_mention','share_expiry','inquiry','signup','payment','subscription','trial',
       'feedback','mail','system','leave') NOT NULL;
```

> 두 표의 기존 값 **순서가 서로 다르다**(옛 사정). 각자 `SHOW COLUMNS` 결과 순서를 그대로 옮겨 쓰고
> 끝에 `'leave'` 만 붙일 것. 위 SQL 은 2026-08-22 dev 기준이다.

`users.auto_clock_in_on_focus BOOLEAN NOT NULL DEFAULT 1` 은 컬럼 추가라 sync 로 안전하다.

### 3. cron 1개 신규
`services/attendanceAutoClose.js` — 매시 5분. 워크스페이스 tz 기준 **어제 이전**의 열린 하루를 닫는다.
배포 직후 로그에 `[attendanceAutoClose] initialized — hourly` 가 찍히는지 확인.

### 4. 롤백
신규 표·신규 라우트라 기존 기능에 얹힌 것은 **가용시간 소비처 4곳뿐**이다
(`routes/tasks.js` my-week·my-month, `services/weeklyReviewSnapshot.js`, `services/reportUnitSnapshot.js`).
휴가 데이터가 0건이면 이 네 곳은 종전과 **완전히 같은 값**을 낸다 — 되돌릴 이유가 생기기 어렵다.
그래도 되돌린다면 `backups/{TIMESTAMP}` 의 백엔드를 복원하면 된다(표는 남겨도 무해).

## dev 검증 결과 (2026-08-22, Opus 자체 검증 — **Fable 미검증**)

- 출퇴근 전이 22항목 실HTTP: 출근·이중출근 차단·휴게·재개·퇴근·재조회 일치·재출근 누계 보존·원장 6건
- 권한 12항목: member → `/team`·남의 잔여·부여·승인 전부 403, 타 워크스페이스 403
- 감사·알림: AuditLog `attendance.clock_in` 기록, 신청 → 관리자 알림 도달, 승인 → 신청자 알림 도달
- 휴가: 부여 15 → 신청 3일 → 승인(3일 박제) → 잔여 12 → 취소 → 잔여 15 복원, 겹침 400
- 가용시간: 휴가 주 40h → 16h, 휴가 없는 주 40h 그대로(회귀 0)
- Focus 연동 A/B/C 실측 전건 통과 + 설정 OFF 시 미개입
- 가드: guard-invariants 25/25 · health-check 37/37 · e2e tenant 실패 0(근태 4표면 추가) · 프론트 빌드 EXIT 0

## 남은 것 (Phase 3 잔여)

- `GET /api/attendance/stats` 월별 통계 라우트 + Insights AttendanceTab (설계 §8)
- 관리자 정정 UI — 라우트(`PATCH /api/attendance/days/:id`)는 있고 화면이 없다
- 주간보고 멤버 통계에 `leave_days` 는 이미 실린다. 화면 노출은 미완
