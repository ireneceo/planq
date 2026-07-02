// 유실 메일 복구 — imap_last_uid 되감기 후 syncOne 반복 (dedup 은 message_id 로 보장). 완료 후 삭제.
require('dotenv').config();

(async () => {
  const { EmailAccount } = require('./models');
  const { syncOne } = require('./services/emailImapCron');
  const { sequelize } = require('./config/database');

  const acct = await EmailAccount.findByPk(1);
  console.log('before: imap_last_uid =', acct.imap_last_uid);

  if (acct.imap_last_uid > 17908) {
    await acct.update({ imap_last_uid: 17908 });
    console.log('rewound to 17908');
  }

  let prev = -1;
  for (let i = 0; i < 40; i++) {
    const a = await EmailAccount.findByPk(1);
    if (a.imap_last_uid === prev) { console.log('caught up at', a.imap_last_uid); break; }
    prev = a.imap_last_uid;
    try {
      await syncOne(a);
    } catch (e) {
      console.error('syncOne error:', e.message);
      break;
    }
    const after = await EmailAccount.findByPk(1);
    console.log(`iter ${i + 1}: uid ${prev} -> ${after.imap_last_uid}`);
  }

  const [[stat]] = await sequelize.query(
    "SELECT COUNT(*) n, MIN(m.sent_at) earliest, MAX(m.sent_at) latest FROM email_messages m JOIN email_threads t ON t.id=m.thread_id WHERE t.account_id=1 AND m.direction='inbound' AND m.created_at >= NOW() - INTERVAL 1 HOUR"
  );
  console.log('recovered this run:', JSON.stringify(stat));
  const [[et]] = await sequelize.query('SELECT COUNT(*) n FROM email_threads WHERE account_id=1 AND message_count=0');
  console.log('remaining empty threads:', JSON.stringify(et));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
