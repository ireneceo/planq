// PlanQ 안내방(2026-11-04, docs/PLANQ_GUIDE_ROOM_DESIGN.md §1·§8) — 멱등.
//   ① conversations.channel_type ENUM 끝에 'platform'  ② help_question_logs.mode ENUM 끝에 'support_room'
//   ③ support_rooms 표(워크스페이스당 하나 — 안내방의 상태: 사람 연결 요청·Cue 멈춤·«그만 받기»·관리자 읽음)
//   ENUM 끝에 값 붙이기는 MySQL 8 메타데이터 변경(표 다시 쓰기 없음). 재조회로 판정하고 미충족이면 exit 1.
// 롤백: 코드만 되돌린다. 값·표는 남겨도 옛 코드에 무해 — 모델 선언을 되돌리면 sync alter 가 값을 지우니 되돌리지 않는다.
require('dotenv').config();
const { sequelize } = require('../config/database');

async function colType(table, col) {
  const [r] = await sequelize.query(`SELECT COLUMN_TYPE t FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, { replacements: [table, col] });
  return r[0] ? r[0].t : null;
}
async function appendEnum(table, col, value, notNullDefault) {
  const t = await colType(table, col);
  if (!t) throw new Error(`${table}.${col} 없음`);
  if (t.includes(`'${value}'`)) { console.log(`[migrate-support-room] ${table}.${col} '${value}' 이미 있음 — skip`); return; }
  const values = t.replace(/^enum\(/i, '').replace(/\)$/, '');
  await sequelize.query(`ALTER TABLE ${table} MODIFY COLUMN ${col} ENUM(${values},'${value}') ${notNullDefault}`);
  console.log(`[migrate-support-room] ${table}.${col} += '${value}'`);
}

(async () => {
  try {
    await appendEnum('conversations', 'channel_type', 'platform', "NULL DEFAULT 'internal'");
    await appendEnum('help_question_logs', 'mode', 'support_room', "NOT NULL DEFAULT 'qhelper'");
    await sequelize.query(`CREATE TABLE IF NOT EXISTS support_rooms (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      business_id INT NOT NULL,
      conversation_id INT NOT NULL,
      human_requested_at DATETIME NULL,
      cue_muted_until DATETIME NULL,
      nudges_off_at DATETIME NULL,
      admin_last_read_at DATETIME NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      UNIQUE KEY uq_support_rooms_business (business_id),
      UNIQUE KEY uq_support_rooms_conversation (conversation_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    console.log('[migrate-support-room] support_rooms 확인');

    const c = await colType('conversations', 'channel_type');
    const h = await colType('help_question_logs', 'mode');
    const [[tb]] = await sequelize.query("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'support_rooms'");
    if (!/'platform'/.test(c) || !/'customer'/.test(c) || !/'support_room'/.test(h) || !/'qhelper'/.test(h) || !Number(tb.n)) {
      console.error('[migrate-support-room] 검증 실패', c, h, tb); process.exit(1);
    }
    console.log('[migrate-support-room] OK', c, h);
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-support-room] 실패:', e.message); process.exit(1); }
})();
