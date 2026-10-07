#!/usr/bin/env node
// feedback-reply — 운영 피드백에 답글을 단다(개발완료 단계). 2026-10-07 Irene:
//   "개발완료 스킬에는 운영서버 피드백에서 완료한 것과 조치한 것에 대한 안내답변을 다 하게 하자."
//
// 관리자 화면의 [답변] 과 **같은 함수**(services/feedbackRespond)를 쓴다 — 상태·답글·보고자 알림이 같이 간다.
//
// 입력 JSON: [{ "id": 457, "status": "reviewing"|"done"|"wontfix", "response": "안내 문구" }, …]
//   - status 는 사실대로: 운영에 **배포까지 끝난 것만 done**. 고쳤지만 배포 전이면 reviewing + "다음 배포에 반영".
//   - 이미 같은 답글이 달려 있으면 건너뛴다(멱등 — 두 번 돌려도 알림이 두 번 가지 않는다).
//
// 사용(운영 — 이 파일은 배포 rsync 로 /opt/planq/backend/scripts 에 있다. 배포 전이면 /tmp 로 복사):
//   node scripts/feedback-reply.js /tmp/replies.json            # dry-run(기본) — 무엇이 바뀌는지 출력
//   node scripts/feedback-reply.js /tmp/replies.json --apply    # 실제 저장 + 알림
//   (--actor <user_id> 를 주면 responded_by 로 남는다. 기본은 platform_admin 첫 사용자)
require('dotenv').config();
const fs = require('fs');

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const APPLY = args.includes('--apply');
const actorIdx = args.indexOf('--actor');
if (!file) { console.error('사용: node scripts/feedback-reply.js <replies.json> [--apply] [--actor <user_id>]'); process.exit(1); }

(async () => {
  const { FeedbackItem, User } = require('../models');
  const { respondToFeedback, ALLOWED_STATUS } = require('../services/feedbackRespond');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(list)) throw new Error('JSON 은 배열이어야 한다');

  let actorUserId = actorIdx >= 0 ? Number(args[actorIdx + 1]) : null;
  if (!actorUserId) {
    const admin = await User.findOne({ where: { platform_role: 'platform_admin' }, order: [['id', 'ASC']], attributes: ['id'] });
    actorUserId = admin ? admin.id : null;
  }

  for (const r of list) {
    const id = Number(r.id);
    const response = String(r.response || '').trim();
    if (!id || !response || !ALLOWED_STATUS.includes(r.status)) { console.log(`#${r.id} 건너뜀 — id·status·response 확인`); continue; }
    const item = await FeedbackItem.findByPk(id);
    if (!item) { console.log(`#${id} 없음`); continue; }
    if (item.status === r.status && String(item.admin_response || '').trim() === response) { console.log(`#${id} 이미 같은 답글 — 건너뜀`); continue; }
    console.log(`#${id} [${item.status} → ${r.status}] ${item.title}\n    ↳ ${response.replace(/\n/g, ' ')}`);
    if (APPLY) await respondToFeedback(item, { status: r.status, admin_response: response, actorUserId, waitNotify: true });
  }
  console.log(APPLY ? '적용 완료' : '(dry-run — --apply 를 주면 저장·알림)');
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
