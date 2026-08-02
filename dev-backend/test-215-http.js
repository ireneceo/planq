// #215 Fable 게이트 — 실 HTTP 검증 (검증 후 삭제)
const BASE = 'http://localhost:3003';
const { sequelize } = require('./config/database');
const { canAccessFileByLevel } = require('./middleware/access_scope');

let pass = 0, fail = 0;
function judge(name, ok, detail) {
  if (ok) { pass++; console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

(async () => {
  // login
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'health-check@planq.kr', password: 'HealthCheck2026!' }),
  });
  const lj = await lr.json();
  const token = lj.data?.token || lj.data?.accessToken;
  judge('login', lr.status === 200 && !!token, `status=${lr.status}`);
  const H = { Authorization: 'Bearer ' + token };

  // ── 목록 (I) ──
  const listR = await fetch(BASE + '/api/businesses/5/email-threads?folder=all&limit=200', { headers: H });
  const listJ = await listR.json();
  const threads = listJ.data || [];
  judge('목록 200 + data 배열', listR.status === 200 && Array.isArray(threads), `status=${listR.status}, n=${threads.length}`);
  const hasField = threads.length > 0 && threads.every(t => typeof t.attachment_count === 'number');
  judge('전 스레드 attachment_count number', hasField);

  const t1919 = threads.find(t => t.id === 1919);
  judge('I-1: thread 1919 (att 1222 옛 is_inline=1 PDF) attachment_count>=1', !!t1919 && t1919.attachment_count >= 1, t1919 ? `count=${t1919.attachment_count}` : 'thread 1919 목록에 없음');

  const t2412 = threads.find(t => t.id === 2412);
  console.log('  info: thread 2412 in list =', t2412 ? `count=${t2412.attachment_count}` : 'not in first 200');

  // ── 상세 (A/G/H/경계) ──
  async function detail(id) {
    const r = await fetch(`${BASE}/api/businesses/5/email-threads/${id}`, { headers: H });
    return { status: r.status, j: await r.json() };
  }

  // A + 옛 데이터 sample: att 1222 출현
  const d1919 = await detail(1919);
  const msgs1919 = d1919.j.data?.messages || [];
  const allAtt1919 = msgs1919.flatMap(m => m.attachments || []);
  const att1222 = allAtt1919.find(a => a.id === 1222);
  judge('시나리오1(A·옛데이터): detail 1919 에 att 1222 출현', d1919.status === 200 && !!att1222, att1222 ? `file_id=${att1222.file_id}, name=${att1222.file_name}` : `status=${d1919.status}, atts=${allAtt1919.length}`);

  // A/H: msg 1376 — att 2008 부재 + inline_images 존재
  const d2412 = await detail(2412);
  const msgs2412 = d2412.j.data?.messages || [];
  const m1376 = msgs2412.find(m => m.id === 1376);
  const att2008Absent = m1376 && !(m1376.attachments || []).some(a => a.id === 2008);
  const inline2128 = m1376 && (m1376.inline_images || []).some(i => i.file_id === 2128 && i.content_id);
  judge('시나리오2(A): msg1376 attachments 에 att 2008 부재', !!att2008Absent, m1376 ? `atts=${JSON.stringify((m1376.attachments||[]).map(a=>a.id))}` : 'msg 1376 없음');
  judge('시나리오2(H): msg1376 inline_images 에 file 2128 존재', !!inline2128, m1376 ? JSON.stringify(m1376.inline_images) : '');

  // G: thread 4 — rfc822-headers 칩 부재
  const d4 = await detail(4);
  const atts4 = (d4.j.data?.messages || []).flatMap(m => m.attachments || []);
  judge('시나리오3(G): thread 4 에 rfc822-headers 칩(att 3) 부재', d4.status === 200 && !atts4.some(a => a.id === 3), `atts=${JSON.stringify(atts4.map(a=>a.id))}`);

  // 경계 fail-open: thread 10 — content_id NULL + body_html NULL → 칩 표시
  const d10 = await detail(10);
  const atts10 = (d10.j.data?.messages || []).flatMap(m => m.attachments || []);
  judge('시나리오7(경계 fail-open): thread 10 att 5(content_id NULL·body NULL) 표시', atts10.some(a => a.id === 5), `atts=${JSON.stringify(atts10.map(a=>a.id))}`);

  // ── I-4 정합 불변식: 목록 count == detail 계수 (표본 10 + 대상 스레드) ──
  const sampleIds = [...new Set([1919, 2412, 4, 10, ...threads.slice(0, 10).map(t => t.id)])];
  let mismatches = [];
  for (const id of sampleIds) {
    const lt = threads.find(t => t.id === id);
    if (!lt) continue;
    const d = await detail(id);
    const NOISE = new Set(['text/rfc822-headers', 'message/delivery-status', 'text/x-amp-html']);
    const detCnt = (d.j.data?.messages || []).flatMap(m => m.attachments || [])
      .filter(a => a.file_id != null && !NOISE.has(String(a.mime_type || '').toLowerCase())).length;
    if (detCnt !== lt.attachment_count) mismatches.push({ id, list: lt.attachment_count, detail: detCnt });
  }
  judge(`I-4 정합 불변식 (표본 ${sampleIds.length}스레드): 목록 count == detail 칩 수`, mismatches.length === 0, mismatches.length ? JSON.stringify(mismatches) : 'mismatch 0');
  if (t2412) judge('I-2: embedded-only thread 2412 attachment_count', true, `count=${t2412.attachment_count} (detail 대조는 I-4 에 포함)`);

  // ── D: 파일 다운로드 (att 1222 → file 1342) ──
  const dl = await fetch(BASE + '/api/files/5/1342/download', { headers: H });
  const buf = dl.status === 200 ? await dl.arrayBuffer() : null;
  judge('시나리오4(D): GET /api/files/5/1342/download 200 + pdf + bytes', dl.status === 200 && String(dl.headers.get('content-type')).includes('pdf') && buf && buf.byteLength > 1000, `status=${dl.status}, ct=${dl.headers.get('content-type')}, bytes=${buf ? buf.byteLength : 0}`);

  // ── 멀티테넌트 격리 ──
  const dl3 = await fetch(BASE + '/api/files/3/2699/download', { headers: H });
  judge('시나리오5(멀티테넌트): biz5 토큰 → biz3 파일 다운로드 거부', dl3.status === 403 || dl3.status === 404, `status=${dl3.status}`);
  const list3 = await fetch(BASE + '/api/businesses/3/email-threads?folder=all', { headers: H });
  judge('멀티테넌트: biz5 토큰 → biz3 목록 거부', list3.status === 403 || list3.status === 404, `status=${list3.status}`);

  // 무인증 접근 거부
  const anon = await fetch(BASE + '/api/files/5/1342/download');
  judge('무인증 다운로드 401', anon.status === 401, `status=${anon.status}`);

  // ── F: 개인 L1 스코프 실측 (biz 3 제2 멤버) ──
  const q = (sql, r) => sequelize.query(sql, { replacements: r, type: sequelize.QueryTypes.SELECT });
  const [f2699] = await q('SELECT * FROM files WHERE id=2699');
  const owners = await q('SELECT user_id, role FROM business_members WHERE business_id=3 AND user_id != 3 LIMIT 3');
  const okOwner = await canAccessFileByLevel(3, f2699);
  judge('시나리오6(F): 계정 주인 user 3 → biz3 L1 파일 접근 true', okOwner === true);
  if (owners.length > 0) {
    for (const o of owners) {
      const okOther = await canAccessFileByLevel(o.user_id, f2699);
      judge(`시나리오6(F): 타 멤버 user ${o.user_id}(${o.role}) → L1 파일 접근 false`, okOther === false);
    }
  } else {
    // 제2 멤버 실계정 없음 — 가상 멤버 스코프로 실측 불가 → 임의 타 사용자로 실측
    const okOther = await canAccessFileByLevel(999999, f2699);
    judge('시나리오6(F): 비멤버 접근 false (제2 멤버 부재 폴백)', okOther === false);
  }
  // 회사 계정(L3) 불변 대조
  const [l3chk] = await q("SELECT COUNT(*) c FROM files f JOIN email_attachments ea ON ea.file_id=f.id JOIN email_messages em ON em.id=ea.message_id JOIN email_threads et ON et.id=em.thread_id JOIN email_accounts ac ON ac.id=et.account_id WHERE ac.owner_user_id IS NULL AND f.vlevel != 'L3'");
  judge('F: 회사 계정 첨부 L3 불변 (vlevel != L3 = 0건)', Number(l3chk.c) === 0, `위반=${l3chk.c}`);

  console.log(`\n=== 결과: PASS ${pass} / FAIL ${fail} ===`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
