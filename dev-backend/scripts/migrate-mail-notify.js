// #203/#207 마이그레이션 — Q Mail 알림 (멱등. 매 배포 실행해도 안전)
//
//   ① notification_prefs.event_kind ENUM 확장 — 'mail' 신규 + **잠복 버그 2건 동시 해소**
//      · 'share_expiry' 는 코드(EVENT_KINDS)·notifications ENUM 에는 있는데 이 테이블에만 없어서
//        사용자가 그 알림을 끄려고 PUT 하면 Data truncated → 500. "끌 수 없는 알림" 상태였다.
//      · 'system' 은 세 곳 어디에도 없는데 emailImapCron 이 실제로 발송한다 → notifications INSERT 가
//        try/catch 에 삼켜져 **인앱 알림만 조용히 사라지고** email/push 는 나갔다(부분 고장).
//   ② notifications.event_kind ENUM 확장 — 'mail', 'system'
//   ③ email_accounts.notify_scope — 계정별 알림 범위. 기본 'recommended'(확인권장+답변필요, Irene 지정)
//
//   ENUM 은 **끝에만 append** — 기존 값 순서 불변이라 데이터 재매핑이 없고 MySQL 8 에서 INPLACE.
//   롤백은 코드만 되돌리면 된다(옛 코드는 신규 값을 안 쓰므로 ENUM 잔존 무해). ENUM 축소 금지 —
//   신규 값을 쓰는 row 가 있으면 파괴적이다.
require('dotenv').config();
const { sequelize } = require('../config/database');

const PREF_KINDS = [
  'signature', 'invoice', 'tax_invoice', 'task', 'event', 'invite', 'message', 'mention',
  'comment_mention', 'inquiry', 'signup', 'payment', 'subscription', 'trial', 'feedback',
  'share_expiry', 'mail', 'system',
];
const NOTI_KINDS = [
  'signature', 'invoice', 'tax_invoice', 'task', 'event', 'invite', 'message', 'mention',
  'comment_mention', 'share_expiry', 'inquiry', 'signup', 'payment', 'subscription', 'trial',
  'feedback', 'mail', 'system',
];

const enumSql = (list) => list.map((v) => `'${v}'`).join(',');

async function currentEnum(table, column) {
  const [rows] = await sequelize.query(`SHOW COLUMNS FROM ${table} LIKE '${column}'`);
  return rows.length ? String(rows[0].Type) : null;
}

async function ensureEnum(table, column, list) {
  const cur = await currentEnum(table, column);
  if (cur === null) { console.log(`[migration] ${table}.${column} 없음 — skip`); return; }
  const missing = list.filter((v) => !cur.includes(`'${v}'`));
  if (!missing.length) { console.log(`[migration] ${table}.${column} 이미 최신 — skip`); return; }
  await sequelize.query(`ALTER TABLE ${table} MODIFY COLUMN ${column} ENUM(${enumSql(list)}) NOT NULL`);
  console.log(`[migration] ${table}.${column} ENUM +${missing.join(',')}`);
}

async function main() {
  await ensureEnum('notification_prefs', 'event_kind', PREF_KINDS);
  await ensureEnum('notifications', 'event_kind', NOTI_KINDS);

  const [cols] = await sequelize.query("SHOW COLUMNS FROM email_accounts LIKE 'notify_scope'");
  if (!cols.length) {
    await sequelize.query(`
      ALTER TABLE email_accounts
        ADD COLUMN notify_scope ENUM('all','recommended','reply_only')
        NOT NULL DEFAULT 'recommended'
        COMMENT '알림 범위 — all=전체 / recommended=확인권장+답변필요(기본) / reply_only=답변필요만'
    `);
    console.log('[migration] email_accounts.notify_scope 추가 (default recommended)');
  } else {
    console.log('[migration] email_accounts.notify_scope 이미 존재 — skip');
  }

  await sequelize.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
