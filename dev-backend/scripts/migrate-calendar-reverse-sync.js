// 역방향 동기화(구글→PlanQ) 마이그레이션 — #242 ②. 멱등.
//
// 추가하는 것
//   1. external_connections.gcal_sync_token   TEXT NULL       — 개인 연동 증분 커서
//   2. business_cloud_tokens.gcal_sync_token  TEXT NULL       — 워크스페이스 증분 커서
//   3. calendar_event_gcal_links.last_pushed_etag VARCHAR(255) NULL — 에코 루프 1차 필터
//   4. calendar_events.created_at/updated_at  DATETIME → DATETIME(3)
//
// 왜 4번인가
//   역방향 충돌 규칙이 "구글 updated vs PlanQ updated_at 최신 우선" 인데, 구글은 밀리초이고
//   이쪽이 초 정밀도면 **같은 초 안의 변경이 전부 동률**이 되어 규칙이 무력해진다.
//   posts 에서 같은 계열의 사고가 이미 있었다(같은 초 두 저장이 낙관적 잠금을 통과해 본문 덮어씀).
//   DATETIME → DATETIME(3) 은 **정밀도 확대**라 기존 값은 .000 으로 패딩될 뿐 잘리지 않는다.
//
// ★ 배포 순서: 이 스크립트(DB) → 백엔드 → 프론트. **권장이 아니라 필수다.**
//   Sequelize 는 모델에 선언된 컬럼을 모든 SELECT 에 싣는다 — 컬럼 없이 새 백엔드를 올리면
//   `ExternalConnection` 조회 전체가 `ER_BAD_FIELD_ERROR` 로 죽는다(외부 연동 화면·캘린더 전멸).
//   "역전해도 무해" 가 아니다. DB 를 먼저 올려라.
//   (반대로 이 스크립트만 먼저 돌리고 옛 백엔드를 두는 것은 안전하다 — 옛 코드는 신규 컬럼을 모른다.)
//
// 롤백
//   ALTER TABLE external_connections DROP COLUMN gcal_sync_token;
//   ALTER TABLE business_cloud_tokens DROP COLUMN gcal_sync_token;
//   ALTER TABLE calendar_event_gcal_links DROP COLUMN last_pushed_etag;
//   ALTER TABLE calendar_events MODIFY created_at DATETIME NOT NULL, MODIFY updated_at DATETIME NOT NULL;
//   (커서·etag 는 캐시라 지워도 다음 폴링이 재부트스트랩한다. 데이터 손실 없음)
require('dotenv').config();
const { sequelize } = require('../config/database');

const COLUMNS = [
  { table: 'external_connections', column: 'gcal_sync_token', ddl: 'ADD COLUMN gcal_sync_token TEXT NULL' },
  { table: 'business_cloud_tokens', column: 'gcal_sync_token', ddl: 'ADD COLUMN gcal_sync_token TEXT NULL' },
  { table: 'calendar_event_gcal_links', column: 'last_pushed_etag', ddl: 'ADD COLUMN last_pushed_etag VARCHAR(255) NULL' },
];

const DATETIME_MS = { table: 'calendar_events', columns: ['created_at', 'updated_at'], target: 'datetime(3)' };

async function columnInfo(table, column) {
  const [rows] = await sequelize.query(
    `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
    { replacements: { table, column } },
  );
  return rows[0] || null;
}

async function tableExists(table) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table`,
    { replacements: { table } },
  );
  return rows.length > 0;
}

async function run() {
  let changed = 0;
  let failed = false;

  // ── 1~3. 신규 컬럼 ──
  for (const c of COLUMNS) {
    if (!(await tableExists(c.table))) {
      console.error(`✗ ${c.table} 테이블이 없습니다 — sync-database.js 를 먼저 실행하세요`);
      failed = true;
      continue;
    }
    if (await columnInfo(c.table, c.column)) {
      console.log(`· ${c.table}.${c.column} 이미 존재 — skip`);
      continue;
    }
    console.log(`→ ${c.table}.${c.column} 추가`);
    await sequelize.query(`ALTER TABLE ${c.table} ${c.ddl}`);
    changed += 1;
  }

  // ── 4. calendar_events 시각 정밀도 ──
  for (const col of DATETIME_MS.columns) {
    const cur = await columnInfo(DATETIME_MS.table, col);
    if (!cur) {
      console.error(`✗ ${DATETIME_MS.table}.${col} 컬럼이 없습니다 — 스키마 확인 필요`);
      failed = true;
      continue;
    }
    if (String(cur.t).toLowerCase() === DATETIME_MS.target) {
      console.log(`· ${DATETIME_MS.table}.${col} 이미 ${DATETIME_MS.target} — skip`);
      continue;
    }
    console.log(`→ ${DATETIME_MS.table}.${col} ${cur.t} → ${DATETIME_MS.target}`);
    await sequelize.query(`ALTER TABLE ${DATETIME_MS.table} MODIFY ${col} DATETIME(3) NOT NULL`);
    changed += 1;
  }

  // ── 검증 — ALTER 성공 로그가 아니라 실제 스키마를 다시 읽어 판정한다 ──
  console.log('\n검증:');
  let ok = true;
  for (const c of COLUMNS) {
    const info = await columnInfo(c.table, c.column);
    const good = !!info;
    console.log(`  ${good ? '✓' : '✗'} ${c.table}.${c.column} = ${info ? info.t : '(없음)'}`);
    if (!good) ok = false;
  }
  for (const col of DATETIME_MS.columns) {
    const info = await columnInfo(DATETIME_MS.table, col);
    const good = String(info?.t).toLowerCase() === DATETIME_MS.target;
    console.log(`  ${good ? '✓' : '✗'} ${DATETIME_MS.table}.${col} = ${info?.t}`);
    if (!good) ok = false;
  }

  console.log(ok && !failed ? `\n완료 (변경 ${changed}건)` : '\n실패 — 위 ✗ 항목 확인');
  if (!ok || failed) process.exitCode = 1;
}

run()
  .catch((e) => { console.error('마이그레이션 실패:', e.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
