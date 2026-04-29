// 기존 사용자 username 자동 마이그레이션
// 규칙:
//  - 이메일 prefix 추출 → lowercase + [a-z0-9_-] 만 남기기 sanitize
//  - 3자 미만이면 'user_' + id
//  - 31자 이상은 30자로 자르기
//  - 이미 존재하면 _2, _3, ... suffix 시도
//
// AI 계정 (is_ai=true) 은 username 부여 안 함 (시스템 계정).
// 이미 username 있는 사용자는 건드리지 않음.

const { sequelize } = require('../config/database');
const { User } = require('../models');

const RE_VALID = /^[a-z0-9_-]{3,30}$/;

function sanitizePrefix(prefix) {
  return String(prefix || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
}

async function findAvailable(base, excludeIds, transaction) {
  let candidate = base;
  if (candidate.length < 3) candidate = (candidate + '___').slice(0, 3);
  let n = 1;
  while (n < 1000) {
    const exists = await User.findOne({
      where: { username: candidate },
      attributes: ['id'],
      transaction,
    });
    if (!exists || excludeIds.has(exists.id)) return candidate;
    n += 1;
    const suffix = `_${n}`;
    candidate = (base.slice(0, 30 - suffix.length) + suffix);
  }
  throw new Error(`could not find available username for base=${base}`);
}

(async () => {
  const t = await sequelize.transaction();
  try {
    const targets = await User.findAll({
      where: { username: null, is_ai: false },
      attributes: ['id', 'email', 'name'],
      order: [['id', 'ASC']],
      transaction: t,
    });
    console.log(`Found ${targets.length} users without username`);

    const reservedIds = new Set();
    let assigned = 0;
    let fallback = 0;
    const results = [];

    for (const u of targets) {
      const prefix = (u.email || '').split('@')[0] || '';
      let base = sanitizePrefix(prefix);
      if (base.length < 3) {
        base = `user_${u.id}`;
        fallback += 1;
      }
      const username = await findAvailable(base, reservedIds, t);
      if (!RE_VALID.test(username)) {
        throw new Error(`invalid generated username: ${username} for user id=${u.id}`);
      }
      await User.update({ username }, { where: { id: u.id }, transaction: t });
      reservedIds.add(u.id);
      assigned += 1;
      results.push({ id: u.id, email: u.email, name: u.name, username });
    }

    await t.commit();
    console.log(`\nAssigned ${assigned} usernames (${fallback} fallback to user_${'<id>'} pattern)\n`);
    console.log('Sample assignments:');
    results.slice(0, 15).forEach((r) => {
      console.log(`  ${String(r.id).padStart(3)} | ${r.email.padEnd(40)} | ${r.username}`);
    });
    if (results.length > 15) console.log(`  ... and ${results.length - 15} more`);
    process.exit(0);
  } catch (e) {
    await t.rollback();
    console.error('FAIL:', e.message);
    process.exit(1);
  }
})();
