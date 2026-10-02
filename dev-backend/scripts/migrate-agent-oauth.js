// AI 에이전트 연동(#439) — 스키마. 멱등. 2026-10-02.
//   ① ephemeral_tokens.kind ENUM 끝에 agent_authreq · agent_code · agent_idem · agent_confirm append (옛 값 순서 유지)
//   ② agent_clients · agent_grants 표 신설(CREATE TABLE IF NOT EXISTS 와 같은 효과 — Model.sync 기본값은 만들기만 한다)
// **코드 배포 전에** 실행한다 — 새 코드가 ENUM 에 없는 kind 를 쓰면 인가 요청 저장이 실패한다.
// 스키마를 재조회해 판정하고 미충족이면 exit 1.
// 롤백: 전부 additive — 옛 코드에 무해하다. 코드만 되돌리고 스키마는 남긴다.
require('dotenv').config();
const { sequelize } = require('../config/database');

const KINDS = ['agent_authreq', 'agent_code', 'agent_idem', 'agent_confirm'];

async function colType(table, col) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, { replacements: [table, col] });
  return rows[0] ? String(rows[0].COLUMN_TYPE) : null;
}
async function hasTable(t) {
  const [rows] = await sequelize.query(
    'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', { replacements: [t] });
  return rows.length > 0;
}

(async () => {
  try {
    let k = await colType('ephemeral_tokens', 'kind');
    if (!k) throw new Error('ephemeral_tokens.kind 없음');
    const add = KINDS.filter((x) => !k.includes(`'${x}'`));
    if (add.length) {
      const vals = k.replace(/^enum\(/i, '').replace(/\)$/, '');
      await sequelize.query(`ALTER TABLE ephemeral_tokens MODIFY COLUMN kind ENUM(${vals},${add.map((x) => `'${x}'`).join(',')}) NOT NULL`);
      console.log('[migrate-agent-oauth] ephemeral_tokens.kind 추가:', add.join(', '));
    } else console.log('[migrate-agent-oauth] ephemeral kind 이미 있음 — skip');

    const { AgentClient, AgentGrant } = require('../models');
    for (const [name, M] of [['agent_clients', AgentClient], ['agent_grants', AgentGrant]]) {
      if (!(await hasTable(name))) {
        await M.sync();   // 없을 때만 만든다(alter 아님)
        console.log(`[migrate-agent-oauth] ${name} 생성`);
      } else console.log(`[migrate-agent-oauth] ${name} 이미 있음 — skip`);
    }

    const miss = [];
    k = await colType('ephemeral_tokens', 'kind');
    for (const x of KINDS) if (!k.includes(`'${x}'`)) miss.push(`kind ${x}`);
    for (const t of ['agent_clients', 'agent_grants']) if (!(await hasTable(t))) miss.push(t);
    if (!(await colType('agent_grants', 'prev_refresh_token_hash'))) miss.push('agent_grants.prev_refresh_token_hash');
    if (miss.length) { console.error('[migrate-agent-oauth] 검증 실패:', miss.join(', ')); process.exit(1); }
    console.log('[migrate-agent-oauth] OK');
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('[migrate-agent-oauth] 실패:', e.message);
    process.exit(1);
  }
})();
