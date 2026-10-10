// canary-guest-project — 고객용 프로젝트 링크(`/g/:token`, scope=project) 의 **탭·카드·필터·등록 문**
//   (docs/GUEST_PROJECT_VIEW_DECISIONS.md §C·D·E·F·G · §H 가 이 파일을 요구했다)
//
// 재는 것
//   ① 다섯 탭 본문 첫 자식의 left 집합이 폭마다 **하나**인가(3폭) + 스크롤 주체가 탭 본문인가(바깥 문서는 안 스크롤)
//   ② 카드 열 수 — 375 에서 2열 · 1440 에서 4열(880 기둥 안)
//   ③ preview_url — L4·general·png 만 있고, L2 png·internal 에는 **키가 없다** · 있는 주소는 실제 200 이미지
//   ④ 필터를 만지는 동안 `/api/guest/` 요청 0건 · 필터 결과 수 == 같은 술어로 센 수
//   ⑤ 개요 — 마일스톤 목록 == 업무 중 is_milestone · 다음 마감 == 미완료 min(due)
//   ⑥ «고객으로 등록» → 시트에 [로그인]·[계정 요청하기] 둘이 보인다 · 로그인 주소의 redirect 로 **돌아온다**
//   ⑦ 잠긴 문서·로그인 후 받기 파일을 누르면 같은 시트가 뜬다
//   ⑧ (§I-3, 2026-10-10) 파일 «보기» — general 이미지·PDF 는 링크 토큰 아래 미리보기(원본 아님) · 그 밖은 404 ·
//      PDF 쪽수·상한 · 응답 원문에 stored name·경로 0 · 회수하면 닫힘 · 뷰어(3폭은 ①에서) · 분당 상한
//   ⑨ (§I-2) 주요 이슈 — 켠 항목만 · 키 4개 · PATCH 권한·감사 · 개요 3건 == /history 상위 3 · 히스토리 탭
//   ⑩ (§I-1) 개요 기본 정보 표(빈 칸 «—») · 업무 통계(버킷 합·지연·이번 주) · 진행률 막대 == 서버 값
//
// ★ 픽스처는 Node 에서 만든다(브라우저 안 fetch 는 하니스를 죽인다). 끝나면 전부 **지운다.**
// ★ 링크는 발급이 멱등이라 이미 살아 있으면 남의 것을 받는다 — 그건 회수하지 않는다(내가 만든 201 만).
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');
const { launch, login, sleep, BASE, CREDS } = require('./lib/browser');

const API = process.env.E2E_API || 'http://localhost:3003';
const RUN = Date.now().toString(36).slice(-6);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');
const VPS = [{ w: 375, h: 740, m: true }, { w: 900, h: 900, m: false }, { w: 1440, h: 900, m: false }];

let _tok = null;
async function api(p, init = {}) {
  if (!_tok) {
    const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(CREDS) });
    const j = await r.json().catch(() => ({})); _tok = j.data && (j.data.token || j.data.accessToken);
  }
  const headers = { Authorization: `Bearer ${_tok}`, ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) };
  const r = await fetch(`${API}${p}`, { ...init, headers });
  const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body, text };
}
let _M = null, _seq = null;
function models() {
  if (!_M) {
    require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
    _M = require('/opt/planq/dev-backend/models');
    ({ sequelize: _seq } = require('/opt/planq/dev-backend/config/database'));
  }
  return _M;
}
const sql = async (q, r) => { models(); return (await _seq.query(q, { replacements: r }))[0]; };
/** n 쪽짜리 PDF 바이트 — ghostscript 로 만든다(픽스처). */
function makePdf(n) {
  const out = path.join(os.tmpdir(), `zzgp-${process.pid}-${n}.pdf`);
  execFileSync('gs', ['-q', '-sDEVICE=pdfwrite', '-o', out, '-c', `${n} { /Helvetica findfont 60 scalefont setfont 100 400 moveto (Page) show showpage } repeat`]);
  const b = fs.readFileSync(out); fs.unlinkSync(out); return b;
}
/** 고객 신원의 접근 토큰 — 서버가 쓰는 것과 같은 비밀로 서명한다(dev 검사 전용). */
function tokenFor(userId) {
  models();
  const jwt = require('/opt/planq/dev-backend/node_modules/jsonwebtoken');
  return jwt.sign({ userId, id: userId }, process.env.JWT_SECRET, { expiresIn: '10m' });
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')] });
  const made = { tasks: [], posts: [], files: [], links: [], convLinks: [], history: [] };
  let browser = null;
  try {
    const M = models();
    const me = await api('/api/auth/me');
    const biz = me.body?.data?.active_business_id ?? me.body?.data?.user?.active_business_id;
    const uid = me.body?.data?.id ?? me.body?.data?.user?.id;
    const [cv] = await sql("SELECT id, project_id FROM conversations WHERE business_id=? AND channel_type='customer' AND project_id IS NOT NULL ORDER BY id DESC LIMIT 1", [biz]);
    if (!cv) { results.push({ name: '픽스처', unmeasured: true, details: ['⚪ 프로젝트 고객 대화방이 없다'] }); return results; }
    const PROJ = cv.project_id;

    // ── 픽스처 — 업무 5 · 문서 4 · 파일 3
    const T = (o) => M.Task.create({ business_id: biz, project_id: PROJ, created_by: uid, status: 'not_started', title: `ZZ카나리-G ${RUN} ${o.title}`, ...o, title: `ZZ카나리-G ${RUN} ${o.title}` });
    const d0 = new Date(); const day = (n) => new Date(d0.getTime() + n * 86400000).toISOString().slice(0, 10);
    const tk = [
      await T({ title: '마일스톤A', is_milestone: true, due_date: day(20), assignee_id: uid, category: 'zz-design' }),
      await T({ title: '가까운마감', due_date: day(2), assignee_id: uid, category: 'zz-dev' }),
      await T({ title: '먼마감', due_date: day(40), assignee_id: uid, category: 'zz-dev' }),
      await T({ title: '완료된것', status: 'completed', due_date: day(1), assignee_id: uid, category: 'zz-design' }),
      await T({ title: '마일스톤B', is_milestone: true, due_date: day(5), category: 'zz-design' }),
      // ⑩ 지연 1 · 완료(completed_at 있음) 2
      await T({ title: '지연된것', status: 'in_progress', due_date: day(-1), assignee_id: uid }),
      await T({ title: '완료2', status: 'completed', completed_at: new Date(Date.now() - 2 * 86400000), assignee_id: uid }),
      await T({ title: '완료마일스톤', status: 'completed', is_milestone: true, completed_at: new Date(Date.now() - 3 * 86400000) }),
    ];
    made.tasks.push(...tk.map((x) => x.id));
    const P = async (title, security_level, vlevel, category) => {
      const p = await M.Post.create({ business_id: biz, project_id: PROJ, title: `ZZ카나리-G ${RUN} ${title}`, author_id: uid, status: 'published', vlevel, security_level, category, content_json: null, content_text: '' });
      made.posts.push(p.id); return p;
    };
    const pGeneral = await P('공개문서', 'general', 'L3', 'zz-spec');
    const pInternal = await P('내부문서', 'internal', 'L3', 'zz-spec');
    await P('기밀문서', 'confidential', 'L3', 'zz-spec');
    await P('개인문서', 'general', 'L1', 'zz-spec');
    const up = async (name, patch, bytes = Buffer.concat([PNG, Buffer.from(RUN + name)]), type = 'image/png') => {
      const fd = new FormData();
      fd.append('file', new Blob([bytes], { type }), name);
      const r = await api(`/api/files/${biz}`, { method: 'POST', body: fd });
      const id = r.body?.data?.id; if (!id) throw new Error(`업로드 실패 ${r.status}`);
      made.files.push(id);
      await sql(`UPDATE files SET project_id=?, ${Object.keys(patch).map((k) => `${k}=?`).join(', ')} WHERE id=?`, [PROJ, ...Object.values(patch), id]);
      return id;
    };
    const fL4 = await up(`zzgp4-${RUN}.png`, { vlevel: 'L4', security_level: 'general', share_token: `zzgp${RUN}${Math.random().toString(36).slice(2, 12)}` });
    const fL2 = await up(`zzgp2-${RUN}.png`, { vlevel: 'L2', security_level: 'general' });
    const fIn = await up(`zzgpi-${RUN}.png`, { vlevel: 'L4', security_level: 'internal', share_token: `zzgi${RUN}${Math.random().toString(36).slice(2, 12)}` });
    // F1 (2026-09-24 Fable) — 공유에 비밀번호·만료가 걸린 L4 는 공개 다운로드가 401/410 이다. 썸네일(=stored name)도 없어야 한다.
    const fPw = await up(`zzgpw-${RUN}.png`, { vlevel: 'L4', security_level: 'general', share_token: `zzgw${RUN}${Math.random().toString(36).slice(2, 12)}`, share_password_hash: 'x' });
    const fEx = await up(`zzgpx-${RUN}.png`, { vlevel: 'L4', security_level: 'general', share_token: `zzgx${RUN}${Math.random().toString(36).slice(2, 12)}`, share_expires_at: new Date(Date.now() - 86400000) });
    // ⑧ 보기 픽스처 — PDF 3쪽·21쪽(L2 general) · 기밀 PDF · L1 png · svg·docx(이름·종류만 바꾼 행 — 판정 술어를 잰다)
    const pdf3 = makePdf(3);
    const fPdf = await up(`zzgpd-${RUN}.pdf`, { vlevel: 'L2', security_level: 'general' }, pdf3, 'application/pdf');
    const fPdf21 = await up(`zzgp21-${RUN}.pdf`, { vlevel: 'L3', security_level: 'general' }, makePdf(21), 'application/pdf');
    const fConf = await up(`zzgpc-${RUN}.pdf`, { vlevel: 'L3', security_level: 'confidential' }, makePdf(1), 'application/pdf');
    const fL1 = await up(`zzgp1-${RUN}.png`, { vlevel: 'L1', security_level: 'general' });
    const fSvg = await up(`zzgps-${RUN}.png`, { vlevel: 'L2', security_level: 'general' });
    await sql('UPDATE files SET file_name=?, mime_type=? WHERE id=?', [`zzgps-${RUN}.svg`, 'image/svg+xml', fSvg]);
    const fDocx = await up(`zzgpx2-${RUN}.png`, { vlevel: 'L2', security_level: 'general' });
    await sql('UPDATE files SET file_name=?, mime_type=? WHERE id=?', [`zzgpx2-${RUN}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fDocx]);
    const l2Bytes = Buffer.concat([PNG, Buffer.from(RUN + `zzgp2-${RUN}.png`)]);
    // ⑨ 주요 이슈 — 공개 1 · 비공개 1 (앱 라우트로 만든다)
    const hVis = await api(`/api/projects/${PROJ}/history-entries`, { method: 'POST', body: JSON.stringify({ title: `ZZ카나리-G ${RUN} 공개이슈`, body: '본문 공개', client_visible: true, occurred_at: new Date(Date.now() - 3600000).toISOString() }) });
    const hHid = await api(`/api/projects/${PROJ}/history-entries`, { method: 'POST', body: JSON.stringify({ title: `ZZ카나리-G ${RUN} 비공개이슈`, body: '본문 비공개' }) });
    const hVisId = hVis.body?.data?.id; const hHidId = hHid.body?.data?.id;
    if (hVisId) made.history.push(hVisId); if (hHidId) made.history.push(hHidId);

    const lk = await api(`/api/projects/${PROJ}/guest-links`, { method: 'POST', body: '{}' });
    if (!lk.body?.data?.url) { push('링크 발급', false, `${lk.status} ${lk.body?.message || ''}`); return results; }
    if (lk.status === 201) made.links.push(lk.body.data.id);
    const token = lk.body.data.url.split('/g/')[1];

    // ── ③ preview_url
    const fr = await fetch(`${API}/api/guest/${token}/files`); const fj = await fr.json();
    const items = fj.data?.items || [];
    const pick = (id) => items.find((x) => x.id === id);
    // ★ 2026-10-10 §I-3 — 썸네일은 «받기» 가 아니라 «보기» 술어다(general L2/L3/L4 이미지·PDF). 받기는 그대로.
    const ownUrl = (id) => `/api/guest/${encodeURIComponent(token)}/files/${id}/preview?w=400`;
    push('③ L4·general·png 에 preview_url(링크 토큰 아래)', pick(fL4)?.preview_url === ownUrl(fL4) && pick(fL4)?.viewable === true, JSON.stringify(pick(fL4) && { dl: pick(fL4).downloadable, p: pick(fL4).preview_url }));
    push('③ L2·general·png 에 preview_url·viewable(보기) · 받기는 아님', pick(fL2)?.preview_url === ownUrl(fL2) && pick(fL2)?.viewable === true && pick(fL2)?.downloadable === false && pick(fL2)?.preview_kind === 'image', JSON.stringify(pick(fL2)));
    push('③ internal 에는 preview_url 키 없음', pick(fIn) && !('preview_url' in pick(fIn)) && pick(fIn).viewable === false, JSON.stringify(pick(fIn)));
    for (const [label, id] of [['비밀번호 공유', fPw], ['만료된 공유', fEx]]) {
      const row = pick(id);
      const op = await fetch(`${API}/api/guest/${token}/files/${id}/open`, { redirect: 'manual' });
      // 받기는 막힌다(F1 그대로). 보기는 문서와 같은 술어라 열린다 — 원본이 아니라 줄여 그린 그림이다.
      push(`③ ${label} L4 → 받기 불가 · /open 404 · 보기 주소는 링크 토큰 아래`, row && row.downloadable === false && op.status === 404 && row.preview_url === ownUrl(id),
        `${JSON.stringify(row && { dl: row.downloadable, p: row.preview_url })} · open ${op.status}`);
    }
    const okOpen = await fetch(`${API}/api/guest/${token}/files/${fL4}/open`, { redirect: 'manual' });
    push('③ 대조군 — 조건 없는 L4 공유는 /open 302', okOpen.status === 302, String(okOpen.status));
    if (pick(fL4)?.preview_url) {
      const ir = await fetch(`${API}${pick(fL4).preview_url}`);
      push('③ preview_url 이 실제 이미지 200', ir.status === 200 && /image\//.test(ir.headers.get('content-type') || ''), `${ir.status} ${ir.headers.get('content-type')}`);
    }
    push('③ 응답에 파일 경로·저장소 칸이 안 나간다', !/file_path|external_id|storage_provider|share_token/.test(JSON.stringify(fj)), '원문 검사');

    let convTok = null;
    // ── ⑧ 보기(§I-3) — 실 HTTP, 무토큰
    const G = (p, init) => fetch(`${API}/api/guest/${token}${p}`, init);
    const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
    {
      const r = await G(`/files/${fL2}/preview?w=400`); const b = Buffer.from(await r.arrayBuffer());
      push('⑧-1 L2 png 보기 → 200 image · 원본과 다른 바이트', r.status === 200 && /^image\//.test(r.headers.get('content-type') || '') && sha(b) !== sha(l2Bytes),
        `${r.status} ${r.headers.get('content-type')} · ${b.length}B · 같은 바이트=${sha(b) === sha(l2Bytes)}`);
      push('⑧-1 헤더 — inline 파일명 없음 · nosniff · 1시간', /filename="preview"/.test(r.headers.get('content-disposition') || '') && r.headers.get('x-content-type-options') === 'nosniff' && /max-age=3600/.test(r.headers.get('cache-control') || ''),
        `${r.headers.get('content-disposition')} · ${r.headers.get('cache-control')}`);
      const outs = [];
      for (const q of ['', '?w=99999', '?w=abc']) {
        const x = await G(`/files/${fL2}/preview${q}`); const xb = Buffer.from(await x.arrayBuffer());
        outs.push(`${q || '(w 없음)'}→${x.status} ${x.headers.get('content-type')} 원본=${sha(xb) === sha(l2Bytes)}`);
        if (!(x.status === 200 && /webp/.test(x.headers.get('content-type') || '') && sha(xb) !== sha(l2Bytes))) outs.push('✗');
      }
      push('⑧-2 w 없음·과대·잘못된 값도 원본이 아니라 줄인 그림', !outs.includes('✗'), outs.join(' | '));
    }
    {
      const rows = [['internal png', fIn], ['confidential pdf', fConf], ['L1 png', fL1], ['svg', fSvg], ['docx', fDocx]];
      const out = [];
      for (const [label, id] of rows) { const r = await G(`/files/${id}/preview?w=400`); out.push(`${label} ${r.status}`); }
      push('⑧-3 internal·confidential·L1·svg·docx 보기 → 404', out.every((x) => x.endsWith('404')), out.join(' · '));
      push('⑧-3 confidential·L1 은 목록에 행 없음', !pick(fConf) && !pick(fL1), `conf ${!!pick(fConf)} · L1 ${!!pick(fL1)}`);
      push('⑧-3 svg·docx 는 목록에 preview_url 키 없음', pick(fSvg) && !('preview_url' in pick(fSvg)) && pick(fDocx) && !('preview_url' in pick(fDocx)),
        JSON.stringify({ svg: pick(fSvg) && pick(fSvg).viewable, docx: pick(fDocx) && pick(fDocx).viewable }));
    }
    {
      const r1 = await G(`/files/${fPdf}/preview?page=1&w=1024`); const b1 = Buffer.from(await r1.arrayBuffer());
      push('⑧-6 PDF 1쪽 → 200 png · X-Pq-Pages 3 · 원본 아님', r1.status === 200 && r1.headers.get('content-type') === 'image/png' && r1.headers.get('x-pq-pages') === '3' && sha(b1) !== sha(pdf3) && b1.slice(0, 4).toString('hex') === '89504e47',
        `${r1.status} ${r1.headers.get('content-type')} pages=${r1.headers.get('x-pq-pages')} ${b1.length}B`);
      const bad = [];
      for (const pg of ['4', '0', 'x', '-1', '1.5']) { const r = await G(`/files/${fPdf}/preview?page=${pg}`); bad.push(`p${pg}→${r.status}`); }
      push('⑧-6 없는 쪽·잘못된 쪽 → 404', bad.every((x) => x.endsWith('404')), bad.join(' · '));
      const r20 = await G(`/files/${fPdf21}/preview?page=20&w=200`); const r21 = await G(`/files/${fPdf21}/preview?page=21&w=200`);
      push('⑧-6 21쪽 PDF — 20쪽 200 · X-Pq-Pages 20 · 21쪽 404', r20.status === 200 && r20.headers.get('x-pq-pages') === '20' && r21.status === 404,
        `p20 ${r20.status} pages=${r20.headers.get('x-pq-pages')} · p21 ${r21.status}`);
      push('⑧ 목록 — PDF 는 preview_kind pdf · viewable', pick(fPdf)?.preview_kind === 'pdf' && pick(fPdf)?.viewable === true, JSON.stringify(pick(fPdf)));
    }
    {
      // ⑧-4 대화 링크(scope=conversation) 로 같은 주소 → 404
      const cl = await api(`/api/conversations/${biz}/${cv.id}/guest-links`, { method: 'POST', body: '{}' });
      const ctok = cl.body?.data?.url ? cl.body.data.url.split('/g/')[1] : null;
      convTok = ctok;
      if (cl.status === 201 && cl.body?.data?.id) made.convLinks.push(cl.body.data.id);
      if (!ctok) results.push({ name: '⑧-4 대화 링크로 보기·히스토리 → 404', unmeasured: true, details: [`⬜ 대화 링크 발급 실패 ${cl.status}`] });
      else {
        const a = await fetch(`${API}/api/guest/${ctok}/files/${fL2}/preview?w=400`);
        const h = await fetch(`${API}/api/guest/${ctok}/history`);
        push('⑧-4 대화 링크로 보기·히스토리 → 404', a.status === 404 && h.status === 404, `preview ${a.status} · history ${h.status}`);
      }
    }
    {
      // ⑧-7 원문에 stored name·경로·메일 0 — 목록 + 미리보기 헤더
      const [frow] = await sql('SELECT file_path FROM files WHERE id=?', [fL2]);
      const stored = path.basename(frow.file_path || 'NONE');
      const raw = JSON.stringify(fj);
      const pr = await G(`/files/${fL2}/preview?w=400`);
      const hdrs = JSON.stringify([...pr.headers.entries()]);
      const hits = ['/public-image/', 'file_path', 'uploads/', '@', stored].filter((x) => raw.includes(x) || hdrs.includes(x));
      push('⑧-7 목록·미리보기 원문에 public-image·경로·stored name·@ 0건', hits.length === 0, hits.join(',') || '0건');
    }

    // ── ⑨ 주요 이슈(§I-2)
    {
      const hr = await G('/history'); const hj = await hr.json().catch(() => ({}));
      const its = hj.data?.items || [];
      const titles = its.map((x) => x.title);
      push('⑨-12 켠 항목만 /history 에 · 끈 항목은 없다', hr.status === 200 && titles.includes(`ZZ카나리-G ${RUN} 공개이슈`) && !titles.includes(`ZZ카나리-G ${RUN} 비공개이슈`), `${hr.status} · ${its.length}건`);
      const keys = [...new Set(its.flatMap((x) => Object.keys(x)))].sort().join(',');
      push('⑨-12 응답 키 == {body, id, occurred_at, title} · 작성자 0', keys === 'body,id,occurred_at,title' && !/created_by|author/.test(JSON.stringify(hj)), keys);
      const pt = await api(`/api/projects/${PROJ}/history-entries/${hHidId}`, { method: 'PATCH', body: JSON.stringify({ client_visible: true }) });
      const after = ((await (await G('/history')).json()).data?.items || []).map((x) => x.title);
      const [aud] = await sql("SELECT COUNT(*) n FROM audit_logs WHERE action='project.history_entry.client_visible' AND target_id=? AND created_at > NOW() - INTERVAL 2 MINUTE", [PROJ]);
      push('⑨-12·13 멤버 PATCH true → /history 에 나타남 · 감사 1행', pt.status === 200 && after.includes(`ZZ카나리-G ${RUN} 비공개이슈`) && Number(aud.n) >= 1, `PATCH ${pt.status} · 감사 ${aud.n}`);
      await api(`/api/projects/${PROJ}/history-entries/${hHidId}`, { method: 'PATCH', body: JSON.stringify({ client_visible: false }) });
      const back = ((await (await G('/history')).json()).data?.items || []).map((x) => x.title);
      push('⑨ PATCH false → 다시 빠진다', !back.includes(`ZZ카나리-G ${RUN} 비공개이슈`), `${back.length}건`);
      const badBody = await api(`/api/projects/${PROJ}/history-entries/${hHidId}`, { method: 'PATCH', body: JSON.stringify({ client_visible: 'yes' }) });
      push('⑨ PATCH 값이 불리언이 아니면 400', badBody.status === 400, String(badBody.status));
      // 고객 신원 — 이 프로젝트에 계정 있는 고객이 없으면 같은 워크스페이스의 다른 프로젝트(그 고객이 붙은 곳)로 잰다.
      //   판정은 서버(services/projectAccess)와 같은 열 — project_clients.contact_user_id.
      //   ★ 프로젝트를 만든 계정(검사 계정)이 멤버가 아닌 워크스페이스면 POST 가 막히므로 같은 워크스페이스로 한정.
      const [cu] = await sql(`SELECT pc.project_id, pc.contact_user_id user_id FROM project_clients pc
        JOIN users u ON u.id = pc.contact_user_id JOIN projects p ON p.id = pc.project_id
        WHERE p.business_id=? AND u.status='active'
          AND pc.contact_user_id NOT IN (SELECT user_id FROM business_members WHERE business_id=?)
        ORDER BY (pc.project_id = ?) DESC LIMIT 1`, [biz, biz, PROJ]);
      let cuRow = cu;
      if (!cuRow) {
        // 없으면 이 프로젝트에 **검사 동안만** 고객 연결 1행을 둔다(이 워크스페이스 멤버가 아닌 활성 계정) — 바로 지운다.
        const [other] = await sql(`SELECT id FROM users WHERE status='active' AND (is_guest=0 OR is_guest IS NULL) AND platform_role <> 'platform_admin'
          AND id NOT IN (SELECT user_id FROM business_members WHERE business_id=?) ORDER BY id LIMIT 1`, [biz]);
        if (other) {
          await sql('INSERT INTO project_clients (project_id, contact_user_id, contact_name) VALUES (?, ?, ?)', [PROJ, other.id, `ZZ카나리-G ${RUN}`]);
          cuRow = { project_id: PROJ, user_id: other.id, temp: true };
        }
      }
      const cleanTempClient = async () => { if (cuRow && cuRow.temp) await sql('DELETE FROM project_clients WHERE project_id=? AND contact_name=?', [PROJ, `ZZ카나리-G ${RUN}`]); };
      if (!cuRow) results.push({ name: '⑨-13 고객 PATCH → 403', unmeasured: true, details: ['⬜ 고객 신원으로 쓸 활성 계정이 없다'] });
      else try {
        const cu = cuRow;
        let eid = hVisId; let tmp = null;
        if (Number(cu.project_id) !== Number(PROJ)) {
          const c = await api(`/api/projects/${cu.project_id}/history-entries`, { method: 'POST', body: JSON.stringify({ title: `ZZ카나리-G ${RUN} 고객권한`, client_visible: true }) });
          tmp = c.body?.data?.id; eid = tmp; if (tmp) made.history.push(tmp);
        }
        const r = await fetch(`${API}/api/projects/${cu.project_id}/history-entries/${eid}`, { method: 'PATCH', headers: { Authorization: `Bearer ${tokenFor(cu.user_id)}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ client_visible: false }) });
        const [still] = await sql('SELECT client_visible FROM project_history_entries WHERE id=?', [eid]);
        // 대조군 — 같은 신원이 앱 GET 도 403(고객 판정이 실제로 섰다는 증거. 404·401 이면 신원이 안 선 것이다)
        const g = await fetch(`${API}/api/projects/${cu.project_id}/history-entries`, { headers: { Authorization: `Bearer ${tokenFor(cu.user_id)}` } });
        const gj = await g.json().catch(() => ({}));
        push('⑨-13 고객 PATCH → 403 · 값 그대로 (대조: 같은 신원 GET 도 member_only)', !!eid && r.status === 403 && Number(still.client_visible) === 1 && g.status === 403 && /member_only/.test(JSON.stringify(gj)),
          `프로젝트 ${cu.project_id}${cu.temp ? '(임시 고객 연결)' : ''} · PATCH ${r.status} · GET ${g.status} ${gj.message || ''} · client_visible=${still && still.client_visible}`);
      } finally { await cleanTempClient(); }
      const ge = await api(`/api/projects/${PROJ}/history-entries`);
      const mine = (ge.body?.data || []).find((x) => x.id === hVisId);
      push('⑨-14 앱 GET history-entries 에 client_visible', !!mine && mine.client_visible === true, JSON.stringify(mine && { id: mine.id, v: mine.client_visible }));
    }

    // ── 브라우저
    ({ browser } = await launch());
    const page = await browser.newPage();
    // 눈으로 볼 때 — `E2E_LANG=ko|en` 으로 언어를, `E2E_SHOT_DIR` 로 탭별 스크린샷을 남긴다(판정에는 영향 없음).
    const LANG = process.env.E2E_LANG || 'ko';
    const SHOT = process.env.E2E_SHOT_DIR || '';
    await page.evaluateOnNewDocument((l) => { try { localStorage.setItem('i18nextLng', l); } catch { /* */ } }, LANG);
    await page.setViewport({ width: 1440, height: 900 });
    const guestReqs = [];
    page.on('request', (r) => { if (/\/api\/guest\//.test(r.url())) guestReqs.push(r.url()); });
    const open = async (tab) => {
      await page.goto(`${BASE}/g/${token}${tab && tab !== 'overview' ? `?tab=${tab}` : ''}`, { waitUntil: 'networkidle2', timeout: 45000 });
      await page.waitForSelector(`[data-testid="guest-tab-body-${tab}"]`, { timeout: 15000 }).catch(() => null);
      await sleep(900);
    };

    // ① 탭 기둥 · 스크롤 주체 · ② 카드 열
    for (const vp of VPS) {
      await page.setViewport({ width: vp.w, height: vp.h, isMobile: vp.m, hasTouch: vp.m });
      const lefts = {}; let outerScroll = false;
      for (const tab of ['overview', 'tasks', 'history', 'docs', 'files', 'chat']) {
        await open(tab);
        const m = await page.evaluate((tb) => {
          const body = [...document.querySelectorAll(`[data-testid="guest-tab-body-${tb}"]`)].find((e) => e.getBoundingClientRect().height > 1);
          if (!body) return null;
          // 첫 **보이는** 자식(채팅은 메시지 목록의 첫 자식)
          let host = body;
          if (tb === 'chat') host = [...body.querySelectorAll('div')].find((d) => getComputedStyle(d).overflowY === 'auto') || body;
          const kid = [...host.children].find((c) => c.getBoundingClientRect().width > 1);
          const doc = document.scrollingElement;
          return { left: kid ? Math.round(kid.getBoundingClientRect().left) : null, outer: doc.scrollHeight > doc.clientHeight + 1 };
        }, tab);
        lefts[tab] = m ? m.left : null; if (m && m.outer) outerScroll = true;
        if (SHOT) await page.screenshot({ path: path.join(SHOT, `${LANG}-${vp.w}-${tab}.png`) });
      }
      // 여섯 탭 버튼이 **화면 안에** 다 보이는가 — 잘리면 가로로 밀어야 한다는 걸 알 수 없다(2026-09-24 영어 폰 Chat 잘림).
      const tabsFit = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="guest-tab-"][role="tab"]')]
        .filter((e) => e.getBoundingClientRect().height > 1).map((e) => Math.round(e.getBoundingClientRect().right)));
      push(`① @${vp.w} 여섯 탭이 한 화면에 다 보인다`, tabsFit.length === 6 && Math.max(...tabsFit) <= vp.w,
        `탭 오른쪽 끝 ${tabsFit.join(',')} · 화면 ${vp.w}`);
      const set = new Set(Object.values(lefts).filter((x) => x !== null));
      push(`① @${vp.w} 여섯 탭 본문 left 가 하나`, set.size === 1 && Object.values(lefts).every((x) => x !== null), JSON.stringify(lefts));
      push(`① @${vp.w} 바깥 문서는 스크롤하지 않는다`, !outerScroll, `outer=${outerScroll}`);
      if (vp.w !== 900) {
        await open('files');
        const cols = await page.evaluate(() => {
          const cards = [...document.querySelectorAll('[data-testid^="guest-file-"]')].filter((e) => /^guest-file-\d+$/.test(e.dataset.testid) && e.getBoundingClientRect().height > 1);
          if (!cards.length) return 0;
          const top = Math.round(cards[0].getBoundingClientRect().top);
          return cards.filter((c) => Math.round(c.getBoundingClientRect().top) === top).length;
        });
        const want = vp.w === 375 ? 2 : 4;
        // 파일이 3장뿐이면 1440 첫 줄은 3이 최대다 — 열 수는 min(카드수, want) 로 판정
        const expect = Math.min(want, items.length);
        push(`② @${vp.w} 카드 첫 줄 ${expect}장`, cols === expect, `첫 줄 ${cols} · 카드 ${items.length}`);
        // 꼬리표·용량·날짜가 **카드 안에 온전히** 있는가 — span 의 scrollWidth 로는 못 잡는다(카드의 overflow 가
        //   자른다). 좌표로 잰다: 요소 오른쪽 끝 ≤ 카드 오른쪽 끝. (2026-09-24 Fable F6 — 꼬리표가 카드 밖으로 밀려 잘렸다)
        const clipped = await page.evaluate(() => {
          const out = []; let cards = 0, tags = 0, metas = 0;
          for (const card of document.querySelectorAll('[data-testid^="guest-file-"]')) {
            if (!/^guest-file-\d+$/.test(card.dataset.testid)) continue;
            const cr = card.getBoundingClientRect(); if (cr.height < 2) continue;
            cards += 1;
            if (card.querySelector('[data-testid^="guest-file-tag-"]')) tags += 1;
            metas += card.querySelectorAll('[data-card-meta] > span').length;
            // 이름은 **일부러** 말줄임한다(긴 파일명) — 재는 것은 꼬리표와 용량·날짜뿐이다.
            const parts = [card.querySelector('[data-testid^="guest-file-tag-"]'), ...card.querySelectorAll('[data-card-meta] > span')];
            for (const el of parts) {
              if (!el) continue;
              const r = el.getBoundingClientRect();
              if (r.width > 0 && (r.right > cr.right - 1 || r.left < cr.left + 1 || el.scrollWidth > el.clientWidth + 1)) out.push(`${card.dataset.testid}:${(el.textContent || '').slice(0, 12)}`);
            }
          }
          return { out, cards, tags, metas };
        });
        // ★ 잰 것이 없으면 초록이 아니다 — 손잡이(testid·data-card-meta)가 없는 빌드에서는 아무것도 안 집혀 통과했다
        //   (2026-09-24 실측: 빌드 실패로 옛 번들이 떠 있는데 «0건» 초록). 카드마다 꼬리표가 있고 메타가 잡혀야 한다.
        const measured = clipped.cards > 0 && clipped.tags === clipped.cards && clipped.metas >= clipped.cards;
        push(`② @${vp.w} 카드 꼬리표·용량·날짜가 잘리지 않는다`, measured && clipped.out.length === 0,
          `${clipped.out.slice(0, 4).join(' | ') || '잘림 0건'} · 카드 ${clipped.cards} · 꼬리표 ${clipped.tags} · 메타 ${clipped.metas}`);
      }
    }
    await page.setViewport({ width: 1440, height: 900 });

    // ⑤ 개요
    await open('overview');
    const tl = (await (await fetch(`${API}/api/guest/${token}/tasks`)).json()).data || [];
    const msIds = new Set(tl.filter((k) => k.is_milestone).map((k) => k.id));
    const shownMs = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="guest-ov-ms-"]')].map((e) => Number(e.dataset.testid.replace('guest-ov-ms-', ''))));
    push('⑤ 개요 마일스톤 == 업무 중 is_milestone(최대 6)', shownMs.length === Math.min(6, msIds.size) && shownMs.every((id) => msIds.has(id)), `화면 ${shownMs.length} · 기대 ${Math.min(6, msIds.size)}`);
    const open2 = tl.filter((k) => !['completed', 'canceled'].includes(k.status) && k.due_date).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0];
    const nd = await page.evaluate(() => (document.querySelector('[data-testid="guest-ov-nextdue"]') || {}).innerText || '');
    push('⑤ 다음 마감 == 미완료 min(due)', !!open2 && nd.includes(open2.title), `${open2 && open2.title} | ${nd.replace(/\n/g, ' ')}`);

    // ④ 필터 — 요청 0건 · 수 일치
    await open('tasks');
    const before = guestReqs.length;
    await page.click('[data-testid="guest-tasks-state-done"]'); await sleep(400);
    const doneShown = await page.evaluate(() => document.querySelectorAll('[data-testid^="guest-task-"]').length);
    const doneExpect = tl.filter((k) => k.status === 'completed').length;
    await page.click('[data-testid="guest-tasks-state-open"]'); await sleep(400);
    const openShown = await page.evaluate(() => document.querySelectorAll('[data-testid^="guest-task-"]').length);
    const openExpect = tl.filter((k) => !['completed', 'canceled'].includes(k.status)).length;
    await page.click('[data-testid="guest-tasks-state-all"]'); await sleep(300);
    await page.type('[data-testid="guest-tasks-filter"] input', `${RUN} 마일스톤`); await sleep(500);
    const qShown = await page.evaluate(() => document.querySelectorAll('[data-testid^="guest-task-"]').length);
    const qExpect = tl.filter((k) => k.title.toLowerCase().includes(`${RUN} 마일스톤`)).length;
    push('④ 필터 결과 수 == 같은 술어로 센 수', doneShown === doneExpect && openShown === openExpect && qShown === qExpect,
      `완료 ${doneShown}/${doneExpect} · 진행 ${openShown}/${openExpect} · 검색 ${qShown}/${qExpect}`);
    push('④ 필터를 만지는 동안 서버 요청 0건', guestReqs.length === before, `${guestReqs.length - before}건`);

    // ⑦ 잠긴 문서 · 로그인 후 받기 → 같은 시트
    await open('docs');
    await page.click(`[data-testid="guest-doc-${pInternal.id}"]`).catch(() => null); await sleep(600);
    const s1 = await page.evaluate(() => !!document.querySelector('[data-testid="guest-login-sheet"][aria-modal="true"]'));
    push('⑦ 잠긴 문서 → 로그인 시트', s1, s1 ? '떴다' : '안 떴다');
    // 잠김 표시는 **그림**이다 — 이모지는 기기 글꼴에 따라 ☒ 로 깨진다.
    const lockSvg = await page.evaluate((id) => !!document.querySelector(`[data-testid="guest-doc-${id}"] svg rect`) && !/🔒/.test(document.body.innerText), pInternal.id);
    push('⑦ 잠긴 카드의 잠김 표시가 SVG 로 그려진다(이모지 아님)', lockSvg, lockSvg ? 'svg' : '이모지이거나 없음');
    await page.keyboard.press('Escape'); await sleep(300);
    const genOpen = await page.evaluate((id) => !!document.querySelector(`[data-testid="guest-doc-${id}"]`), pGeneral.id);
    push('⑦ 공개 문서 카드가 있다 · 기밀/개인은 카드가 없다', genOpen && !(await page.evaluate(() => /기밀문서|개인문서/.test(document.body.innerText))), 'innerText 검사');
    await open('files');
    // ★ 2026-10-10 — L2 png 는 이제 «보기» 다. 볼 수도 받을 수도 없는 파일(docx)이 «로그인 후 받기» 다.
    await page.click(`[data-testid="guest-file-${fDocx}"]`).catch(() => null); await sleep(600);
    const s2 = await page.evaluate(() => !!document.querySelector('[data-testid="guest-login-sheet"]'));
    push('⑦ 로그인 후 받기 파일 → 같은 시트', s2, s2 ? '떴다' : '안 떴다');
    await page.keyboard.press('Escape'); await sleep(300);

    // ⑧-11 보기 화면(3폭) — 꼬리표 · 이미지 창 · Esc 는 창만 · PDF 쪽 넘김 · 창의 [받기] → 시트(창은 닫힌다)
    for (const vp of VPS) {
      await page.setViewport({ width: vp.w, height: vp.h, isMobile: vp.m, hasTouch: vp.m });
      await open('files');
      const tags = await page.evaluate((ids) => Object.fromEntries(ids.map((id) => [id, (document.querySelector(`[data-testid="guest-file-tag-${id}"]`) || {}).textContent || null])), [fL4, fL2, fIn, fDocx, fPdf]);
      const T = (await (await fetch(`${API}/api/guest/${token}/files`)).json()).data.items;
      const want = (id) => { const r = T.find((x) => x.id === id); return r.downloadable ? '받기' : r.locked ? '잠김' : r.viewable ? '보기' : '로그인 후 받기'; };
      const tagOk = [fL4, fL2, fIn, fDocx, fPdf].every((id) => tags[id] === want(id));
      push(`⑧-11 @${vp.w} 카드 꼬리표 == 받기/보기/잠김/로그인 후 받기`, tagOk, JSON.stringify(tags));
      const thumbs = await page.evaluate((ids) => ids.map((id) => { const im = document.querySelector(`[data-testid="guest-file-thumb-${id}"]`); return im ? (im.complete && im.naturalWidth > 0) : null; }), [fL2, fPdf]);
      push(`⑧-11 @${vp.w} L2 png·PDF 썸네일이 실제로 그려진다`, thumbs.every((x) => x === true), JSON.stringify(thumbs));
      await page.click(`[data-testid="guest-file-${fL2}"]`); await sleep(700);
      const lb = await page.evaluate(() => { const m = [...document.querySelectorAll('[aria-modal="true"]')]; const img = m[0] && m[0].querySelector('img'); return { n: m.length, src: img ? img.getAttribute('src') : null, ok: !!img && img.complete && img.naturalWidth > 0 }; });
      push(`⑧-11 @${vp.w} 이미지 누르면 창 1개 · 링크 토큰 미리보기 주소`, lb.n === 1 && /\/api\/guest\/.+\/preview\?w=1600$/.test(lb.src || '') && lb.ok, JSON.stringify(lb));
      await page.keyboard.press('Escape'); await sleep(400);
      const afterEsc = await page.evaluate(() => ({ modals: document.querySelectorAll('[aria-modal="true"]').length, body: !!document.querySelector('[data-testid="guest-tab-body-files"]') }));
      push(`⑧-11 @${vp.w} Esc 1회 → 창만 닫히고 탭 그대로`, afterEsc.modals === 0 && afterEsc.body, JSON.stringify(afterEsc));
      const pdfReqs = [];
      const onReq = (r) => { if (/\/preview\?page=/.test(r.url())) pdfReqs.push(r.url()); };
      page.on('request', onReq);
      await page.click(`[data-testid="guest-file-${fPdf}"]`); await sleep(1500);
      const no1 = await page.evaluate(() => (document.querySelector('[data-testid="guest-pdf-pageno"]') || {}).textContent || '');
      const pg1 = await page.evaluate(() => { const im = document.querySelector('[data-testid="guest-pdf-page"]'); return !!im && im.complete && im.naturalWidth > 0; });
      await page.click('[data-testid="guest-pdf-next"]'); await sleep(1200);
      const no2 = await page.evaluate(() => (document.querySelector('[data-testid="guest-pdf-pageno"]') || {}).textContent || '');
      page.off('request', onReq);
      push(`⑧-11 @${vp.w} PDF 창 «1 / 3» 그려짐 → 다음 «2 / 3» · page=2 요청`, no1.trim() === '1 / 3' && pg1 && no2.trim() === '2 / 3' && pdfReqs.some((u) => /page=2/.test(u)),
        `${no1} → ${no2} · 그림 ${pg1} · 요청 ${pdfReqs.map((u) => (u.match(/page=\d+/) || [''])[0]).join(',')}`);
      const dlBox = await page.evaluate(() => { const el = document.querySelector('[data-testid="guest-pdf-download"]'); if (!el) return null; const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { hit: !!h && (el === h || el.contains(h)), bottom: Math.round(r.bottom) }; });
      await page.click('[data-testid="guest-pdf-download"]').catch(() => null); await sleep(600);
      const st = await page.evaluate(() => ({ sheet: !!document.querySelector('[data-testid="guest-login-sheet"]'), pdf: !!document.querySelector('[data-testid="guest-pdf-stage"]') }));
      push(`⑧-11 @${vp.w} PDF 창 [받기](보이고 눌림) → 창 닫히고 로그인 시트`, !!dlBox && dlBox.hit && dlBox.bottom <= vp.h && st.sheet && !st.pdf, `${JSON.stringify(dlBox)} · ${JSON.stringify(st)}`);
      await page.keyboard.press('Escape'); await sleep(300);
      if (SHOT) await page.screenshot({ path: path.join(SHOT, `${LANG}-${vp.w}-files-view.png`) });
    }
    await page.setViewport({ width: 1440, height: 900 });

    // ⑨-15 · ⑩ 개요 — 기본 정보 · 통계 · 주요 이슈 3 (3폭) / 히스토리 탭
    const ctxJ = (await (await fetch(`${API}/api/guest/${token}`)).json()).data;
    const hist = (await (await fetch(`${API}/api/guest/${token}/history`)).json()).data.items;
    for (const vp of VPS) {
      await page.setViewport({ width: vp.w, height: vp.h, isMobile: vp.m, hasTouch: vp.m });
      await open('overview');
      await page.waitForSelector('[data-testid="guest-ov-stats"]', { timeout: 8000 }).catch(() => null);
      await sleep(600);
      const ov = await page.evaluate(() => {
        const txt = (id) => (document.querySelector(`[data-testid="${id}"]`) || {}).textContent || null;
        const vis = (id) => { const el = document.querySelector(`[data-testid="${id}"]`); if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
        const nums = {};
        for (const el of document.querySelectorAll('[data-testid^="guest-ov-bucket-"]')) nums[el.dataset.testid.replace('guest-ov-bucket-', '')] = Number(el.firstElementChild.textContent);
        const bar = document.querySelector('[data-testid="guest-tab-body-overview"] [aria-hidden] > div');
        const issues = [...document.querySelectorAll('[data-testid^="guest-ov-issue-"]')].map((e) => Number(e.dataset.testid.replace('guest-ov-issue-', '')));
        return {
          infoVis: vis('guest-ov-info'), desc: txt('guest-ov-info-desc'), period: txt('guest-ov-info-period'), files: txt('guest-ov-info-files'),
          nums, overdue: Number((document.querySelector('[data-testid="guest-ov-overdue-count"] div') || {}).textContent),
          week: Number((document.querySelector('[data-testid="guest-ov-week-count"] div') || {}).textContent),
          weekBars: [...document.querySelectorAll('[data-testid="guest-ov-week-bar"]')].map((e) => Number(e.dataset.count)),
          barPct: bar ? bar.style.width : null, issues,
          wide: document.scrollingElement.scrollWidth > innerWidth + 1,
        };
      });
      const tl2 = (await (await fetch(`${API}/api/guest/${token}/tasks`)).json()).data || [];
      const bsum = Object.values(ov.nums).reduce((a, b) => a + b, 0);
      const today = new Date(); const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const td = ymd(today); const we = ymd(new Date(today.getTime() + 7 * 86400000));
      const od = tl2.filter((k) => k.due_date && !['completed', 'canceled'].includes(k.status) && k.due_date.slice(0, 10) < td).length;
      const wk = tl2.filter((k) => k.due_date && !['completed', 'canceled'].includes(k.status) && k.due_date.slice(0, 10) >= td && k.due_date.slice(0, 10) < we).length;
      push(`⑩ @${vp.w} 기본 정보 표가 보인다 · 빈 칸은 «—»`, ov.infoVis && ov.desc === (ctxJ.project.description || '—') && (ctxJ.project.start_date || ctxJ.project.end_date ? ov.period !== '—' : ov.period === '—') && /\d/.test(ov.files || ''),
        `desc=${(ov.desc || '').slice(0, 20)} · period=${ov.period} · files=${ov.files}`);
      push(`⑩ @${vp.w} 버킷 합 == 업무 수 · 지연 == ${od} · 이번 주 == ${wk}`, bsum === tl2.length && ov.overdue === od && ov.week === wk, `합 ${bsum}/${tl2.length} · 지연 ${ov.overdue} · 이번 주 ${ov.week}`);
      const pct = `${Math.round((ctxJ.project.task_summary.completed / Math.max(1, ctxJ.project.task_summary.total)) * 100)}%`;
      push(`⑩ @${vp.w} 진행률 막대 == 서버 task_summary`, ov.barPct === pct, `${ov.barPct} vs ${pct}`);
      push(`⑩ @${vp.w} 주별 완료 8칸 · 합 ≥ 1`, ov.weekBars.length === 8 && ov.weekBars.reduce((a, b) => a + b, 0) >= 1, JSON.stringify(ov.weekBars));
      push(`⑨-15 @${vp.w} 개요 주요 이슈 == /history 상위 3`, JSON.stringify(ov.issues) === JSON.stringify(hist.slice(0, 3).map((x) => x.id)), `${JSON.stringify(ov.issues)} vs ${JSON.stringify(hist.slice(0, 3).map((x) => x.id))}`);
      push(`⑩ @${vp.w} 개요가 가로로 넘치지 않는다`, !ov.wide, `wide=${ov.wide}`);
      if (SHOT) await page.screenshot({ path: path.join(SHOT, `${LANG}-${vp.w}-overview-full.png`), fullPage: true });
      await open('history');
      const hv = await page.evaluate((run) => {
        const rows = [...document.querySelectorAll('[data-testid^="guest-history-"][data-kind]')];
        const t = rows.map((r) => r.innerText);
        return { n: rows.length, kinds: [...new Set(rows.map((r) => r.dataset.kind))].sort().join(','), vis: t.some((x) => x.includes(`${run} 공개이슈`)), hid: t.some((x) => x.includes(`${run} 비공개이슈`)), wide: document.scrollingElement.scrollWidth > innerWidth + 1 };
      }, RUN);
      push(`⑨ @${vp.w} 히스토리 탭 — 공개 이슈 있음 · 비공개 없음 · 이슈/완료/마일스톤 함께`, hv.vis && !hv.hid && /done/.test(hv.kinds) && /issue/.test(hv.kinds) && /milestone/.test(hv.kinds) && !hv.wide, JSON.stringify(hv));
      if (SHOT) await page.screenshot({ path: path.join(SHOT, `${LANG}-${vp.w}-history.png`) });
    }
    await page.setViewport({ width: 1440, height: 900 });

    // ⑥ 고객으로 등록 → 시트 두 버튼(3폭) · redirect 착지
    for (const vp of VPS) {
      await page.setViewport({ width: vp.w, height: vp.h, isMobile: vp.m, hasTouch: vp.m });
      await open('overview');
      await page.click('[data-testid="guest-register"]').catch(() => null); await sleep(500);
      await page.click('[data-testid="guest-login-request"]').catch(() => null); await sleep(300);
      const vis = await page.evaluate(() => ['guest-login-go', 'guest-login-send'].map((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`); if (!el) return false;
        const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return r.bottom <= innerHeight && !!h && (el === h || el.contains(h));
      }));
      push(`⑥ @${vp.w} 등록 시트 [로그인]·[계정 요청하기] 보인다`, vis.every(Boolean), JSON.stringify(vis));
      // 닫는 문이 **보이고, 누르면 닫힌다** — 바깥 누르기·Esc 만으로는 폰 사용자가 닫는 법을 모른다.
      const closeBox = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="guest-login-close"]'); if (!el) return null;
        const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, hit: !!h && (el === h || el.contains(h)) };
      });
      if (SHOT) await page.screenshot({ path: path.join(SHOT, `${LANG}-${vp.w}-sheet.png`) });
      if (closeBox && closeBox.hit) { if (vp.m) await page.touchscreen.tap(closeBox.x, closeBox.y); else await page.mouse.click(closeBox.x, closeBox.y); }
      await sleep(400);
      const stillOpen = await page.evaluate(() => !!document.querySelector('[data-testid="guest-login-sheet"]'));
      push(`⑥ @${vp.w} 시트 × 가 보이고 누르면 닫힌다`, !!closeBox && closeBox.hit && !stillOpen, `× ${closeBox ? (closeBox.hit ? '보임' : '가려짐') : '없음'} · 닫힘 ${!stillOpen}`);
      if (stillOpen) { await page.keyboard.press('Escape'); await sleep(300); }
    }
    await page.setViewport({ width: 1440, height: 900 });
    // redirect — 로그인한 창에서 /login?redirect= 를 열면 그 링크로 돌아와야 한다
    const page2 = await browser.newPage();
    await login(page2);
    await page2.goto(`${BASE}/login?redirect=${encodeURIComponent(`/g/${token}?tab=docs`)}`, { waitUntil: 'networkidle2' });
    await sleep(2500);
    const landed = new URL(page2.url());
    push('⑥ 로그인 redirect 가 링크의 문서 탭으로 돌아온다', landed.pathname === `/g/${token}` && landed.searchParams.get('tab') === 'docs', landed.pathname + landed.search);
    // 로그인한 멤버는 [앱에서 열기]
    await page2.waitForSelector('[data-testid="guest-open-app"]', { timeout: 8000 }).catch(() => null);
    const app = await page2.evaluate(() => !!document.querySelector('[data-testid="guest-open-app"]'));
    push('⑥ 로그인한 프로젝트 멤버에게는 [앱에서 열기]', app, app ? '보임' : '안 보임');

    // ⑨-14 멤버 히스토리 탭 «고객 공개» 토글 — 누르면 PATCH 정확히 1건 · 값이 뒤집힌다
    if (hVisId) {
      const patches = [];
      const onReq = (r) => { if (r.method() === 'PATCH' && /history-entries\//.test(r.url())) patches.push(r.url()); };
      page2.on('request', onReq);
      await page2.goto(`${BASE}/projects/p/${PROJ}?tab=history`, { waitUntil: 'networkidle2', timeout: 45000 });
      await page2.waitForSelector(`[data-testid="history-client-visible-${hVisId}"] [role="switch"]`, { timeout: 15000 }).catch(() => null);
      const before = await page2.evaluate((id) => (document.querySelector(`[data-testid="history-client-visible-${id}"] [role="switch"]`) || {}).getAttribute?.('aria-checked'), hVisId);
      await page2.click(`[data-testid="history-client-visible-${hVisId}"] [role="switch"]`).catch(() => null);
      await sleep(2000);
      page2.off('request', onReq);
      const [row] = await sql('SELECT client_visible FROM project_history_entries WHERE id=?', [hVisId]);
      push('⑨-14 멤버 «고객 공개» 토글 → PATCH 정확히 1건 · DB 반영', before === 'true' && patches.length === 1 && Number(row.client_visible) === 0,
        `전 ${before} · PATCH ${patches.length}건 · DB ${row.client_visible}`);
      await sql('UPDATE project_history_entries SET client_visible=1 WHERE id=?', [hVisId]);
    } else results.push({ name: '⑨-14 멤버 토글', unmeasured: true, details: ['⬜ 공개 이슈 픽스처가 없다'] });
    await page2.close();

    // ⑧-5 회수 뒤 — 캐시가 판정 앞에 서지 않는가(미리보기 1회로 캐시를 만든 뒤 링크를 닫는다)
    if (made.links.length) {
      const warm = await fetch(`${API}/api/guest/${token}/files/${fL2}/preview?w=400`);
      await api(`/api/projects/${PROJ}/guest-links/${made.links[0]}`, { method: 'DELETE' });
      const cold = await fetch(`${API}/api/guest/${token}/files/${fL2}/preview?w=400`);
      const coldPdf = await fetch(`${API}/api/guest/${token}/files/${fPdf}/preview?page=1&w=1024`);
      const coldH = await fetch(`${API}/api/guest/${token}/history`);
      push('⑧-5 링크를 닫으면 캐시가 있어도 보기·히스토리 404', warm.status === 200 && cold.status === 404 && coldPdf.status === 404 && coldH.status === 404,
        `전 ${warm.status} · 후 이미지 ${cold.status} · PDF ${coldPdf.status} · 히스토리 ${coldH.status}`);
    } else results.push({ name: '⑧-5 회수 뒤 캐시', unmeasured: true, details: ['⬜ 이미 살아 있던 링크를 재사용했다 — 남의 링크는 닫지 않는다'] });

    // ⑧-8 분당 상한 — 미리보기 121번째 → 429 (맨 끝에 둔다: 이 뒤로 같은 키의 보기가 1분간 막힌다)
    {
      // 한도는 판정(attachGuest)보다 **앞**이고 키가 토큰이다 — 대화 링크 토큰으로 두드려 프로젝트 링크를 잠그지 않는다.
      const tk = convTok;
      if (!tk) results.push({ name: '⑧-8 분당 120 상한', unmeasured: true, details: ['⬜ 대화 링크가 없다'] });
      else {
        let first429 = 0;
        for (let i = 1; i <= 125; i++) { const r = await fetch(`${API}/api/guest/${tk}/files/${fL2}/preview?w=200`); if (r.status === 429) { first429 = i; break; } }
        push('⑧-8 분당 120 — 121번째 이내에 429', first429 > 0 && first429 <= 121, `첫 429 = ${first429}번째`);
      }
    }
    return results;
  } catch (e) {
    push('카나리 실행', false, e.message);
    return results;
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      if (made.tasks.length) { await sql('DELETE FROM task_status_history WHERE task_id IN (?)', [made.tasks]).catch(() => null); await sql('DELETE FROM tasks WHERE id IN (?)', [made.tasks]); }
      if (made.posts.length) await sql('DELETE FROM posts WHERE id IN (?)', [made.posts]);
      if (made.history.length) await sql('DELETE FROM project_history_entries WHERE id IN (?)', [made.history]);
      await sql('DELETE FROM project_clients WHERE contact_name=?', [`ZZ카나리-G ${RUN}`]);
      if (made.convLinks.length) {
        const us = await sql('SELECT guest_user_id FROM guest_links WHERE id IN (?)', [made.convLinks]);
        await sql('DELETE FROM guest_links WHERE id IN (?)', [made.convLinks]);
        const uids = us.map((u) => u.guest_user_id).filter(Boolean);
        if (uids.length) { await sql('DELETE FROM conversation_participants WHERE user_id IN (?)', [uids]); await sql('DELETE FROM users WHERE id IN (?) AND is_guest=1', [uids]); }
      }
      for (const id of made.files) {
        const [f] = await sql('SELECT business_id FROM files WHERE id=?', [id]);
        if (!f) continue;
        await api(`/api/files/${f.business_id}/${id}`, { method: 'DELETE' });
        await api(`/api/files/${f.business_id}/${id}/purge`, { method: 'DELETE' });
      }
      if (made.links.length) {
        const us = await sql('SELECT guest_user_id FROM guest_links WHERE id IN (?)', [made.links]);
        const uids = us.map((u) => u.guest_user_id).filter(Boolean);
        await sql('DELETE FROM guest_links WHERE id IN (?)', [made.links]);
        if (uids.length) { await sql('DELETE FROM conversation_participants WHERE user_id IN (?)', [uids]); await sql('DELETE FROM users WHERE id IN (?) AND is_guest=1', [uids]); }
      }
      const [left] = await sql('SELECT (SELECT COUNT(*) FROM tasks WHERE title LIKE ?) t, (SELECT COUNT(*) FROM posts WHERE title LIKE ?) p, (SELECT COUNT(*) FROM project_history_entries WHERE title LIKE ?) h', [`ZZ카나리-G ${RUN}%`, `ZZ카나리-G ${RUN}%`, `ZZ카나리-G ${RUN}%`]);
      const remain = Number(left.t) + Number(left.p) + Number(left.h);
      results.push({ name: 'cleanup:guest-project', hasCanary: true, fail: remain ? 1 : 0,
        details: [`업무 ${made.tasks.length} · 문서 ${made.posts.length} · 파일 ${made.files.length} · 이슈 ${made.history.length} · 링크 ${made.links.length}+${made.convLinks.length} 정리 · 남음 ${remain}`] });
    } catch (e) { results.push({ name: 'cleanup:guest-project', fail: 1, details: [`🔴 ${e.message}`] }); }
  }
}

module.exports = { run };
