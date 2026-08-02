// #215 Fable 게이트 — 표본 조회 (검증 후 삭제)
const { sequelize } = require('./config/database');
(async () => {
  const q = (sql, r) => sequelize.query(sql, { replacements: r, type: sequelize.QueryTypes.SELECT });
  console.log('att1222:', JSON.stringify(await q("SELECT ea.id, ea.message_id, ea.file_id, ea.filename, ea.mime_type, ea.is_inline, em.thread_id, em.business_id FROM email_attachments ea JOIN email_messages em ON em.id=ea.message_id WHERE ea.id=1222")));
  console.log('msg1376 atts:', JSON.stringify(await q("SELECT ea.id, ea.file_id, ea.content_id, ea.mime_type, ea.is_inline, em.thread_id, em.business_id FROM email_attachments ea JOIN email_messages em ON em.id=ea.message_id WHERE ea.message_id=1376")));
  console.log('counts:', JSON.stringify(await q('SELECT COUNT(*) total, SUM(is_inline=1) inl FROM email_attachments')));
  console.log('personal L1 files:', JSON.stringify(await q("SELECT COUNT(*) c, SUM(f.vlevel='L1' AND f.visibility='L1') l1, SUM(f.uploader_id=3) up3 FROM files f WHERE f.id IN (SELECT ea.file_id FROM email_attachments ea JOIN email_messages em ON em.id=ea.message_id JOIN email_threads et ON et.id=em.thread_id JOIN email_accounts ac ON ac.id=et.account_id WHERE ac.owner_user_id IS NOT NULL AND ea.file_id IS NOT NULL)")));
  console.log('sample L1 file:', JSON.stringify(await q("SELECT f.id, f.business_id, f.vlevel, f.visibility, f.uploader_id FROM files f JOIN email_attachments ea ON ea.file_id=f.id JOIN email_messages em ON em.id=ea.message_id JOIN email_threads et ON et.id=em.thread_id JOIN email_accounts ac ON ac.id=et.account_id WHERE ac.owner_user_id IS NOT NULL LIMIT 2")));
  console.log('company L3 sample:', JSON.stringify(await q("SELECT COUNT(*) c, SUM(f.vlevel='L3') l3 FROM files f JOIN email_attachments ea ON ea.file_id=f.id JOIN email_messages em ON em.id=ea.message_id JOIN email_threads et ON et.id=em.thread_id JOIN email_accounts ac ON ac.id=et.account_id WHERE ac.owner_user_id IS NULL")));
  console.log('nullCid biz5:', JSON.stringify(await q("SELECT ea.id, em.thread_id, ea.content_id, ea.is_inline, ea.file_id, ea.mime_type FROM email_attachments ea JOIN email_messages em ON em.id=ea.message_id WHERE em.business_id=5 AND ea.content_id IS NULL AND ea.file_id IS NOT NULL AND LOWER(ea.mime_type) NOT IN ('text/rfc822-headers','message/delivery-status','text/x-amp-html') LIMIT 2")));
  console.log('noise biz5:', JSON.stringify(await q("SELECT ea.id, em.thread_id, ea.mime_type FROM email_attachments ea JOIN email_messages em ON em.id=ea.message_id WHERE em.business_id=5 AND ea.mime_type='text/rfc822-headers' AND ea.file_id IS NOT NULL LIMIT 2")));
  console.log('bodyNull biz5:', JSON.stringify(await q("SELECT ea.id, em.thread_id FROM email_attachments ea JOIN email_messages em ON em.id=ea.message_id WHERE em.business_id=5 AND em.body_html IS NULL AND ea.file_id IS NOT NULL AND LOWER(ea.mime_type) NOT IN ('text/rfc822-headers','message/delivery-status','text/x-amp-html') LIMIT 2")));
  console.log('acct32:', JSON.stringify(await q('SELECT id, business_id, owner_user_id, email FROM email_accounts WHERE id=32')));
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
