// 감사 로그 보관 스탬프 백필 (Fable 설계 §2).
//   기본 dry-run. --apply 를 줘야 쓴다. 멱등 — 이미 값이 있는 행은 건너뛴다.
//
// 순서가 중요하다: ① business_id 귀속 복원 → ② retain_until 스탬프.
//   ①을 먼저 안 하면 워크스페이스 데이터인데 플랫폼 행으로 위장된 것들이 최상위 티어 보관을
//   받아 영원히 남는다(운영 실측 232행 — posts.js 등이 businessId 를 안 넘기던 탓).
require('dotenv').config();
const { sequelize } = require('../config/database');
const { stampFor, platformAuditExpiry } = require('../services/retentionPolicy');

const APPLY = process.argv.includes('--apply');
const PLATFORM_ACTIONS = /^(admin\.|platform_settings\.|retention\.)/;

(async () => {
  const out = { attributed: {}, stamped: 0, platform_stamped: 0, left_null: 0 };

  // ① 타깃을 조인해 워크스페이스를 복원한다. 타깃이 사라진 행은 NULL 로 둔다(보존).
  const JOINS = [
    ['post', 'posts'],
    ['task', 'tasks'],
    ['conversation', 'conversations'],
  ];
  for (const [targetType, table] of JOINS) {
    const [rows] = await sequelize.query(
      `SELECT a.id, t.business_id
         FROM audit_logs a JOIN ${table} t ON t.id = a.target_id
        WHERE a.business_id IS NULL AND a.target_type = :tt AND t.business_id IS NOT NULL`,
      { replacements: { tt: targetType } });
    out.attributed[targetType] = rows.length;
    if (APPLY && rows.length) {
      for (const r of rows) {
        await sequelize.query('UPDATE audit_logs SET business_id = :b WHERE id = :id AND business_id IS NULL',
          { replacements: { b: r.business_id, id: r.id } });
      }
    }
  }

  // ② 워크스페이스 행 스탬프. 기록 시점 플랜은 알 수 없으므로 **현재 유효 플랜**을 쓴다 —
  //    면제 워크스페이스는 실제 이력보다 길게 잡히는데, 그건 보존 쪽 오차라 허용한다.
  const [bizRows] = await sequelize.query(
    'SELECT DISTINCT business_id AS b FROM audit_logs WHERE business_id IS NOT NULL AND retain_until IS NULL');
  for (const { b } of bizRows) {
    const [rows] = await sequelize.query(
      'SELECT id, created_at FROM audit_logs WHERE business_id = :b AND retain_until IS NULL',
      { replacements: { b } });
    for (const r of rows) {
      const until = await stampFor(b, 'audit_log', r.created_at);
      if (!until) { out.left_null += 1; continue; }
      out.stamped += 1;
      if (APPLY) {
        await sequelize.query('UPDATE audit_logs SET retain_until = :u WHERE id = :id AND retain_until IS NULL',
          { replacements: { u: until, id: r.id } });
      }
    }
  }

  // ③ 플랫폼 액션(운영자 행위)만 최상위 티어 스탬프. 그 외 NULL 은 그대로 둔다(보존).
  const [nullRows] = await sequelize.query(
    'SELECT id, action, created_at FROM audit_logs WHERE business_id IS NULL AND retain_until IS NULL');
  for (const r of nullRows) {
    if (!PLATFORM_ACTIONS.test(r.action || '')) { out.left_null += 1; continue; }
    out.platform_stamped += 1;
    if (APPLY) {
      await sequelize.query('UPDATE audit_logs SET retain_until = :u WHERE id = :id AND retain_until IS NULL',
        { replacements: { u: platformAuditExpiry(r.created_at), id: r.id } });
    }
  }

  console.log(APPLY ? '[backfill-audit] 적용' : '[backfill-audit] dry-run (--apply 필요)');
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
