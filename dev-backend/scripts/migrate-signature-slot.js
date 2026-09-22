// 서명란(slot) — signature_requests 에 칸 정보 4칸. 멱등. 2026-09-22.
//   slot           : 문서 서명란 번호(1·2…). NULL = 옛 요청(서명란 없이 받은 것)
//   party          : 'us'(보내는 쪽 멤버) | 'them'(받는 쪽 — 이메일 링크+인증번호). 기본 them = 옛 동작
//   signer_user_id : 보내는 쪽 서명자(멤버). 요청 창에서 고르고 기본값은 요청자
//   (고정본 지문은 이미 있는 content_hash 를 쓴다 — 같은 값을 두 칸에 두지 않는다)
// **코드 배포 전에** 실행한다(모델이 새 칸을 쓰면 없을 때 500). 롤백: additive 라 옛 코드에 무해 — 코드만 되돌린다.
require('dotenv').config();
const { sequelize } = require('../config/database');

const COLS = [
  ['slot', 'INT NULL'],
  ['party', "ENUM('us','them') NOT NULL DEFAULT 'them'"],
  ['signer_user_id', 'INT NULL'],
];
const has = async (c) => {
  const [r] = await sequelize.query(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='signature_requests' AND COLUMN_NAME=?`,
    { replacements: [c] });
  return r.length > 0;
};
(async () => {
  try {
    for (const [c, def] of COLS) {
      if (!(await has(c))) { await sequelize.query(`ALTER TABLE signature_requests ADD COLUMN ${c} ${def}`); console.log('[migrate-signature-slot] +', c); }
    }
    const miss = [];
    for (const [c] of COLS) if (!(await has(c))) miss.push(c);
    if (miss.length) { console.error('[migrate-signature-slot] 검증 실패:', miss.join(', ')); process.exit(1); }
    console.log('[migrate-signature-slot] OK');
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-signature-slot] 실패:', e.message); process.exit(1); }
})();
