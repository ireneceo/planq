// task_candidates.conversation_id 를 nullable 로 — 운영 스키마 드리프트 교정. 멱등.
//
// 왜 (2026-08-29 운영 실측)
//   모델은 `allowNull: true`(메일·Q Note 후보는 대화가 없다)인데 **운영 DB 만 NOT NULL** 이었다.
//   그래서 메일에서 업무가 나오는 순간 insert 가 터졌다:
//     SequelizeDatabaseError: Column 'conversation_id' cannot be null
//     at extractEmailTaskCandidates → routes/email_threads.js POST extract-tasks → 500
//   운영에 메일 후보가 0건인 진짜 이유가 이것이다 — "아무도 안 눌러서" 가 아니라
//   **업무가 있는 메일에서는 항상 깨졌다.** (업무가 없는 메일은 insert 를 안 해서 200 이 떴고,
//   그래서 겉보기엔 멀쩡해 보였다.)
//
//   `sync-database.js` 는 기존 컬럼의 NULL 허용을 바꾸지 않으므로 이 ALTER 가 필요하다.
//   dev 는 이미 nullable 이라 dev 에서는 영영 재현되지 않았다 — 운영에서만 죽는 종류다.
const { sequelize } = require('../config/database');

// ★ 한 컬럼씩 고치면 "다음 컬럼" 이 계속 나온다(실제로 conversation_id 를 고치자마자
//   source_message_ids 가 같은 오류로 터졌다). 모델이 nullable 이라고 말하는데 DB 가 NOT NULL 인
//   컬럼을 **전수로** 찾아 한 번에 맞춘다.
const TaskCandidate = require('../models/TaskCandidate');

(async () => {
  const [cols] = await sequelize.query('SHOW COLUMNS FROM task_candidates');
  const attrs = TaskCandidate.rawAttributes;
  const drift = cols.filter((c) => {
    const a = attrs[c.Field];
    if (!a || a.primaryKey) return false;
    return a.allowNull !== false && c.Null !== 'YES';
  });
  if (drift.length === 0) {
    console.log('✓ 드리프트 없음 — 모델과 DB 의 NULL 허용이 일치');
  } else {
    for (const c of drift) {
      // 타입은 그대로 두고 NULL 허용만 바꾼다. FK 는 유지된다(값이 NULL 이면 검사 안 함).
      await sequelize.query(`ALTER TABLE task_candidates MODIFY COLUMN \`${c.Field}\` ${c.Type} NULL`);
      console.log(`+ task_candidates.${c.Field} (${c.Type}) → NULL 허용`);
    }
  }
  const [after] = await sequelize.query('SHOW COLUMNS FROM task_candidates');
  const left = after.filter((c) => {
    const a = attrs[c.Field];
    if (!a || a.primaryKey) return false;
    return a.allowNull !== false && c.Null !== 'YES';
  });
  console.log(`· 검산: 남은 드리프트 ${left.length}개 (0 이어야 함)${left.length ? ' — ' + left.map(x => x.Field).join(',') : ''}`);
  if (left.length) { console.error('FATAL 드리프트가 남았다'); process.exit(1); }
  console.log('[migrate-candidate-nullable-conv] 완료 (멱등)');
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
