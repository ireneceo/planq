// Sign in with Apple — 스키마 2건. 멱등. 2026-09-21.
//   ① oauth_connections.provider ENUM 끝에 'apple' append (기존 값 순서 유지 → 옛 행 무변경)
//   ①-b ephemeral_tokens.kind ENUM 끝에 'apple_oauth_state' append (애플 state — 구글 state 와 섞지 않는다)
//   ② platform_settings 에 애플 자격 4칸 (nullable — 비어 있으면 애플 로그인이 안 보일 뿐)
// **코드 배포 전에** 실행한다 — 모델이 'apple' 을 쓰는데 ENUM 에 없으면 연결 저장이 실패한다.
// 스키마를 재조회해 판정하고 미충족이면 exit 1(alter 가 조용히 실패한 전례 — 64키 한도).
// 롤백: 전부 additive 라 옛 코드에 무해하다. **코드만 되돌리고 스키마는 남긴다**.
require('dotenv').config();
const { sequelize } = require('../config/database');

const COLS = [
  ['apple_services_id', 'VARCHAR(200) NULL'],
  ['apple_team_id', 'VARCHAR(20) NULL'],
  ['apple_key_id', 'VARCHAR(20) NULL'],
  ['apple_private_key_enc', 'TEXT NULL'],
];

async function colType(table, col) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, { replacements: [table, col] });
  return rows[0] ? String(rows[0].COLUMN_TYPE) : null;
}

(async () => {
  try {
    const t = await colType('oauth_connections', 'provider');
    if (!t) throw new Error('oauth_connections.provider 없음');
    if (!t.includes("'apple'")) {
      const vals = t.replace(/^enum\(/i, '').replace(/\)$/, '');
      await sequelize.query(`ALTER TABLE oauth_connections MODIFY COLUMN provider ENUM(${vals},'apple') NOT NULL`);
      console.log('[migrate-apple-login] provider ENUM 에 apple 추가');
    } else console.log('[migrate-apple-login] provider ENUM apple 이미 있음 — skip');
    const k = await colType('ephemeral_tokens', 'kind');
    if (!k) throw new Error('ephemeral_tokens.kind 없음');
    if (!k.includes("'apple_oauth_state'")) {
      const vals = k.replace(/^enum\(/i, '').replace(/\)$/, '');
      await sequelize.query(`ALTER TABLE ephemeral_tokens MODIFY COLUMN kind ENUM(${vals},'apple_oauth_state') NOT NULL`);
      console.log('[migrate-apple-login] ephemeral_tokens.kind 에 apple_oauth_state 추가');
    }
    for (const [c, def] of COLS) {
      if (!(await colType('platform_settings', c))) {
        await sequelize.query(`ALTER TABLE platform_settings ADD COLUMN ${c} ${def}`);
        console.log(`[migrate-apple-login] platform_settings.${c} 추가`);
      }
    }
    const t2 = await colType('oauth_connections', 'provider');
    const miss = [];
    if (!t2.includes("'apple'")) miss.push('provider enum');
    if (!(await colType('ephemeral_tokens', 'kind')).includes("'apple_oauth_state'")) miss.push('ephemeral kind');
    for (const [c] of COLS) if (!(await colType('platform_settings', c))) miss.push(c);
    if (miss.length) { console.error('[migrate-apple-login] 검증 실패:', miss.join(', ')); process.exit(1); }
    console.log('[migrate-apple-login] OK', t2);
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error('[migrate-apple-login] 실패:', e.message);
    process.exit(1);
  }
})();
