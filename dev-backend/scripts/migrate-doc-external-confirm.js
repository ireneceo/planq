// 문서 외부 컨펌 마이그레이션 — 운영 #239. 멱등.
//
// 추가하는 것 (signature_requests)
//   1. kind          ENUM('sign','confirm') NOT NULL DEFAULT 'sign'  — 서명 요청 vs 확인 요청
//   2. confirmed_at  DATETIME NULL                                   — 확인 시각
//   3. comment       TEXT NULL                                       — 외부 확인자가 남긴 의견
//   4. comment_at    DATETIME NULL
//   5. status ENUM 에 'confirmed','commented' **끝에 append**
//
// 왜 별도 스크립트인가
//   sync-database(Sequelize `alter: true`)는 **ENUM 확장을 못 한다.** 게다가 모델별 alter 실패를
//   exit 0 으로 삼킨 전례가 있다(64키 한도). 그래서 ENUM 이 걸린 변경은 이 저장소에서 전용 멱등
//   스크립트가 담당한다 (migrate-mail-notify · migrate-task-hold-status · migrate-email-delivery-status
//   와 같은 계열). 이 스크립트는 스키마를 **재조회해 판정**하고 미충족이면 exit 1 을 낸다.
//
// ★ 배포 순서: 이 스크립트(DB) → PM2 reload. **권장이 아니라 필수다.**
//   신 코드는 `kind='confirm'` · `status='confirmed'` 를 쓴다. 컬럼/ENUM 없이 새 백엔드가 먼저 뜨면
//   쓰기가 `Data truncated` 로 죽고 확인 기능이 통째로 무력해진다.
//   (반대로 이 스크립트만 먼저 돌리고 옛 백엔드를 두는 것은 안전하다 — 옛 코드는 신규 값을 모른다.)
//   위치는 sync-database **뒤**, 백필 **앞** — sync 가 컬럼을 먼저 만들어도 여기서 skip 되므로 충돌 없다.
//
// ★★ 롤백 정책 (Fable 판정 2026-08-18) — **코드만 revert 한다. 컬럼·ENUM 은 남긴다.**
//   additive 컬럼 + 끝-append ENUM 은 옛 코드에 무해하다. 반대로 축소 SQL 은 `confirmed`/`commented`
//   행이 생긴 뒤엔 데이터를 자른다 — 자를 값이 있는 순간부터 위험하고, 없는 순간엔 불필요하다.
//   그래서 롤백용 DROP/축소 SQL 을 **의도적으로 두지 않는다.**
//
//   ⚠️ 이 정책이 성립하려면 조건이 하나 있다:
//      **코드 롤백 시에도 `models/SignatureRequest.js` 의 신규 컬럼·ENUM 선언은 revert 하지 않는다.**
//      Sequelize `alter: true` 는 **모델에 없는 컬럼을 DROP 한다.** 모델까지 되돌린 채 재배포하면
//      sync-database 가 이 4컬럼을 조용히 지운다. 되돌릴 것은 라우트·프론트뿐이다.
require('dotenv').config();
const { sequelize } = require('../config/database');

const TABLE = 'signature_requests';

const COLUMNS = [
  { column: 'kind', ddl: "ADD COLUMN kind ENUM('sign','confirm') NOT NULL DEFAULT 'sign' AFTER entity_id" },
  { column: 'confirmed_at', ddl: 'ADD COLUMN confirmed_at DATETIME NULL' },
  { column: 'comment', ddl: 'ADD COLUMN comment TEXT NULL' },
  { column: 'comment_at', ddl: 'ADD COLUMN comment_at DATETIME NULL' },
];

// 기존 7값 + 신규 2값. **순서를 바꾸지 않는다** — ENUM 은 내부적으로 순번으로 저장되므로
//   앞쪽을 건드리면 기존 행의 의미가 통째로 뒤바뀐다. 끝에만 붙인다.
const STATUS_ENUM = "ENUM('pending','sent','viewed','signed','rejected','expired','canceled','confirmed','commented')";
const NEW_STATUS_VALUES = ['confirmed', 'commented'];

async function columnInfo(column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
    { replacements: { table: TABLE, column } },
  );
  return rows[0] || null;
}

async function tableExists() {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table`,
    { replacements: { table: TABLE } },
  );
  return rows.length > 0;
}

async function run() {
  let changed = 0;
  let failed = false;

  if (!(await tableExists())) {
    console.error(`✗ ${TABLE} 테이블이 없습니다 — sync-database.js 를 먼저 실행하세요`);
    process.exit(1);
  }

  const countRows = async () => {
    const [rows] = await sequelize.query(`SELECT COUNT(*) AS n FROM ${TABLE}`);
    return Number(rows[0].n);
  };
  const before = await countRows();
  console.log(`[migrate-doc-external-confirm] 시작 — ${TABLE} ${before}행`);

  // ── 1~4. 신규 컬럼 ──
  for (const c of COLUMNS) {
    if (await columnInfo(c.column)) {
      console.log(`· ${TABLE}.${c.column} 이미 존재 — skip`);
      continue;
    }
    console.log(`→ ${TABLE}.${c.column} 추가`);
    await sequelize.query(`ALTER TABLE ${TABLE} ${c.ddl}`);
    changed += 1;
  }

  // ── 5. status ENUM 확장 ──
  const st = await columnInfo('status');
  if (!st) {
    console.error(`✗ ${TABLE}.status 컬럼이 없습니다 — 스키마 확인 필요`);
    failed = true;
  } else if (NEW_STATUS_VALUES.every((v) => String(st.t).includes(`'${v}'`))) {
    console.log(`· ${TABLE}.status 이미 확장됨 — skip`);
  } else {
    console.log(`→ ${TABLE}.status ENUM 확장 (+${NEW_STATUS_VALUES.join(', ')})`);
    await sequelize.query(`ALTER TABLE ${TABLE} MODIFY COLUMN status ${STATUS_ENUM} NOT NULL DEFAULT 'pending'`);
    changed += 1;
  }

  // ── 최종 판정 — 스키마를 **재조회**해 확인한다. "돌렸으니 됐겠지" 로 통과시키지 않는다. ──
  for (const c of COLUMNS) {
    if (!(await columnInfo(c.column))) {
      console.error(`✗ 검증 실패 — ${TABLE}.${c.column} 이 없습니다`);
      failed = true;
    }
  }
  const stAfter = await columnInfo('status');
  for (const v of NEW_STATUS_VALUES) {
    if (!stAfter || !String(stAfter.t).includes(`'${v}'`)) {
      console.error(`✗ 검증 실패 — ${TABLE}.status 에 '${v}' 가 없습니다`);
      failed = true;
    }
  }
  // 행 수 보존 — additive 이므로 변할 이유가 없다. 변했으면 뭔가 잘못된 것이다.
  const after = await countRows();
  if (after !== before) {
    console.error(`✗ 검증 실패 — 행 수가 변했습니다 ${before} → ${after}`);
    failed = true;
  }
  // 기존 행은 전부 'sign' 이어야 한다 (DEFAULT 가 채운다). 기존 요청은 모두 서명 요청이었다.
  if (after > 0) {
    const [kr] = await sequelize.query(`SELECT COUNT(*) AS n FROM ${TABLE} WHERE kind <> 'sign'`);
    const k = Number(kr[0].n);
    if (k > 0) console.log(`  (참고) kind<>'sign' 행 ${k}건 — 이미 확인 요청이 생성된 뒤라면 정상`);
  }

  if (failed) {
    console.error('[migrate-doc-external-confirm] 실패 — 배포를 중단합니다');
    process.exit(1);
  }
  console.log(`[migrate-doc-external-confirm] 완료 — 변경 ${changed}${changed === 0 ? ' (멱등 확인)' : ''} · ${after}행 보존`);
  process.exit(0);
}

run().catch((e) => {
  console.error('[migrate-doc-external-confirm] 오류:', e.message);
  process.exit(1);
});
