// 살아 있는 워크스페이스 — 자동 작업(cron)이 지운 워크스페이스를 건너뛰는 **공용 술어 한 벌**.
//   2026-10-29 docs/WORKSPACE_DELETION_DESIGN.md ⑦. 요청 경로는 middleware/workspaceAlive.js 가 닫는다 —
//   cron 은 요청이 아니라서 그 문을 안 지난다. 그래서 지운 워크스페이스의 고객에게 정기 청구서가,
//   대표에게 입금 안내 메일이 계속 나갈 수 있었다(솔로만 지워지던 동안은 무해했다).
//   server.js 에 등록된 cron 서비스는 이 파일을 쓰거나 `// cronalive-exempt: <이유>` 를 적는다
//   (가드 `guard-invariants --category=cronalive`).
const { Op } = require('sequelize');

/** Business 를 직접 고를 때 where 에 펼친다: `where: { ...aliveBusinessWhere(), … }` */
function aliveBusinessWhere() {
  return { deleted_at: null };
}

/** 하위 표를 고를 때 Business 를 붙여 거른다. as 는 그 모델의 연관 별칭(없으면 생략). */
function aliveBusinessInclude(as) {
  const { Business } = require('../models');
  return { model: Business, ...(as ? { as } : {}), required: true, where: { deleted_at: null }, attributes: [] };
}

/** 주어진 business_id 중 살아 있는 것만 Set 으로. */
async function aliveBusinessIds(ids) {
  const { Business } = require('../models');
  const uniq = [...new Set((ids || []).map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!uniq.length) return new Set();
  const rows = await Business.findAll({ where: { id: { [Op.in]: uniq }, deleted_at: null }, attributes: ['id'], raw: true });
  return new Set(rows.map((r) => r.id));
}

/** 행 목록에서 지운 워크스페이스 것을 뺀다. business_id 가 비어 있는 행(플랫폼 행)은 남긴다. */
async function filterAliveRows(rows, key = 'business_id') {
  const list = rows || [];
  const alive = await aliveBusinessIds(list.map((r) => r && r[key]));
  return list.filter((r) => r && (r[key] == null || alive.has(Number(r[key]))));
}

async function isBusinessAlive(id) {
  return (await aliveBusinessIds([id])).has(Number(id));
}

module.exports = { aliveBusinessWhere, aliveBusinessInclude, aliveBusinessIds, filterAliveRows, isBusinessAlive };
