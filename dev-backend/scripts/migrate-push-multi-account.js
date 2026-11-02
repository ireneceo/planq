// 2026-11-02 한 기기 여러 계정 — push_subscriptions UNIQUE(endpoint) → UNIQUE(endpoint, user_id). 멱등.
//   설계 docs/MULTI_ACCOUNT_DESIGN.md 7절 1·단계 0 (Fable 설계 판정 반영).
//   ★ **코드보다 먼저** 돈다(배포 슬롯 PM2 reload 앞) — 새 구독 코드는 같은 기기 주소에 사람 둘을 넣는다.
//     옛 UNIQUE(endpoint) 가 남아 있으면 두 번째 계정 구독이 500(중복)으로 실패해 «첫 계정 푸시가 끊기는» 종전 상태가 된다.
//   롤백: 옛 코드는 새 UNIQUE 와도 돈다(그 코드는 다른 사람 행을 expired: 접두로 비키고 새 행을 만든다).
//     옛 UNIQUE 를 되살리려면 같은 endpoint 활성 행이 둘 이상인지 먼저 본다(--rollback 가 세고 있으면 멈춘다).
//   사용: node scripts/migrate-push-multi-account.js [--dry] [--rollback]
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');
const ROLLBACK = process.argv.includes('--rollback');
const TAG = '[migrate-push-multi-account]';
const TABLE = 'push_subscriptions';
const NEW_IDX = 'uq_push_endpoint_user';

async function indexes() {
  const [rows] = await sequelize.query(
    `SELECT INDEX_NAME name, NON_UNIQUE nu, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols
       FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? GROUP BY INDEX_NAME, NON_UNIQUE`,
    { replacements: [TABLE] }
  );
  return rows;
}

async function forward() {
  const idx = await indexes();
  // 1) 새 UNIQUE 먼저(있으면 skip) — 옛 것을 지우는 사이 중복이 들어올 틈을 두지 않는다
  if (!idx.some((i) => i.name === NEW_IDX)) {
    const [dup] = await sequelize.query(`SELECT endpoint, user_id, COUNT(*) n FROM ${TABLE} GROUP BY endpoint, user_id HAVING n > 1 LIMIT 5`);
    if (dup.length) throw new Error(`(endpoint,user_id) 중복 ${dup.length}건 — 먼저 정리 필요`);
    if (DRY) console.log(`${TAG} (dry) ADD UNIQUE ${NEW_IDX}(endpoint,user_id)`);
    else { await sequelize.query(`ALTER TABLE ${TABLE} ADD UNIQUE KEY ${NEW_IDX} (endpoint, user_id)`); console.log(`${TAG} ${NEW_IDX} 추가`); }
  } else console.log(`${TAG} ${NEW_IDX} 이미 있음 — skip`);
  // 2) endpoint 단독 UNIQUE 전부 제거(dev 에는 'endpoint' · 'push_subscriptions_endpoint_unique' 두 개가 있었다)
  for (const i of idx) {
    if (Number(i.nu) === 0 && i.cols === 'endpoint') {
      if (DRY) console.log(`${TAG} (dry) DROP INDEX ${i.name}`);
      else { await sequelize.query(`ALTER TABLE ${TABLE} DROP INDEX \`${i.name}\``); console.log(`${TAG} DROP INDEX ${i.name}`); }
    }
  }
}

async function rollback() {
  const [dup] = await sequelize.query(`SELECT endpoint, COUNT(*) n FROM ${TABLE} GROUP BY endpoint HAVING n > 1 LIMIT 5`);
  if (dup.length) throw new Error(`같은 endpoint 행 ${dup.length}건 이상 — 옛 UNIQUE(endpoint) 를 되살릴 수 없다(여러 계정 행이 있음)`);
  if (DRY) { console.log(`${TAG} (dry) ADD UNIQUE push_subscriptions_endpoint_unique(endpoint) · DROP ${NEW_IDX}`); return; }
  const idx = await indexes();
  if (!idx.some((i) => i.name === 'push_subscriptions_endpoint_unique')) await sequelize.query(`ALTER TABLE ${TABLE} ADD UNIQUE KEY push_subscriptions_endpoint_unique (endpoint)`);
  if (idx.some((i) => i.name === NEW_IDX)) await sequelize.query(`ALTER TABLE ${TABLE} DROP INDEX ${NEW_IDX}`);
  console.log(`${TAG} 되돌림 완료`);
}

async function verify() {
  const idx = await indexes();
  const ok = idx.some((i) => i.name === NEW_IDX && Number(i.nu) === 0 && i.cols === 'endpoint,user_id');
  const old = idx.filter((i) => Number(i.nu) === 0 && i.cols === 'endpoint');
  if (!ok) throw new Error(`${NEW_IDX} 없음`);
  if (old.length) throw new Error(`endpoint 단독 UNIQUE 남음: ${old.map((i) => i.name).join(',')}`);
  const [c] = await sequelize.query(`SELECT COUNT(*) n, SUM(expired_at IS NULL) active FROM ${TABLE}`);
  console.log(`${TAG} 검증 OK — UNIQUE(endpoint,user_id) · 행 ${c[0].n} (활성 ${c[0].active || 0})`);
}

(async () => {
  try {
    await sequelize.authenticate();
    if (ROLLBACK) await rollback();
    else { await forward(); if (!DRY) await verify(); }
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error(`${TAG} 실패:`, e.message);
    try { await sequelize.close(); } catch { /* ignore */ }
    process.exit(1);
  }
})();
