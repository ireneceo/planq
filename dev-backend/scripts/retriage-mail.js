// 옛 규칙으로 분류된 메일 스레드를 지금 규칙으로 다시 판정한다 (멱등).
//
// 새 분류(사이클: WORK_SIGNAL + 아는 상대 + 학습 규칙)가 들어오기 전에 동기화된 스레드는
// "뉴스레터·자동발송인데 답변 필요" 로 켜져 있다 → 답변 필요 폴더와 확인 필요 인박스가 무용지물.
// 원본 메일은 건드리지 않고 분류 필드만 다시 계산한다. 사람이 손댄 흔적(답변함·규칙·스팸 표시,
// 담당자 지정)은 존중해서 건드리지 않는다.
//
//   node scripts/retriage-mail.js            # 미리보기 (변경 없음)
//   node scripts/retriage-mail.js --apply    # 실제 반영
require('dotenv').config();
// --impersonation (2026-10-15): 사칭 검사 소급은 따로 돈다 — scripts/retriage-impersonation.js(docs/MAIL_IMPERSONATION_DESIGN.md §5).
if (process.argv.includes('--impersonation')) {
  require('./retriage-impersonation').run()
    .then(async () => { await require('../config/database').sequelize.close(); process.exit(0); })
    .catch((e) => { console.error('[retriage-impersonation] 실패:', e.message); process.exit(1); });
  return;
}
const { Op } = require('sequelize');
const { sequelize } = require('../config/database');
const { EmailThread, EmailAccount } = require('../models');
const R = require('../services/mailRetriage');
const { offFor } = require('../services/mailCriteria');

const APPLY = process.argv.includes('--apply');
// --list: 바뀌는 스레드를 전부 출력(기본은 예시 8건) — 반영 전에 오승격이 없는지 한 줄씩 보려고 (2026-09-22)
const SAMPLE_MAX = process.argv.includes('--list') ? Infinity : 8;
// --promote-only (2026-10-11, Fable): 자동·마케팅 폴더 → 확인 권장으로 **올라가는 행만** 쓴다.
//   규칙 변경과 무관한 옛 드리프트(강등·답변 필요 해제)가 같이 적용되지 않게. 답변 필요는 건드리지 않는다.
const PROMOTE_ONLY = process.argv.includes('--promote-only');
// --promote-reply-criterion=inbound_action (2026-10-15, docs/MAIL_CRITERIA_DESIGN.md §6.2):
//   --promote-only 와 같이 쓰면 **그 기준이 정한** 답변 필요 승격(자동·마케팅/확인 권장 → 답변 필요)도 쓴다.
//   다른 이유로 답변 필요가 켜지는 행(옛 드리프트)은 여전히 쓰지 않는다.
// --fill-criterion (2026-10-15): 폴더가 그대로인 스레드에 «어느 기준이 정했나»(triage_criterion)만 적는다.
//   폴더·답변 필요는 건드리지 않는다(메타데이터). 설정 «메일 분류 기준» 의 30일 적중 수가 옛 메일에도 보이게.
const FILL_CRITERION = process.argv.includes('--fill-criterion');
const PROMOTE_REPLY = (process.argv.find((a) => a.startsWith('--promote-reply-criterion=')) || '').split('=')[1] || null;

(async () => {
  const accounts = await EmailAccount.findAll({ where: { is_active: true }, attributes: ['id', 'business_id', 'email'] });
  const accMap = new Map(accounts.map(a => [a.id, a]));
  // "우리 주소" 공식은 **한 벌만 존재해야 한다** — services/mailRetriage.buildContext(수집 경로와 같은 함수).
  const ctx = await R.buildContext(accounts.map(a => a.business_id));
  const offByBiz = new Map();
  for (const b of new Set(accounts.map(a => a.business_id))) offByBiz.set(b, await offFor(b));

  // 대상: 열린 메일 전부(답변 필요·확인 권장·자동). 단 **사람이 직접 내린 건 건드리지 않는다** —
  //   제외 기준은 services/mailRetriage.eligibleWhere 한 곳(설정 화면의 기준 끄기 소급과 같다).
  const threads = await EmailThread.findAll({ where: R.eligibleWhere(), order: [['id', 'ASC']] });
  const assigned = await R.assignedIds(threads.map(t => t.id));

  // 백필(과거 메일)은 "읽기만" 이 정책인데 reply_needed=1 로 남은 모순 행 정리 (옛 동기화 잔재)
  const backfillStuck = await EmailThread.count({ where: { reply_needed: true, reply_needed_reason: 'backfill' } });
  if (APPLY && backfillStuck > 0) {
    await EmailThread.update({ reply_needed: false }, { where: { reply_needed: true, reply_needed_reason: 'backfill' } });
  }
  console.log(`백필인데 답변 필요로 켜져 있던 스레드: ${backfillStuck}건${APPLY ? ' → 해제' : ''}`);

  let changed = 0, kept = 0, skipped = 0, filled = 0;
  const flips = {};
  const samples = [];
  for (const th of threads) {
    if (assigned.has(th.id)) { skipped++; continue; }
    const acc = accMap.get(th.account_id);
    if (!acc) { skipped++; continue; }
    const j = await R.judgeThread(th, ctx, [offByBiz.get(acc.business_id)], { businessId: acc.business_id });
    if (!j) { skipped++; continue; }
    const { fields, criterion, folder: after } = j.results[0];
    const before = R.folderOfRow(th);
    // 바뀐 게 없으면 건드리지 않는다 (멱등) — 기준 이름만 비어 있으면 --fill-criterion 이 채운다.
    if (fields.reply_needed === !!th.reply_needed && fields.status === th.status && fields.triage === th.triage) {
      if (FILL_CRITERION && criterion && th.triage_criterion !== criterion) {
        filled++;
        if (APPLY) await th.update({ triage_criterion: criterion });
      }
      kept++; continue;
    }
    if (PROMOTE_ONLY) {
      const promoteReview = before === 'auto' && after === 'review';
      const promoteReply = !!PROMOTE_REPLY && after === 'reply' && before !== 'reply' && criterion === PROMOTE_REPLY;
      if (!promoteReview && !promoteReply) { kept++; continue; }
    }
    changed++;
    const k = `${before}→${after} [${criterion}]`;
    flips[k] = (flips[k] || 0) + 1;
    if (samples.length < SAMPLE_MAX) samples.push(`${th.id} | ${(th.subject || '').slice(0, 60)} | ${k}`);
    if (APPLY) {
      if (PROMOTE_ONLY && after === 'review') {
        await th.update({ status: fields.status, triage: fields.triage, uncertain_reason: fields.uncertain_reason, triage_criterion: criterion });
        continue;
      }
      await R.writeFields(th, fields);
    }
  }
  console.log(`대상 ${threads.length}건 — 그대로 ${kept} · 재분류 ${changed} · 건너뜀(담당자·데이터없음) ${skipped}`);
  console.log('전이:', flips);
  if (FILL_CRITERION) console.log(`기준 이름만 채움(폴더 그대로): ${filled}건`);
  if (samples.length) console.log('예시:\n  ' + samples.join('\n  '));
  console.log(APPLY ? '→ 반영 완료' : '→ 미리보기 (반영하려면 --apply)');
  await sequelize.close();
})();
