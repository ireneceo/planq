// 멤버 초대 권한 — business_members.invited_role ENUM('member','admin') NULL. 멱등.
//   초대할 때 고른 권한을 담아 두고 수락(services/invites.acceptInvite)이 role 로 옮긴다(2026-11-06 Irene «초대할 때부터 권한»).
//   NULL = 옛 초대 = member. 백필 없음.
const { sequelize } = require('../config/database');

async function hasColumn(table, col) {
  const [r] = await sequelize.query(
    `SELECT COUNT(*) n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t AND COLUMN_NAME=:c`,
    { replacements: { t: table, c: col } });
  return Number(r[0].n) > 0;
}

(async () => {
  let changed = 0;
  if (await hasColumn('business_members', 'invited_role')) {
    console.log('✓ business_members.invited_role 이미 존재 — skip');
  } else {
    await sequelize.query("ALTER TABLE business_members ADD COLUMN invited_role ENUM('member','admin') NULL AFTER role");
    console.log("+ business_members.invited_role 추가 (NULL = 옛 초대 = member)");
    changed += 1;
  }
  const [d] = await sequelize.query("SELECT COUNT(*) c FROM business_members WHERE user_id IS NULL AND invite_token IS NOT NULL AND role <> 'member'");
  console.log(`· 검산: 수락 전 초대 행 중 role 이 member 가 아닌 행 ${d[0].c} (0 이어야 함)`);
  console.log(`[migrate-invited-role] 완료 — 변경 ${changed}건 (멱등)`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
