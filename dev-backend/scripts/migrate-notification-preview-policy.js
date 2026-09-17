// #407 — `notifications.preview_policy` 추가. **멱등**.
//
//   왜 컬럼인가 (Fable 13차 차단1): 처음엔 `event_kind` 로 «사람이 쓴 글» 을 갈랐는데,
//   업무 댓글은 `'task'` 로 만들어진다 — 시스템 문구와 **같은 종류**다. 종류로 가르면 반드시 샌다.
//   만든 쪽이 행에 적어 두면, 그 행을 읽는 누구든(지금은 미읽음 에스컬레이션 크론) 따라온다.
//
//   ★ 코드 배포 **전에** 돌린다. 컬럼이 없는 채로 새 코드가 뜨면 알림 생성이 500 이 된다.
const { sequelize } = require('../config/database');

(async () => {
  const [cols] = await sequelize.query("SHOW COLUMNS FROM notifications LIKE 'preview_policy'");
  if (cols.length) { console.log('[migrate] notifications.preview_policy 이미 있음 — 건너뜀'); await sequelize.close(); return; }
  await sequelize.query(
    "ALTER TABLE notifications ADD COLUMN preview_policy ENUM('default','internal_only') NOT NULL DEFAULT 'default'"
  );
  console.log('[migrate] notifications.preview_policy 추가 완료');
  await sequelize.close();
})().catch((e) => { console.error('[migrate] 실패:', e.message); process.exit(1); });
