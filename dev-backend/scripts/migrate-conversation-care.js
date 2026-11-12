// Q talk 고객 문의 «응대 상태 · 담당자» — conversation_care 표 + 한 번 백필. 멱등 (매 배포 실행 안전). 2026-11-12
//   설계 docs/QTALK_CARE_DESIGN.md (Fable DESIGN: READY).
//
// sync-database 도 모델을 보고 만들지만 조용히 실패할 수 있다 — 그러면 대화 목록·상세가 없는 표를 읽어
// 500 이 된다. PM2 reload 앞에서 한 번 더 보장하고 **다시 조회해서** 판정한다. FK(cascade)도 따로 확인해 붙인다.
//
// 백필(INSERT IGNORE — 이미 행이 있는 방은 건드리지 않는다. 두 번째 실행은 0행):
//   살아 있는 고객 방(channel_type='customer' · status='active' · archived_at IS NULL · 지운 워크스페이스 제외) 중
//   **고객에게 보이는 마지막 메시지**(clientVisibleSql · MAX(id))를 고객 쪽(그 방 참여 role 'client' 또는 users.is_guest=1)이
//   썼고 30일 이내인 방만 'open'. 담당 = 기본값 규칙(services/convCare.defaultAssignee 와 같은 술어):
//   Client.assigned_member_id 가 활성 사람 멤버 ∧ 이미 그 방 참여자(보는 중 아님)면 그 사람, 아니면 미배정.
//   출력 «만든 행 / 담당 채운 수 / 미배정 수». 롤백은 코드만(표는 남겨도 무해).
//
// 사용: node scripts/migrate-conversation-care.js        (적용)
//       node scripts/migrate-conversation-care.js --dry  (만들 행 수만 출력)
require('dotenv').config();
const { sequelize } = require('../config/database');
const { clientVisibleSql } = require('../utils/messageVisibility');

const DRY = process.argv.includes('--dry');

async function tableExists() {
  const [rows] = await sequelize.query("SHOW TABLES LIKE 'conversation_care'");
  return rows.length > 0;
}
async function fkExists() {
  const [rows] = await sequelize.query(`
    SELECT CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'conversation_care'
       AND REFERENCED_TABLE_NAME = 'conversations' AND DELETE_RULE = 'CASCADE'`);
  return rows.length > 0;
}

// 백필 대상 — SELECT 한 벌을 dry·적용·검산이 같이 쓴다.
const CANDIDATES_SQL = `
  SELECT c.id AS conversation_id, c.business_id,
         CASE WHEN bm.user_id IS NOT NULL AND cp_a.id IS NOT NULL THEN cl.assigned_member_id ELSE NULL END AS assignee_user_id,
         lm.created_at AS last_at
    FROM conversations c
    JOIN businesses b ON b.id = c.business_id AND b.deleted_at IS NULL
    JOIN (
      SELECT m.conversation_id, MAX(m.id) AS mid
        FROM messages m
       WHERE ${clientVisibleSql('m')}
       GROUP BY m.conversation_id
    ) last ON last.conversation_id = c.id
    JOIN messages lm ON lm.id = last.mid
    JOIN users su ON su.id = lm.sender_id
    LEFT JOIN conversation_participants cp_s
      ON cp_s.conversation_id = c.id AND cp_s.user_id = lm.sender_id AND cp_s.role = 'client'
    LEFT JOIN clients cl ON cl.id = c.client_id AND cl.business_id = c.business_id
    LEFT JOIN business_members bm
      ON bm.business_id = c.business_id AND bm.user_id = cl.assigned_member_id
     AND bm.removed_at IS NULL AND bm.role IN ('owner', 'admin', 'member')
    LEFT JOIN users au ON au.id = cl.assigned_member_id
    LEFT JOIN conversation_participants cp_a
      ON cp_a.conversation_id = c.id AND cp_a.user_id = cl.assigned_member_id AND cp_a.is_viewer = 0
   WHERE c.channel_type = 'customer'
     AND c.status = 'active' AND c.archived_at IS NULL
     AND (cp_s.id IS NOT NULL OR su.is_guest = 1)
     AND (lm.is_ai IS NULL OR lm.is_ai = 0)
     AND lm.created_at >= (NOW() - INTERVAL 30 DAY)
     AND (au.id IS NULL OR (au.is_ai = 0 AND (au.is_guest IS NULL OR au.is_guest = 0)))`;

async function run() {
  if (!(await tableExists())) {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS \`conversation_care\` (
        \`conversation_id\` INT NOT NULL,
        \`business_id\` INT NOT NULL,
        \`state\` ENUM('open','hold','resolved') NOT NULL DEFAULT 'open',
        \`state_changed_at\` DATETIME NOT NULL,
        \`state_changed_by\` INT NULL,
        \`assignee_user_id\` INT NULL,
        \`assigned_at\` DATETIME NULL,
        \`assigned_by\` INT NULL,
        \`created_at\` DATETIME NOT NULL,
        \`updated_at\` DATETIME NOT NULL,
        PRIMARY KEY (\`conversation_id\`),
        KEY \`idx_care_biz_state_assignee\` (\`business_id\`, \`state\`, \`assignee_user_id\`),
        CONSTRAINT \`fk_care_conv\` FOREIGN KEY (\`conversation_id\`) REFERENCES \`conversations\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    if (!(await tableExists())) throw new Error('CREATE 는 돌았는데 표가 없다 — 판정 실패');
    console.log('[migration] conversation_care 생성');
  } else {
    console.log('[migration] conversation_care 이미 있음');
  }
  // sync-database 가 먼저 만들었으면 FK 이름·삭제 규칙이 다를 수 있다 — cascade 가 없으면 붙인다.
  if (!(await fkExists())) {
    await sequelize.query('ALTER TABLE `conversation_care` ADD CONSTRAINT `fk_care_conv` FOREIGN KEY (`conversation_id`) REFERENCES `conversations` (`id`) ON DELETE CASCADE');
    if (!(await fkExists())) throw new Error('FK cascade 를 붙였는데 안 보인다 — 판정 실패');
    console.log('[migration] conversation_care FK cascade 추가');
  }

  const [cand] = await sequelize.query(`
    SELECT x.*, (cc.conversation_id IS NOT NULL) AS has_row
      FROM (${CANDIDATES_SQL}) x
      LEFT JOIN conversation_care cc ON cc.conversation_id = x.conversation_id`);
  const todo = cand.filter((r) => !Number(r.has_row));
  const withAssignee = todo.filter((r) => r.assignee_user_id).length;
  if (DRY) {
    console.log(`[migration] conversation_care dry — 만들 행 ${todo.length} / 담당 채움 ${withAssignee} / 미배정 ${todo.length - withAssignee} (대상 ${cand.length}, 이미 있음 ${cand.length - todo.length})`);
    return;
  }
  const [, meta] = await sequelize.query(`
    INSERT IGNORE INTO conversation_care
      (conversation_id, business_id, state, state_changed_at, state_changed_by, assignee_user_id, assigned_at, assigned_by, created_at, updated_at)
    SELECT x.conversation_id, x.business_id, 'open', NOW(), NULL, x.assignee_user_id,
           CASE WHEN x.assignee_user_id IS NULL THEN NULL ELSE NOW() END, NULL, NOW(), NOW()
      FROM (${CANDIDATES_SQL}) x`);
  const inserted = typeof meta === 'number' ? meta : (meta?.affectedRows ?? 0);
  console.log(`[migration] conversation_care 백필 — 만든 행 ${inserted} / 담당 채움 ${withAssignee} / 미배정 ${todo.length - withAssignee}`);
}

run()
  .then(() => sequelize.close())
  .catch(async (e) => { console.error('[migration] conversation_care 실패:', e.message); await sequelize.close().catch(() => {}); process.exit(1); });
