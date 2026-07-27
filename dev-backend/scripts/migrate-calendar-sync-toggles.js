// 캘린더 연동 토글 마이그레이션 (Irene 요구 2026-07-27) — 멱등.
//
//   ① business_cloud_tokens.sync_enabled  — 팀 연동: 연결은 유지한 채 동기화만 끄기
//   ② external_connections.sync_enabled   — 개인 연동: 위와 동일 (읽기 overlay 는 is_active 가 담당)
//   ③ calendar_events.gcal_sync           — 일정 단위 "구글 캘린더에 올리기"
//   ④ calendar_event_gcal_links (신규)    — 일정 ↔ 구글 이벤트 링크 (목적지가 여러 개라 1:N)
//
//   ★ 기본값 전부 1(ON) — Irene 요구 "디폴트는 다 연동 체크된 상태".
//
//   과거 일정이 한꺼번에 구글로 쏟아지지 않는 이유(중요):
//     push 는 생성·수정·수동버튼 트리거에서만 일어난다. 컬럼 기본값이 1 이어도 **자동 일괄 업로드
//     cron 은 없다.** 즉 이 마이그레이션은 "죽어 있던 경로를 켜는" 부작용이 없다.
//     (memory feedback_backfill_needs_write_side_fix — 백필이 죽은 경로를 켜는지 반드시 점검)
//
//   왜 링크 테이블이 필요한가:
//     기존 calendar_events.gcal_event_id 는 **단일 목적지**(워크스페이스 캘린더 1개) 전제다.
//     개인 캘린더 쓰기가 들어오면 한 일정이 팀 캘린더 + 참여자별 개인 캘린더 N곳에 존재할 수 있어
//     컬럼 하나로는 표현이 안 된다. 기존 컬럼은 workspace 링크로 그대로 두고(회귀 0),
//     신규 목적지만 링크 테이블에 쌓는다. 옛 컬럼 제거는 이번 스코프 밖.
//
//   ★ 배포 순서: 이 스크립트(DB) → 백엔드 → 프론트.
//
//   롤백: 코드 revert 후 (컬럼·테이블 잔존은 무해)
//     DROP TABLE IF EXISTS calendar_event_gcal_links;
//     ALTER TABLE calendar_events DROP COLUMN gcal_sync;
//     ALTER TABLE business_cloud_tokens DROP COLUMN sync_enabled;
//     ALTER TABLE external_connections DROP COLUMN sync_enabled;
require('dotenv').config();
const { sequelize } = require('../config/database');

async function hasColumn(table, column) {
  const [rows] = await sequelize.query(`SHOW COLUMNS FROM ${table} LIKE '${column}'`);
  return rows.length > 0;
}

async function hasTable(table) {
  const [rows] = await sequelize.query(`SHOW TABLES LIKE '${table}'`);
  return rows.length > 0;
}

async function addColumn(table, column, ddl) {
  if (!(await hasTable(table))) { console.log(`[migration] ${table} 없음 — skip`); return false; }
  if (await hasColumn(table, column)) { console.log(`[migration] ${table}.${column} 이미 존재 — skip`); return false; }
  await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  console.log(`[migration] ${table}.${column} 추가`);
  return true;
}

async function ensureLinkTable() {
  if (await hasTable('calendar_event_gcal_links')) {
    console.log('[migration] calendar_event_gcal_links 이미 존재 — skip');
    return false;
  }
  await sequelize.query(`
    CREATE TABLE calendar_event_gcal_links (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      event_id BIGINT NOT NULL COMMENT 'calendar_events.id 는 bigint — FK 타입 일치 필수',
      target ENUM('workspace','personal') NOT NULL,
      connection_id INT NULL COMMENT 'personal 일 때 external_connections.id. workspace 는 NULL',
      user_id INT NULL COMMENT 'personal 일 때 소유자 — 누구 캘린더인지',
      gcal_event_id VARCHAR(255) NOT NULL,
      gcal_calendar_id VARCHAR(255) NULL DEFAULT 'primary',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_event_target_conn (event_id, target, connection_id),
      KEY idx_event (event_id),
      KEY idx_conn (connection_id),
      CONSTRAINT fk_cegl_event FOREIGN KEY (event_id) REFERENCES calendar_events(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('[migration] calendar_event_gcal_links 생성 (FK ON DELETE CASCADE)');
  return true;
}

(async () => {
  try {
    let changed = 0;
    // 기본 ON — Irene 요구. NOT NULL + DEFAULT 1 이라 기존 행도 즉시 1 로 채워진다.
    if (await addColumn('business_cloud_tokens', 'sync_enabled', "TINYINT(1) NOT NULL DEFAULT 1 COMMENT '팀 캘린더 동기화 on/off (연결은 유지)'")) changed++;
    if (await addColumn('external_connections', 'sync_enabled', "TINYINT(1) NOT NULL DEFAULT 1 COMMENT '개인 캘린더 쓰기 동기화 on/off'")) changed++;
    // ★ gcal_sync 는 migrate-calendar-sync-split 에서 gcal_sync_workspace 로 rename 됐다.
    //   분리가 끝난 DB 에 이 컬럼을 다시 ADD 하면 **죽은 컬럼이 부활**해 두 벌이 된다
    //   (Fable 게이트 재현). 후속 컬럼이 있으면 이 스크립트는 손대지 않는다.
    if (await hasColumn('calendar_events', 'gcal_sync_workspace')) {
      console.log('[migration] calendar_events.gcal_sync — split 완료 상태라 skip');
    } else if (await addColumn('calendar_events', 'gcal_sync', "TINYINT(1) NOT NULL DEFAULT 1 COMMENT '이 일정을 구글 캘린더에 올릴지'")) changed++;
    if (await ensureLinkTable()) changed++;

    // 확인 출력
    const syncCol = (await hasColumn('calendar_events', 'gcal_sync_workspace')) ? 'gcal_sync_workspace' : 'gcal_sync';
    const [[ev]] = await sequelize.query(`SELECT COUNT(*) AS n FROM calendar_events WHERE ${syncCol}=1`);
    const [[linked]] = await sequelize.query("SELECT COUNT(*) AS n FROM calendar_events WHERE gcal_event_id IS NOT NULL");
    console.log(`[migration] ${syncCol}=1 일정 ${ev.n}건 / 이미 구글에 올라간 일정 ${linked.n}건`);
    console.log('[migration] 자동 일괄 업로드 cron 없음 — 과거 일정은 그대로 둔다 (수동 "구글 캘린더로 보내기" 로만)');
    console.log(changed ? `[migration] 완료 — 변경 ${changed}건` : '[migration] 완료 — 변경 0 (멱등 확인)');
    process.exit(0);
  } catch (e) {
    console.error('[migration] 실패:', e.message);
    process.exit(1);
  }
})();
