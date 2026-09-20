// 메일 첨부 ↔ Q file 계약 (2026-09-20 Irene 결정).
//   ①메일 첨부는 Q file 목록에 **자동으로 안 들어간다** ②[이 워크스페이스에 저장] 으로만 들어간다
//   ③개인 메일(L1) 첨부는 **남이 저장할 수 없다**(403) ④공용(L3) 은 멤버도 가능
// 실행: cd dev-backend && node scripts/checks/mail-attachment-library.js
// ① 메일 첨부가 Q file 목록에서 빠지는가 ② [워크스페이스에 저장] 이 되는가
// ③ 공용(L3)/개인(L1) 메일 계정에 따라 보안이 갈리는가
const db = require('../../config/database'); const s = db.sequelize || db;
const { generateAccessToken } = require('../../services/authTokens');
const tok = async (id) => { const [r] = await s.query('SELECT * FROM users WHERE id=:i', { replacements: { i: id } }); return generateAccessToken(r[0]); };
const API = 'http://localhost:3003';
const get = async (t, p) => { const r = await fetch(API + p, { headers: { Authorization: 'Bearer ' + t } }); return { s: r.status, j: await r.json().catch(() => null) }; };
const post = async (t, p) => { const r = await fetch(API + p, { method: 'POST', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: '{}' }); return { s: r.status, j: await r.json().catch(() => null) }; };

(async () => {
  const BIZ = 3;
  const [ms] = await s.query("SELECT user_id, role FROM business_members WHERE business_id=:b AND removed_at IS NULL AND role<>'ai' ORDER BY FIELD(role,'owner','admin','member')", { replacements: { b: BIZ } });
  const owner = ms.find(m => m.role === 'owner').user_id;
  const member = (ms.find(m => m.role === 'member') || {}).user_id;
  if (!member) { console.log('⬜ 미측정 — 평멤버가 없다'); process.exit(0); }
  const TAG = 'ZMF' + Date.now();
  let fail = 0; const judge = (n, ok, d) => { console.log(`${ok ? '✅' : '❌'} ${n} — ${d}`); if (!ok) fail++; };

  // 픽스처 — 메일 스레드/메시지/첨부 2건(개인 L1 · 공용 L3)
  const mk = async (vis, uploader) => {
    await s.query(`INSERT INTO files (business_id,uploader_id,file_name,file_path,file_size,mime_type,storage_provider,content_hash,visibility,vlevel,ref_count,created_at,updated_at)
      VALUES (:b,:u,:n,:p,100,'image/png','planq',:h,:v,:v,1,NOW(),NOW())`,
      { replacements: { b: BIZ, u: uploader, n: `${TAG}-${vis}.png`, p: `/tmp/${TAG}-${vis}.png`, h: TAG + vis, v: vis } });
    const [f] = await s.query('SELECT id FROM files WHERE file_name=:n', { replacements: { n: `${TAG}-${vis}.png` } });
    return f[0].id;
  };
  const fL1 = await mk('L1', owner), fL3 = await mk('L3', owner);
  const [acc] = await s.query('SELECT id FROM email_accounts WHERE business_id=:b LIMIT 1', { replacements: { b: BIZ } });
  if (!acc.length) { console.log('⬜ 미측정 — 메일 계정이 없다'); await s.query('DELETE FROM files WHERE file_name LIKE :t', { replacements: { t: TAG + '%' } }); process.exit(0); }
  await s.query("INSERT INTO email_threads (business_id,account_id,subject,status,triage,last_message_at,created_at,updated_at) VALUES (:b,:a,:s,'open','human',NOW(),NOW(),NOW())", { replacements: { b: BIZ, a: acc[0].id, s: TAG } });
  const [th] = await s.query('SELECT id FROM email_threads WHERE subject=:s', { replacements: { s: TAG } });
  await s.query("INSERT INTO email_messages (business_id,thread_id,direction,message_id,to_emails,subject,sent_at,created_at,updated_at) VALUES (:b,:t,'inbound',:s,'[]',:s,NOW(),NOW(),NOW())", { replacements: { b: BIZ, t: th[0].id, s: TAG } });
  const [mg] = await s.query('SELECT id FROM email_messages WHERE subject=:s', { replacements: { s: TAG } });
  const aIds = [];
  for (const fid of [fL1, fL3]) {
    await s.query('INSERT INTO email_attachments (message_id,file_id,filename,mime_type,size_bytes,is_inline,created_at,updated_at) VALUES (:m,:f,:n,:mt,100,0,NOW(),NOW())',
      { replacements: { m: mg[0].id, f: fid, n: `${TAG}.png`, mt: 'image/png' } });
    const [a] = await s.query('SELECT id FROM email_attachments WHERE file_id=:f', { replacements: { f: fid } });
    aIds.push(a[0].id);
  }

  try {
    const tOwner = await tok(owner), tMember = await tok(member);
    // ① 목록에서 빠지는가
    const list = await get(tOwner, `/api/projects/workspace/${BIZ}/all-files?limit=1000`);
    const names = (list.j?.data || []).map(x => x.file_name);
    judge('메일 첨부가 Q file 목록에 안 나온다', !names.some(n => String(n).startsWith(TAG)), `목록 ${names.length}건 중 ${TAG} 0건 기대`);
    // ② 저장
    const saved = await post(tOwner, `/api/businesses/${BIZ}/email-attachments/${aIds[1]}/save-to-library`);
    judge('[워크스페이스에 저장] 이 된다', saved.s === 201 || saved.s === 200, `HTTP ${saved.s} ${JSON.stringify(saved.j?.data || saved.j)}`);
    const list2 = await get(tOwner, `/api/projects/workspace/${BIZ}/all-files?limit=1000`);
    const after = (list2.j?.data || []).map(x => x.file_name).filter(n => String(n).startsWith(TAG));
    judge('저장한 것은 목록에 나타난다', after.length === 1, `${after.length}건`);
    // ③ 보안 — 개인(L1) 첨부는 남이 저장할 수 없다
    const other = await post(tMember, `/api/businesses/${BIZ}/email-attachments/${aIds[0]}/save-to-library`);
    judge('개인(L1) 첨부는 남이 저장 못 한다 (음성 대조군)', other.s === 403, `HTTP ${other.s}`);
    // ③-b 공용(L3) 첨부는 멤버도 저장 가능
    const okL3 = await post(tMember, `/api/businesses/${BIZ}/email-attachments/${aIds[1]}/save-to-library`);
    judge('공용(L3) 첨부는 멤버도 저장 가능', okL3.s === 200 || okL3.s === 201, `HTTP ${okL3.s}`);
  } finally {
    await s.query('DELETE FROM email_attachments WHERE filename LIKE :t', { replacements: { t: TAG + '%' } });
    await s.query('DELETE FROM email_messages WHERE subject=:s', { replacements: { s: TAG } });
    await s.query('DELETE FROM email_threads WHERE subject=:s', { replacements: { s: TAG } });
    await s.query('DELETE FROM files WHERE file_name LIKE :t', { replacements: { t: TAG + '%' } });
    const [l] = await s.query('SELECT COUNT(*) n FROM files WHERE file_name LIKE :t', { replacements: { t: TAG + '%' } });
    console.log('원복 잔여', l[0].n);
  }
  console.log(`\n실패 ${fail}건`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
