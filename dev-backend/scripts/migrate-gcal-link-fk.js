// calendar_event_gcal_links.connection_id 에 FK(ON DELETE CASCADE) 추가 + 기존 고아 정리. 멱등.
//
//   왜: 링크 테이블에는 event_id FK 만 있었고 connection_id 에는 인덱스(idx_conn)뿐이었다.
//       그래서 연결이 사라져도 링크가 **고아로 살아남는다** — 운영 실측 link#1(connection_id=12,
//       conn#12 부재). 그 링크가 붙은 event#29 는 updateAtLink 가 graceful return 하며
//       역방향 동기화가 영구 정지했다.
//
//   왜 앱 코드가 아니라 DB 인가: 삭제 경로가 셋이다 —
//       ① routes/external_connections.js DELETE (정리함) ② services/accountAnonymize.js (안 함)
//       ③ models/index.js Business/User onDelete CASCADE (앱 코드를 안 탄다).
//       앱 레벨로만 막으면 경로가 늘 때마다 또 빠진다. 이번 사고가 정확히 그 유형이다.
//       DELETE 라우트의 명시적 destroy 는 그대로 둔다 — FK 와 중복돼도 무해하고 의도를 남긴다.
//
//   ★ 실행 순서가 곧 안전성이다. 이 스크립트는 **sync-database.js 보다 먼저** 돌아야 한다.
//     sync-database.js:29 가 `SET FOREIGN_KEY_CHECKS = 0` 으로 alter 를 도는데, FK 검사가 꺼진
//     상태의 ADD FOREIGN KEY 는 **기존 행을 검증하지 않는다** → 고아가 남은 채 FK 만 붙는
//     최악의 상태가 조용히 만들어진다. deploy-planq.sh 의 pre-sync 슬롯에 등록한 이유다.
//
//   ★ 멱등 판정은 제약 **이름이 아니라 컬럼 쌍**으로 한다. sequelize alter 는 FK 를 drop/재생성하며
//     개명한다(dev 의 external_connections FK 가 ibfk_115/116 까지 증가한 실증). 이름으로 판정하면
//     개명 후 **중복 FK 를 또 붙인다**.
//
//   롤백: 제약 **이름을 조회한 뒤** DROP 한다 (위와 같은 이유로 이름이 고정이 아니다).
//     SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
//      WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='calendar_event_gcal_links'
//        AND COLUMN_NAME='connection_id' AND REFERENCED_TABLE_NAME='external_connections';
//     ALTER TABLE calendar_event_gcal_links DROP FOREIGN KEY <그 이름>;
require('dotenv').config();
const { sequelize } = require('../config/database');

const TABLE = 'calendar_event_gcal_links';

async function tableExists(name) {
  const [rows] = await sequelize.query(
    'SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
    { replacements: [name] },
  );
  return rows.length > 0;
}

/** 컬럼 쌍으로 FK 존재 판정 (이름 무관) — 개명 후 중복 생성 차단 */
async function fkOnConnection() {
  const [rows] = await sequelize.query(
    'SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE '
    + 'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? '
    + "AND COLUMN_NAME = 'connection_id' AND REFERENCED_TABLE_NAME = 'external_connections'",
    { replacements: [TABLE] },
  );
  return rows.map((r) => r.CONSTRAINT_NAME);
}

(async () => {
  try {
    if (!(await tableExists(TABLE))) {
      // 아직 테이블이 없는 환경 — sync-database 가 모델의 references 로 FK 까지 만들어 준다(C1).
      console.log(`[migration] ${TABLE} 없음 — skip (fresh 환경은 모델 references 가 처리)`);
      process.exit(0);
    }

    let changed = 0;

    // ① 고아 정리 — **반드시 FK 추가보다 먼저**. 남아 있으면 ②가 실패한다.
    const [orphans] = await sequelize.query(
      `SELECT l.id, l.connection_id, l.event_id FROM ${TABLE} l `
      + 'LEFT JOIN external_connections c ON c.id = l.connection_id '
      + 'WHERE l.connection_id IS NOT NULL AND c.id IS NULL',
    );
    if (orphans.length) {
      console.log(`[migration] 고아 링크 ${orphans.length}건: `
        + orphans.map((o) => `link#${o.id}(conn=${o.connection_id},event=${o.event_id})`).join(', '));
      await sequelize.query(
        `DELETE l FROM ${TABLE} l `
        + 'LEFT JOIN external_connections c ON c.id = l.connection_id '
        + 'WHERE l.connection_id IS NOT NULL AND c.id IS NULL',
      );
      console.log(`[migration] 고아 링크 ${orphans.length}건 삭제`);
      changed += orphans.length;
    } else {
      console.log('[migration] 고아 링크 0건 — 정리 skip');
    }

    // ② FK 추가 (ON UPDATE CASCADE 까지 포함해 sequelize 생성형과 맞춘다 — 매 sync 마다 drop/재생성되는
    //    churn 을 없앤다. 운영 event_id FK 가 그 형태다.)
    const existing = await fkOnConnection();
    if (existing.length) {
      console.log(`[migration] connection_id FK 이미 존재(${existing.join(', ')}) — skip`);
    } else {
      await sequelize.query(
        `ALTER TABLE ${TABLE} ADD CONSTRAINT fk_gcal_link_conn `
        + 'FOREIGN KEY (connection_id) REFERENCES external_connections(id) '
        + 'ON DELETE CASCADE ON UPDATE CASCADE',
      );
      console.log('[migration] connection_id FK 추가 (ON DELETE CASCADE)');
      changed += 1;
    }

    // 최종 상태 — 거짓 통과 방지를 위해 실제 조회로 확인해 찍는다.
    const after = await fkOnConnection();
    const [[left]] = await sequelize.query(
      `SELECT COUNT(*) AS n FROM ${TABLE} l `
      + 'LEFT JOIN external_connections c ON c.id = l.connection_id '
      + 'WHERE l.connection_id IS NOT NULL AND c.id IS NULL',
    );
    console.log(`[migration] 최종: FK=${after.length ? after.join(',') : '없음'} · 잔여 고아=${left.n}`);
    if (!after.length) throw new Error('FK 가 존재하지 않는다 — 적용 실패');
    if (Number(left.n) !== 0) throw new Error(`고아 ${left.n}건 잔존 — 정리 실패`);

    console.log(changed ? `[migration] 완료 — 변경 ${changed}건` : '[migration] 완료 — 변경 0 (멱등 확인)');
    process.exit(0);
  } catch (e) {
    console.error('[migration] 실패:', e.message);
    process.exit(1);
  }
})();
