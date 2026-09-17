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

/** 익명화가 지운 L1 파일의 Drive 사본 — **커밋 뒤** 거둔다(되돌릴 수 없는 외부 호출). */
// ★ 요청 스코프로 받는다 — 모듈 전역이면 사용자끼리 섞인다(Fable 9차 N1 과 같은 모양).
async function flushAnonymizeRecalls(pendingAnonymizeRecalls) {
  const { File } = require('../models');
  const { recallDriveMirror } = require('./driveMirrorRecall');
  while (pendingAnonymizeRecalls.length) {
    const id = pendingAnonymizeRecalls.shift();
    try {
      const f = await File.findByPk(id, { paranoid: false });
      if (!f || !f.gdrive_mirror_id) continue;
      const patch = {};
      const r = await recallDriveMirror(f, patch);
      if ((r === 'removed' || r === 'shared') && Object.keys(patch).length) await f.update(patch, { hooks: false });
    } catch (e) { console.warn('[accountAnonymize] Drive 회수 실패', id, e.message); }
  }
}

async function anonymizeUser(user) {
  const uid = user.id;
  const anonymizeRecalls = [];   // ★ 요청(사용자) 스코프 — 전역이면 섞인다
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
      password_reset_token: null, email_change_otp_hash: null, secondary_email_otp_hash: null,
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
        { where: { client_id: { [Op.in]: clientIds } }, transaction: t });
    }

    // 4) 개인 자산 L1 삭제 (D4). ★ catch 제거 — 실패하면 rollback 되어 anonymized_at 미기록 → 재시도(🟠4).
    //   침묵 catch 가 Unknown column 을 삼켜 "성공했는데 PII 잔존"이 나던 것(🔴1 실사례).
    // ★ Drive 사본도 거둔다 (2026-09-17, Fable 8차 ④).
    //   여기는 `trashFile` 을 우회해 `deleted_at` 만 찍는다(트랜잭션 안이라 그 설계가 맞다).
    //   그런데 그러면 **회수도 쿼터 반환도 안 일어난다** — 탈퇴한 사람의 개인 파일 사본이
    //   공유 폴더에 남는다. L1 은 이제 미러 대상이 아니지만 **과거분은 이미 올라가 있다**
    //   (운영 실측 L1 미러 12건). 지울 대상을 먼저 챙겨 두고 **커밋 뒤** 거둔다.
    const l1Mirrored = await File.findAll({
      where: { uploader_id: uid, visibility: 'L1', deleted_at: null, storage_provider: 'planq' },
      attributes: ['id'], transaction: t, raw: true,
    });
    if (l1Mirrored.length) anonymizeRecalls.push(...l1Mirrored.map((r) => r.id));
    await File.update({ deleted_at: new Date() }, { where: { uploader_id: uid, visibility: 'L1', deleted_at: null }, transaction: t });
    await Post.destroy({ where: { author_id: uid, vlevel: 'L1' }, transaction: t });
    await KbDocument.destroy({ where: { uploaded_by: uid, scope: 'private' }, transaction: t });

    // 5) 토큰/연동 purge — ★ 각 모델의 실제 user FK 컬럼명(EmailAccount 만 owner_user_id).
    //   컬럼명이 맞으면 destroy 는 매칭 0건이어도 에러 없음. catch 없이 진짜 에러는 rollback.
    await RefreshToken.destroy({ where: { user_id: uid }, transaction: t });
    await ApiToken.destroy({ where: { user_id: uid }, transaction: t });
    await PushSubscription.destroy({ where: { user_id: uid }, transaction: t });
    await OauthConnection.destroy({ where: { user_id: uid }, transaction: t });
    await ExternalConnection.destroy({ where: { user_id: uid }, transaction: t });
    await EmailAccount.destroy({ where: { owner_user_id: uid }, transaction: t });
    await NotificationPref.destroy({ where: { user_id: uid }, transaction: t });

    await t.commit();
    await flushAnonymizeRecalls(anonymizeRecalls);   // ★ 커밋 뒤에 Drive 사본을 거둔다
    return true;
  } catch (e) {
    await t.rollback().catch(() => {});
    console.warn('[anonymize] user', uid, 'failed:', e.message);
    return false;
  }
}

// Q Note purge — cross-DB(FastAPI). 익명화 트랜잭션 밖(멱등, 실패 시 다음 cron 재시도).
//   URL·헤더는 exportJobWorker 와 동일 규약(QNOTE_INTERNAL_URL + /api/sessions/internal + x-internal-api-key).
//   실패해도 users.anonymized_at 은 이미 커밋됨 — 하지만 음성 지문 잔존은 심각하므로 실패를 반환해 재시도 유도.
async function purgeQNote(uid) {
  const base = process.env.QNOTE_INTERNAL_URL || 'http://localhost:8000';
  const key = process.env.INTERNAL_API_KEY;
  try {
    const res = await fetch(`${base}/api/sessions/internal/purge-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-api-key': key || '' },
      body: JSON.stringify({ user_id: uid }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) { console.warn('[anonymize] qnote purge', uid, 'status', res.status); return false; }
    return true;
  } catch (e) { console.warn('[anonymize] qnote purge', uid, e.message); return false; }
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
    // Q Note purge(음성 지문 등)를 먼저 — 실패하면 익명화를 보류해 다음 cron 재시도(anonymized_at 미기록).
    //   전부 성공 or 전무. 생체정보가 남은 채 "익명화 완료"로 표시되지 않게 (Fable 🔴2).
    const qnoteOk = await purgeQNote(uid);
    if (!qnoteOk) { fail++; continue; }
    const done = await anonymizeUser(u);
    if (done) ok++; else fail++;
  }
  return { due: due.length, ok, fail };
}

module.exports = { runAccountAnonymizeCron, anonymizeUser };
