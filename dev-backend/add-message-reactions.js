// #138 message_reactions 테이블 생성 (멱등). 운영 배포 전 선행 실행.
require('dotenv').config();
const { sequelize } = require('./config/database');
// ★ models/index 를 통해 로드해야 association 이 등록되고 sync 가 FK(ON DELETE CASCADE)를 만든다.
//   모델 파일을 단독 require 하면 FK 없이 테이블이 생겨, 대화/메시지를 지워도 리액션 고아행이 남는다.
const { MessageReaction } = require('./models');
(async () => {
  try {
    await MessageReaction.sync();   // 없으면 생성(FK 포함), 있으면 no-op

    // 이미 만들어진 테이블 보정 — emoji collation 이 ci 면 이모지 6종이 서로 구별되지 않는다.
    const [col] = await sequelize.query("SHOW FULL COLUMNS FROM message_reactions LIKE 'emoji'");
    if (col[0] && col[0].Collation !== 'utf8mb4_bin') {
      console.log('- emoji collation 교정:', col[0].Collation, '→ utf8mb4_bin');
      await sequelize.query('ALTER TABLE message_reactions DROP INDEX message_reactions_unique');
      await sequelize.query("ALTER TABLE message_reactions MODIFY emoji VARCHAR(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL");
      await sequelize.query('ALTER TABLE message_reactions ADD UNIQUE KEY message_reactions_unique (message_id, user_id, emoji)');
      console.log('✓ collation + UNIQUE 재생성');
    }

    const [fk] = await sequelize.query(`SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='message_reactions' AND REFERENCED_TABLE_NAME IS NOT NULL`);
    console.log('✓ FK:', fk.length ? fk.map((f) => f.CONSTRAINT_NAME).join(', ') : '없음 (경고 — CASCADE 안 됨)');
    const [c] = await sequelize.query('SHOW COLUMNS FROM message_reactions');
    console.log('✓ message_reactions 컬럼:', c.map((x) => x.Field).join(', '));
    const [i] = await sequelize.query('SHOW INDEX FROM message_reactions');
    console.log('✓ 인덱스:', [...new Set(i.map((x) => x.Key_name))].join(', '));
  } catch (e) { console.error('FAILED:', e.message); process.exitCode = 1; }
  finally { await sequelize.close(); }
})();
