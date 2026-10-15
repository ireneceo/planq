// 역할 사전 — 쓰는 문 한 벌 (2026-10-15, Fable 설계 · docs/MEMBER_ROLES_DESIGN.md)
//
// 역할 글자는 project_members.role · business_members.default_role 에 **글자 그대로** 남는다(FK 없음 — 읽는 쪽이
// 글자로 매칭한다). 그래서 «정본 목록» 과 «글자» 가 갈라지지 않게 쓰는 길을 여기 하나로 모은다:
//   - ensureRole  : 화면 어디서든 새 글자를 저장하면 사전에도 생긴다(= Irene 의 «각 UI 에서 동기화»).
//                   이미 있으면 사전의 표기를 돌려준다 — 'design' 을 쳐도 사전이 'Design' 이면 'Design' 으로 저장.
//   - renameRole  : 사전 + 두 칸을 같은 워크스페이스 안에서 함께 바꾼다(트랜잭션).
//   - deleteRole  : 사전에서 지우고, 그 역할을 단 칸은 비운다(NULL).
// ★ 사전 행을 다른 곳에서 직접 만들거나 두 칸을 직접 일괄 UPDATE 하지 말 것 — 갈라진다.
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const MemberRole = require('../models/MemberRole');

const MAX_LEN = 30;
const MAX_PER_BIZ = 50;

// 공통 기본 세트 — 업종 무관(«개발»·«기타» 없음). 워크스페이스 언어의 글자로 시드한다(키+i18n 아님 — 개명하면 깨진다).
const DEFAULTS = {
  ko: ['기획', '디자인', '제작', '영업', '마케팅', '운영', '고객지원'],
  en: ['Planning', 'Design', 'Production', 'Sales', 'Marketing', 'Operations', 'Support'],
};

// «역할 없음» 의 다른 표기 — 마이그레이션이 사전에 넣지 않고 그 칸을 비운다.
const JUNK = new Set(['기타', '팀원', '오너', 'owner', 'member']);

class RoleError extends Error {
  constructor(code, http) { super(code); this.code = code; this.http = http; }
}

function normalizeName(raw) {
  return String(raw ?? '').trim().replace(/\s+/g, ' ');
}

function isJunk(name) {
  return JUNK.has(normalizeName(name).toLowerCase());
}

/** 새 워크스페이스에 공통 기본 세트 — 사전이 비어 있을 때만(멱등). */
async function seedDefaults(businessId, { lang, userId = null, transaction } = {}) {
  if (!businessId) return 0;
  const existing = await MemberRole.count({ where: { business_id: businessId }, transaction });
  if (existing > 0) return 0;
  const names = DEFAULTS[String(lang || '').startsWith('en') ? 'en' : 'ko'];
  await MemberRole.bulkCreate(names.map((name, i) => ({
    business_id: businessId, name, sort_order: i, created_by: userId,
  })), { transaction, ignoreDuplicates: true });
  return names.length;
}

async function findByName(businessId, name, transaction) {
  // UNIQUE 가 ai_ci 라 = 비교도 대소문자 무시다.
  return MemberRole.findOne({ where: { business_id: businessId, name }, transaction });
}

/**
 * 글자를 저장하기 전에 부른다. 빈 값 → null. 사전에 없으면 만든다.
 * @returns 저장할 글자(사전 표기) 또는 null
 * @throws RoleError('role_too_long'|400, 'role_limit'|409)
 */
async function ensureRole(businessId, raw, { userId = null, transaction } = {}) {
  const name = normalizeName(raw);
  if (!name) return null;
  if (name.length > MAX_LEN) throw new RoleError('role_too_long', 400);
  const hit = await findByName(businessId, name, transaction);
  if (hit) return hit.name;
  const total = await MemberRole.count({ where: { business_id: businessId }, transaction });
  if (total >= MAX_PER_BIZ) throw new RoleError('role_limit', 409);
  const maxOrder = (await MemberRole.max('sort_order', { where: { business_id: businessId }, transaction })) ?? -1;
  try {
    const row = await MemberRole.create({
      business_id: businessId, name, sort_order: Number(maxOrder) + 1, created_by: userId,
    }, { transaction });
    return row.name;
  } catch (err) {
    // 같은 순간 다른 창이 먼저 만들었다 — 그 행을 쓴다.
    if (err?.name === 'SequelizeUniqueConstraintError') {
      const again = await findByName(businessId, name, transaction);
      if (again) return again.name;
    }
    throw err;
  }
}

/** 이 워크스페이스에서 역할 글자별 사용 수 — { lower(name): { project, default } } */
async function usageCounts(businessId) {
  const [pm] = await sequelize.query(
    `SELECT LOWER(TRIM(pm.role)) AS k, COUNT(*) AS c
       FROM project_members pm JOIN projects p ON p.id = pm.project_id
      WHERE p.business_id = :biz AND pm.role IS NOT NULL AND TRIM(pm.role) <> ''
      GROUP BY k`, { replacements: { biz: businessId } });
  const [bm] = await sequelize.query(
    `SELECT LOWER(TRIM(default_role)) AS k, COUNT(*) AS c
       FROM business_members
      WHERE business_id = :biz AND removed_at IS NULL AND default_role IS NOT NULL AND TRIM(default_role) <> ''
      GROUP BY k`, { replacements: { biz: businessId } });
  const out = new Map();
  for (const r of pm) out.set(r.k, { project: Number(r.c), default: 0 });
  for (const r of bm) {
    const cur = out.get(r.k) || { project: 0, default: 0 };
    cur.default = Number(r.c);
    out.set(r.k, cur);
  }
  return out;
}

// 같은 워크스페이스 범위의 두 칸을 old → value(null 이면 비움) 로 바꾼다. 바뀐 행 수를 돌려준다.
async function rewriteColumns(businessId, oldName, value, transaction) {
  const [pmRes] = await sequelize.query(
    `UPDATE project_members pm JOIN projects p ON p.id = pm.project_id
        SET pm.role = :value
      WHERE p.business_id = :biz AND LOWER(TRIM(pm.role)) = LOWER(:old)`,
    { replacements: { biz: businessId, old: oldName, value }, transaction });
  const [bmRes] = await sequelize.query(
    `UPDATE business_members SET default_role = :value
      WHERE business_id = :biz AND LOWER(TRIM(default_role)) = LOWER(:old)`,
    { replacements: { biz: businessId, old: oldName, value }, transaction });
  return { project: Number(pmRes?.affectedRows || 0), default: Number(bmRes?.affectedRows || 0) };
}

/** 이름 바꾸기 — 사전 + 두 칸을 함께. 대소문자만 바꾸는 것도 허용. */
async function renameRole(role, rawName) {
  const name = normalizeName(rawName);
  if (!name) throw new RoleError('role_name_required', 400);
  if (name.length > MAX_LEN) throw new RoleError('role_too_long', 400);
  if (name === role.name) return { name, changed: { project: 0, default: 0 } };
  if (name.toLowerCase() !== role.name.toLowerCase()) {
    const dup = await findByName(role.business_id, name);
    if (dup) throw new RoleError('role_duplicate', 409);
  }
  const old = role.name;
  const changed = await sequelize.transaction(async (transaction) => {
    await role.update({ name }, { transaction });
    return rewriteColumns(role.business_id, old, name, transaction);
  });
  return { name, old, changed };
}

/** 지우기 — 그 역할을 단 칸은 비운다(NULL). */
async function deleteRole(role) {
  const cleared = await sequelize.transaction(async (transaction) => {
    const c = await rewriteColumns(role.business_id, role.name, null, transaction);
    await role.destroy({ transaction });
    return c;
  });
  return { name: role.name, cleared };
}

/** 정렬 — ids 순서대로 sort_order 0..n. 이 워크스페이스 행만. */
async function reorder(businessId, ids) {
  const list = (Array.isArray(ids) ? ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const rows = await MemberRole.findAll({ where: { business_id: businessId, id: { [Op.in]: list } } });
  const mine = new Set(rows.map((r) => r.id));
  await sequelize.transaction(async (transaction) => {
    let i = 0;
    for (const id of list) {
      if (!mine.has(id)) continue;
      await MemberRole.update({ sort_order: i++ }, { where: { id, business_id: businessId }, transaction });
    }
  });
  return mine.size;
}

module.exports = {
  DEFAULTS, JUNK, MAX_LEN, MAX_PER_BIZ, RoleError,
  normalizeName, isJunk, seedDefaults, ensureRole, usageCounts, renameRole, deleteRole, reorder,
};
