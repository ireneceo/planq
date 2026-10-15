// 수락 전인데 계정이 붙은 멤버 초대 행을 되돌린다 — docs/INVITE_INAPP_NOTIFY_DESIGN.md §4 (Fable 2026-10-15 D1)
//
//   예전 멤버 초대는 받는 이메일이 기존 계정이면 초대 순간 business_members.user_id 를 채웠다(joined_at 은 NULL).
//   멤버십을 읽는 곳은 user_id 로 찾으므로 그 사람은 수락 전부터 멤버였다. 코드는 이제 수락 때만 채운다(routes/businesses.js).
//
//   대상: user_id NOT NULL ∧ joined_at NULL ∧ invite_token NOT NULL ∧ invite_email NOT NULL ∧ removed_at NULL ∧ role ∉ (owner, ai)
//     (invite_token NULL 인 옛 직접 추가 실멤버는 자동 제외)
//   대상마다 둘로 가른다:
//     ① 그 사람이 그 워크스페이스에 남긴 감사 기록 0건 → user_id = NULL (대기 초대로 되돌림 — 수락하면 다시 붙는다)
//     ② 1건 이상 → joined_at = 첫 감사 시각 (이미 멤버로 일했다 — 끊으면 일하던 팀이 끊기고, 30일 지난 초대는 수락도 못 한다)
//
//   사전 점검(⒝): 감사 «invite.accept» 가 있는데 joined_at 이 비어 있는 멤버 초대가 1건이라도 있으면 --apply 를 거절한다
//     (그 행은 실제로 수락한 실멤버라 술어에서 빠져야 한다 — 사람이 먼저 본다).
//   사용: node scripts/migrate-invite-prefill.js            (기본 = 읽기만, 계획·점검 수치 출력)
//         node scripts/migrate-invite-prefill.js --apply    (실행 — 행마다 감사 기록, 멱등: 다시 돌리면 0행)
//   되돌리기: 출력의 (id, 이전 user_id, 결정) 과 감사 «business_member.invite_prefill_backfill» 의 old_value 로 복원한다.
require('dotenv').config();
const { sequelize } = require('../config/database');
const APPLY = process.argv.includes('--apply');
const TAG = '[migrate-invite-prefill]';

const TARGET_SQL = `
  SELECT bm.id, bm.business_id, bm.user_id, bm.invite_email, bm.invited_at,
         (bm.invited_at IS NOT NULL AND bm.invited_at < NOW() - INTERVAL 30 DAY) AS expired
  FROM business_members bm
  WHERE bm.user_id IS NOT NULL AND bm.joined_at IS NULL AND bm.invite_token IS NOT NULL
    AND bm.invite_email IS NOT NULL AND bm.removed_at IS NULL AND bm.role NOT IN ('owner','ai')
  ORDER BY bm.id`;

async function count(sql, rep) {
  try { const [r] = await sequelize.query(sql, { replacements: rep }); return Number(r[0]?.n || 0); }
  catch (e) { return `? (${e.message.slice(0, 60)})`; }
}

async function main() {
  const [targets] = await sequelize.query(TARGET_SQL);
  const acceptedNoJoin = await count(`
    SELECT COUNT(DISTINCT bm.id) n FROM audit_logs a JOIN business_members bm ON bm.id = a.target_id
    WHERE a.action = 'invite.accept' AND a.target_type = 'workspace_member' AND bm.joined_at IS NULL`);
  console.log(`${TAG} ⒜ 대상 ${targets.length}행 (30일 지남 ${targets.filter((t) => Number(t.expired)).length})`);
  console.log(`${TAG} ⒝ 수락 감사가 있는데 joined_at 없음: ${acceptedNoJoin} (0 이어야 --apply)`);

  const plan = [];
  for (const t of targets) {
    const rep = { u: t.user_id, b: t.business_id };
    const [a] = await sequelize.query(
      'SELECT COUNT(*) n, MIN(created_at) first_at FROM audit_logs WHERE user_id = :u AND business_id = :b', { replacements: rep });
    const audits = Number(a[0]?.n || 0);
    const data = {
      tasks: await count('SELECT COUNT(*) n FROM tasks WHERE business_id = :b AND (created_by = :u OR assignee_id = :u)', rep),
      task_comments: await count('SELECT COUNT(*) n FROM task_comments tc JOIN tasks t ON t.id = tc.task_id WHERE t.business_id = :b AND tc.user_id = :u', rep),
      messages: await count('SELECT COUNT(*) n FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.business_id = :b AND m.sender_id = :u', rep),
      posts: await count('SELECT COUNT(*) n FROM posts WHERE business_id = :b AND author_id = :u', rep),
      project_members: await count('SELECT COUNT(*) n FROM project_members pm JOIN projects p ON p.id = pm.project_id WHERE p.business_id = :b AND pm.user_id = :u', rep),
      conv_participants: await count('SELECT COUNT(*) n FROM conversation_participants cp JOIN conversations c ON c.id = cp.conversation_id WHERE c.business_id = :b AND cp.user_id = :u', rep),
      assigned_clients: await count('SELECT COUNT(*) n FROM clients WHERE business_id = :b AND assigned_member_id = :u', rep),
      active_here: await count('SELECT COUNT(*) n FROM users WHERE id = :u AND active_business_id = :b', rep),
    };
    const decision = audits > 0 ? 'mark_joined' : 'unlink';
    plan.push({ ...t, audits, first_at: a[0]?.first_at || null, decision, data });
    console.log(`${TAG} id=${t.id} biz=${t.business_id} user=${t.user_id} expired=${Number(t.expired)} ⒞감사=${audits} → ${decision}`
      + ` ⒟${JSON.stringify(data)}`);
  }

  if (!APPLY) { console.log(`${TAG} 읽기만 — 실행하려면 --apply`); return; }
  if (acceptedNoJoin !== 0) { console.error(`${TAG} ⒝ 가 0 이 아니다 — 적용하지 않는다. 그 행부터 사람이 본다.`); process.exitCode = 2; return; }

  let done = 0;
  for (const p of plan) {
    await sequelize.transaction(async (tx) => {
      const where = 'id = :id AND user_id = :u AND joined_at IS NULL AND removed_at IS NULL';
      const rep = { id: p.id, u: p.user_id, at: p.first_at };
      const sql = p.decision === 'unlink'
        ? `UPDATE business_members SET user_id = NULL WHERE ${where}`
        : `UPDATE business_members SET joined_at = :at WHERE ${where}`;
      const [res] = await sequelize.query(sql, { replacements: rep, transaction: tx });
      const changed = Number(res?.affectedRows ?? res?.changedRows ?? 0);
      if (!changed) return;
      // 감사는 단일 지점(writeAudit — 보관 기한 스탬프·마스킹)으로, 같은 트랜잭션 안에서
      await require('../services/auditService').writeAudit({
        businessId: p.business_id, action: 'business_member.invite_prefill_backfill',
        targetType: 'business_member', targetId: p.id,
        oldValue: { user_id: p.user_id, joined_at: null },
        newValue: p.decision === 'unlink' ? { user_id: null, decision: 'unlink' } : { joined_at: p.first_at, decision: 'mark_joined' },
      }, { transaction: tx });
      done += 1;
    });
  }
  console.log(`${TAG} 적용 ${done}행`);
}

main().then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error(TAG, e.message); process.exit(1); });
