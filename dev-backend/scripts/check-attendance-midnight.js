// 근태 자정 분할 회귀 (docs/ATTENDANCE_MIDNIGHT_SPLIT_DESIGN.md §2-7 ①④) — health-check `attnmidnight` 가 부른다.
//   지난 날짜(2025-06-10/11)·주입한 «지금» 으로 서비스 함수를 직접 부르고, 만든 행은 전부 지운다.
//   출력 맨 끝 한 줄: <<{"ok":bool,"checks":[...]} (판정은 부르는 쪽)
//   사용: node scripts/check-attendance-midnight.js <business_id> <user_id>
require('dotenv').config();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { AttendanceDay, AttendanceEvent, FocusSession } = require('../models');
const A = require('../services/attendanceTransition');
const { startOfDayInTz } = require('../utils/datetime');

const [biz, uid] = process.argv.slice(2).map(Number);
const checks = [];
const check = (name, okv) => checks.push({ name, ok: !!okv });
const days = []; const sessions = [];

async function scenario(y, t, sessionLastAgoMs) {
  const tz = await A.workspaceTz(biz);
  const mid = startOfDayInTz(t, tz);
  const now = new Date(mid.getTime() + 60000);
  const yd = await AttendanceDay.create({ business_id: biz, user_id: uid, work_date: y, state: 'working', clock_in_at: new Date(mid.getTime() - 14 * 3600000) });
  days.push(yd.id);
  await AttendanceEvent.create({ business_id: biz, user_id: uid, attendance_day_id: yd.id, kind: 'clock_in', at: yd.clock_in_at, source: 'auto_focus', actor_user_id: uid });
  await A.recomputeDay(yd.id);
  const s = await FocusSession.create({ business_id: biz, user_id: uid, state: 'active', started_at: new Date(mid.getTime() - 2 * 3600000), last_activity_at: new Date(now.getTime() - sessionLastAgoMs) });
  sessions.push(s.id);
  const r = await A.ensureMidnightSplit({ businessId: biz, userId: uid, now });
  const td = await AttendanceDay.findOne({ where: { business_id: biz, user_id: uid, work_date: t } });
  if (td) days.push(td.id);
  await yd.reload(); await s.reload();
  const sessionState = s.state;
  await s.update({ state: 'stopped', ended_at: s.last_activity_at });
  return { r, yd, td, sessionState, mid };
}

(async () => {
  try {
    if (!biz || !uid) throw new Error('business_id user_id 필요');
    const pre = await AttendanceDay.count({ where: { business_id: biz, user_id: uid, work_date: { [Op.in]: ['2025-06-10', '2025-06-11', '2025-06-13', '2025-06-14'] } } });
    if (pre) throw new Error(`픽스처 날짜에 기존 행 ${pre}건`);
    // ① 살아 있는 세션이 자정을 걸쳤다 → 어제 24:00 퇴근 + 오늘 00:00 출근, 측정 유지
    const a = await scenario('2025-06-10', '2025-06-11', 10000);
    check('① 분할됨', !!a.r);
    check('① 어제 닫힘·자동 마감 표시 없음', a.yd.state === 'done' && !a.yd.auto_closed && a.yd.clock_out_at && +new Date(a.yd.clock_out_at) === +a.mid);
    check('① 오늘 00:00 근무중', a.td && a.td.state === 'working' && +new Date(a.td.clock_in_at) === +a.mid);
    check('① 업무 측정 유지(분할 직후 active)', a.sessionState === 'active');
    const ev = a.td ? await AttendanceEvent.findAll({ where: { attendance_day_id: a.td.id } }) : [];
    check('① source auto_midnight', ev.length === 1 && ev[0].source === 'auto_midnight');
    // ④ 대조군 — 세션이 죽었다(10분 전) → 분할 없음(«미출근» 은 종전대로)
    const b = await scenario('2025-06-13', '2025-06-14', 600000);
    check('④ 대조군 분할 없음', b.r === null && !b.td && b.yd.state === 'working');
  } catch (e) {
    checks.push({ name: `오류: ${e.message}`, ok: false });
  } finally {
    await FocusSession.destroy({ where: { id: sessions } }).catch(() => null);
    await AttendanceEvent.destroy({ where: { attendance_day_id: days } }).catch(() => null);
    await AttendanceDay.destroy({ where: { id: days } }).catch(() => null);
    process.stdout.write(`\n<<${JSON.stringify({ ok: checks.length > 0 && checks.every((c) => c.ok), checks })}\n`);
    await sequelize.close().catch(() => null);
  }
})();
