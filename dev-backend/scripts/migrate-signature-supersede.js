// 서명 회차 닫기 · 고객 «수정 요청» — signature_requests 스키마. 멱등. 2026-10-22 (Fable 설계 PASS, docs/SIGNATURE_REVISE_ROUND_DESIGN.md)
//
// 추가하는 것
//   1. status ENUM 끝에 'superseded'      — 닫힌 회차의 행(기록으로만 남는다 · 잠금·서명본·진행·거래 단계에서 빠진다)
//   2. superseded_at DATETIME NULL        — 닫은 시각. 같은 값 = 같은 회차(이전 회차 묶음의 키)
//   3. rejected_kind ENUM('revise','decline') NULL — 받는 쪽이 «수정 요청» 인지 «서명 안 함» 인지. 옛 행 NULL = 거절
//
// ★ 배포 순서: 이 스크립트(DB) → PM2 reload. 모델이 새 칸을 SELECT 하므로 칸 없이 새 백엔드가 뜨면 서명 조회 전체가 500.
// ★ 롤백은 코드만. 칸·ENUM 은 남긴다(옛 코드에 무해). models/SignatureRequest.js 의 선언은 되돌리지 않는다 —
//   sync alter 가 모델에 없는 칸을 DROP 한다(migrate-doc-external-confirm.js 헤더와 같은 정책).
require('dotenv').config();
const { sequelize } = require('../config/database');

const TABLE = 'signature_requests';
const STATUS_ENUM = "ENUM('pending','sent','viewed','signed','rejected','expired','canceled','confirmed','commented','superseded')";
const COLUMNS = [
  { column: 'superseded_at', ddl: 'ADD COLUMN superseded_at DATETIME NULL' },
  { column: 'rejected_kind', ddl: "ADD COLUMN rejected_kind ENUM('revise','decline') NULL" },
];

async function columnType(column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
    { replacements: { table: TABLE, column } },
  );
  return rows[0] ? String(rows[0].t) : null;
}

(async () => {
  try {
    const st = await columnType('status');
    if (!st) { console.error(`[migrate-signature-supersede] ✗ ${TABLE}.status 가 없습니다 — sync-database.js 먼저`); process.exit(1); }
    if (!st.includes("'superseded'")) {
      await sequelize.query(`ALTER TABLE ${TABLE} MODIFY COLUMN status ${STATUS_ENUM} NOT NULL DEFAULT 'pending'`);
      console.log('[migrate-signature-supersede] + status superseded');
    }
    for (const c of COLUMNS) {
      if (!(await columnType(c.column))) {
        await sequelize.query(`ALTER TABLE ${TABLE} ${c.ddl}`);
        console.log('[migrate-signature-supersede] +', c.column);
      }
    }
    // 재조회 판정 — 미충족이면 exit 1(배포가 멈춘다)
    const miss = [];
    if (!(await columnType('status') || '').includes("'superseded'")) miss.push('status.superseded');
    for (const c of COLUMNS) if (!(await columnType(c.column))) miss.push(c.column);
    if (miss.length) { console.error('[migrate-signature-supersede] 검증 실패:', miss.join(', ')); process.exit(1); }
    console.log('[migrate-signature-supersede] OK');
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-signature-supersede] 실패:', e.message); process.exit(1); }
})();
