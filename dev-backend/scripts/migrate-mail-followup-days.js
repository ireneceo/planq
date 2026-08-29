// #384 나머지 — 메일별 "며칠 뒤 알림" 기간. 멱등.
//
// 왜 컬럼 하나인가
//   알림은 이미 붙었지만 기간이 3일 고정이었다(services/mailFollowUp.MIN_DAYS).
//   Irene 요구는 "언제쯤까지 답변 안 오면 알려달라는 **설정**" 이다.
//
// 값의 뜻 (여기가 정본)
//   NULL — 기본값(3일)을 쓴다. 지금까지의 모든 스레드가 여기 해당한다(백필 불필요).
//   0    — 이 대화는 알림을 **끈다**. (연락 끝난 안내 메일 등)
//   N    — N일 뒤. 1~365 범위만 저장한다.
//
// ★ 백필하지 않는다. NULL 이 곧 "기본값" 이라 옛 행의 동작이 그대로 유지된다 —
//   백필하면 나중에 기본값을 바꿀 때 옛 행만 옛 값에 고정돼 버린다.
const { sequelize } = require('../config/database');

async function hasColumn(table, col) {
  const [r] = await sequelize.query(
    `SELECT COUNT(*) n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t AND COLUMN_NAME=:c`,
    { replacements: { t: table, c: col } });
  return Number(r[0].n) > 0;
}

(async () => {
  let changed = 0;
  if (await hasColumn('email_threads', 'follow_up_days')) {
    console.log('✓ email_threads.follow_up_days 이미 존재 — skip');
  } else {
    await sequelize.query('ALTER TABLE email_threads ADD COLUMN follow_up_days INT NULL');
    console.log('+ email_threads.follow_up_days 추가 (NULL=기본 3일 · 0=끔 · N=N일)');
    changed += 1;
  }
  // 검산 — 범위를 벗어난 값이 있으면 알아채야 한다(수동 조작·버그 대비)
  const [bad] = await sequelize.query(
    'SELECT COUNT(*) c FROM email_threads WHERE follow_up_days IS NOT NULL AND (follow_up_days < 0 OR follow_up_days > 365)');
  console.log(`· 검산: 범위 밖 값 ${bad[0].c}행 (0 이어야 함)`);
  if (Number(bad[0].c) > 0) { console.error('FATAL 범위 밖 값이 있다'); process.exit(1); }
  console.log(`[migrate-mail-followup-days] 완료 — 변경 ${changed}건 (멱등)`);
  process.exit(0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
