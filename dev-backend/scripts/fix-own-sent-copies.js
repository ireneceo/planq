// 다른 앱에서 보낸 우리 답장의 사본(받은편지함으로 돌아온 것)을 «보낸 메일·읽음» 으로 바로잡는다 — 멱등. 2026-10-07.
//   판정은 수집과 **같은 함수** services/emailAddress.isOwnSentCopy. 바로잡은 스레드는 안읽음 수·마지막 방향을
//   메시지에서 다시 센다. Irene: "이메일에서 내가 답장을 보내면 다시 안읽은 것처럼 … 표시를 왜해?" (운영 스레드 3690)
//   재조회로 판정하고 남은 행이 있으면 exit 1.
// 롤백: 출력된 메시지 id 를 direction='inbound' 로 되돌린다(읽음 표시는 되돌릴 이유가 없다).
require('dotenv').config();
const { sequelize } = require('../config/database');
(async () => {
  try {
    const A = require('../services/emailAddress');
    const T = require('../services/emailTriage');
    const q = (s, r) => sequelize.query(s, { replacements: r, type: sequelize.QueryTypes.SELECT });
    const find = async () => {
      const out = [];
      for (const a of await q('SELECT id, business_id FROM email_accounts')) {
        const self = await A.selfEmailsForAccount(a.id);
        const own = await T.buildOwnEmailSet(a.business_id);
        const ms = await q(`SELECT m.id, m.thread_id, LOWER(m.from_email) f, m.to_emails, m.cc_emails FROM email_messages m
          JOIN email_threads t ON t.id = m.thread_id WHERE t.account_id = ? AND m.direction = 'inbound'`, [a.id]);
        for (const m of ms) if (A.isOwnSentCopy({ fromEmail: m.f, toEmails: m.to_emails, ccEmails: m.cc_emails, selfEmails: self, ownEmails: own })) out.push(m);
      }
      return out;
    };
    const rows = await find();
    console.log(`[fix-own-sent-copies] 대상 ${rows.length}건`, rows.map((r) => `m${r.id}(t${r.thread_id})`).join(' '));
    if (rows.length) {
      await sequelize.query("UPDATE email_messages SET direction = 'outbound', is_read = 1 WHERE id IN (?)", { replacements: [rows.map((r) => r.id)] });
      for (const tid of [...new Set(rows.map((r) => r.thread_id))]) {
        const [{ unread }] = await q("SELECT COUNT(*) unread FROM email_messages WHERE thread_id = ? AND direction = 'inbound' AND is_read = 0", [tid]);
        const [last] = await q('SELECT direction FROM email_messages WHERE thread_id = ? ORDER BY sent_at DESC, id DESC LIMIT 1', [tid]);
        await sequelize.query('UPDATE email_threads SET unread_count = ?, last_message_direction = ? WHERE id = ?', { replacements: [Number(unread), last ? last.direction : 'inbound', tid] });
        console.log(`[fix-own-sent-copies] 스레드 ${tid}: 안읽음 ${unread} · 마지막 ${last && last.direction}`);
      }
    }
    const after = await find();
    if (after.length) { console.error('[fix-own-sent-copies] 남은 행', after.map((r) => r.id)); process.exit(1); }
    console.log('[fix-own-sent-copies] OK — 남은 행 0');
    await sequelize.close(); process.exit(0);
  } catch (e) { console.error('[fix-own-sent-copies] 실패:', e.message); process.exit(1); }
})();
