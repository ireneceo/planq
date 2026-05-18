// N+27 마이그레이션 — messages.cue_rating + cue_rating_at
require('dotenv').config();
const { sequelize } = require('../config/database');

async function main() {
  const queryInterface = sequelize.getQueryInterface();
  const cols = await queryInterface.describeTable('messages');
  if (!cols.cue_rating) {
    await sequelize.query(`
      ALTER TABLE messages
        ADD COLUMN cue_rating TINYINT NULL COMMENT '-1=down, 0=neutral, 1=up (Cue 메시지만)',
        ADD COLUMN cue_rating_at DATETIME NULL,
        ADD COLUMN cue_rating_by_user_id INT NULL
    `);
    console.log('[migration] messages +3 cue_rating cols');
  } else {
    console.log('[migration] messages cue_rating exists — skip');
  }
  await sequelize.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
