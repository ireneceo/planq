// 신규 고객 팔로업 — 워크스페이스 여러 곳의 «여정 요약» 을 한 번에 (2026-11-06, docs/ADMIN_FOLLOWUP_DESIGN.md ②)
//
// ★ 막힘 신호는 computeSignals 한 함수 — routes/admin_journey.js(한 곳 상세)와 이 목록이 같이 부른다. 복제 금지.
// ★ 묶음 쿼리는 워크스페이스 수와 무관하게 정해진 수(≤10) + 대표 단계(사람 1명 ~13 쿼리, 5곳씩).
// ★ 사용 모양만 — 업무 제목·대화 본문·문서 제목·파일 이름·대화방 이름을 싣지 않는다(시각·개수·키만).
const { QueryTypes, Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { getAdoptionStages } = require('./adoptionStages');
const { APP_CLIENT_KINDS, CALENDAR_PROVIDERS } = require('./onboarding');
const followupRules = require('./followupRules');

const DAY = 24 * 60 * 60 * 1000;
/** 막힘 신호 기준 — 화면은 key 와 숫자만 받아 문구를 그린다. */
const INACTIVE_DAYS = 5;
const TRIAL_ENDING_DAYS = 3;
const SOLO_AFTER_DAYS = 3;
const STAGE1_STALL_DAYS = 7;
const OWNER_CONCURRENCY = 5;
const HUMAN_ROLES = ['owner', 'admin', 'member'];

// Business 는 timestamps 라 인스턴스 속성이 createdAt — attributes 로 'created_at' 을 고르면 그쪽에만 값이 있다.
const createdOf = (b) => b.createdAt || (b.get && b.get('created_at')) || b.created_at || null;
const daysSince = (d, now) => (d ? Math.floor((now - new Date(d).getTime()) / DAY) : null);
const laterOf = (a, b) => (!a ? b : !b ? a : (new Date(a) > new Date(b) ? a : b));
const trialDaysLeftOf = (biz, now) => (biz.subscription_status === 'trialing' && biz.trial_ends_at
  ? Math.ceil((new Date(biz.trial_ends_at).getTime() - now) / DAY) : null);

/**
 * 막힘 신호 — { inactiveDays, trialDaysLeft, members, ageDays, mailErrors, ownerStage } → [{key, …}]
 * (2026-10-30 1단계 기준 그대로 옮김 — 순서·숫자 불변)
 */
function computeSignals({ inactiveDays, trialDaysLeft, members, ageDays, mailErrors, ownerStage }) {
  const signals = [];
  if (inactiveDays !== null && inactiveDays !== undefined && inactiveDays >= INACTIVE_DAYS) signals.push({ key: 'inactive', days: inactiveDays });
  if (trialDaysLeft !== null && trialDaysLeft !== undefined && trialDaysLeft < 0) signals.push({ key: 'trial_ended', days: -trialDaysLeft });
  else if (trialDaysLeft !== null && trialDaysLeft !== undefined && trialDaysLeft <= TRIAL_ENDING_DAYS) signals.push({ key: 'trial_ending', days: trialDaysLeft });
  if (members <= 1 && ageDays >= SOLO_AFTER_DAYS) signals.push({ key: 'solo', days: ageDays });
  if (mailErrors > 0) signals.push({ key: 'mail_error', count: mailErrors });
  if (ownerStage === 1 && ageDays >= STAGE1_STALL_DAYS) signals.push({ key: 'stage_stalled', stage: 1, days: ageDays });
  return signals;
}

const q = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });
const groupBy = (rows, key) => {
  const m = new Map();
  for (const r of rows) { const k = Number(r[key]); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
};

/**
 * businesses: Business 인스턴스(또는 같은 칸의 객체) 배열 — id·owner_id·createdAt·trial_ends_at·subscription_status 필요.
 * 돌려주는 것: Map(business_id → { stage, last_seen_at, members, setup, signals, help, room, owner_lang })
 */
async function summarize(businesses) {
  const out = new Map();
  if (!businesses.length) return out;
  const now = Date.now();
  const ids = businesses.map((b) => b.id);

  // 1) 사람 멤버(AI 제외) — 워크스페이스별 사람 수·마지막 로그인
  const memberRows = await q(`
    SELECT bm.business_id, bm.user_id, u.last_login_at
      FROM business_members bm JOIN users u ON u.id = bm.user_id
     WHERE bm.business_id IN (:ids) AND bm.removed_at IS NULL AND bm.role IN (:roles) AND u.is_ai = 0`,
  { ids, roles: HUMAN_ROLES });
  const membersByBiz = groupBy(memberRows, 'business_id');
  const userIds = [...new Set(memberRows.map((r) => Number(r.user_id)))];
  const nowDate = new Date(now);

  const [lastUsedRows, appSessionRows, pushRows, calendarRows, grantRows, mailRows, roomRows] = await Promise.all([
    // 2) 마지막 접속 — refresh 토큰 마지막 사용(journey 와 같은 술어)
    userIds.length ? q('SELECT user_id, MAX(last_used_at) at FROM refresh_tokens WHERE user_id IN (:u) GROUP BY user_id', { u: userIds }) : [],
    // 3) 앱으로 로그인한 살아 있는 세션(onboarding.personalSetup 과 같은 술어)
    userIds.length ? q(`SELECT DISTINCT user_id FROM refresh_tokens
        WHERE user_id IN (:u) AND client_kind IN (:k) AND revoked_at IS NULL AND expires_at > :now`, { u: userIds, k: APP_CLIENT_KINDS, now: nowDate }) : [],
    // 4) 푸시 구독 — 알림(아무 종류) · 앱(apns/fcm)
    userIds.length ? q(`SELECT user_id, MAX(kind IN ('apns','fcm')) app FROM push_subscriptions
        WHERE user_id IN (:u) AND expired_at IS NULL GROUP BY user_id`, { u: userIds }) : [],
    // 5) 개인 캘린더 연결
    q(`SELECT DISTINCT business_id, user_id FROM external_connections
        WHERE business_id IN (:ids) AND owner_scope = 'user' AND provider IN (:p) AND is_active = 1`, { ids, p: CALENDAR_PROVIDERS }),
    // 6) AI 앱 — 동의를 마치고 끊지 않은 연결(이 워크스페이스 기본 또는 함께 허용)
    userIds.length ? q(`SELECT user_id, business_id, extra_business_ids FROM agent_grants
        WHERE user_id IN (:u) AND revoked_at IS NULL AND activated_at IS NOT NULL`, { u: userIds }) : [],
    // 7) 메일 계정·동기화 오류
    q(`SELECT business_id, COUNT(*) n, SUM(last_sync_error IS NOT NULL) err FROM email_accounts
        WHERE business_id IN (:ids) AND is_active = 1 GROUP BY business_id`, { ids }),
    // 8) 안내방 — 마지막 글·관리자 안 읽음(listRoomsForAdmin 과 같은 술어)·PlanQ 팀 마지막 발언·규칙별 마지막 보낸 시각
    q(`SELECT sr.business_id, sr.conversation_id, sr.human_requested_at, c.last_message_at,
          (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = sr.conversation_id AND m.is_ai = 0 AND m.is_deleted = 0 AND m.is_internal = 0
              AND (m.meta IS NULL OR JSON_EXTRACT(m.meta, '$.platform_staff') IS NULL)
              AND (sr.admin_last_read_at IS NULL OR m.created_at > sr.admin_last_read_at)) AS unread,
          (SELECT MAX(m.created_at) FROM messages m WHERE m.conversation_id = sr.conversation_id
              AND JSON_EXTRACT(m.meta, '$.platform_staff') = true) AS last_staff_at
        FROM support_rooms sr JOIN conversations c ON c.id = sr.conversation_id
       WHERE sr.business_id IN (:ids)`, { ids }),
  ]);
  const roomByBiz = new Map(roomRows.map((r) => [Number(r.business_id), r]));
  const convIds = roomRows.map((r) => r.conversation_id);
  // 9) 규칙 초안으로 보낸 기록 — meta.followup_rule (postStaffMessage 가 서버에서 찍는다)
  const sentRows = convIds.length ? await q(`
    SELECT conversation_id, JSON_UNQUOTE(JSON_EXTRACT(meta, '$.followup_rule')) rule_key, MAX(created_at) at
      FROM messages WHERE conversation_id IN (:c) AND JSON_EXTRACT(meta, '$.followup_rule') IS NOT NULL
     GROUP BY conversation_id, rule_key`, { c: convIds }) : [];
  // 10) 대표 언어(초안 틀)
  const ownerIds = [...new Set(businesses.map((b) => b.owner_id).filter(Boolean))];
  const langRows = ownerIds.length ? await q('SELECT id, language FROM users WHERE id IN (:o)', { o: ownerIds }) : [];

  const lastUsed = new Map(lastUsedRows.map((r) => [Number(r.user_id), r.at]));
  const appSession = new Set(appSessionRows.map((r) => Number(r.user_id)));
  const push = new Map(pushRows.map((r) => [Number(r.user_id), { any: true, app: Number(r.app) === 1 }]));
  const calendar = new Set(calendarRows.map((r) => `${r.business_id}:${r.user_id}`));
  const mail = new Map(mailRows.map((r) => [Number(r.business_id), { n: Number(r.n) || 0, err: Number(r.err) || 0 }]));
  const lang = new Map(langRows.map((r) => [Number(r.id), String(r.language || '').startsWith('en') ? 'en' : 'ko']));
  const sentByConv = groupBy(sentRows, 'conversation_id');
  const grantTouches = (g, biz) => {
    if (Number(g.business_id) === biz) return true;
    let extra = g.extra_business_ids;
    if (typeof extra === 'string') { try { extra = JSON.parse(extra); } catch { extra = null; } }
    return Array.isArray(extra) && extra.map(Number).includes(biz);
  };

  // 대표 단계 — 사람 1명 ~13 쿼리라 5곳씩(DB 풀 20)
  const stageOf = new Map();
  const withOwner = businesses.filter((b) => b.owner_id && (membersByBiz.get(b.id) || []).some((m) => Number(m.user_id) === b.owner_id));
  for (let i = 0; i < withOwner.length; i += OWNER_CONCURRENCY) {
    await Promise.all(withOwner.slice(i, i + OWNER_CONCURRENCY).map(async (b) => {
      const s = await getAdoptionStages({ businessId: b.id, userId: b.owner_id, role: 'owner' });
      stageOf.set(b.id, { current: s.current, stage_count: s.stage_count });
    }));
  }

  for (const b of businesses) {
    const ms = membersByBiz.get(b.id) || [];
    const uids = ms.map((m) => Number(m.user_id));
    const lastSeenAt = ms.reduce((acc, m) => laterOf(laterOf(acc, m.last_login_at), lastUsed.get(Number(m.user_id)) || null), null);
    const mailInfo = mail.get(b.id) || { n: 0, err: 0 };
    const setup = {
      app: uids.some((u) => appSession.has(u) || (push.get(u) && push.get(u).app)),
      notifications: uids.some((u) => push.has(u)),
      calendar: uids.some((u) => calendar.has(`${b.id}:${u}`)),
      ai_app: grantRows.some((g) => uids.includes(Number(g.user_id)) && grantTouches(g, b.id)),
      mail_accounts: mailInfo.n,
      mail_errors: mailInfo.err,
    };
    const stage = stageOf.get(b.id) || null;
    const ageDays = daysSince(createdOf(b), now);
    const trialDaysLeft = trialDaysLeftOf(b, now);
    const signals = computeSignals({
      inactiveDays: daysSince(lastSeenAt, now), trialDaysLeft, members: ms.length, ageDays,
      mailErrors: mailInfo.err, ownerStage: stage ? stage.current : null,
    });
    const r = roomByBiz.get(b.id);
    const room = r ? {
      conversation_id: r.conversation_id, last_message_at: r.last_message_at, unread: Number(r.unread) || 0,
      last_staff_at: r.last_staff_at || null, human_requested: !!r.human_requested_at,
    } : null;
    const sentAt = new Map(((r && sentByConv.get(Number(r.conversation_id))) || []).map((x) => [x.rule_key, x.at]));
    out.set(b.id, {
      stage, last_seen_at: lastSeenAt, members: ms.length, trial_days_left: trialDaysLeft,
      setup, signals, room,
      help: followupRules.helpFor({ signals, setup, ageDays, room, sentAt }),
      owner_lang: lang.get(b.owner_id) || 'ko',
    });
  }
  return out;
}

// ★ 플랫폼 관리자 목록 — 워크스페이스 경계를 넘는 것이 이 화면의 목적이다(라우트가 requireRole('platform_admin') 로 닫는다).
const M = () => require('../models');
const { businessSearchOr } = require('./adminSubscriptionView');
const { isExemptNow } = require('./billingExemptView');
const FOLLOWUP_BIZ_ATTRS = ['id', 'name', 'brand_name', 'owner_id', 'plan', 'subscription_status', 'trial_ends_at', 'created_at',
  'billing_exempt', 'billing_exempt_kind', 'billing_exempt_until'];
const CANDIDATE_CAP = 300;   // «도울 일 먼저» 정렬은 후보 전부를 요약해야 한다 — 상한(운영 수십 곳)

/** 범위 술어 — 목록·초안이 같은 함수. 우리 것(면제 internal)은 뺀다. */
async function followupCandidates({ days, q }) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const or = await businessSearchOr(q);
  const rows = await M().Business.findAll({
    where: {
      deleted_at: null,
      [Op.and]: [
        { [Op.or]: [{ created_at: { [Op.gte]: since } }, { subscription_status: 'trialing' }] },
        ...(or ? [{ [Op.or]: or }] : []),
      ],
    },
    attributes: FOLLOWUP_BIZ_ATTRS,
    include: [{ model: M().User, as: 'owner', attributes: ['id', 'name', 'email'], required: false }],
    order: [['created_at', 'DESC'], ['id', 'DESC']],
    limit: CANDIDATE_CAP,
  });
  return rows.filter((b) => !(isExemptNow(b) && b.billing_exempt_kind === 'internal'));
}

module.exports = {
  followupCandidates, FOLLOWUP_BIZ_ATTRS,
  computeSignals, summarize, daysSince, laterOf, trialDaysLeftOf,
  INACTIVE_DAYS, TRIAL_ENDING_DAYS, SOLO_AFTER_DAYS, STAGE1_STALL_DAYS,
};
