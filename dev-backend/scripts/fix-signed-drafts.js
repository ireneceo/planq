// 서명·확인 요청이 나간 임시저장(draft) 문서를 발행 상태로 — 2026-10-23
//   Irene: «서명이 다 완료된 이 파일이 왜 [임시저장]이라고 리스트에 나와?» (프로젝트 매니지먼트 업무협력 계약서)
//
//   2026-10-23 전에는 자동저장 draft 그대로 서명 요청을 보낼 수 있었고, 요청이 문서를 잠가(signatureCore.isPostSignatureLocked)
//   명시 저장(승격 PUT)도 409 라 영영 draft 로 남았다. 지금은 요청을 보내는 순간 발행한다(routes/signatures.js).
//   이 스크립트는 그 전에 생긴 행만 고친다 — **status 만** draft → published. 공개 범위(vlevel)는 그대로(넓히지 않는다).
//
//   기본은 **읽기만**(대상 목록) · --apply 면 고치고 감사(post.create, via signature.backfill) 남김. 멱등(다시 돌리면 0건).
//   롤백: 감사 행의 target_id 들을 status='draft' 로.
require('dotenv').config();
const { sequelize } = require('../config/database');
const APPLY = process.argv.includes('--apply');

(async () => {
  try {
    const [rows] = await sequelize.query(`
      SELECT p.id, p.business_id, p.author_id, p.vlevel, p.title,
             COUNT(s.id) AS reqs, SUM(s.status = 'signed') AS signed
        FROM posts p
        JOIN signature_requests s ON s.entity_type = 'post' AND s.entity_id = p.id AND s.business_id = p.business_id
       WHERE p.status = 'draft' AND p.deleted_at IS NULL
         AND s.status NOT IN ('canceled', 'superseded')
       GROUP BY p.id
       ORDER BY p.id`);
    console.log(`[fix-signed-drafts] 대상 ${rows.length}건${APPLY ? '' : ' (읽기만 — --apply 로 고침)'}`);
    for (const r of rows) console.log(`  #${r.id} ws=${r.business_id} ${r.vlevel} 요청 ${r.reqs}·서명 ${r.signed} «${String(r.title).slice(0, 40)}»`);
    if (!APPLY || rows.length === 0) process.exit(0);

    const ids = rows.map((r) => r.id);
    await sequelize.transaction(async (t) => {
      await sequelize.query(`UPDATE posts SET status = 'published' WHERE status = 'draft' AND id IN (:ids)`, { replacements: { ids }, transaction: t });
      const { writeAudit } = require('../services/auditService');
      for (const r of rows) {
        await writeAudit({
          businessId: r.business_id, action: 'post.create', targetType: 'post', targetId: r.id,
          oldValue: { status: 'draft' }, newValue: { status: 'published', via: 'signature.backfill' },
        }, { transaction: t });
      }
    });
    const [[left]] = await sequelize.query(`SELECT COUNT(*) AS n FROM posts WHERE status = 'draft' AND id IN (:ids)`, { replacements: { ids } });
    console.log(`[fix-signed-drafts] 고침 ${ids.length}건 · 남은 draft ${left.n}`);
    process.exit(left.n === 0 ? 0 : 1);
  } catch (e) {
    console.error('[fix-signed-drafts]', e.message);
    process.exit(1);
  }
})();
