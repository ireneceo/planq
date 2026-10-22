// 공용 메일 멤버별 읽음 + 답변 담당 업무 (2026-10-22 · docs/MAIL_MEMBER_READ_AND_REPLY_OWNER_DESIGN.md §7 C7) — 멱등.
//   email_threads 칸 3개 + 인덱스 1:
//     last_inbound_message_id — 마지막 «받은» 메일 id(우리 사본 제외). 백필은 sent_at DESC, id DESC 첫 행(MAX(id) 금지 — 늦게 들어온 옛 메일).
//     read_floor_message_id   — 옛 «누군가 읽음» 의 바닥. 칸을 처음 만들 때 한 번만 채운다(unread_count = 0 인 행).
//     reply_task_id           — 이 스레드의 답변 업무(FK 없음 — 없는 업무 = 없음).
//   모델이 이 칸을 SELECT 하므로 **코드보다 먼저**(배포 슬롯).
// 롤백: additive 칸이라 옛 코드에 무해. **코드만 되돌리고 칸은 남긴다**(모델 선언까지 되돌리면 sync 가 DROP 한다).
require('dotenv').config();
const { sequelize } = require('../config/database');
const TAG = '[migrate-mail-member-read]';
const CHUNK = 2000;

async function hasCol(name) {
  const [r] = await sequelize.query(`SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_threads' AND COLUMN_NAME = ?`, { replacements: [name] });
  return r.length > 0;
}
async function hasIdx(name) {
  const [r] = await sequelize.query(`SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_threads' AND INDEX_NAME = ?`, { replacements: [name] });
  return r.length > 0;
}

(async () => {
  try {
    const hadInbound = await hasCol('last_inbound_message_id');
    const hadFloor = await hasCol('read_floor_message_id');
    if (!hadInbound) {
      await sequelize.query('ALTER TABLE email_threads ADD COLUMN last_inbound_message_id INT NULL');
      console.log(TAG, 'last_inbound_message_id 추가');
    }
    if (!hadFloor) {
      await sequelize.query('ALTER TABLE email_threads ADD COLUMN read_floor_message_id INT NULL');
      console.log(TAG, 'read_floor_message_id 추가');
    }
    if (!(await hasCol('reply_task_id'))) {
      await sequelize.query('ALTER TABLE email_threads ADD COLUMN reply_task_id INT NULL');
      console.log(TAG, 'reply_task_id 추가');
    }
    if (!(await hasIdx('email_threads_biz_acct_inbound'))) {
      await sequelize.query('CREATE INDEX email_threads_biz_acct_inbound ON email_threads (business_id, account_id, last_inbound_message_id)');
      console.log(TAG, '인덱스 추가');
    }

    // 백필 — 비어 있는 행만(멱등). 순서 = 받은 시각 최신 → 같은 시각이면 id 큰 것.
    let filled = 0;
    for (;;) {
      const [rows] = await sequelize.query(`SELECT t.id FROM email_threads t
        WHERE t.last_inbound_message_id IS NULL
          AND EXISTS (SELECT 1 FROM email_messages m WHERE m.thread_id = t.id AND m.direction = 'inbound')
        ORDER BY t.id LIMIT ${CHUNK}`);
      if (!rows.length) break;
      const ids = rows.map((r) => r.id);
      await sequelize.query(`UPDATE email_threads t SET t.last_inbound_message_id = (
          SELECT m.id FROM email_messages m WHERE m.thread_id = t.id AND m.direction = 'inbound'
          ORDER BY m.sent_at DESC, m.id DESC LIMIT 1)
        WHERE t.id IN (:ids)`, { replacements: { ids } });
      filled += ids.length;
    }
    console.log(TAG, `last_inbound 채움 ${filled}`);

    // 바닥 — 아직 한 번도 안 채웠을 때만(배포 1회). 다시 돌려도 새로 읽은 것을 «모두 읽음» 으로 만들지 않는다.
    //   ★ «한 번도 안 채웠다» 를 칸이 있는지로 가르지 않는다 — 배포는 sync-database(alter)를 이 슬롯보다 먼저 돌려
    //   모델에 선언된 이 칸을 먼저 만든다. 2026-10-22 운영: 칸이 «이미 있음» 이라 바닥을 건너뛰어 스레드 5,335/5,379 가
    //   모든 멤버에게 안 읽음이 됐다. 그래서 «채워진 행이 하나라도 있는가» 로 본다.
    const [[fl]] = await sequelize.query('SELECT COUNT(*) n FROM email_threads WHERE read_floor_message_id IS NOT NULL');
    const floorPending = !hadFloor || Number(fl.n) === 0;
    if (floorPending) {
      const [r] = await sequelize.query(`UPDATE email_threads SET read_floor_message_id = last_inbound_message_id
        WHERE unread_count = 0 AND last_inbound_message_id IS NOT NULL`);
      console.log(TAG, `바닥 채운 수 ${r.affectedRows ?? r.changedRows ?? '?'}`);
    } else console.log(TAG, `바닥 이미 채움(${fl.n}행) — 다시 채우지 않음`);

    const [[s]] = await sequelize.query(`SELECT
        SUM(last_inbound_message_id IS NOT NULL AND (read_floor_message_id IS NULL OR last_inbound_message_id > read_floor_message_id)) AS unread_left,
        COUNT(*) AS total FROM email_threads`);
    console.log(TAG, `안 읽음으로 남는 스레드 ${s.unread_left || 0} / 전체 ${s.total}`);

    for (const c of ['last_inbound_message_id', 'read_floor_message_id', 'reply_task_id']) {
      if (!(await hasCol(c))) { console.error(TAG, '검증 실패', c); process.exit(1); }
    }
    if (!(await hasIdx('email_threads_biz_acct_inbound'))) { console.error(TAG, '검증 실패 인덱스'); process.exit(1); }
    console.log(TAG, 'OK');
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error(TAG, '실패:', e.message); process.exit(1); }
})();
