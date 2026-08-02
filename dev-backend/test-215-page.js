// #215 Fable 게이트 — I-1/I-2 목록 페이지 순회 실측 (검증 후 삭제)
const BASE = 'http://localhost:3003';
(async () => {
  const lr = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'health-check@planq.kr', password: 'HealthCheck2026!' }),
  });
  const token = (await lr.json()).data?.token;
  const H = { Authorization: 'Bearer ' + token };
  const want = new Map([[1919, null], [2412, null]]);
  for (let page = 1; page <= 20; page++) {
    const r = await fetch(`${BASE}/api/businesses/5/email-threads?folder=all&limit=200&page=${page}`, { headers: H });
    const j = await r.json();
    const rows = j.data || [];
    if (!rows.length) break;
    for (const t of rows) if (want.has(t.id)) want.set(t.id, t.attachment_count);
    if ([...want.values()].every(v => v !== null)) break;
  }
  console.log('thread 1919 attachment_count =', want.get(1919));
  console.log('thread 2412 attachment_count =', want.get(2412));
  // detail 대조
  for (const id of [1919, 2412]) {
    const r = await fetch(`${BASE}/api/businesses/5/email-threads/${id}`, { headers: H });
    const j = await r.json();
    const NOISE = new Set(['text/rfc822-headers', 'message/delivery-status', 'text/x-amp-html']);
    const cnt = (j.data?.messages || []).flatMap(m => m.attachments || [])
      .filter(a => a.file_id != null && !NOISE.has(String(a.mime_type || '').toLowerCase())).length;
    console.log(`thread ${id} detail 칩 수 =`, cnt);
  }
  const ok1 = want.get(1919) >= 1;
  const ok2 = want.get(2412) !== null;
  console.log(ok1 ? 'I-1 PASS' : 'I-1 FAIL', '/', ok2 ? `I-2 측정=${want.get(2412)}` : 'I-2 미발견');
  process.exit(ok1 && ok2 ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(1); });
