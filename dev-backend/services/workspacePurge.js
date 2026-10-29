// 지운 워크스페이스 정리 — 유예(30일)가 끝난 곳의 파일 바이트·외부 연결·고객 개인정보를 지운다.
//   docs/WORKSPACE_DELETION_DESIGN.md ①-2 · ⑥ (Fable 설계 판정 2026-10-29). 매일 00시 묶음에서 돈다.
//
//   대상: deleted_at 있음 ∧ purged_at 없음 ∧ purge_after ≤ 지금 ∧
//         (사유 owner_request ∨ 주인 계정이 이미 익명화됨) — 계정 탈퇴로 지운 곳은 계정 복구가 되살릴 수 있는 동안 건드리지 않는다.
//         ★ 계정 탈퇴본은 purge_after 가 비어 있다(탈퇴는 계정 쪽 유예를 쓴다) → 주인이 익명화됐으면 purge_after 없이도 대상.
//   지우는 것: 파일 바이트(filePurge 한 문) · Q Note 회의·문서(purge-business) · 메일 계정 자격(행은 두고 비밀값·사용 끔) ·
//             클라우드·외부 연결·API·AI 앱 토큰 행 · 공유 링크·게스트 링크·초대 링크 · 고객 개인 연락처 · 구독(canceled).
//   남기는 것: businesses 행 · 청구서·결제·세금계산서·환불 · 감사 로그 · 멤버 행 · 대화·문서 본문(접근은 이미 404 — 본문 하드 퍼지는 다음 단계).
//   멱등 — purged_at 은 모든 단계가 끝난 뒤에만 찍는다. 중간에 실패하면 다음 날 처음부터 다시(이미 지운 것은 0건).
// cronalive-exempt: 지운 워크스페이스만 고르는 정리 작업 — 살아 있는 곳을 거르는 술어의 반대편이다
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const M = require('../models');

const FILE_BATCH = 200;
const MAX_FILE_BATCHES = 50;   // 한 번에 1만 개까지 — 남으면 다음 날 이어서(purged_at 을 안 찍는다)
const SHARE_COLS = ['share_token', 'shared_at', 'share_created_at', 'share_expires_at', 'share_password_hash'];
const SHARE_MODELS = ['Post', 'Task', 'Document', 'CalendarEvent', 'Invoice', 'File', 'KbDocument', 'FileFolder', 'Report', 'Quote', 'EmailThread'];

async function dueBusinesses(now = new Date(), onlyIds = null) {
  const rows = await M.Business.findAll({
    where: {
      deleted_at: { [Op.ne]: null },
      purged_at: null,
      ...(Array.isArray(onlyIds) ? { id: { [Op.in]: onlyIds } } : {}),
    },
    attributes: ['id', 'owner_id', 'deletion_reason', 'purge_after'],
    raw: true,
  });
  const out = [];
  for (const b of rows) {
    if (b.deletion_reason === 'owner_request') {
      if (b.purge_after && new Date(b.purge_after) <= now) out.push(b);
      continue;
    }
    // 계정 탈퇴본 — 주인 계정이 익명화된 뒤에만(계정 복구가 되살릴 수 있는 동안은 바이트를 지우지 않는다)
    const owner = await M.User.findByPk(b.owner_id, { attributes: ['anonymized_at'], raw: true });
    if (owner?.anonymized_at) out.push(b);
  }
  return out;
}

async function purgeQNoteBusiness(businessId) {
  const base = process.env.QNOTE_INTERNAL_URL || 'http://localhost:8000';
  try {
    const res = await fetch(`${base}/api/sessions/internal/purge-business`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-api-key': process.env.INTERNAL_API_KEY || '' },
      body: JSON.stringify({ business_id: businessId }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) { console.warn('[workspacePurge] qnote', businessId, 'status', res.status); return false; }
    return true;
  } catch (e) { console.warn('[workspacePurge] qnote', businessId, e.message); return false; }
}

// 파일 바이트 — filePurge.purgeFile 한 문(dedup ref_count·산 참조·Drive 사본을 그 함수가 판단한다).
//   바이트가 끝까지 지워졌으면 true, 상한에 걸려 남았으면 false(다음 날 이어서).
async function purgeFiles(businessId) {
  const { purgeFile, flushPurgeExternals } = require('./filePurge');
  for (let i = 0; i < MAX_FILE_BATCHES; i++) {
    const batch = await M.File.findAll({
      where: { business_id: businessId, purged_at: null },
      paranoid: false, limit: FILE_BATCH, order: [['id', 'ASC']],
    });
    if (!batch.length) return true;
    const queue = [];
    const t = await sequelize.transaction();
    try {
      for (const f of batch) {
        if (!f.deleted_at) { f.deleted_at = new Date(); await f.save({ transaction: t, hooks: false }); }
        await purgeFile(f, t, queue);
      }
      await t.commit();
    } catch (e) { await t.rollback().catch(() => {}); throw e; }
    await flushPurgeExternals(queue);   // 외부(Drive) 삭제는 커밋 뒤
  }
  return (await M.File.count({ where: { business_id: businessId, purged_at: null }, paranoid: false })) === 0;
}

async function purgeRest(businessId) {
  const t = await sequelize.transaction();
  try {
    const where = { business_id: businessId };
    // 메일 계정 — 행을 지우면 메일 스레드가 CASCADE 로 통째로 사라진다(본문 하드 퍼지는 다음 단계). 자격만 지우고 끈다.
    await M.EmailAccount.update({
      is_active: false, imap_password_encrypted: null, smtp_password_encrypted: null,
      oauth_access_token_encrypted: null, oauth_refresh_token_encrypted: null,
    }, { where, transaction: t });
    await M.BusinessCloudToken.destroy({ where, transaction: t });
    await M.ExternalConnection.destroy({ where, transaction: t });
    await M.ApiToken.destroy({ where, transaction: t });
    await M.AgentGrant.destroy({ where, transaction: t });

    // 공유 링크 — 공개 라우터가 이미 닫았지만(workspaceAliveParam) 열쇠 자체를 없앤다
    for (const name of SHARE_MODELS) {
      const Model = M[name];
      if (!Model || !Model.rawAttributes.business_id || !Model.rawAttributes.share_token) continue;
      const patch = {};
      for (const c of SHARE_COLS) if (Model.rawAttributes[c]) patch[c] = null;
      await Model.update(patch, { where: { ...where, share_token: { [Op.ne]: null } }, transaction: t, paranoid: false, hooks: false });
    }
    if (M.KbShareBundle) await M.KbShareBundle.destroy({ where, transaction: t });
    if (M.ReportShare) await M.ReportShare.destroy({ where, transaction: t });
    if (M.GuestLink) await M.GuestLink.update({ revoked_at: new Date() }, { where: { ...where, revoked_at: null }, transaction: t });

    // 초대 링크 — 아직 수락 안 된 멤버·고객 초대
    await M.BusinessMember.update({ invite_token: null }, { where: { ...where, invite_token: { [Op.ne]: null } }, transaction: t });
    const projectIds = (await M.Project.findAll({ where, attributes: ['id'], raw: true, transaction: t })).map((p) => p.id);
    if (projectIds.length) {
      await M.ProjectClient.update({ invite_token: null }, { where: { project_id: { [Op.in]: projectIds }, invite_token: { [Op.ne]: null } }, transaction: t });
    }

    // 고객 개인 연락처 — 청구 증빙에 쓰는 사업자 정보(biz_*·tax_invoice_email)는 남긴다(세무 보존, 계정 탈퇴와 같은 트레이드오프)
    const clientIds = (await M.Client.findAll({ where, attributes: ['id'], raw: true, transaction: t })).map((c) => c.id);
    if (clientIds.length) {
      await M.Client.update({
        display_name: '삭제된 고객', display_name_localized: null, invite_token: null, invite_email: null,
        phone: null, email_aliases: null, notes: null, summary: null, summary_json: null,
        billing_contact_name: null, billing_contact_email: null, billing_contact_phone: null,
        job_title: null, department: null,
      }, { where: { id: { [Op.in]: clientIds } }, transaction: t });
      // 대화방 제목에 고객 이름이 박제돼 있다(clientOnboarding) — 계정 탈퇴 익명화와 같은 처리
      await M.Conversation.update({ title: '삭제된 고객' }, { where: { client_id: { [Op.in]: clientIds } }, transaction: t });
    }

    await M.Subscription.update(
      { status: 'canceled', cancel_reason: 'workspace_purged' },
      { where: { ...where, status: { [Op.notIn]: ['canceled', 'replaced'] } }, transaction: t });

    await M.Business.update({ purged_at: new Date() }, { where: { id: businessId }, transaction: t });
    await t.commit();
  } catch (e) { await t.rollback().catch(() => {}); throw e; }
}

/** @param {{ onlyIds?: number[], now?: Date }} opts — onlyIds 는 검증용(그 워크스페이스만) */
async function runWorkspacePurge(opts = {}) {
  const now = opts.now || new Date();
  const due = await dueBusinesses(now, opts.onlyIds || null);
  const out = { due: due.length, purged: 0, deferred: 0, failed: 0 };
  for (const b of due) {
    try {
      if (!(await purgeQNoteBusiness(b.id))) { out.deferred += 1; continue; }   // 회의 기록이 남은 채 «정리됨» 으로 찍지 않는다
      if (!(await purgeFiles(b.id))) { out.deferred += 1; continue; }
      await purgeRest(b.id);
      out.purged += 1;
      require('./auditService').logAudit(null, {
        action: 'business.purge', targetType: 'business', targetId: b.id, businessId: null, userId: null,   // 플랫폼 행 — 지운 워크스페이스는 플랜 보관기간이 없다(삭제 기록과 같은 이유)
        newValue: { purged_at: new Date(), reason: b.deletion_reason },
      });
    } catch (e) {
      out.failed += 1;
      console.warn('[workspacePurge] biz', b.id, e.message);
    }
  }
  return out;
}

module.exports = { runWorkspacePurge, dueBusinesses };
