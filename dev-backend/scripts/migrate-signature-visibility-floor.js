// 서명·확인 요청이 살아 있는 «나만 보기»(L1) 문서를 공개 범위 바닥(L2)으로 — 2026-10-23 · Fable 설계 DESIGN-CHANGE
//   Irene: «팀 계약인데 나만이라고 공개가 나오는게 맞아? 서명을 회사이름으로 하면 개인이 마음대로 나만으로 하면 안되는 것 같은데.»
//
//   지금은 보내는 순간 올린다(routes/signatures.js → signatureCore.raisePostToSignatureFloor). 이 스크립트는 그 전에 생긴 행만.
//   판정·올리는 방식은 같은 함수(signatureCore.signatureVisibilityFloor / raisePostToSignatureFloor) — 두 벌로 두지 않는다.
//     프로젝트 문서 → L2(프로젝트 멤버 + 그 프로젝트 고객) · 프로젝트 없음 → L2 특정 멤버(작성자 ∪ 우리 쪽 서명자, owner/admin 은 L2 를 본다).
//
//   기본은 **읽기만**(대상 목록) · --apply 면 고치고 감사(post.visibility_change, reason signature_floor.backfill). 멱등(다시 돌리면 0건).
//   ★ 운영은 숨겨 둔 문서가 보이게 되는 변경이라 Irene 답(일괄 올림 / 앞으로만)을 받은 뒤 배포 방에서만 --apply.
//   롤백: 감사 행 old_value.vlevel 로 되돌림(target_member_ids 는 new_value 에 남김).
require('dotenv').config();
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { Post, SignatureRequest } = require('../models');
const core = require('../services/signatureCore');
const APPLY = process.argv.includes('--apply');

(async () => {
  try {
    const reqs = await SignatureRequest.findAll({
      where: { entity_type: 'post', status: { [Op.in]: core.SIGNATURE_ACTIVE_STATUSES } },
      attributes: ['entity_id'], group: ['entity_id'], raw: true,
    });
    const ids = reqs.map((r) => r.entity_id);
    const posts = ids.length ? await Post.findAll({ where: { id: { [Op.in]: ids }, vlevel: 'L1' } }) : [];
    console.log(`[sig-vis-floor] 대상 ${posts.length}건${APPLY ? '' : ' (읽기만 — --apply 로 고침)'}`);
    for (const p of posts) {
      const f = await core.signatureVisibilityFloor(p);
      console.log(`  #${p.id} ws=${p.business_id} 작성자=${p.author_id} L1 → L2(${f.audience === 'project' ? `프로젝트 ${p.project_id}` : `멤버 ${f.requiredTargetIds.join(',')}`}) 요청 ${f.activeCount} «${String(p.title).slice(0, 40)}»`);
    }
    if (!APPLY || posts.length === 0) process.exit(0);

    const { writeAudit } = require('../services/auditService');
    let n = 0;
    for (const p of posts) {
      await sequelize.transaction(async (t) => {
        const raised = await core.raisePostToSignatureFloor(p, { transaction: t });
        if (!raised) return;
        n += 1;
        await writeAudit({
          businessId: p.business_id, action: 'post.visibility_change', targetType: 'post', targetId: p.id,
          oldValue: { vlevel: raised.from },
          newValue: { vlevel: raised.to, project_id: p.project_id, target_member_ids: p.target_member_ids || null, reason: 'signature_floor.backfill' },
        }, { transaction: t });
      });
    }
    const [[left]] = await sequelize.query(`SELECT COUNT(*) AS n FROM posts WHERE vlevel = 'L1' AND id IN (:ids)`, { replacements: { ids: posts.map((p) => p.id) } });
    console.log(`[sig-vis-floor] 고침 ${n}건 · 남은 L1 ${left.n}`);
    process.exit(left.n === 0 ? 0 : 1);
  } catch (e) {
    console.error('[sig-vis-floor]', e.message);
    process.exit(1);
  }
})();
