// 메일 사칭 검사 — 멱등. 2026-10-15. 설계 docs/MAIL_IMPERSONATION_DESIGN.md §5.
//   ① email_threads.spam_origin ENUM 끝에 'impersonation' append(기존 'provider' 순서 유지)
//   ② email_threads.impersonation JSON NULL — { level, signals[{code,level,detail}], assessed_at, released_at? }
//   백필 없음 — NULL = 아직 판정 안 함. 옛 메일 소급은 retriage-mail.js --impersonation (dry-run 기본, 수동).
// 롤백: additive 라 옛 코드에 무해. **코드만 되돌리고 칸·ENUM 값은 남긴다**(모델 선언을 되돌리면 sync 가 DROP 한다).
//   단 'impersonation' 행이 남은 채 옛 코드로 돌리면 옛 화면이 그 스레드를 «업체 스팸» 안내 없이 스팸으로 보여 줄 뿐이다.
require('dotenv').config();
const { sequelize } = require('../config/database');
async function colType(name) {
  const [r] = await sequelize.query(`SELECT COLUMN_TYPE t FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_threads' AND COLUMN_NAME = ?`, { replacements: [name] });
  return r[0] ? r[0].t : null;
}
(async () => {
  try {
    const so = await colType('spam_origin');
    if (!so) throw new Error('spam_origin 칸이 없다 — migrate-mail-sent-spam 먼저');
    if (!/'impersonation'/.test(so)) {
      const vals = so.replace(/^enum\(|\)$/gi, '');
      await sequelize.query(`ALTER TABLE email_threads MODIFY COLUMN spam_origin ENUM(${vals},'impersonation') NULL DEFAULT NULL`);
      console.log('[migrate-mail-impersonation] spam_origin 에 impersonation 추가');
    } else console.log('[migrate-mail-impersonation] spam_origin 이미 있음 — skip');
    if (!(await colType('impersonation'))) {
      await sequelize.query('ALTER TABLE email_threads ADD COLUMN impersonation JSON NULL AFTER spam_since');
      console.log('[migrate-mail-impersonation] impersonation 칸 추가');
    } else console.log('[migrate-mail-impersonation] impersonation 이미 있음 — skip');
    const a = await colType('spam_origin'); const b = await colType('impersonation');
    if (!/^enum\('provider','impersonation'\)$/i.test(a) || !/json/i.test(b || '')) { console.error('[migrate-mail-impersonation] 검증 실패', a, b); process.exit(1); }
    console.log('[migrate-mail-impersonation] OK', a, b);
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-mail-impersonation] 실패:', e.message); process.exit(1); }
})();
