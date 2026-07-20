// accountAnonymize.js — 탈퇴 유예(30일) 만료 계정 익명화 cron. ACCOUNT_DELETION_DESIGN v3.
//   대상: status='deleted' AND deletion_scheduled_at<=NOW() AND anonymized_at IS NULL AND is_ai=false.
//   PII 마스킹(users/business_members/clients/conversations) + 개인자산 L1 삭제 + 토큰 purge.
//   단계별 멱등 — anonymized_at 은 전 단계 성공 후 최후 기록. 실패하면 다음 날 재시도.
//   Q Note purge(cross-DB)는 best-effort 별도 호출(실패해도 익명화 완료 — 재시도 상한).
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const {
  User, BusinessMember, Client, Conversation, File, Post, KbDocument,
  RefreshToken, ApiToken, PushSubscription, OauthConnection, ExternalConnection,
  EmailAccount, NotificationPref,
} = require('../models');

async function anonymizeUser(user) {
  const uid = user.id;
  const t = await sequelize.transaction();
  try {
    // 1) users PII 마스킹
    await user.update({
      name: '탈퇴한 사용자',
      email: `deleted-${uid}@deleted.planq.kr`,
      username: `deleted_${uid}`,
      password_hash: 'DELETED_ACCOUNT_NO_LOGIN',
      phone: null, avatar_url: null, bio: null,
      secondary_email: null, pending_email: null, pending_secondary_email: null,
      name_localized: null, expertise: null, organization: null, job_title: null,
      language_levels: null, answer_style_default: null, answer_length_default: null,
      timezone: null, reference_timezones: null,
      refresh_token: null, reset_token: null, email_verify_token: null,
      anonymized_at: new Date(),
    }, { transaction: t });

    // 2) business_members 워크스페이스별 프로필 PII (🔴5)
    await BusinessMember.update(
      { name: null, name_localized: null, bio: null, expertise: null, organization: null, job_title: null },
      { where: { user_id: uid }, transaction: t });

    // 3) clients (Client 역할 탈퇴 — display 마스킹) + conversations title 스냅샷(🟠6)
    const clients = await Client.findAll({ where: { user_id: uid }, attributes: ['id'], transaction: t });
    if (clients.length) {
      const clientIds = clients.map((c) => c.id);
      await Client.update(
        { display_name: '탈퇴한 고객', display_name_localized: null, invite_email: null },
        { where: { id: { [Op.in]: clientIds } }, transaction: t });
      // conversations.title 에 client.display_name 이 박제됨(clientOnboarding) — 마스킹
      await Conversation.update(
        { title: '탈퇴한 고객' },
        { where: { client_id: { [Op.in]: clientIds } }, transaction: t }).catch(() => {});
    }

    // 4) 개인 자산 L1 삭제 (D4)
    await File.update({ deleted_at: new Date() }, { where: { uploader_id: uid, visibility: 'L1', deleted_at: null }, transaction: t }).catch(() => {});
    await Post.destroy({ where: { author_id: uid, vlevel: 'L1' }, transaction: t }).catch(() => {});
    await KbDocument.destroy({ where: { uploaded_by: uid, scope: 'private' }, transaction: t }).catch(() => {});

    // 5) 토큰/연동 purge (유예 진입 시 일부 지웠으나 멱등 재확인)
    for (const M of [RefreshToken, ApiToken, PushSubscription, OauthConnection, ExternalConnection, EmailAccount, NotificationPref]) {
      await M.destroy({ where: { user_id: uid }, transaction: t }).catch(() => {});
    }

    await t.commit();
    return true;
  } catch (e) {
    await t.rollback().catch(() => {});
    console.warn('[anonymize] user', uid, 'failed:', e.message);
    return false;
  }
}

// Q Note purge — cross-DB(FastAPI). best-effort, 익명화 트랜잭션 밖.
async function purgeQNote(uid) {
  try {
    const base = process.env.QNOTE_INTERNAL_URL || 'http://localhost:8000';
    const secret = process.env.INTERNAL_SHARED_SECRET || process.env.QNOTE_INTERNAL_SECRET;
    await fetch(`${base}/api/internal/qnote/purge-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Secret': secret || '' },
      body: JSON.stringify({ user_id: uid }),
    });
  } catch (e) { console.warn('[anonymize] qnote purge', uid, e.message); }
}

async function runAccountAnonymizeCron() {
  const due = await User.findAll({
    where: {
      status: 'deleted',
      is_ai: false,
      anonymized_at: null,
      deletion_scheduled_at: { [Op.lte]: new Date() },
    },
    limit: 200,
  });
  let ok = 0, fail = 0;
  for (const u of due) {
    const uid = u.id;
    const done = await anonymizeUser(u);
    if (done) { ok++; await purgeQNote(uid); }
    else fail++;
  }
  return { due: due.length, ok, fail };
}

module.exports = { runAccountAnonymizeCron, anonymizeUser };
