// feedback_items 승인 체계 — 멱등. 2026-10-22 (설계 docs/FEEDBACK_APPROVAL_DESIGN.md · Fable 판정).
//   ① status ENUM 끝에 queued(진행대기)·in_progress(반영중) append — 순서 = 모델 순서.
//   ② approved_by INT NULL · approved_at DATETIME NULL — «승인됨» 의 정본(services/feedbackStatus).
//   ③ platform_settings.feedback_approval_since — 비어 있을 때만 지금 시각(다시 돌려도 안 바뀐다). 배포 닫기가 그 전의 옛 reviewing 만
//      옛 규칙으로 닫는다(시한부 호환).
//   ★ sync-database(alter) 와 순서가 바뀌어도 된다 — 칸·ENUM 이 이미 있으면 건너뛰고, 시각은 «비어 있으면» 만 본다.
//     (첫 구현은 시각을 approved_at 칸 설명에 적었는데, sync alter 가 그 설명을 매번 지워 운영에서 exit 1 로 배포를 멈출 뻔했다 — Fable 게이트 실측)
//   옛 행은 건드리지 않는다(기계가 가르지 않는다) — 끝에 옛 reviewing·pending 수만 출력.
// 롤백: 코드만 되돌린다. ENUM 값·칸은 남긴다(옛 코드에 무해, 모델에서 빼면 sync 가 칸을 지운다).
//   단 queued·in_progress 행이 이미 있으면 옛 코드 화면에 그 값이 기본 라벨로 보인다 — 롤백 전에 수를 본다.
require('dotenv').config();
const { sequelize } = require('../config/database');
const WANT = ['pending', 'reviewing', 'done', 'wontfix', 'queued', 'in_progress'];
async function col(name, table = 'feedback_items') {
  const [r] = await sequelize.query(`SELECT COLUMN_TYPE t FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, { replacements: [table, name] });
  return r[0] || null;
}
(async () => {
  try {
    const st = await col('status');
    if (!st) throw new Error('feedback_items.status 없음');
    const have = (st.t.match(/'([^']+)'/g) || []).map((x) => x.slice(1, -1));
    if (WANT.every((v) => have.includes(v))) console.log('[migrate-feedback-approval] status ENUM 이미 있음 — skip');
    else {
      const missing = WANT.filter((v) => !have.includes(v));
      const next = [...have, ...missing];
      await sequelize.query(`ALTER TABLE feedback_items MODIFY COLUMN status ENUM(${next.map((v) => `'${v}'`).join(',')}) NOT NULL DEFAULT 'pending'`);
      console.log('[migrate-feedback-approval] status ENUM +', missing.join(','));
    }
    if (!(await col('approved_by'))) {
      await sequelize.query('ALTER TABLE feedback_items ADD COLUMN approved_by INT NULL AFTER responded_at');
      console.log('[migrate-feedback-approval] approved_by 추가');
    }
    if (!(await col('approved_at'))) {
      await sequelize.query('ALTER TABLE feedback_items ADD COLUMN approved_at DATETIME NULL AFTER approved_by');
      console.log('[migrate-feedback-approval] approved_at 추가');
    }
    if (!(await col('feedback_approval_since', 'platform_settings'))) {
      await sequelize.query('ALTER TABLE platform_settings ADD COLUMN feedback_approval_since DATETIME NULL');
      console.log('[migrate-feedback-approval] platform_settings.feedback_approval_since 추가');
    }
    const [, meta] = await sequelize.query('UPDATE platform_settings SET feedback_approval_since = NOW() WHERE feedback_approval_since IS NULL');
    if (meta && meta.affectedRows) console.log('[migrate-feedback-approval] 승인 체계 시작 시각 기록');
    const s2 = await col('status');
    const [[ps]] = await sequelize.query('SELECT feedback_approval_since s FROM platform_settings ORDER BY id LIMIT 1');
    const ok = WANT.every((v) => s2.t.includes(`'${v}'`)) && (await col('approved_at')) && (await col('approved_by')) && ps && ps.s;
    if (!ok) { console.error('[migrate-feedback-approval] 검증 실패', s2.t, ps); process.exit(1); }
    const [[n]] = await sequelize.query(`SELECT SUM(status='pending') p, SUM(status='reviewing') r,
      SUM(status='reviewing' AND admin_response IS NOT NULL AND TRIM(admin_response)<>'' AND approved_at IS NULL) rr
      FROM feedback_items WHERE parent_id IS NULL`);
    console.log(`[migrate-feedback-approval] OK · approval_since=${new Date(ps.s).toISOString()} · 최상위 접수 ${n.p || 0} · 검토중 ${n.r || 0}(그중 답글 달린 옛 검토중 ${n.rr || 0} — 배포 닫기 호환 대상)`);
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-feedback-approval] 실패:', e.message); process.exit(1); }
})();
