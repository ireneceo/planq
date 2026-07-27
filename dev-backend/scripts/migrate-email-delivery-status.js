// Q Mail 발송 상태 마이그레이션 — email_messages.delivery_status ENUM 에 'suppressed' append. 멱등.
//
//   왜: 발송 라우트 3곳(답장·작성·전달)이 SMTP 결과와 무관하게 무조건 'sent' 를 박아 넣었다.
//       그래서 dev 발송 게이트(EMAIL_SENDING_ENABLED=false)가 삼킨 메일도 "보냄" 으로 남아
//       사용자가 보냈다고 믿었다 (2026-07-27 Irene 보고 "받기만 되고 발송이 안 된다").
//       'suppressed' 는 '실제로 안 나갔다' 를 'sent' 와 구분해 기록하기 위한 값이다.
//
//   ENUM 은 **끝에만 append** — 기존 5값의 순서가 불변이라 기존 행의 내부 인덱스 재매핑이 없고,
//   MySQL 8 에서 메타데이터만 바뀌는 INPLACE/LOCK=NONE 변경이라 무중단이다.
//   중간 삽입·순서 변경은 테이블 리빌드를 유발하므로 절대 금지.
//
//   ★ 배포 순서: 이 스크립트(DB) → 백엔드 → 프론트.
//     역전하면 새 코드가 옛 ENUM 에 'suppressed' 를 써서 strict 모드 truncation 으로 저장 실패한다.
//     옛 백엔드는 신규 ENUM 값을 절대 쓰지 않으므로 DB 선행은 안전하다.
//
//   백필 없음 — 과거 행의 'sent' 는 그대로 둔다. 실제로 나갔는지 지금 와서 알 방법이 없으므로
//   추정으로 고쳐 쓰지 않는다(거짓 기록을 다른 거짓 기록으로 바꾸는 셈).
//
//   롤백: 코드 revert 후 →
//     UPDATE email_messages SET delivery_status='failed' WHERE delivery_status='suppressed';
//     ENUM 원복 ALTER 는 선택 (새 값 잔존은 무해).
require('dotenv').config();
const { sequelize } = require('../config/database');

// 기존 5값 순서 그대로 + 끝에 1값.
const DELIVERY_ENUM = ['pending', 'sent', 'delivered', 'bounced', 'failed', 'suppressed'];

async function columnType(table, column) {
  const [rows] = await sequelize.query(`SHOW COLUMNS FROM ${table} LIKE '${column}'`);
  return rows.length ? rows[0] : null;
}

async function ensureDeliveryEnum() {
  const col = await columnType('email_messages', 'delivery_status');
  if (!col) { console.log('[migration] email_messages.delivery_status 없음 — skip'); return false; }

  const cur = String(col.Type);
  const missing = DELIVERY_ENUM.filter((v) => !cur.includes(`'${v}'`));
  if (!missing.length) { console.log('[migration] delivery_status ENUM 이미 최신 — skip (변경 0)'); return false; }

  // 현 DDL 의 NULL 정책·기본값을 그대로 보존한다.
  const nullClause = col.Null === 'NO' ? 'NOT NULL' : 'NULL';
  const defClause = col.Default != null ? ` DEFAULT '${col.Default}'` : '';
  const values = DELIVERY_ENUM.map((v) => `'${v}'`).join(',');

  await sequelize.query(
    `ALTER TABLE email_messages MODIFY COLUMN delivery_status ENUM(${values}) ${nullClause}${defClause}, ` +
    'ALGORITHM=INPLACE, LOCK=NONE'
  );
  console.log(`[migration] delivery_status ENUM +${missing.join(',')} (${nullClause}${defClause})`);
  return true;
}

(async () => {
  try {
    const changed = await ensureDeliveryEnum();
    const after = await columnType('email_messages', 'delivery_status');
    console.log('[migration] 최종 타입:', after ? after.Type : '(없음)');
    console.log(changed ? '[migration] 완료 — 변경 있음' : '[migration] 완료 — 변경 0 (멱등 확인)');
    process.exit(0);
  } catch (e) {
    console.error('[migration] 실패:', e.message);
    process.exit(1);
  }
})();
