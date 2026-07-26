// #206 마이그레이션 — Q Task 보류(on_hold) + 외부컨펌중(external_review). 멱등 (매 배포 실행 안전).
//
//   ① tasks.status ENUM 확장 — 'on_hold', 'external_review' 를 **끝에 append**
//   ② tasks.hold_prev_status VARCHAR(30) NULL — 보류 해제 시 복귀 목적지 (권위 컬럼)
//   ③ tasks.hold_reason      VARCHAR(500) NULL — 보류 사유 (선택). 해제 시 NULL 초기화
//
//   ENUM 은 **끝에만 append** — 기존 8값의 순서가 불변이라 기존 행의 내부 인덱스 재매핑이 없고,
//   MySQL 8 에서 메타데이터만 바뀌는 INPLACE/LOCK=NONE 변경이라 무중단이다.
//   중간 삽입·순서 변경은 테이블 리빌드 + 기존 행 재매핑을 유발하므로 절대 금지.
//
//   ★ 배포 순서: 이 스크립트(DB) → 백엔드 → 프론트.
//     역전하면 새 코드가 옛 ENUM 에 'on_hold' 를 써서 MySQL strict 모드 truncation 으로 저장 실패한다.
//     옛 백엔드는 신규 ENUM 값을 절대 쓰지 않으므로 DB 선행은 안전하다.
//
//   롤백: 코드 revert 후 잔존 행 정리 →
//     UPDATE tasks SET status = COALESCE(NULLIF(hold_prev_status,''),'in_progress'),
//                      hold_prev_status = NULL, hold_reason = NULL
//       WHERE status IN ('on_hold','external_review');
//     ENUM 원복 ALTER 는 선택 (새 값 잔존은 무해 — done_feedback 전례).
require('dotenv').config();
const { sequelize } = require('../config/database');

// 기존 8값 순서 그대로 + 끝에 2값. done_feedback 은 폐지값이지만 순서 보존을 위해 유지한다.
const STATUS_ENUM = [
  'not_started', 'waiting', 'in_progress',
  'reviewing', 'revision_requested', 'done_feedback',
  'completed', 'canceled',
  'on_hold', 'external_review',
];

async function columnType(table, column) {
  const [rows] = await sequelize.query(`SHOW COLUMNS FROM ${table} LIKE '${column}'`);
  return rows.length ? rows[0] : null;
}

async function ensureStatusEnum() {
  const col = await columnType('tasks', 'status');
  if (!col) { console.log('[migration] tasks.status 없음 — skip'); return false; }

  const cur = String(col.Type);
  const missing = STATUS_ENUM.filter((v) => !cur.includes(`'${v}'`));
  if (!missing.length) { console.log('[migration] tasks.status ENUM 이미 최신 — skip'); return false; }

  // 현 DDL 의 NULL 정책을 그대로 보존한다 (Null: 'YES' → NULL 허용). NOT NULL 승격은 이번 스코프 밖.
  const nullClause = col.Null === 'NO' ? 'NOT NULL' : 'NULL';
  const defClause = col.Default != null ? ` DEFAULT '${col.Default}'` : '';
  const values = STATUS_ENUM.map((v) => `'${v}'`).join(',');

  await sequelize.query(
    `ALTER TABLE tasks MODIFY COLUMN status ENUM(${values}) ${nullClause}${defClause}, ` +
    'ALGORITHM=INPLACE, LOCK=NONE'
  );
  console.log(`[migration] tasks.status ENUM +${missing.join(',')} (${nullClause}${defClause})`);
  return true;
}

async function ensureColumn(column, ddl) {
  const col = await columnType('tasks', column);
  if (col) { console.log(`[migration] tasks.${column} 이미 존재 — skip`); return false; }
  await sequelize.query(`ALTER TABLE tasks ADD COLUMN ${column} ${ddl}`);
  console.log(`[migration] tasks.${column} 추가`);
  return true;
}

async function main() {
  let changed = 0;
  if (await ensureStatusEnum()) changed += 1;
  if (await ensureColumn('hold_prev_status',
    "VARCHAR(30) NULL COMMENT '#206 보류 해제 시 복귀할 직전 상태'")) changed += 1;
  if (await ensureColumn('hold_reason',
    "VARCHAR(500) NULL COMMENT '#206 보류 사유 (선택). 해제 시 NULL'")) changed += 1;

  // 현재 분포 — 배포 전후 대조용 (옛 데이터 무변경 확인)
  const [dist] = await sequelize.query(
    'SELECT status, COUNT(*) c FROM tasks GROUP BY status ORDER BY c DESC'
  );
  console.log('[migration] tasks.status 분포:', dist.map((r) => `${r.status}=${r.c}`).join(' '));
  console.log(changed === 0 ? '[migration] 변경 0 (멱등 확인)' : `[migration] 변경 ${changed}건`);

  await sequelize.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
