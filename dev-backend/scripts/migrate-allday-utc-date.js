#!/usr/bin/env node
// 종일 일정 재부호화 — 기기 자정 instant → UTC 자정 날짜 (2026-10-07 · docs/ALLDAY_EVENT_DATE_DESIGN.md, Fable 판정 U). 멱등.
//
// ★ **코드 배포·재시작 뒤에** 돈다(Fable 3). 새 코드는 옛 행을 반올림으로 바로 맞게 읽고, 서버가 옛 화면 번들의 값도
//   정규화한다. 반대로 이 스크립트를 먼저 돌리면 옛 코드가 새 행을 «구글 end D+2 · 서쪽 기기 전날» 로 읽는 창이 생긴다.
//
// 하는 일 (all_day=1 이고 UTC 자정 부호화가 아닌 행만):
//   ① start_at/end_at → 가장 가까운 UTC 자정의 날짜(utils/allDayDate.normalizeAllDay)
//      기기 시간대를 모르므로 «워크스페이스 시간대로 추정» 하지 않는다 — 운영에 기기가 워크스페이스보다 동쪽인 조합이 실존한다.
//   ② 반복 원본이면 회차 키(exception_dates · 자식 recurrence_id)를 같은 날 수만큼 옮긴다
//      — 회차 키 = start 의 UTC 날짜라, 서울 자정 저장 원본의 키는 사람 날짜의 **전날**이었다.
//   ③ updated_at 은 그대로 둔다 — 알림 cron 이 «저장 시각보다 앞선 발송 시각은 버린다» 판정에 updated_at 을 읽는다.
//      올리면 내일 종일의 «1일 전» 알림이 영영 건너뛰어진다.
// 롤백: --revert (그 행 워크스페이스 시간대의 자정/23:59:59 로 되돌리고 키도 역이동).
//
// 사용:  node scripts/migrate-allday-utc-date.js          (적용)
//        node scripts/migrate-allday-utc-date.js --dry    (무엇을 할지만)
//        node scripts/migrate-allday-utc-date.js --revert
require('dotenv').config();
const { sequelize } = require('../config/database');
const A = require('../utils/allDayDate');

const DRY = process.argv.includes('--dry');
const REVERT = process.argv.includes('--revert');
const log = (...a) => console.log('[allday-utc-date]', ...a);
const DAY = A.DAY_MS;
const slice = (d) => new Date(d).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);

// 워크스페이스 벽시계 자정 → instant (되돌리기 전용)
function tzMidnight(ymd, tz, endOfDay) {
  const [y, m, d] = ymd.split('-').map(Number);
  const target = Date.UTC(y, m - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0);
  let g = target;
  for (let i = 0; i < 3; i++) {
    const p = {};
    for (const x of new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(g))) {
      if (x.type !== 'literal') p[x.type] = Number(x.value);
    }
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    if (seen === target) break;
    g += target - seen;
  }
  return new Date(g);
}

(async () => {
  try {
    const [rows] = await sequelize.query(
      `SELECT e.id, e.business_id, e.start_at, e.end_at, e.rrule, e.exception_dates, e.recurrence_parent_id, b.timezone
         FROM calendar_events e LEFT JOIN businesses b ON b.id = e.business_id
        WHERE e.all_day = 1`);
    const plan = [];
    for (const r of rows) {
      const encoded = A.isUtcEncoded(r.start_at, r.end_at);
      let next;
      if (!REVERT) {
        if (encoded) continue;
        const n = A.normalizeAllDay(r.start_at, r.end_at);
        if (!n) { log('읽을 수 없는 행 — 건너뜀', r.id); continue; }
        next = n;
      } else {
        if (!encoded) continue;
        const tz = r.timezone || 'Asia/Seoul';
        const { date, last_date: last } = A.allDayDates(r);
        next = { start_at: tzMidnight(date, tz, false), end_at: tzMidnight(last, tz, true) };
      }
      plan.push({ r, next, shift: dayDiff(slice(next.start_at), slice(r.start_at)) });
    }
    log(`${REVERT ? '되돌릴' : '고칠'} 행 ${plan.length} / 종일 ${rows.length}`);
    for (const p of plan) {
      log(` #${p.r.id} biz ${p.r.business_id} ${new Date(p.r.start_at).toISOString()} → ${p.next.start_at.toISOString()} · ${new Date(p.r.end_at).toISOString()} → ${p.next.end_at.toISOString()}${p.r.rrule && p.shift ? ` · 회차 키 ${p.shift > 0 ? '+' : ''}${p.shift}일` : ''}`);
    }
    if (DRY || plan.length === 0) { log(DRY ? '--dry — 쓰지 않음' : '할 일 없음'); process.exit(0); }

    const t = await sequelize.transaction();
    try {
      for (const p of plan) {
        const sets = ['start_at = ?', 'end_at = ?'];
        const vals = [p.next.start_at, p.next.end_at];
        if (p.r.rrule && p.shift) {
          let ex = p.r.exception_dates;
          if (typeof ex === 'string') { try { ex = JSON.parse(ex); } catch { ex = null; } }
          if (Array.isArray(ex) && ex.length) {
            sets.push('exception_dates = ?');
            vals.push(JSON.stringify(ex.map((d) => A.addDays(String(d).slice(0, 10), p.shift)).sort()));
          }
          await sequelize.query(
            'UPDATE calendar_events SET recurrence_id = DATE_ADD(recurrence_id, INTERVAL ? DAY), updated_at = updated_at WHERE recurrence_parent_id = ? AND recurrence_id IS NOT NULL',
            { replacements: [p.shift, p.r.id], transaction: t });
        }
        await sequelize.query(`UPDATE calendar_events SET ${sets.join(', ')}, updated_at = updated_at WHERE id = ?`,
          { replacements: [...vals, p.r.id], transaction: t });
      }
      await t.commit();
    } catch (e) { await t.rollback(); throw e; }
    log('완료', plan.length);
    process.exit(0);
  } catch (e) {
    console.error('[allday-utc-date] 실패', e.message);
    process.exit(1);
  }
})();
