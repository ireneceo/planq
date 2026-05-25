// weeklyReviewCron.js — 주간 보고 자동 박제 cron
//
// 매시간 0분 트리거.
// 워크스페이스 timezone 기준 월요일 00:00~00:59 사이에
// 지난 주 결산이 없고 auto_enabled=true 인 멤버에게 자동 박제.

const cron = require('node-cron');
const { Op } = require('sequelize');
const { WeeklyReview, WeeklyReviewSetting, Business, BusinessMember, BusinessWeeklyReport, User } = require('../models');
const { buildSnapshot, buildWorkspaceSnapshot } = require('./weeklyReviewSnapshot');

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
// N+63 — cron callback 을 함수로 추출. server.js init 시 즉시 1회 실행 (PM2 restart 후 다음 정각 기다림 X).
//   사용자 호소 "왜 저장된 게 없어" — 다음 정각까지 기다리지 않고 즉시 backfill.
async function runWeeklyReviewCron() {
    console.log('[weeklyReviewCron] triggered at', new Date().toISOString());

    try {
      // 1. 활성 멤버 순회 — BusinessMember 는 active 컬럼 없음. removed_at NULL 이 활성.
      // 사이클 N+26: 워크스페이스 단위 weekly_finalize_dow/hour/enabled 설정에 따라 트리거.
      // weekly_finalize_enabled=false 인 워크스페이스는 자동 확정 자체 skip.
      const members = await BusinessMember.findAll({
        where: { removed_at: null },
        include: [{ model: Business, attributes: ['id', 'timezone', 'weekly_finalize_dow', 'weekly_finalize_hour', 'weekly_finalize_enabled'] }],
      });

      let processed = 0;
      let created = 0;

      for (const m of members) {
        const biz = m.Business;
        if (!biz) continue;
        if (biz.weekly_finalize_enabled === false) continue;  // 워크스페이스 자동 확정 OFF
        const wsTz = biz.timezone || 'Asia/Seoul';
        const nowInTz = getNowInTz(wsTz);

        if (!nowInTz) continue;

        // 워크스페이스 설정된 요일·시각 (default 월요일 0시).
        // N+63 — 옛: 1시간 window 만. PM2 restart / 서버 다운 miss 회귀.
        // 새: trigger 시점 이미 지났으면 매시간 시도. 아래 line ~100 `if (exists) continue` 가 멱등 보장.
        const targetDow = biz.weekly_finalize_dow != null ? Number(biz.weekly_finalize_dow) : 1;
        const targetHour = biz.weekly_finalize_hour != null ? Number(biz.weekly_finalize_hour) : 0;
        const currentDow = nowInTz.weekday;
        let daysFromTargetDow = (currentDow - targetDow + 7) % 7;
        if (daysFromTargetDow === 0 && nowInTz.hour < targetHour) daysFromTargetDow = 7;
        const triggerHourMs = new Date(
          nowInTz.year, nowInTz.month - 1, nowInTz.day - daysFromTargetDow, targetHour
        ).getTime();
        const nowMs = new Date(
          nowInTz.year, nowInTz.month - 1, nowInTz.day, nowInTz.hour
        ).getTime();
        if (nowMs < triggerHourMs) continue;

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

      // ─── 워크스페이스 통합본 박제 (사이클 N+18) ───
      // 멤버 fan-out 과 별개로, 월요일 00시에 들어선 워크스페이스 × 1건 박제.
      // 같은 주차 manual row 가 있으면 skip (수동 우선).
      const businessesNeedingWorkspaceReport = new Set();
      for (const m of members) {
        const biz = m.Business;
        if (!biz || biz.weekly_finalize_enabled === false) continue;
        const wsTz = biz.timezone || 'Asia/Seoul';
        const nowInTz = getNowInTz(wsTz);
        if (!nowInTz) continue;
        const targetDow = biz.weekly_finalize_dow != null ? Number(biz.weekly_finalize_dow) : 1;
        const targetHour = biz.weekly_finalize_hour != null ? Number(biz.weekly_finalize_hour) : 0;
        // N+63 — 옛 코드: 1시간 window 만 trigger → PM2 restart / 서버 다운으로 그 1시간 miss 하면 다음 주까지 0.
        //   사용자 호소: "왜 저장된 게 없어? 매주 mon 00:00 자동 확정" — 5/25 mon 00:00 KST cron miss 회귀.
        // 새 코드: 이번 주 trigger 시점이 이미 지났으면 매시간 시도. existing 검사로 멱등 (한 번만 생성).
        //   같은 주차 row 있으면 아래 루프에서 skip.
        const currentDow = nowInTz.weekday;  // 0=Sun, 1=Mon, ..., 6=Sat
        let daysFromTargetDow = (currentDow - targetDow + 7) % 7;
        // 정확히 targetDow 일이지만 targetHour 아직 안 도래했으면 지난 주 trigger 로 간주
        if (daysFromTargetDow === 0 && nowInTz.hour < targetHour) daysFromTargetDow = 7;
        // 이번 주의 trigger 시각 — currentDow 에서 daysFromTargetDow 일 전 + targetHour 시
        const triggerHourMs = new Date(
          nowInTz.year, nowInTz.month - 1, nowInTz.day - daysFromTargetDow, targetHour
        ).getTime();
        const nowMs = new Date(
          nowInTz.year, nowInTz.month - 1, nowInTz.day, nowInTz.hour
        ).getTime();
        if (nowMs >= triggerHourMs) {
          businessesNeedingWorkspaceReport.add(m.business_id);
        }
      }
      let wsCreated = 0;
      for (const bizId of businessesNeedingWorkspaceReport) {
        const biz = await Business.findByPk(bizId, { attributes: ['timezone'] });
        const wsTz = biz?.timezone || 'Asia/Seoul';
        const nowInTz = getNowInTz(wsTz);
        if (!nowInTz) continue;
        const todayInTz = new Date(nowInTz.year, nowInTz.month - 1, nowInTz.day);
        const lastMonday = mondayOfDate(addDays(todayInTz, -7));
        const lastSunday = addDays(lastMonday, 6);
        const weekStart = dateToStr(lastMonday);
        const weekEnd = dateToStr(lastSunday);

        const existing = await BusinessWeeklyReport.findOne({
          where: { business_id: bizId, week_start: weekStart },
        });
        // N+63 — auto/manual 둘 다 있으면 skip (멱등). 옛 코드는 auto 만 있으면 매시간 update 했음 — 의도 아님.
        if (existing) continue;
        const snapshot = await buildWorkspaceSnapshot(bizId, weekStart);
        if (existing) {
          await existing.update({
            week_end: weekEnd,
            finalized_at: new Date(),
            finalized_by: 'auto',
            snapshot_data: snapshot,
          });
        } else {
          await BusinessWeeklyReport.create({
            business_id: bizId, week_start: weekStart, week_end: weekEnd,
            finalized_at: new Date(),
            finalized_by: 'auto',
            snapshot_data: snapshot,
          });
        }
        wsCreated++;
        console.log(`[weeklyReviewCron] workspace report auto created for biz ${bizId}, week ${weekStart}`);
      }

      console.log(`[weeklyReviewCron] done. processed=${processed}, personal_created=${created}, workspace_created=${wsCreated}`);
    } catch (err) {
      console.error('[weeklyReviewCron] error:', err.message);
    }
}

function initWeeklyReviewCron() {
  // 매시간 0분 cron
  cron.schedule('0 * * * *', runWeeklyReviewCron);
  // N+63 — server start 직후 1회 즉시 실행 (PM2 restart 후 backfill miss 차단).
  // 약간 지연 (5s) — DB / 다른 service init 완료 후.
  setTimeout(() => { runWeeklyReviewCron().catch(e => console.error('[weeklyReviewCron] startup run err', e.message)); }, 5000);
  console.log('[weeklyReviewCron] initialized — runs at :00 every hour + startup once');
}

module.exports = { initWeeklyReviewCron, runWeeklyReviewCron };
