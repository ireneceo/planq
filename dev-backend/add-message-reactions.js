// #138 message_reactions 테이블 생성 (멱등). 운영 배포 전 선행 실행.
require('dotenv').config();
const { sequelize } = require('./config/database');
const MessageReaction = require('./models/MessageReaction');
(async () => {
  try {
    await MessageReaction.sync();   // 없으면 생성, 있으면 no-op
    const [c] = await sequelize.query('SHOW COLUMNS FROM message_reactions');
    console.log('✓ message_reactions 컬럼:', c.map((x) => x.Field).join(', '));
    const [i] = await sequelize.query('SHOW INDEX FROM message_reactions');
    console.log('✓ 인덱스:', [...new Set(i.map((x) => x.Key_name))].join(', '));
  } catch (e) { console.error('FAILED:', e.message); process.exitCode = 1; }
  finally { await sequelize.close(); }
})();
