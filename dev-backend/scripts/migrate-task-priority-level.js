// #353 ⑤ 마이그레이션 — tasks.priority_level (중요도). 멱등 (매 배포 실행 안전).
//
//   `ALTER TABLE tasks ADD COLUMN priority_level ENUM('low','normal','high','urgent') NULL DEFAULT NULL`
//
// ★ 왜 필요한가 — LLM 은 **여태 우선순위를 만들고 있었는데 저장할 자리가 없어 매번 버려졌다.**
//   services/actions/task_actions.js 옛 주석: "Sequelize 는 모델에 없는 속성을 조용히 버리므로
//   여기에 쓰면 저장되는 척만 하는 죽은 코드다."
//
// ★ NULL default 인 이유 — 'normal' 을 기본값으로 두면 운영 옛 업무 251건이 전부 "보통" 으로
//   표시된다. 아무도 그렇게 정한 적이 없는데 시스템이 채운 값이 사용자 입력처럼 보인다
//   (memory feedback_system_filled_not_user_input). **백필하지 않는다.**
//
// ★ 이름이 priority 가 아닌 이유 — 이미 `priority_order`(주간 사용자 랭킹)가 있고 UI 문구도
//   "우선순위 {{n}}" 이다. `priority_level` 이면 옆에 놓였을 때 level vs order 로 자기 설명이 되고,
//   grep 하면 둘이 같이 걸려 쌍 주석을 읽게 된다.
//
// ★ 배포 순서: 이 스크립트(DB) → 백엔드 reload. 역전하면 새 코드가 없는 컬럼에 써서 실패한다.
//   옛 백엔드는 이 컬럼을 절대 안 쓰므로 DB 선행은 안전하다.
//
// 롤백: **코드만 revert.** 컬럼과 models/Task.js 선언은 남긴다 —
//   sync-database 가 "모델에 없는 컬럼" 을 DROP 할 수 있어서, 선언을 지우면 데이터까지 날아간다.
//   NULL 허용 컬럼이라 남겨도 무해하다.
require('dotenv').config();
const { sequelize } = require('../config/database');

const ENUM_VALUES = ['low', 'normal', 'high', 'urgent'];

async function column(table, name) {
  const [rows] = await sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE '${name}'`);
  return rows.length ? rows[0] : null;
}

async function run() {
  const existing = await column('tasks', 'priority_level');
  if (existing) {
    console.log(`[migration] tasks.priority_level 이미 있음 (${existing.Type}) — skip`);
    return true;
  }
  const list = ENUM_VALUES.map((v) => `'${v}'`).join(',');
  await sequelize.query(
    `ALTER TABLE \`tasks\` ADD COLUMN \`priority_level\` ENUM(${list}) NULL DEFAULT NULL ` +
    `COMMENT '#353 5 importance (AI/human). different from priority_order (weekly rank)'`
  );
  // ★ 실행했다고 믿지 않고 **다시 조회해서** 판정한다.
  const after = await column('tasks', 'priority_level');
  if (!after) throw new Error('ALTER 는 돌았는데 컬럼이 없다 — 판정 실패');
  const [[cnt]] = await sequelize.query('SELECT COUNT(*) n, SUM(priority_level IS NULL) nulls FROM tasks');
  console.log(`[migration] tasks.priority_level 추가 완료 (${after.Type}) · 기존 ${cnt.n}행 전부 NULL=${cnt.nulls}`);
  return true;
}

if (require.main === module) {
  run()
    .then(() => sequelize.close())
    .then(() => process.exit(0))
    .catch((e) => { console.error('[migration] 실패:', e.message); process.exit(1); });
}
module.exports = { run };
