// 일정 단위 구글 연동 플래그를 **팀/개인으로 분리** (Irene 지적 2026-07-27). 멱등.
//
//   왜: 처음엔 `calendar_events.gcal_sync` 하나로 만들고 목적지는 공개범위로 자동 결정했다.
//       그런데 **팀 캘린더와 개인 캘린더는 연결된 구글 계정이 다르다.** 스위치가 하나뿐이면
//       "팀에는 올리고 내 캘린더엔 안 올린다" 같은 당연한 선택을 할 수 없다.
//       Irene: "팀과 개인 공유 계정이 다른데 설정이 하나면 안되잖아."
//
//   ① gcal_sync → gcal_sync_workspace 로 rename (기존 값 보존, 의미는 '팀 캘린더')
//   ② gcal_sync_personal 신규 (기본 1 — "디폴트는 다 연동 체크" 요구 유지)
//
//   rename 을 쓰는 이유: `gcal_sync` 라는 이름을 남겨두고 "사실 팀 전용" 이라고 주석만 달면
//   다음 사람이 반드시 오해한다. 이름이 곧 계약이다.
//
//   ★ 배포 순서: 이 스크립트(DB) → 백엔드 → 프론트.
//   롤백: ALTER TABLE calendar_events CHANGE gcal_sync_workspace gcal_sync TINYINT(1) NOT NULL DEFAULT 1;
//         ALTER TABLE calendar_events DROP COLUMN gcal_sync_personal;
require('dotenv').config();
const { sequelize } = require('../config/database');

async function col(table, name) {
  const [rows] = await sequelize.query(`SHOW COLUMNS FROM ${table} LIKE '${name}'`);
  return rows.length ? rows[0] : null;
}

(async () => {
  try {
    let changed = 0;

    // ① rename — 옛 이름이 남아 있고 새 이름이 없을 때만
    const old = await col('calendar_events', 'gcal_sync');
    const ws = await col('calendar_events', 'gcal_sync_workspace');
    if (old && !ws) {
      await sequelize.query(
        "ALTER TABLE calendar_events CHANGE gcal_sync gcal_sync_workspace TINYINT(1) NOT NULL DEFAULT 1 "
        + "COMMENT '이 일정을 팀 구글 캘린더에 올릴지'"
      );
      console.log('[migration] gcal_sync → gcal_sync_workspace rename (값 보존)');
      changed++;
    } else if (ws) {
      console.log('[migration] gcal_sync_workspace 이미 존재 — skip');
    } else {
      // 옛 컬럼도 새 컬럼도 없는 환경 — 새로 만든다
      await sequelize.query(
        "ALTER TABLE calendar_events ADD COLUMN gcal_sync_workspace TINYINT(1) NOT NULL DEFAULT 1 "
        + "COMMENT '이 일정을 팀 구글 캘린더에 올릴지'"
      );
      console.log('[migration] gcal_sync_workspace 신규 생성');
      changed++;
    }

    // ② 개인 캘린더 플래그
    if (!(await col('calendar_events', 'gcal_sync_personal'))) {
      await sequelize.query(
        "ALTER TABLE calendar_events ADD COLUMN gcal_sync_personal TINYINT(1) NOT NULL DEFAULT 1 "
        + "COMMENT '이 일정을 본인 개인 구글 캘린더에 올릴지'"
      );
      console.log('[migration] gcal_sync_personal 추가 (기본 1)');
      changed++;
    } else {
      console.log('[migration] gcal_sync_personal 이미 존재 — skip');
    }

    const w = await col('calendar_events', 'gcal_sync_workspace');
    const p = await col('calendar_events', 'gcal_sync_personal');
    console.log('[migration] 최종:', `gcal_sync_workspace=${w && w.Type}/${w && w.Default}`, `gcal_sync_personal=${p && p.Type}/${p && p.Default}`);
    console.log(changed ? `[migration] 완료 — 변경 ${changed}건` : '[migration] 완료 — 변경 0 (멱등 확인)');
    process.exit(0);
  } catch (e) {
    console.error('[migration] 실패:', e.message);
    process.exit(1);
  }
})();
