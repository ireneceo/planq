// 메일 읽음 — «사람 × 스레드» 한 곳 (2026-10-22 · docs/MAIL_MEMBER_READ_AND_REPLY_OWNER_DESIGN.md §7).
//
// Irene: *"공용메일을 읽었는지 안읽었는지를 멤버별로 … 그냥 읽음 표시는 누구 기준이야? … 내가 읽은 건지 아닌지 기준이고
//   읽은 거랑 답변한거 멤버별로 권한자 이름으로"*
//   옛 읽음은 워크스페이스 하나(email_threads.unread_count) — 누가 열면 모두에게 읽음이었다.
//
// 정본: email_thread_participants.last_read_message_id (내 커서).
// 나에게 안 읽음 = last_inbound_message_id > GREATEST(내 커서, 바닥 read_floor_message_id).
//   바닥은 배포 때 «옛 공용 읽음» 을 모두의 읽음으로 이은 값(scripts/migrate-mail-member-read.js) — 그 뒤 안 쓴다.
// 응답 키 `unread_count` 는 그대로 두고 값만 **보는 사람 기준 0/1** 로 바꾼다(Fable C2 — 화면·옛 번들 무변경).
//   그래서 읽는 쪽은 `unreadAttribute(userId)` 로 그 칸을 갈아 끼운다. 칸 unread_count 를 직접 읽지 않는다(가드 mailread).
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');

const BULK_CHUNK = 500;

function uid(userId) {
  const n = Number(userId);
  if (!Number.isInteger(n) || n <= 0) throw new Error('mailRead: userId required');
  return n;
}

// 판정 SQL 조각. alias = 그 쿼리에서 email_threads 의 이름(Sequelize findAll 은 모델명 `EmailThread`).
//   참여자 행은 (thread_id, user_id) 유니크 인덱스로 한 행만 찾는다.
function unreadExpr(userId, alias = 'EmailThread') {
  const a = `\`${alias}\``;
  return `(${a}.\`last_inbound_message_id\` IS NOT NULL AND ${a}.\`last_inbound_message_id\` > GREATEST(
    COALESCE((SELECT p.last_read_message_id FROM email_thread_participants p
              WHERE p.thread_id = ${a}.\`id\` AND p.user_id = ${uid(userId)}), 0),
    COALESCE(${a}.\`read_floor_message_id\`, 0)))`;
}

/** where 조각 — 나에게 안 읽은 스레드만. `Op.and` 배열에 넣는다. */
function unreadForWhere(userId, alias) {
  return sequelize.literal(unreadExpr(userId, alias));
}

/** attributes 쌍 — `unread_count` 를 보는 사람 기준 0/1 로 갈아 끼운다(attributes.exclude 에 'unread_count' 를 같이 넣을 것). */
function unreadAttribute(userId, alias) {
  return [sequelize.literal(`(CASE WHEN ${unreadExpr(userId, alias)} THEN 1 ELSE 0 END)`), 'unread_count'];
}

/** 한 스레드가 나에게 안 읽음인가 — 인스턴스(또는 plain)와 내 커서로. */
function isUnreadFor(thread, cursor) {
  const last = Number(thread.last_inbound_message_id) || 0;
  if (!last) return false;
  return last > Math.max(Number(cursor) || 0, Number(thread.read_floor_message_id) || 0);
}

/**
 * 읽음 쓰기 — 단일 UPSERT(Fable C3). 커서는 앞으로만 간다(GREATEST). 담당·팔로우·보는 중 칸은 건드리지 않는다.
 * threadIds 는 **호출부가 범위(business_id·접근 계정)를 거른 것**이어야 한다.
 */
async function markReadFor(userId, threadIds) {
  const u = uid(userId);
  const ids = [...new Set((threadIds || []).map(Number).filter(Boolean))];
  let n = 0;
  for (let i = 0; i < ids.length; i += BULK_CHUNK) {
    const chunk = ids.slice(i, i + BULK_CHUNK);
    const [res] = await sequelize.query(`INSERT INTO email_thread_participants
        (thread_id, user_id, is_assigned, is_following, last_read_message_id, last_read_at, is_viewing, is_drafting, created_at, updated_at)
      SELECT t.id, ${u}, 0, 0, t.last_inbound_message_id, NOW(), 0, 0, NOW(), NOW()
        FROM email_threads t WHERE t.id IN (:chunk) AND t.last_inbound_message_id IS NOT NULL
      ON DUPLICATE KEY UPDATE
        last_read_message_id = GREATEST(COALESCE(last_read_message_id, 0), VALUES(last_read_message_id)),
        last_read_at = VALUES(last_read_at), updated_at = VALUES(updated_at)`,
    { replacements: { chunk } });
    n += Number(res && (res.affectedRows ?? 0)) || 0;
  }
  return n;
}

/**
 * 이 메일 계정을 지금 볼 수 있는 멤버 — 공용 = qmail 메뉴가 none 이 아닌 멤버(AI 제외) · 개인 = 주인만.
 * 반환 [{ user_id, name }]. 이름은 워크스페이스 표시명(BusinessMember.name → User.name).
 */
async function audienceOf(businessId, account) {
  const { BusinessMember, User } = require('../models');
  const ownerId = account && account.owner_user_id ? Number(account.owner_user_id) : null;
  const where = { business_id: Number(businessId), user_id: { [Op.ne]: null } };
  if (ownerId) where.user_id = ownerId;
  const rows = await BusinessMember.findAll({
    where, attributes: ['user_id', 'name', 'role'],
    include: [{ model: User, as: 'user', attributes: ['id', 'name', 'status'], required: true }],
  });
  const { getMemberMenuLevels } = require('../middleware/menu_permission');
  const out = [];
  for (const r of rows) {
    if (r.role === 'ai') continue;
    if (r.user && r.user.status && r.user.status !== 'active') continue;
    if (!ownerId) {
      try {
        const lv = await getMemberMenuLevels(businessId, r.user_id);
        if (lv && lv.menus && lv.menus.qmail === 'none') continue;
      } catch { /* 권한 표를 못 읽으면 기본(열린 문화)으로 둔다 — 명단 표시용이다 */ }
    }
    out.push({ user_id: r.user_id, name: r.name || (r.user && r.user.name) || null });
  }
  return out;
}

/**
 * 상세의 «읽음 n/m» 재료 — 명단 각 사람이 마지막 받은 메일까지 읽었나 + 시각. 답장한 멤버는 호출부(senderMap)가 더한다.
 * thread 는 last_inbound_message_id·read_floor_message_id 를 가진 행.
 */
async function readersOf(thread, audience) {
  const { EmailThreadParticipant } = require('../models');
  const ids = audience.map((a) => a.user_id);
  const parts = ids.length ? await EmailThreadParticipant.findAll({
    where: { thread_id: thread.id, user_id: { [Op.in]: ids } },
    attributes: ['user_id', 'last_read_message_id', 'last_read_at'],
  }) : [];
  const byUser = new Map(parts.map((p) => [p.user_id, p]));
  return audience.map((a) => {
    const p = byUser.get(a.user_id);
    const read = !isUnreadFor(thread, p ? p.last_read_message_id : null);
    // 바닥으로만 읽음이 된 사람(옛 공용 읽음)은 시각을 모른다 — null 로 둔다.
    const at = read && p && p.last_read_message_id ? p.last_read_at : null;
    return { user_id: a.user_id, name: a.name, read, read_at: at };
  });
}

module.exports = { unreadForWhere, unreadAttribute, isUnreadFor, markReadFor, audienceOf, readersOf, unreadExpr };
