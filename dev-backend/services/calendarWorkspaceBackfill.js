// services/calendarWorkspaceBackfill.js — 팀 캘린더 재연결 직후 **밀린 일정 올려보내기**.
//
// 왜 필요한가 (Fable 설계 게이트 치명-5, 2026-08-14)
//   팀 토큰의 캘린더 권한이 죽어 있던 기간에 만들어진 일정은 `calendarSync.resolveTargets` 가
//   목적지 목록에서 워크스페이스를 빼버렸기 때문에 **워크스페이스 링크 자체가 없다.**
//   재연결로 권한이 살아나도, reconcile 은 **그 일정을 저장할 때만** 도는 함수라
//   사용자가 일정을 하나하나 다시 열어 저장하기 전까지 구글에는 아무것도 안 나타난다.
//   그런데 재연결 직후 사용자의 첫 검증은 언제나 "구글 캘린더 열어보기" 다 —
//   비어 있는 화면을 보고 **"역시 안 되네"** 로 끝난다. #242 재신고가 정확히 이 지점에서 재생산된다.
//
// 이것은 사용자 자산의 임의 변경이 아니다. 사용자가 **연결하고 캘린더 항목을 체크한** 목적지로,
//   그 목적지가 살아있는 동안이었다면 이미 갔을 일정을 보내는 것 — 연동 계약의 이행이다.
//   (반대로 개인 캘린더는 여기서 손대지 않는다. 사생활 공간이라 비대칭은 의도다.)
//
// 안전장치
//   ① 미래 + 최근 30일만 (오래된 과거를 구글에 쏟아붓지 않는다)
//   ② 상한 100건 — 넘으면 남은 수를 반환해 화면이 "일부만 반영됨" 을 말할 수 있게 한다
//   ③ 기존 `reconcile` 을 그대로 쓴다(멱등). 여기서 push 규칙을 새로 쓰면 두 벌이 된다
//   ④ 건별 실패는 삼키고 계속 — 하나 때문에 전체가 멈추면 재연결 직후가 다시 침묵이 된다
//   ⑤ 감사로그 1건(요약) — 누가 언제 몇 건을 올렸는지 남는다
const { Op } = require('sequelize');
const { CalendarEvent, CalendarEventGcalLink, BusinessCloudToken } = require('../models');
const calendarSync = require('./calendarSync');
const gcal = require('./google_calendar');
const { createAuditLog } = require('./auditService');

const LOOKBACK_DAYS = 30;
const MAX_EVENTS = 100;

/**
 * 워크스페이스 링크가 없는 일정을 찾아 팀 캘린더로 올린다.
 * @param {number} businessId
 * @param {number} actorUserId  재연결을 수행한 사용자(감사로그 주체)
 * @returns {Promise<{eligible:number, pushed:number, failed:number, remaining:number, skipped:string|null}>}
 */
async function backfillWorkspace(businessId, actorUserId, { io = null } = {}) {
  const out = {
    eligible: 0, pushed: 0, failed: 0, remaining: 0, skipped: null,
  };
  // ★ 같은 워크스페이스를 두 경로가 동시에 백필하지 않게 한다(콜백 자동 실행 + 사용자의 수동 재시도).
  //   reconcile 은 건별로는 멱등이지만, 링크가 없는 같은 일정을 두 실행이 동시에 집으면
  //   양쪽 다 "없다" 를 보고 구글에 사본을 두 번 만들 수 있다.
  if (inFlight.has(businessId)) { out.skipped = 'already_running'; return out; }
  inFlight.add(businessId);
  try {
    return await runBackfill(businessId, actorUserId, io, out);
  } finally {
    inFlight.delete(businessId);
  }
}

const inFlight = new Set();

async function runBackfill(businessId, actorUserId, io, out) {

  const token = await BusinessCloudToken.findOne({ where: { business_id: businessId, provider: 'gcal' } });
  // 권한이 없으면 할 일이 없다 — 조용히 0 을 돌려주지 않고 사유를 남긴다(침묵 금지).
  if (!token) { out.skipped = 'not_connected'; return out; }
  if (token.sync_enabled === false) { out.skipped = 'sync_disabled'; return out; }
  if (!gcal.hasWriteScope(token.scope)) { out.skipped = 'no_calendar_scope'; return out; }

  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000);
  // 후보 = 이 워크스페이스의 최근~미래 일정 중 **워크스페이스 링크가 없는** 것.
  //   비공개·개인 일정은 여기서 거르지 않는다 — 판정은 resolveTargets(=isPrivateForGcal·체크박스)가
  //   단독으로 한다. 두 벌로 판정하면 "여기선 되는데 저기선 안 되는" 어긋남이 생긴다.
  const candidates = await CalendarEvent.findAll({
    where: { business_id: businessId, start_at: { [Op.gte]: since } },
    order: [['start_at', 'ASC']],
    limit: MAX_EVENTS + 1,
    include: [{
      model: CalendarEventGcalLink,
      as: 'gcalLinks',
      required: false,
      where: { target: 'workspace' },
    }],
  });

  const missing = candidates.filter((e) => !(e.gcalLinks || []).length);
  out.eligible = missing.length;
  const batch = missing.slice(0, MAX_EVENTS);
  out.remaining = Math.max(0, missing.length - batch.length);

  for (const event of batch) {
    try {
      // ★ userId 는 넘기지 않는다 — resolveTargets 가 개인 목적지를 **일정 작성자(created_by)** 기준으로
      //   고르기 때문이다. 여기서 actor 를 넘기면 재연결한 오너의 개인 캘린더로 남의 일정이 샌다.
      const r = await calendarSync.reconcile(event, { businessId, userId: event.created_by });
      if (r.added > 0 || r.updated > 0) out.pushed += 1;
    } catch (e) {
      out.failed += 1;
      console.error(`[gcalBackfill] event#${event.id} 실패:`, e.message);
    }
  }

  console.log(`[gcalBackfill] biz ${businessId} · 대상 ${out.eligible} · 올림 ${out.pushed} · 실패 ${out.failed} · 남음 ${out.remaining}`);

  if (out.pushed || out.failed) {
    await createAuditLog({
      user_id: actorUserId || null,
      business_id: businessId,
      action: 'calendar.gcal_backfill',
      target_type: 'business_cloud_token',
      target_id: token.id,
      new_value: {
        eligible: out.eligible, pushed: out.pushed, failed: out.failed, remaining: out.remaining, lookback_days: LOOKBACK_DAYS,
      },
    });
  }

  // 실시간 16번 — 다른 멤버 화면의 캘린더·**배너**도 갱신된다.
  //   ★ `pushed > 0` 조건을 걸면 안 된다. 이 신호의 본질은 "올린 일정이 있다" 가 아니라
  //     **"연동 상태가 바뀌었다"** 이다(백필은 재연결 직후에만 돈다). 올릴 게 0건이어도
  //     다른 멤버 화면에는 dismiss 불가한 "끊김" 배너가 떠 있고, 그것을 내리는 유일한 신호가 이것이다.
  if (io) {
    io.to(`business:${businessId}`).emit('calendar:sync-changed', {
      backfilled: out.pushed, reason: out.skipped ? 'checked' : 'reconnected',
    });
  }
  return out;
}

module.exports = { backfillWorkspace, LOOKBACK_DAYS, MAX_EVENTS };
