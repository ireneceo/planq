// 새로 연결한 계정의 «지난 메일(읽기만)» 중 최근 것을 답변 필요로 올린다 — 운영 일회 실행용 (2026-10-22 Fable D3).
//   판정·쓰기는 services/mailRetriage.promoteBackfillReplies 하나(동기화 자동 경로와 같은 함수). 올리기만 한다.
//
//   node scripts/promote-backfill-replies.js --account=7 --base=2026-10-21T08:33:46Z            # 미리보기(전부 출력, 변경 없음)
//   node scripts/promote-backfill-replies.js --account=7 --base=2026-10-21T08:33:46Z --apply    # 반영 + before-apply 기록
//   --days=14 (기본) · --base 는 그 계정을 연결한 시각(창의 기준)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=') || null;
const APPLY = process.argv.includes('--apply');

(async () => {
  const accountId = Number(arg('account'));
  if (!accountId) throw new Error('--account=<id> 가 필요하다');
  const baseAt = arg('base') ? new Date(arg('base')) : new Date();
  if (Number.isNaN(baseAt.getTime())) throw new Error('--base 시각을 읽지 못했다');
  const windowDays = Number(arg('days') || 14);
  const R = require('../services/mailRetriage');
  const preview = await R.promoteBackfillReplies({ accountId, baseAt, windowDays, apply: false });
  console.log(`계정 #${accountId} · 기준 ${baseAt.toISOString()} · 창 ${windowDays}일 — 재판정 ${preview.scanned}건 중 답변 필요 ${preview.promoted}건`);
  for (const r of preview.rows) console.log(`  #${r.id} [${r.criterion}] ${new Date(r.last_inbound_at).toISOString().slice(0, 10)} ${String(r.subject || '').slice(0, 80)}`);
  if (APPLY && preview.promoted) {
    const { EmailThread } = require('../models');
    const before = await EmailThread.findAll({ where: { id: preview.rows.map((r) => r.id) },
      attributes: ['id', 'status', 'reply_needed', 'reply_needed_reason', 'reply_needed_at', 'uncertain_reason', 'triage_criterion', 'triage'] });
    const out = path.join(__dirname, `promote-backfill-before-apply-${accountId}-${Date.now()}.json`);
    fs.writeFileSync(out, JSON.stringify(before.map((t) => t.get({ plain: true })), null, 2));
    const done = await R.promoteBackfillReplies({ accountId, baseAt, windowDays, apply: true });
    console.log(`반영: ${done.promoted}건 · 되돌리기 기록 ${out}`);
  } else if (!APPLY) console.log('미리보기 — 바꾸려면 --apply');
  await require('../config/database').sequelize.close();
  process.exit(0);
})().catch((e) => { console.error('[promote-backfill-replies] 실패:', e.message); process.exit(1); });
