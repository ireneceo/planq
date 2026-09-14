#!/usr/bin/env node
/**
 * notification_prefs.event_kind ENUM 에 `push_fallback` 을 **끝에 append**. (2026-09-14)
 *
 * Irene: *"푸시 실패 시 메일로 재알림 항목 넣는 거 좋은데?"*
 *   기기 알림이 조용히 실패했을 때 메일로 다시 보내는 안전망을 **끄고 켤 수 있는 항목**으로 만든다.
 *   여태 그 발송(unreadEscalationCron)은 설정을 무시했다 — "메일 다 껐는데 온다" 의 원인.
 *
 * ★ 멱등이다 — 이미 있으면 아무것도 하지 않는다.
 * ★ **끝에 append** 한다. 중간에 끼우면 기존 행의 값이 밀린다(ENUM 은 내부적으로 순서 인덱스다).
 * ★ `notifications.event_kind` 는 **건드리지 않는다** — push_fallback 은 알림 레코드로 남는
 *   종류가 아니라 **발송 스위치**다. 두 테이블은 값 목록이 다르므로 한 목록을 공유하지 않는다.
 * ★ 코드 배포 **전에** 실행한다(컬럼에 값이 없으면 저장이 500 난다 — 실측).
 */
require('dotenv').config();
const { Sequelize } = require('sequelize');

const NEW_VALUE = 'push_fallback';
const TABLE = 'notification_prefs';

(async () => {
  const s = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST, dialect: 'mysql', logging: false,
  });
  try {
    const [cols] = await s.query(`SHOW COLUMNS FROM ${TABLE} LIKE 'event_kind'`);
    if (!cols.length) { console.log(`[skip] ${TABLE}.event_kind 컬럼이 없습니다`); return; }
    const type = cols[0].Type;
    if (type.includes(`'${NEW_VALUE}'`)) {
      console.log(`[ok] 이미 있습니다 — 변경 없음 (${NEW_VALUE})`);
      return;
    }
    const values = [...type.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const next = [...values, NEW_VALUE].map((v) => `'${v.replace(/'/g, "''")}'`).join(',');
    const nullable = cols[0].Null === 'YES' ? 'NULL' : 'NOT NULL';
    await s.query(`ALTER TABLE ${TABLE} MODIFY COLUMN event_kind ENUM(${next}) ${nullable}`);
    const [after] = await s.query(`SHOW COLUMNS FROM ${TABLE} LIKE 'event_kind'`);
    const ok = after[0].Type.includes(`'${NEW_VALUE}'`);
    console.log(`[${ok ? 'ok' : 'FAIL'}] ${values.length} → ${values.length + 1} 종류 · ${NEW_VALUE} ${ok ? '추가됨' : '추가 실패'}`);
    if (!ok) process.exitCode = 1;
  } catch (e) {
    console.error('[FAIL]', e.message);
    process.exitCode = 1;
  } finally { await s.close(); }
})();
