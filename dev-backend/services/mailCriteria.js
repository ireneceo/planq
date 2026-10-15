// mailCriteria — 워크스페이스가 **끈** 메일 분류 기준의 단일 원천 (docs/MAIL_CRITERIA_DESIGN.md §3.1)
//
// 저장 자리는 `businesses.permissions.mail_criteria = { off: ['auto_ack', …] }` (새 표·새 컬럼 0,
//   sales_intake 와 같은 JSON). 모양은 normalizeMailCriteria 한 함수가 정한다 — 읽기·쓰기가 같이 지난다.
//   모르는 id·잠긴(lockable) id 는 버린다(fail-closed — 끌 수 없는 기준이 꺼진 채 저장되지 않는다).
// 읽기는 30초 캐시 — 수집 cron 이 메일마다 Business 를 읽지 않게. 저장 라우트가 invalidate 한다.
const CAT = require('./mailCriteriaCatalog');

function normalizeMailCriteria(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const off = Array.isArray(src.off) ? src.off : [];
  return { off: [...new Set(off.map(String).filter((id) => CAT.TOGGLEABLE.has(id)))].sort() };
}

function criteriaOf(biz) {
  const p = biz && biz.permissions && typeof biz.permissions === 'object' ? biz.permissions : {};
  return normalizeMailCriteria(p.mail_criteria);
}

const TTL_MS = 30 * 1000;
const cache = new Map();   // businessId → { at, off:Set }

/** 이 워크스페이스에서 꺼진 기준 — Set. 읽기 실패는 «전부 켜짐»(기본값)으로 떨어진다. */
async function offFor(businessId) {
  const id = Number(businessId);
  if (!id) return new Set();
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.off;
  let off = new Set();
  try {
    const { Business } = require('../models');
    const biz = await Business.findByPk(id, { attributes: ['id', 'permissions'] });
    off = new Set(criteriaOf(biz).off);
  } catch (e) { console.warn('[mailCriteria] offFor', e.message); }
  cache.set(id, { at: Date.now(), off });
  return off;
}

function invalidate(businessId) { cache.delete(Number(businessId)); }

module.exports = { normalizeMailCriteria, criteriaOf, offFor, invalidate };
