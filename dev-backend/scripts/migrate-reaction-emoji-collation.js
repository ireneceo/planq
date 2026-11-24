// 메시지 반응 이모지 칸 정렬 규칙을 utf8mb4_bin 으로 — 2026-11-24. 멱등.
//   모델(models/MessageReaction.js)은 2026-07-11(1c8f7c4b)에 collate 'utf8mb4_bin' 으로 고쳤지만 sync 는 정렬 규칙을
//   바꾸지 않아 DB 칸은 utf8mb4_unicode_ci 그대로였다. 그 규칙에서는 BMP 밖 이모지(👍🎉👌💯…)가 전부 «같은 값» 이라
//   👍 누른 뒤 🎉 를 누르면 👍 행이 지워지고(토글 오판) 한 사람이 한 메시지에 이모지 1종만 달 수 있었다(dev 실측 2026-11-24).
//   바꾸면 더 엄격해질 뿐이라 기존 행·UNIQUE(message_id,user_id,emoji)와 충돌하지 않는다. 스키마를 다시 읽어 판정, 미충족이면 exit 1.
//   롤백: 필요 없음(옛 코드에도 무해 — 비교가 정확해질 뿐).
require('dotenv').config();
const { sequelize } = require('../config/database');
const TAG = '[migrate-reaction-emoji-collation]';

async function collation() {
  const [rows] = await sequelize.query(
    `SELECT COLLATION_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'message_reactions' AND COLUMN_NAME = 'emoji'`);
  return rows[0] ? rows[0].c : null;
}

(async () => {
  try {
    const before = await collation();
    if (!before) { console.log(`${TAG} message_reactions.emoji 없음 — skip`); process.exit(0); }
    if (before !== 'utf8mb4_bin') {
      await sequelize.query('ALTER TABLE message_reactions MODIFY emoji VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL');
      console.log(`${TAG} ${before} → utf8mb4_bin`);
    } else {
      console.log(`${TAG} 이미 utf8mb4_bin — skip`);
    }
    if ((await collation()) !== 'utf8mb4_bin') { console.error(`${TAG} 검증 실패`); process.exit(1); }
    const [[c]] = await sequelize.query('SELECT COUNT(*) AS n FROM message_reactions');
    console.log(`${TAG} OK — 반응 ${c.n}행`);
    await sequelize.close();
    process.exit(0);
  } catch (e) {
    console.error(`${TAG} 실패:`, e.message);
    process.exit(1);
  }
})();
