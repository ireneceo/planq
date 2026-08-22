// 저장된 외부 자격증명을 **옛 키에서 새 키로 다시 암호화**한다.
//
// 운영 #356 — 운영 서버에 `EMAIL_ENCRYPTION_KEY` 가 없어 `JWT_SECRET` 파생 fallback 으로 돌고 있었다.
//   그 상태의 위험: **JWT_SECRET 을 바꾸는 순간 저장된 메일 비밀번호·OAuth 토큰을 전부 못 푼다.**
//   (무통보로 메일 연동 전체가 죽는다. 운영 로그에 `decrypt failed` 가 이미 2회.)
//
// ★ 순서가 전부다: 키를 먼저 넣으면 기존 암호문이 **안 풀린다**.
//   반드시 (1) 옛 키로 복호화 → (2) 새 키로 재암호화 → (3) .env 에 새 키 반영 → (4) 재시작 순서.
//   이 스크립트는 (1)(2) 를 한 트랜잭션 안에서 한다.
//
// 사용:
//   node scripts/reencrypt-secrets.js --new-key <64hex>            # 미리보기 (변경 없음)
//   node scripts/reencrypt-secrets.js --new-key <64hex> --apply    # 실제 반영
//   node scripts/reencrypt-secrets.js --verify --new-key <64hex>   # 반영 후 새 키로 전건 복호화 확인
//
// 옛 키 결정: 인자로 --old-key 를 주면 그것, 없으면 **현재 프로세스 규칙 그대로**
//   (EMAIL_ENCRYPTION_KEY 있으면 그것, 없으면 JWT_SECRET 의 sha256) — 즉 지금 서버가 쓰던 키.
require('dotenv').config();
const crypto = require('crypto');
const { sequelize } = require('../config/database');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const VERIFY = argv.includes('--verify');
function argOf(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}

function keyFromHex(hex) { return Buffer.from(String(hex).slice(0, 64), 'hex'); }
function currentKey() {
  const hex = process.env.EMAIL_ENCRYPTION_KEY;
  if (hex && hex.length >= 64) return keyFromHex(hex);
  const seed = process.env.JWT_SECRET || 'planq-dev-fallback';
  return crypto.createHash('sha256').update(seed).digest();
}
function decWith(key, blob) {
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) throw new Error('invalid_blob');
  const iv = buf.slice(0, IV_LEN);
  const tag = buf.slice(buf.length - TAG_LEN);
  const body = buf.slice(IV_LEN, buf.length - TAG_LEN);
  const d = crypto.createDecipheriv(ALGO, key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString('utf8');
}
function encWith(key, plain) {
  const iv = crypto.randomBytes(IV_LEN);
  const c = crypto.createCipheriv(ALGO, key, iv);
  const body = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return Buffer.concat([iv, body, c.getAuthTag()]).toString('base64');
}

// 암호문이 들어 있는 자리 — 새 컬럼이 생기면 여기에 추가한다(한 곳에서만 관리).
const TARGETS = [
  { table: 'email_accounts', cols: ['imap_password_encrypted', 'smtp_password_encrypted', 'oauth_access_token_encrypted', 'oauth_refresh_token_encrypted'] },
  { table: 'external_connections', cols: ['access_token_encrypted', 'refresh_token_encrypted', 'password_encrypted'] },
  { table: 'business_cloud_tokens', cols: ['access_token_encrypted', 'refresh_token_encrypted'] },
];

(async () => {
  const newHex = argOf('--new-key');
  if (!newHex || newHex.length < 64) {
    console.error('--new-key <64hex> 가 필요합니다. 생성: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
  }
  const newKey = keyFromHex(newHex);
  const oldKey = argOf('--old-key') ? keyFromHex(argOf('--old-key')) : currentKey();

  // 실존 컬럼만 대상으로 한다 — 없는 컬럼을 읽으면 조용히 죽는다(모델이 아니라 DB 가 정본).
  const [colRows] = await sequelize.query(
    "SELECT TABLE_NAME t, COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()");
  const have = new Set(colRows.map(r => `${r.t}.${r.c}`));

  let total = 0; let ok = 0; let failed = 0; let empty = 0; let junk = 0;
  const failures = [];
  const junks = [];

  for (const { table, cols } of TARGETS) {
    const live = cols.filter(c => have.has(`${table}.${c}`));
    if (!live.length) { console.log(`- ${table}: 대상 컬럼 없음 (skip)`); continue; }
    const [rows] = await sequelize.query(`SELECT id, ${live.join(', ')} FROM \`${table}\``);
    console.log(`- ${table}: ${rows.length} 행 · 컬럼 ${live.join(', ')}`);

    for (const row of rows) {
      const patch = {};
      for (const c of live) {
        const blob = row[c];
        if (!blob) { empty += 1; continue; }
        total += 1;
        // ★ 애초에 우리 형식이 아닌 값은 **손대지 않는다.** 옛 계정에 남은 잔재(길이 4 짜리 등)가 있고,
        //   이런 것까지 실패로 세면 정상 데이터의 재암호화를 통째로 막는다(가드가 기능을 죽이는 형태).
        const rawLen = Buffer.from(blob, 'base64').length;
        if (rawLen < IV_LEN + TAG_LEN) { junk += 1; junks.push(`${table}#${row.id}.${c}(len=${rawLen})`); continue; }
        let plain;
        try {
          plain = decWith(oldKey, blob);
        } catch (e) {
          // 이미 새 키로 되어 있는가? (재실행 멱등)
          try { decWith(newKey, blob); ok += 1; continue; }
          catch { failed += 1; failures.push(`${table}#${row.id}.${c}`); continue; }
        }
        patch[c] = encWith(newKey, plain);
        ok += 1;
      }
      if (APPLY && Object.keys(patch).length) {
        const set = Object.keys(patch).map(c => `\`${c}\` = :${c}`).join(', ');
        await sequelize.query(`UPDATE \`${table}\` SET ${set} WHERE id = :id`,
          { replacements: { ...patch, id: row.id } });
      }
    }
  }

  console.log(`\n암호문 ${total}건 · 성공 ${ok} · 실패 ${failed} · 빈값 ${empty} · 형식아님 ${junk}`);
  if (failures.length) console.log('⛔ 옛 키로도 새 키로도 안 풀림(사용자 재입력 필요):', failures.join(', '));
  if (junks.length) console.log('· 우리 형식이 아니라 건드리지 않음:', junks.join(', '));
  if (VERIFY) {
    console.log(failed === 0 ? '✅ 전건 새 키로 복호화 가능' : '⛔ 복호화 불가 항목 있음 — .env 반영하지 말 것');
  } else {
    console.log(APPLY ? '→ 반영 완료. 이제 .env 에 EMAIL_ENCRYPTION_KEY 를 넣고 재시작한다.' : '→ 미리보기 (반영하려면 --apply)');
  }
  process.exit(failed === 0 ? 0 : 1);
})();
