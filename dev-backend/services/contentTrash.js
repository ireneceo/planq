// services/contentTrash.js — 문서(Q docs) · 정보(Q info) 휴지통 영구삭제 **한 벌** (0-D, docs/FIX_0CDEF_ACCESS_DESIGN.md)
//
// 왜: 파일은 services/uploadCleanup.js 가 보관기간이 지나면 지운다. 문서·정보는 `purge_after` 스탬프와
//   화면의 «만료» 표시까지만 있고 **지우는 cron 이 없었다** — 약속한 보관기간이 끝나도 영원히 남았다.
//
// · 영구삭제 본문(purgeContentRow)은 사람의 [영구 삭제](routes/content_trash.js)와 cron 이 **같은 함수**를 쓴다.
// · 판정은 파일과 같은 술어(services/retentionPolicy resolveRetention + isExpired, 래칫 업 · 못 읽으면 보존).
// · ★ 별도 플래그 `CONTENT_TRASH_PURGE_APPLY=1` 일 때만 지운다(기본 꺼짐 = 리포트 모드).
//   파일 cron 의 RETENTION_PURGE_APPLY 와 묶지 않는다 — 묶으면 배포 직후 자정에 리포트 없이 바로 지운다.
//   되돌릴 수 없는 삭제의 첫 회차는 숫자(would_remove)를 먼저 본다.
const { Op } = require('sequelize');

/**
 * 영구삭제 한 벌 — 딸린 것(Q info 검색 청크 · Q docs 첨부 연결)부터 지우고 행을 지운다.
 *   휴지통행 시점에 지우면 복원해도 속이 빈 문서가 된다. 영구삭제는 되돌릴 수 없으니 여기가 맞는 자리다.
 * @param {'post'|'kb'} kind
 */
async function purgeContentRow(kind, row, { transaction } = {}) {
  const M = require('../models');
  if (kind === 'kb') await M.KbChunk.destroy({ where: { kb_document_id: row.id }, transaction });
  else await M.PostAttachment.destroy({ where: { post_id: row.id }, transaction });
  await row.destroy({ force: true, transaction });
}

/**
 * 만료된 문서·정보 휴지통 행을 지운다(플래그가 켜졌을 때만). uploadCleanup.runUploadCleanup 과 같은 모양.
 * @param {Date} today
 * @param {{apply?: boolean, onlyBusinessIds?: number[]}} opts
 *   apply 를 명시하면 플래그보다 우선(검사·수동 실행용). onlyBusinessIds — 검사가 자기 픽스처 워크스페이스만 지우게
 *   좁힌다(health-check 가 dev 의 다른 휴지통 행을 건드리지 않게). cron 은 넘기지 않는다.
 * @returns {{ mode, scanned, removed, failed, skipped, would_remove }}
 */
async function runContentTrashPurge(today = new Date(), opts = {}) {
  const M = require('../models');
  const { sequelize } = require('../config/database');
  const { resolveRetention, isExpired } = require('./retentionPolicy');
  const apply = typeof opts.apply === 'boolean' ? opts.apply : process.env.CONTENT_TRASH_PURGE_APPLY === '1';

  const retCache = new Map();
  const retFor = async (bizId) => {
    if (!retCache.has(bizId)) retCache.set(bizId, await resolveRetention(bizId, 'trash'));
    return retCache.get(bizId);
  };

  const out = { mode: apply ? 'apply' : 'report', scanned: 0, removed: 0, failed: 0, skipped: {}, would_remove: 0 };
  for (const [kind, Model] of [['post', M.Post], ['kb', M.KbDocument]]) {
    const candidates = await Model.findAll({
      paranoid: false,
      where: {
        deleted_at: { [Op.ne]: null },
        ...(Array.isArray(opts.onlyBusinessIds) ? { business_id: { [Op.in]: opts.onlyBusinessIds } } : {}),
      },
      limit: 2000,
      order: [['deleted_at', 'ASC']],
    });
    for (const row of candidates) {
      out.scanned += 1;
      const ret = await retFor(row.business_id);
      if (!ret.ok) { out.skipped[ret.reason] = (out.skipped[ret.reason] || 0) + 1; continue; }   // 못 읽으면 보존
      if (!isExpired(row.purge_after, row.deleted_at, ret.days, today)) continue;
      out.would_remove += 1;
      if (!apply) continue;
      const t = await sequelize.transaction();
      try {
        await purgeContentRow(kind, row, { transaction: t });
        await t.commit();
        out.removed += 1;
      } catch (e) {
        await t.rollback().catch(() => {});
        out.failed += 1;
        console.warn('[content-trash] purge failed', kind, row.id, e.message);
        continue;
      }
      try {
        // 감사 단일 지점(스탬프·마스킹) — await 해서 회차 결과와 원장이 같은 순간을 말하게 한다
        await require('./auditService').writeAudit({
          userId: null, businessId: row.business_id,
          action: kind === 'post' ? 'post.purge' : 'kb.document_purge',
          targetType: kind, targetId: row.id,
          oldValue: { title: row.title, by: 'retention' },
        });
      } catch (e) { console.warn('[content-trash] audit failed', e.message); }
    }
  }
  return out;
}

module.exports = { purgeContentRow, runContentTrashPurge };
