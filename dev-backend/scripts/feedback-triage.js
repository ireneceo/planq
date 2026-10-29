#!/usr/bin/env node
// feedback-triage — 피드백 AI 조사 결과를 운영 피드백 건에 붙인다 (2026-10-29 · docs/FEEDBACK_AI_TRIAGE_DESIGN.md).
//   Irene 10-29 «권고대로»(접수 즉시 AI 가 원인·고칠 방법만 조사해 관리자 상세에 붙여 둔다) = **조사 칸 3개에 한한 상시 승인**.
//   부르는 것은 상황판(정해진 코드)이다 — 정찰 방이 쓴 .claude/plans/fb<id>.triage.json 을 scp 로 넘겨 이 스크립트를 부른다.
//
// ★ 바꾸는 것은 ai_triage · ai_triage_verdict · ai_triage_at 뿐 — 상태·답글·승인·알림은 손대지 않는다(services/feedbackTriage).
// ★ 검증의 정본은 이 스크립트(services/feedbackTriage.validateTriage). 틀린 결과는 저장하지 않고(--apply 면 «조사 실패» + 이유 코드만) exit 1.
//
// 입력 JSON: { "id": 457, "verdict": "needs_fix", "summary": "…", "cause": "…", "fix": "…", "files": ["dev-backend/routes/x.js:12"],
//              "size": "small", "fable_needed": false, "repro": "…", "fixed_commit": "abc1234", "head": "<커밋>", "room": "<방 번호>" }
//   또는 그 배열. 실패 보고(방이 죽음 등)는 { "id": 457, "verdict": "failed", "error": ["room_dead"], "room": "…" }.
//
// 사용(운영 — /opt/planq/backend):
//   node scripts/feedback-triage.js /tmp/fb457.triage.json            # dry-run(기본) — 무엇을 할지 출력
//   node scripts/feedback-triage.js /tmp/fb457.triage.json --apply    # 저장
//   --force : 이미 조사된 건도 덮어쓰기(다시 조사)
// 끝 코드: 0 = 전부 저장(또는 건너뜀) · 1 = 하나라도 거절 · 2 = 사용법/읽기 오류
require('dotenv').config();
const fs = require('fs');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
if (!file) { console.error('사용: node scripts/feedback-triage.js <triage.json> [--apply] [--force]'); process.exit(2); }

(async () => {
  let list;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (raw.length > 64 * 1024) throw new Error('파일이 너무 크다(64KB 초과)');
    const parsed = JSON.parse(raw);
    list = Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) { console.error('읽기 실패:', e.message); process.exit(2); }
  if (list.length > 10) { console.error('한 번에 10건까지'); process.exit(2); }

  const { FeedbackItem, User } = require('../models');
  const { planTriage, saveTriage } = require('../services/feedbackTriage');
  const admin = await User.findOne({ where: { platform_role: 'platform_admin' }, order: [['id', 'ASC']], attributes: ['id'] });
  const actorUserId = admin ? admin.id : null;

  let rejected = 0;
  for (const input of list) {
    const id = input && Number.isInteger(input.id) && input.id > 0 ? input.id : null;
    if (!id) { console.log('건너뜀 — id 없음'); rejected++; continue; }
    const item = await FeedbackItem.findByPk(id);
    const plan = planTriage(item, input, { force: FORCE });
    if (plan.action === 'skip') { console.log(`#${id} 건너뜀 — ${plan.reason}`); continue; }
    if (plan.action === 'reject') {
      rejected++;
      console.log(`#${id} ✗ 거절 — ${plan.reason}${plan.errors ? ' ' + plan.errors.join(',') : ''}`);
      // 형식이 틀린 결과는 «조사 실패» 로만 남긴다(이미 성공한 조사는 덮지 않음)
      if (APPLY && plan.reason === 'invalid' && item && !(item.ai_triage_at && item.ai_triage_verdict !== 'failed' && !FORCE)) {
        await saveTriage(item, plan.triage, { actorUserId });
        console.log(`#${id}   → «조사 실패» 로 기록`);
      }
      continue;
    }
    console.log(`#${id} [${item.status}] ${plan.triage.verdict} — ${String(plan.triage.summary || '').replace(/\n/g, ' ').slice(0, 120)}`);
    if (APPLY) await saveTriage(item, plan.triage, { actorUserId });
  }
  console.log(APPLY ? '적용 완료' : '(dry-run — --apply 를 주면 저장)');
  process.exit(rejected ? 1 : 0);
})().catch((e) => { console.error(e.message); process.exit(2); });
