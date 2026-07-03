// 네이티브 푸시(APNs/FCM) 스키마 — push_subscriptions 확장 (idempotent).
//   설계: docs/MOBILE_APP_DESIGN §5.1
//   1) kind ENUM('webpush','apns','fcm') — 기존 row 는 DEFAULT 'webpush' (백필 불필요)
//   2) device_token VARCHAR(255) — APNs/FCM 기기 토큰 (webpush 는 NULL)
//   3) device_name VARCHAR(100) — 기기 표시명
//   4) p256dh / auth 를 NULL 허용으로 완화 (네이티브 row 는 web push 키가 없음)
//   5) INDEX (kind, user_id)
// sync-database.js alter 의 "Too many keys" 함정(feedback_sync_alter_too_many_keys) 회피 위해
// 컬럼/인덱스 존재 검사 후 수동 ALTER. 운영도 이 스크립트 수동 실행.
const { sequelize } = require('../config/database');

async function columnExists(table, column) {
  const [rows] = await sequelize.query(
    'SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?',
    { replacements: [table, column] }
  );
  return Number(rows[0].c) > 0;
}

async function indexExists(table, indexName) {
  const [rows] = await sequelize.query(
    'SELECT COUNT(*) AS c FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?',
    { replacements: [table, indexName] }
  );
  return Number(rows[0].c) > 0;
}

async function run() {
  console.log('[push-native] 스키마 적용 시작');

  if (!(await columnExists('push_subscriptions', 'kind'))) {
    await sequelize.query(
      "ALTER TABLE push_subscriptions ADD COLUMN kind ENUM('webpush','apns','fcm') NOT NULL DEFAULT 'webpush' AFTER business_id"
    );
    console.log('[push-native] kind 추가');
  } else {
    console.log('[push-native] kind 이미 존재 — skip');
  }

  if (!(await columnExists('push_subscriptions', 'device_token'))) {
    await sequelize.query('ALTER TABLE push_subscriptions ADD COLUMN device_token VARCHAR(255) NULL AFTER auth');
    console.log('[push-native] device_token 추가');
  } else {
    console.log('[push-native] device_token 이미 존재 — skip');
  }

  if (!(await columnExists('push_subscriptions', 'device_name'))) {
    await sequelize.query('ALTER TABLE push_subscriptions ADD COLUMN device_name VARCHAR(100) NULL AFTER user_agent');
    console.log('[push-native] device_name 추가');
  } else {
    console.log('[push-native] device_name 이미 존재 — skip');
  }

  // p256dh / auth 를 NULL 허용으로 (네이티브 row 는 web push 키 없음). MODIFY 는 멱등.
  await sequelize.query('ALTER TABLE push_subscriptions MODIFY p256dh VARCHAR(200) NULL');
  await sequelize.query('ALTER TABLE push_subscriptions MODIFY auth VARCHAR(100) NULL');
  console.log('[push-native] p256dh/auth NULL 허용');

  if (!(await indexExists('push_subscriptions', 'push_subscriptions_kind_user'))) {
    await sequelize.query('ALTER TABLE push_subscriptions ADD INDEX push_subscriptions_kind_user (kind, user_id)');
    console.log('[push-native] INDEX (kind,user_id) 추가');
  } else {
    console.log('[push-native] INDEX (kind,user_id) 이미 존재 — skip');
  }

  console.log('[push-native] 완료');
}

run()
  .then(() => process.exit(0))
  .catch((e) => { console.error('[push-native] 실패:', e); process.exit(1); });
