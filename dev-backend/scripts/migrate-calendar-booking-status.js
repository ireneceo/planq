#!/usr/bin/env node
// calendar_events.booking_status — 고객 창구 상담 예약(CLIENT_ENTRY P2)의 상태 칸. 멱등.
//
//   설계: docs/CLIENT_ENTRY_DESIGN.md §4.6 · §5 P2
//
// ★ **코드 배포 전에** 돌린다. 칸이 없는 채 새 코드가 뜨면 일정 목록이 `Unknown column` 으로 500 이다
//   (모델이 칸을 SELECT 한다 — 예약과 무관한 캘린더 전체가 죽는다).
//
// ── 무엇을 하나 ───────────────────────────────────────────────────────────
//   ① booking_status ENUM(...) **NULL** 추가. NULL = 보통 일정. 기존 행은 전부 NULL 로 남는다
//      (넓히는 변경 — 기존 일정의 뜻이 한 줄도 바뀌지 않는다. 아래에서 스크립트가 직접 대조한다).
//   ② (business_id, booking_status) 인덱스 — 확인필요 수집기·끝남 cron 이 이 둘로 찾는다.
//   `done`(끝남)은 **값이 아니다** — `confirmed && end_at < now` 로 파생한다(§4.6). 칸에 두면
//   시간이 지나는 것만으로 값이 거짓이 되고, 그것을 맞추는 cron 이 또 하나 생긴다.
//
// `sync-database.js` 에 맡기지 않는 이유는 migrate-guest-link-scope-workspace.js 와 같다
//   (모델 밖 컬럼 DROP 전례 · ENUM alter 64키 제한 전례).
//
// 사용:  node scripts/migrate-calendar-booking-status.js         (적용)
//        node scripts/migrate-calendar-booking-status.js --dry   (무엇을 할지만 출력)
require('dotenv').config();
const { sequelize } = require('../config/database');

const DRY = process.argv.includes('--dry');
const log = (...a) => console.log('[calendar-booking]', ...a);
const VALUES = "'requested','proposed','confirmed','declined','canceled'";
const IDX = 'calendar_events_biz_booking';

(async () => {
  try {
    const [[col]] = await sequelize.query("SHOW COLUMNS FROM calendar_events WHERE Field = 'booking_status'");
    const [idx] = await sequelize.query(`SHOW INDEX FROM calendar_events WHERE Key_name = '${IDX}'`);
    const colSql = `ALTER TABLE calendar_events ADD COLUMN booking_status ENUM(${VALUES}) NULL DEFAULT NULL`;
    const idxSql = `CREATE INDEX ${IDX} ON calendar_events (business_id, booking_status)`;

    if (col && idx.length) {
      log('둘 다 이미 적용됨 — 하는 일 없음');
      log('booking_status:', JSON.stringify(col.Type), '· NULL:', col.Null);
      const [dist] = await sequelize.query(
        'SELECT booking_status, COUNT(*) n FROM calendar_events GROUP BY booking_status');
      log('현재 분포:', JSON.stringify(dist));
      process.exit(0);
    }
    if (col && String(col.Type).replace(/\s/g, '') !== `enum(${VALUES})`) {
      // 값 목록이 다르게 이미 있으면 손대지 않는다 — 여기서 MODIFY 하면 기존 값의 정수 매핑을 건드린다.
      console.error('[calendar-booking] 실패: booking_status 가 다른 값 목록으로 이미 있다:', col.Type);
      process.exit(1);
    }

    if (DRY) {
      log('--dry — 실행할 것:');
      log(col ? '  ① (건너뜀 — 칸 있음)' : `  ① ${colSql}`);
      log(idx.length ? '  ② (건너뜀 — 인덱스 있음)' : `  ② ${idxSql}`);
      process.exit(0);
    }

    const [[before]] = await sequelize.query('SELECT COUNT(*) total, MAX(id) max_id FROM calendar_events');
    log('적용 전:', JSON.stringify(before));

    if (!col) { await sequelize.query(colSql); log('① booking_status 추가 완료'); } else log('① 건너뜀');
    if (!idx.length) { await sequelize.query(idxSql); log('② 인덱스 추가 완료'); } else log('② 건너뜀');

    const [[post]] = await sequelize.query(
      'SELECT COUNT(*) total, MAX(id) max_id, SUM(booking_status IS NOT NULL) non_null FROM calendar_events');
    log('적용 후:', JSON.stringify(post));
    // ★ 기존 행이 그대로인지 **스크립트가 판정한다** — 전부 NULL 이어야 한다.
    if (String(before.total) !== String(post.total) || Number(post.non_null) !== 0) {
      console.error('[calendar-booking] ★ 기존 행이 바뀌었다 — 확인 필요');
      process.exit(1);
    }
    log('기존 행 무변경 확인 ✅ (전부 NULL = 보통 일정)');
    process.exit(0);
  } catch (e) {
    console.error('[calendar-booking] 실패:', e.message);
    process.exit(1);
  }
})();
