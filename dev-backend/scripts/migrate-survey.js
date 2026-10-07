// 설문(#460) 마이그레이션 — 멱등(매 배포 실행 안전). docs/SURVEY_DESIGN.md «Fable 수정 7건» 5·7
//
//   ① q_records.survey_token VARCHAR(64) NULL + UNIQUE
//   ② q_records.survey_settings JSON NULL
//   ③ q_record_rows.created_by → NULL 허용 (외부 응답)
//   ④ q_record_audits.user_id → NULL 허용 + action ENUM 끝에 'row.survey','survey.update'
//   ⑤ notifications.event_kind · notification_prefs.event_kind 끝에 'survey'
//      ★ 두 알림 테이블은 값 순서가 다르다 — 테이블마다 **지금 DB 의 Type** 끝에 붙인다(migrate-qsale 와 같은 규칙)
//
//   운영은 코드 배포 **전에** `--dry` → 실행. 롤백: 코드 revert(새 컬럼·ENUM 값 잔존은 무해).
//   사용: node scripts/migrate-survey.js [--dry]
require('dotenv').config();
const { sequelize } = require('../config/database');
const DRY = process.argv.includes('--dry');
const run = async (sql, label) => {
  if (DRY) { console.log(`[migrate-survey] (dry) ${sql}`); return; }
  await sequelize.query(sql);
  console.log(`[migrate-survey] ${label}`);
};
const col = async (table, column) => {
  const [r] = await sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, { replacements: [column] });
  return r[0] || null;
};
function parseEnum(type) {
  const m = String(type).match(/^enum\((.*)\)$/i);
  return m ? [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'")) : null;
}
async function appendEnum(table, column, values) {
  const c = await col(table, column);
  if (!c) { console.log(`[migrate-survey] ${table}.${column} 없음 — skip`); return; }
  const cur = parseEnum(c.Type);
  if (!cur) throw new Error(`${table}.${column} 가 ENUM 이 아니다: ${c.Type}`);
  const add = values.filter((v) => !cur.includes(v));
  if (!add.length) { console.log(`[migrate-survey] ${table}.${column} 이미 있음 — skip`); return; }
  const next = [...cur, ...add].map((v) => `'${v.replace(/'/g, "''")}'`).join(',');
  const nullClause = c.Null === 'NO' ? 'NOT NULL' : 'NULL';
  const defClause = c.Default != null ? ` DEFAULT '${String(c.Default).replace(/'/g, "''")}'` : '';
  await run(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ENUM(${next}) ${nullClause}${defClause}, ALGORITHM=INPLACE, LOCK=NONE`, `${table}.${column} +${add.join(',')}`);
}
async function main() {
  if (!(await col('q_records', 'survey_token'))) await run('ALTER TABLE `q_records` ADD COLUMN `survey_token` VARCHAR(64) NULL, ADD UNIQUE INDEX `q_records_survey_token_unique` (`survey_token`)', 'q_records.survey_token');
  else console.log('[migrate-survey] q_records.survey_token 이미 있음 — skip');
  if (!(await col('q_records', 'survey_settings'))) await run('ALTER TABLE `q_records` ADD COLUMN `survey_settings` JSON NULL', 'q_records.survey_settings');
  else console.log('[migrate-survey] q_records.survey_settings 이미 있음 — skip');
  const cb = await col('q_record_rows', 'created_by');
  if (cb && cb.Null === 'NO') await run('ALTER TABLE `q_record_rows` MODIFY COLUMN `created_by` INT NULL', 'q_record_rows.created_by NULL 허용');
  else console.log('[migrate-survey] q_record_rows.created_by 이미 NULL 허용 — skip');
  const au = await col('q_record_audits', 'user_id');
  if (au && au.Null === 'NO') await run('ALTER TABLE `q_record_audits` MODIFY COLUMN `user_id` INT NULL', 'q_record_audits.user_id NULL 허용');
  else console.log('[migrate-survey] q_record_audits.user_id 이미 NULL 허용 — skip');
  await appendEnum('q_record_audits', 'action', ['row.survey', 'survey.update']);
  await appendEnum('notifications', 'event_kind', ['survey']);
  await appendEnum('notification_prefs', 'event_kind', ['survey']);
}
main().then(() => process.exit(0)).catch((e) => { console.error('[migrate-survey] 실패', e.message); process.exit(1); });
