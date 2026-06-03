// 기존 email_threads 트리아지 백필 (idempotent, 운영서버에서도 재실행 안전).
//   헤더 없는 옛 메일은 발신자 패턴만으로 분류(automated/spam/human). marketing 은 헤더 필요라 보수적으로 못 잡음.
//   reply_needed = human + 마지막 메시지가 inbound + status open (= 우리가 답해야 할 사람 메일).
require('dotenv').config();
const { sequelize } = require('./config/database');
const { EmailThread, EmailMessage } = require('./models');
const { triageBySenderOnly } = require('./services/emailTriage');
const { Op } = require('sequelize');

(async () => {
  const onlyBiz = process.argv[2] ? Number(process.argv[2]) : null;
  const where = {};
  if (onlyBiz) where.business_id = onlyBiz;

  const threads = await EmailThread.findAll({ where, order: [['id', 'ASC']] });
  let human = 0, automated = 0, spam = 0, replyOn = 0, skipped = 0;

  for (const t of threads) {
    // 첫 inbound 메시지 (발신자 기준)
    const firstInbound = await EmailMessage.findOne({
      where: { thread_id: t.id, direction: 'inbound' },
      order: [['sent_at', 'ASC'], ['id', 'ASC']],
      attributes: ['from_email', 'subject', 'body_text'],
    });
    if (!firstInbound) { skipped++; continue; } // outbound-only(compose) → unknown 유지

    const tr = triageBySenderOnly({
      subject: firstInbound.subject,
      bodyText: firstInbound.body_text,
      fromEmail: firstInbound.from_email,
    });

    const patch = { triage: tr.triage };
    // status: 기존 spam/archived 는 유지. open 인데 분류기가 spam 이면 spam 으로 (옛 미분류 정리)
    if (tr.status === 'spam' && t.status === 'open') patch.status = 'spam';

    // reply_needed: 사람 + 마지막이 inbound + open(정상) + 아직 답장 안 함. uncertain 은 수동 검토.
    const needsReply = tr.triage === 'human'
      && t.last_message_direction === 'inbound'
      && (patch.status || t.status) === 'open';
    patch.reply_needed = needsReply;
    if (needsReply && !t.reply_needed_at) patch.reply_needed_at = t.last_message_at || new Date();
    if (needsReply) patch.reply_needed_reason = patch.reply_needed_reason || 'backfill';

    await t.update(patch);
    if (tr.triage === 'human') human++; else if (tr.triage === 'automated') automated++; else if (tr.triage === 'spam') spam++;
    if (needsReply) replyOn++;
  }

  console.log(`백필 완료 — 총 ${threads.length} 스레드`);
  console.log(`  human ${human} / automated ${automated} / spam ${spam} / skip(outbound-only) ${skipped}`);
  console.log(`  reply_needed ON: ${replyOn}`);

  // 분포 확인
  const [dist] = await sequelize.query(
    `SELECT triage, status, COUNT(*) c FROM email_threads ${onlyBiz ? 'WHERE business_id=' + onlyBiz : ''} GROUP BY triage, status ORDER BY c DESC`
  );
  console.table(dist);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
