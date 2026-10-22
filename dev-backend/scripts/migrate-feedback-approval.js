// feedback_items 승인 체계 — 멱등. 2026-10-22 (설계 docs/FEEDBACK_APPROVAL_DESIGN.md · Fable 판정).
//   ① status ENUM 끝에 queued(진행대기)·in_progress(반영중) append — 순서 = 모델 순서.
//   ② approved_by INT NULL · approved_at DATETIME NULL — «승인됨» 의 정본(services/feedbackStatus).
//      approved_at 칸 설명(COMMENT)에 «approval_since=<처음 만든 시각>» 을 남긴다 — 배포 닫기가 그 전의 옛 reviewing 만
//      옛 규칙으로 닫는다(시한부 호환). 칸을 이번에 처음 만들 때만 적는다(다시 돌려도 시각이 안 바뀐다).
//   옛 행은 건드리지 않는다(기계가 가르지 않는다) — 끝에 옛 reviewing·pending 수만 출력.
// 롤백: 코드만 되돌린다. ENUM 값·칸은 남긴다(옛 코드에 무해, 모델에서 빼면 sync 가 칸을 지운다).
//   단 queued·in_progress 행이 이미 있으면 옛 코드 화면에 그 값이 기본 라벨로 보인다 — 롤백 전에 수를 본다.
require('dotenv').config();
const { sequelize } = require('../config/database');
const WANT = ['pending', 'reviewing', 'done', 'wontfix', 'queued', 'in_progress'];
async function col(name) {
  const [r] = await sequelize.query(`SELECT COLUMN_TYPE t, COLUMN_COMMENT c FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'feedback_items' AND COLUMN_NAME = ?`, { replacements: [name] });
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
      const since = new Date().toISOString();
      await sequelize.query(`ALTER TABLE feedback_items ADD COLUMN approved_at DATETIME NULL COMMENT 'approval_since=${since}' AFTER approved_by`);
      console.log('[migrate-feedback-approval] approved_at 추가 · approval_since', since);
    }
    const s2 = await col('status'); const a = await col('approved_at');
    const ok = WANT.every((v) => s2.t.includes(`'${v}'`)) && a && /approval_since=/.test(a.c || '') && (await col('approved_by'));
    if (!ok) { console.error('[migrate-feedback-approval] 검증 실패', s2.t, a && a.c); process.exit(1); }
    const [[n]] = await sequelize.query(`SELECT SUM(status='pending') p, SUM(status='reviewing') r,
      SUM(status='reviewing' AND admin_response IS NOT NULL AND TRIM(admin_response)<>'' AND approved_at IS NULL) rr
      FROM feedback_items WHERE parent_id IS NULL`);
    console.log(`[migrate-feedback-approval] OK · ${a.c} · 최상위 접수 ${n.p || 0} · 검토중 ${n.r || 0}(그중 답글 달린 옛 검토중 ${n.rr || 0} — 배포 닫기 호환 대상)`);
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[migrate-feedback-approval] 실패:', e.message); process.exit(1); }
})();
