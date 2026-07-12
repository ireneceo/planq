// 이미 쌓인 "답변 필요" 오탐 재분류 (멱등).
//
// 배경: PlanQ 가 보낸 알림 메일이 Auto-Submitted 헤더 없이 대표 주소로 나가, 그 메일이 Q Mail 로
//   다시 수집될 때 "사람이 보낸 메일"(triage='human')로 분류되고 reply_needed 가 자동으로 켜졌다.
//   운영 실측: "답변 필요" 116건 중 93건(80%)이 우리가 우리에게 보낸 알림.
//   → 발송 측에 헤더를 붙였고(emailService), 수신 측이 "우리 주소"를 인식하게 했다(emailTriage).
//   이 스크립트는 그 규칙을 이미 저장된 스레드에 소급 적용한다.
//
// 사용:
//   node backfill-mail-selfnotify.js            # dry-run (변경 없이 건수만)
//   node backfill-mail-selfnotify.js --apply    # 실제 반영
//
// 안전장치: 사람이 이미 답장한 스레드(outbound 존재)는 건드리지 않는다. 반복 실행해도 결과 동일.

require('dotenv').config();
const { Op } = require('sequelize');
const { sequelize } = require('./config/database');
const { EmailThread, EmailMessage, EmailAccount, Business } = require('./models');
const { isAutomated, isMarketing, buildOwnEmailSet } = require('./services/emailTriage');

const APPLY = process.argv.includes('--apply');

(async () => {
  const businesses = await Business.findAll({ attributes: ['id', 'name'] });
  let scanned = 0, toAutomated = 0, toMarketing = 0, skippedReplied = 0;
  const samples = [];

  for (const biz of businesses) {
    const accs = await EmailAccount.findAll({ where: { business_id: biz.id }, attributes: ['id'] });
    if (accs.length === 0) continue;
    const ownEmails = await buildOwnEmailSet(biz.id);

    // reply_needed=true 인 스레드만 대상 (오탐이 사는 곳)
    const threads = await EmailThread.findAll({
      where: { business_id: biz.id, reply_needed: true },
      attributes: ['id', 'subject', 'triage', 'status'],
    });

    for (const th of threads) {
      scanned++;
      // 마지막 inbound 메시지의 발신자로 판정 (스레드의 성격을 결정한 메일)
      const lastIn = await EmailMessage.findOne({
        where: { thread_id: th.id, direction: 'inbound' },
        order: [['id', 'DESC']],
        attributes: ['from_email', 'subject'],
      });
      if (!lastIn) continue;

      const from = String(lastIn.from_email || '').toLowerCase().trim();
      // 헤더는 저장하지 않으므로 발신자 기준으로만 판정 (보수적)
      const auto = isAutomated(null, from, ownEmails);
      if (!auto) continue;

      // 사람이 이미 답장한 스레드는 그대로 둔다 (히스토리 존중)
      const outCount = await EmailMessage.count({ where: { thread_id: th.id, direction: 'outbound' } });
      if (outCount > 0) { skippedReplied++; continue; }

      const newTriage = 'automated';
      toAutomated++;
      if (samples.length < 10) samples.push(`  ${from} | ${String(lastIn.subject || '').slice(0, 45)}`);

      if (APPLY) {
        await th.update({
          triage: newTriage,
          reply_needed: false,
          reply_needed_at: null,
          reply_needed_reason: 'auto_reclassified',
        });
      }
    }
  }

  console.log(`\n대상 스레드(답변 필요): ${scanned}건`);
  console.log(`  → automated 재분류: ${toAutomated}건`);
  console.log(`  → 이미 답장해 건드리지 않음: ${skippedReplied}건`);
  if (samples.length) {
    console.log('\n샘플:');
    samples.forEach((s) => console.log(s));
  }
  console.log(APPLY ? '\n✅ 반영 완료' : '\n(dry-run — 반영하려면 --apply)');
  await sequelize.close();
  process.exit(0);
})().catch((e) => { console.error('실패:', e.message); process.exit(1); });
