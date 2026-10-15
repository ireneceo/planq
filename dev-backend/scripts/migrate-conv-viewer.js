// conversation_participants.is_viewer TINYINT(1) NOT NULL DEFAULT 0 — 멱등. 2026-10-15 (Fable 설계 판정 A).
//   «열어 봤다(읽음 커서·핀)» 와 «참여한다(참여자 목록·@·알림)» 를 가른다. 읽음/핀이 만든 행만 1.
//   기본 0 이라 옛 행은 전부 참여자로 남는다 — 옛 자동 참여 행 정리는 따로 `backfill-conv-viewer.js`(dry-run 기본).
//   ★ 모델(defaultScope is_viewer=false)이 이 칸을 SELECT 하므로 **코드 배포 전에** 실행한다(배포 슬롯).
// 롤백: additive 컬럼. 코드만 되돌리고 컬럼은 남긴다(모델 선언까지 되돌리면 sync 가 DROP 한다).
require('dotenv').config();
const { sequelize } = require('../config/database');
async function has() {
  const [r] = await sequelize.query(`SELECT COLUMN_TYPE t FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'conversation_participants' AND COLUMN_NAME = 'is_viewer'`);
  return r[0] ? r[0].t : null;
}
(async () => {
  try {
    if (!(await has())) {
      await sequelize.query('ALTER TABLE conversation_participants ADD COLUMN is_viewer TINYINT(1) NOT NULL DEFAULT 0 AFTER role');
      console.log('[migrate-conv-viewer] is_viewer 추가');
    } else console.log('[migrate-conv-viewer] is_viewer 이미 있음 — skip');
    const t = await has();
    if (!t || !/tinyint/i.test(t)) { console.error('[migrate-conv-viewer] 검증 실패', t); process.exit(1); }
    const [[u]] = await sequelize.query('SELECT SUM(is_viewer = 1) v, COUNT(*) n FROM conversation_participants');
    console.log('[migrate-conv-viewer] OK', t, '· viewer', Number(u.v || 0), '/', u.n);
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-conv-viewer] 실패:', e.message); process.exit(1); }
})();
