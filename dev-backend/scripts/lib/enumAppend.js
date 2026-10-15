// ENUM 끝 append — 멱등. migrate-qsale.js 에서 뽑아 여러 마이그레이션이 같이 쓴다(베끼면 한쪽만 고쳐진다).
//   ★ 지금 DB 의 Type 문자열 끝에 붙인다(값 순서를 바꾸면 메타데이터 변경이 아니라 테이블 복사다).
//   ★ NULL·DEFAULT 는 현 DDL 그대로. ALGORITHM=INPLACE, LOCK=NONE — 순서가 바뀌는 변경이면 MySQL 이 거부해 멈춘다.
function parseEnum(type) {
  const m = String(type).match(/^enum\((.*)\)$/i);
  if (!m) return null;
  return [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"));
}

async function appendEnum(sequelize, { table, column, value }, { dry = false, tag = 'migrate' } = {}) {
  const [rows] = await sequelize.query(`SHOW COLUMNS FROM \`${table}\` LIKE ?`, { replacements: [column] });
  if (!rows.length) { console.log(`[${tag}] ${table}.${column} 없음 — skip`); return false; }
  const col = rows[0];
  const values = parseEnum(col.Type);
  if (!values) throw new Error(`${table}.${column} 가 ENUM 이 아니다: ${col.Type}`);
  if (values.includes(value)) { console.log(`[${tag}] ${table}.${column} 에 '${value}' 이미 있음 — skip`); return false; }

  const next = [...values, value].map((v) => `'${v.replace(/'/g, "''")}'`).join(',');
  const nullClause = col.Null === 'NO' ? 'NOT NULL' : 'NULL';
  const defClause = col.Default != null ? ` DEFAULT '${String(col.Default).replace(/'/g, "''")}'` : '';
  const sql = `ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ENUM(${next}) ${nullClause}${defClause}, ALGORITHM=INPLACE, LOCK=NONE`;
  if (dry) { console.log(`[${tag}] (dry) ${sql}`); return true; }
  await sequelize.query(sql);
  console.log(`[${tag}] ${table}.${column} +'${value}' (${nullClause}${defClause})`);
  return true;
}

module.exports = { parseEnum, appendEnum };
