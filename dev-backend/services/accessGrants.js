// 열람 요청 승인 = «그 사람 · 그 항목 하나» 의 열람 권한 (2026-11-25 · docs/FILE_SEARCH_DISCOVERY_DESIGN.md §3)
//
// ★ 권한 판정은 access_scope 의 읽기 술어 네 벌(파일·문서 × 단건·목록)이 **이 파일 하나**를 부른다.
//   승인은 항목의 공개 범위를 바꾸지 않는다 — 승인된 access_requests 행이 곧 권한이고, 회수하면(status revoked) 닫힌다.
// ★ 좁히는 조건(넓히지 않게):
//   - 워크스페이스 멤버·관리자만(고객·게스트·비멤버는 권한 없음 — 내보낸 사람은 scope 가 멤버가 아니라 저절로 닫힌다)
//   - 항목이 **지금도 L2(제한)** 일 때만 — «나만 보기»(L1)로 바뀌면 승인도 닫힌다(L1 은 영구 비공개). L3·L4 는 원래 보인다.
//   - 같은 워크스페이스 · 그 항목 종류(file|post) · 요청자 본인 · status 'approved'
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');

const TYPES = new Set(['file', 'post']);

function isGrantableScope(scope) {
  return !!scope && !scope.isClient && !scope.isPlatformAdmin && !!(scope.isMember || scope.isOwner || scope.isAdmin) && Number(scope.userId) > 0 && Number(scope.businessId) > 0;
}
function levelOf(type, row) { return type === 'file' ? (row.vlevel || row.visibility) : row.vlevel; }

/** 단건 — 술어가 거절한 뒤에만 부른다(쿼리 1회). */
async function hasGrant(scope, type, row) {
  if (!TYPES.has(type) || !row || !isGrantableScope(scope)) return false;
  if (Number(row.business_id) !== Number(scope.businessId)) return false;
  if (levelOf(type, row) !== 'L2') return false;
  const [rows] = await sequelize.query(
    `SELECT 1 FROM access_requests WHERE business_id = :b AND requester_id = :u AND entity_type = :t AND entity_id = :e AND status = 'approved' LIMIT 1`,
    { replacements: { b: Number(scope.businessId), u: Number(scope.userId), t: type, e: Number(row.id) } },
  );
  return rows.length > 0;
}

/** 목록 — OR 항목 하나(멤버가 아니면 null). 키 `id` 는 Sequelize 가 모델 별칭으로 자격을 붙인다(조인 ambiguous 없음). */
function grantListCond(scope, type) {
  if (!TYPES.has(type) || !isGrantableScope(scope)) return null;
  const sub = `(SELECT ar.entity_id FROM access_requests ar WHERE ar.business_id = ${Number(scope.businessId)} AND ar.requester_id = ${Number(scope.userId)} AND ar.entity_type = '${type}' AND ar.status = 'approved')`;
  const l2 = type === 'file'
    ? { [Op.or]: [{ vlevel: 'L2' }, { vlevel: null, visibility: 'L2' }] }
    : { vlevel: 'L2' };
  return { [Op.and]: [{ id: { [Op.in]: sequelize.literal(sub) } }, l2] };
}

/** 항목이 «나만 보기»(L1)로 바뀌면 그 항목의 대기·승인을 닫는다 — L2 로 돌아와도 옛 승인이 되살아나지 않게(Fable 비차단 2).
 *  공개 범위를 바꾸는 문(파일·문서 PUT visibility)이 부른다. 실패해도 권한은 L2 조건으로 이미 닫혀 있다. */
async function closeForPrivate(businessId, type, id) {
  if (!TYPES.has(type)) return;
  await sequelize.query(
    `UPDATE access_requests SET status = CASE WHEN status = 'approved' THEN 'revoked' ELSE 'canceled' END, decided_at = NOW(), updated_at = NOW()
      WHERE business_id = :b AND entity_type = :t AND entity_id = :e AND status IN ('pending', 'approved')`,
    { replacements: { b: Number(businessId), t: type, e: Number(id) } },
  );
}

module.exports = { hasGrant, grantListCond, isGrantableScope, levelOf, closeForPrivate };
