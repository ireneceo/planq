// weeklyReviewCron.js — 주간 보고 자동 박제 cron
//
// 매시간 0분 트리거.
// 워크스페이스 timezone 기준 월요일 00:00~00:59 사이에
// 지난 주 결산이 없고 auto_enabled=true 인 멤버에게 자동 박제.

const cron = require('node-cron');
const { Op } = require('sequelize');
const { WeeklyReview, WeeklyReviewSetting, Business, BusinessMember, User } = require('../models');
const { buildSnapshot } = require('./weeklyReviewSnapshot');

// 날짜 유틸
function mondayOfDate(d) {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  return monday;
}

function addDays(d, n) {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

function dateToStr(d) {
  return d.toISOString().slice(0, 10);
}

// 특정 timezone에서 현재 시간 정보 얻기
function getNowInTz(tz) {
  try {
    const nowStr = new Date().toLocaleString('en-US', { timeZone: tz, hour12: false });
    const parts = nowStr.match(/(\d+)\/(\d+)\/(\d+),?\s+(\d+):(\d+):(\d+)/);
    if (parts) {
      return {
        year: parseInt(parts[3]),
        month: parseInt(parts[1]),
        day: parseInt(parts[2]),
        hour: parseInt(parts[4]),
        minute: parseInt(parts[5]),
        weekday: new Date(parts[3], parts[1] - 1, parts[2]).getDay(), // 0=Sun, 1=Mon
      };
    }
  } catch (e) {
    console.error('[weeklyReviewCron] timezone parse error:', e.message);
  }
  return null;
}

// ─── cron 초기화 ───
function initWeeklyReviewCron() {
  // 매시간 0분 트리거
  cron.schedule('0 * * * *', async () => {
    console.log('[weeklyReviewCron] triggered at', new Date().toISOString());

    try {
      // 1. 활성 멤버 순회 — BusinessMember 는 active 컬럼 없음. removed_at NULL 이 활성.
      const members = await BusinessMember.findAll({
        where: { removed_at: null },
        include: [{ model: Business, attributes: ['id', 'timezone'] }],
      });

      let processed = 0;
      let created = 0;

      for (const m of members) {
        const wsTz = m.Business?.timezone || 'Asia/Seoul';
        const nowInTz = getNowInTz(wsTz);

        if (!nowInTz) continue;

        // 월요일 00:00~00:59 인지 확인
        const isJustAfterSundayEnd = nowInTz.weekday === 1 && nowInTz.hour === 0;
        if (!isJustAfterSundayEnd) continue;

        processed++;

        // 2. 자동 ON 검사 (row 없으면 default ON)
        const setting = await WeeklyReviewSetting.findOne({
          where: { user_id: m.user_id, business_id: m.business_id },
        });
        if (setting && !setting.auto_enabled) continue;

        // 3. 지난 주 계산
        const todayInTz = new Date(nowInTz.year, nowInTz.month - 1, nowInTz.day);
        const lastMonday = mondayOfDate(addDays(todayInTz, -7));
        const lastSunday = addDays(lastMonday, 6);
        const weekStart = dateToStr(lastMonday);
        const weekEnd = dateToStr(lastSunday);

        // 4. 이미 있는지 확인
        const exists = await WeeklyReview.findOne({
          where: { user_id: m.user_id, business_id: m.business_id, week_start: weekStart },
        });
        if (exists) continue;

        // 5. snapshot 빌드
        const snapshot = await buildSnapshot(m.user_id, m.business_id, weekStart, weekEnd);

        // 빈 주 skip
        if (snapshot.summary.total === 0) {
          console.log(`[weeklyReviewCron] skip empty week for user ${m.user_id}, biz ${m.business_id}`);
          continue;
        }

        // 6. insert
        await WeeklyReview.create({
          user_id: m.user_id,
          business_id: m.business_id,
          week_start: weekStart,
          week_end: weekEnd,
          finalized_at: new Date(),
          finalized_by: 'auto',
          snapshot_data: snapshot,
          retro_note: null,
        });

        created++;
        console.log(`[weeklyReviewCron] auto created for user ${m.user_id}, biz ${m.business_id}, week ${weekStart}`);
      }

      console.log(`[weeklyReviewCron] done. processed=${processed}, created=${created}`);
    } catch (err) {
      console.error('[weeklyReviewCron] error:', err.message);
    }
  });

  console.log('[weeklyReviewCron] initialized — runs at :00 every hour');
}

module.exports = { initWeeklyReviewCron };
