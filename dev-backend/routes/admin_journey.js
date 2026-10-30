// 플랫폼 관리자 — 워크스페이스 «여정» (2026-10-30, docs/PLANQ_GUIDE_ROOM_DESIGN.md §7 · 1단계)
//
// Irene: "플랫폼관리자가 처음에 고객이 접근해서 들어오면 어느 메뉴까지 봤고 앱을 다운받았는지,
//   설정을 어디까지 했는지 자세한 정보 볼 수 있어?"
//
// ★ 이미 있는 데이터만 읽는다 — 새 표 0. 단계·개인 설정은 카드와 같은 함수(adoptionStages·onboarding.personalSetup).
// ★ 관리자가 보는 것은 «사용 모양» 까지다. 응답에 업무 제목·대화 본문·문서 제목·파일 이름·대화방 이름을 싣지 않는다
//   (시각·개수·키만). 사람 이름은 워크스페이스 표시명(services/displayName).
const express = require('express');
const { QueryTypes, Op } = require('sequelize');
const router = express.Router();
const { sequelize } = require('../config/database');
const { Business, BusinessMember, User, Client, EmailAccount } = require('../models');
const { authenticateToken, requireRole } = require('../middleware/auth');
const { successResponse, errorResponse } = require('../middleware/errorHandler');
const { getAdoptionStages } = require('../services/adoptionStages');
const { personalSetup } = require('../services/onboarding');
const { getMemberNameMap } = require('../services/displayName');
const { billableClientWhere } = require('../services/clientQuota');

router.use(authenticateToken, requireRole('platform_admin'));

const HUMAN_ROLES = ['owner', 'admin', 'member'];
const MEMBER_LIMIT = 50;
const DAY = 24 * 60 * 60 * 1000;

/** 막힘 신호 기준 — 화면은 key 와 숫자만 받아 문구를 그린다. */
const INACTIVE_DAYS = 5;
const TRIAL_ENDING_DAYS = 3;
const SOLO_AFTER_DAYS = 3;
const STAGE1_STALL_DAYS = 7;

async function minAt(sql, biz) {
  const rows = await sequelize.query(sql, { replacements: { biz }, type: QueryTypes.SELECT });
  return (rows[0] && rows[0].at) || null;
}

const daysSince = (d, now) => (d ? Math.floor((now - new Date(d).getTime()) / DAY) : null);
const laterOf = (a, b) => (!a ? b : !b ? a : (new Date(a) > new Date(b) ? a : b));

// GET /api/admin/businesses/:id/journey
router.get('/businesses/:id/journey', async (req, res, next) => {
  try {
    const biz = Number(req.params.id);
    if (!biz) return errorResponse(res, 'Invalid id', 400);
    const business = await Business.findByPk(biz, {
      attributes: ['id', 'owner_id', 'createdAt', 'trial_ends_at', 'subscription_status'],
    });
    if (!business) return errorResponse(res, 'Business not found', 404);
    const now = Date.now();

    const memberRows = await BusinessMember.findAll({
      where: { business_id: biz, removed_at: null, role: HUMAN_ROLES },
      attributes: ['user_id', 'role', 'joined_at', 'createdAt'],
      include: [{ model: User, as: 'user', attributes: ['id', 'name', 'last_login_at', 'is_ai'], required: true }],
      order: [['createdAt', 'ASC']],
      limit: MEMBER_LIMIT + 1,
    });
    const humans = memberRows.filter((m) => !m.user.is_ai).slice(0, MEMBER_LIMIT);
    const userIds = humans.map((m) => m.user_id);

    const [nameMap, lastUsedRows] = await Promise.all([
      getMemberNameMap(biz, userIds),
      userIds.length ? sequelize.query(
        'SELECT user_id, MAX(last_used_at) at FROM refresh_tokens WHERE user_id IN (:ids) GROUP BY user_id',
        { replacements: { ids: userIds }, type: QueryTypes.SELECT },
      ) : [],
    ]);
    const lastUsed = new Map(lastUsedRows.map((r) => [Number(r.user_id), r.at]));

    const members = await Promise.all(humans.map(async (m) => {
      const [stages, setup] = await Promise.all([
        getAdoptionStages({ businessId: biz, userId: m.user_id, role: m.role }),
        personalSetup(m.user_id, biz),
      ]);
      const lastSeen = laterOf(m.user.last_login_at, lastUsed.get(m.user_id) || null);
      const named = nameMap.get(m.user_id);
      return {
        user_id: m.user_id,
        name: (named && named.name) || m.user.name,
        role: m.role,
        joined_at: m.joined_at || m.createdAt,
        last_seen_at: lastSeen,
        stage: { current: stages.current, stage_count: stages.stage_count, steps: stages.steps },
        setup,
      };
    }));

    const [mailAccounts, mailErrors, timelineRows, firstClient] = await Promise.all([
      EmailAccount.count({ where: { business_id: biz, is_active: true } }),
      EmailAccount.count({ where: { business_id: biz, is_active: true, last_sync_error: { [Op.ne]: null } } }),
      Promise.all([
        ['first_task', 'SELECT MIN(created_at) at FROM tasks WHERE business_id = :biz'],
        // 사람이 쓴 첫 글 — PlanQ 안내방(3단계 channel_type 'platform')은 워크스페이스 사용이 아니다.
        ['first_message', `SELECT MIN(m.created_at) at FROM messages m JOIN conversations c ON c.id = m.conversation_id
            WHERE c.business_id = :biz AND m.is_ai = 0 AND m.kind = 'text' AND c.channel_type <> 'platform'`],
        ['first_member_joined', `SELECT MIN(COALESCE(bm.joined_at, bm.created_at)) at FROM business_members bm
            JOIN businesses b ON b.id = bm.business_id
            WHERE bm.business_id = :biz AND bm.role IN ('admin','member') AND bm.user_id <> b.owner_id`],
        ['first_event', 'SELECT MIN(created_at) at FROM calendar_events WHERE business_id = :biz AND booking_status IS NULL'],
        ['first_file', 'SELECT MIN(created_at) at FROM files WHERE business_id = :biz'],
        ['first_document', 'SELECT MIN(created_at) at FROM posts WHERE business_id = :biz'],
        ['first_mail_account', 'SELECT MIN(created_at) at FROM email_accounts WHERE business_id = :biz'],
        ['first_invoice', 'SELECT MIN(created_at) at FROM invoices WHERE business_id = :biz'],
      ].map(async ([key, sql]) => ({ key, at: await minAt(sql, biz) }))),
      Client.min('createdAt', { where: billableClientWhere(biz) }),
    ]);

    const timeline = [{ key: 'workspace_created', at: business.createdAt }, ...timelineRows, { key: 'first_client', at: firstClient || null }]
      .filter((e) => e.at)
      .sort((a, b) => new Date(a.at) - new Date(b.at));

    // 단계 요약은 워크스페이스 주인(businesses.owner_id) 기준 — 권한 판정이 아니다.
    const owner = members.find((m) => m.user_id === business.owner_id) || members[0] || null;
    const lastSeenAt = members.reduce((acc, m) => laterOf(acc, m.last_seen_at), null);
    const inactiveDays = daysSince(lastSeenAt, now);
    const ageDays = daysSince(business.createdAt, now);
    const trialDaysLeft = business.subscription_status === 'trialing' && business.trial_ends_at
      ? Math.ceil((new Date(business.trial_ends_at).getTime() - now) / DAY) : null;

    const signals = [];
    if (inactiveDays !== null && inactiveDays >= INACTIVE_DAYS) signals.push({ key: 'inactive', days: inactiveDays });
    if (trialDaysLeft !== null && trialDaysLeft <= TRIAL_ENDING_DAYS) signals.push({ key: 'trial_ending', days: Math.max(0, trialDaysLeft) });
    if (members.length <= 1 && ageDays >= SOLO_AFTER_DAYS) signals.push({ key: 'solo', days: ageDays });
    if (mailErrors > 0) signals.push({ key: 'mail_error', count: mailErrors });
    if (owner && owner.stage.current === 1 && ageDays >= STAGE1_STALL_DAYS) signals.push({ key: 'stage_stalled', stage: 1, days: ageDays });

    // 워크스페이스 한 줄 요약 — 개인 설정은 «한 명이라도 했나».
    const setupAny = (key) => members.some((m) => m.setup.some((s) => s.key === key && s.done));

    return successResponse(res, {
      business_id: biz,
      summary: {
        stage: owner ? owner.stage.current : null,
        stage_count: owner ? owner.stage.stage_count : null,
        last_seen_at: lastSeenAt,
        created_at: business.createdAt,
        trial_days_left: trialDaysLeft,
        members: members.length,
        members_truncated: memberRows.filter((m) => !m.user.is_ai).length > MEMBER_LIMIT,
        app_installed: setupAny('install_app'),
        notifications_on: setupAny('enable_notifications'),
        calendar_connected: setupAny('connect_calendar'),
        ai_app_connected: setupAny('connect_ai_app'),
        mail_accounts: mailAccounts,
        mail_errors: mailErrors,
      },
      members,
      timeline,
      signals,
    });
  } catch (err) { next(err); }
});

module.exports = router;
