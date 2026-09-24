// canary-image-ctx — 이미지 보안 Stage 2b 1·2단계: 공개 화면 3곳이 본문 이미지에 `?ctx=` 를 붙이는가
//   (docs/IMAGE_STAGE2B_DECISIONS.md §1·§3 — 3단계 켜기 전에 이 셋이 초록이어야 한다)
//
// 재는 것 (실브라우저 · 익명)
//   ① 공유 링크(/public/posts/:token) · 게스트 문서(/g/:token 문서 탭) · 서명(/sign/:token)
//      — 본문 <img> 의 src 에 ctx= 가 있고, 실제로 그려졌다(naturalWidth > 0)
//   ② 계측 — 그 화면을 여는 동안 서버가 ctx_ok 를 세고 would_deny 는 늘지 않는다
//      (= 3단계를 켜도 이 화면은 안 깨진다). 음성 대조군: ctx 없이 부르면 would_deny 가 는다
// ★ 픽스처는 Node 에서 만들고 끝나면 전부 지운다. 링크 발급은 멱등이라 내가 만든 201 만 회수한다.
const { launch, sleep, BASE, CREDS } = require('./lib/browser');

const API = process.env.E2E_API || 'http://localhost:3003';
const RUN = Date.now().toString(36).slice(-6);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64');

let _tok = null;
async function api(p, init = {}) {
  if (!_tok) {
    const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(CREDS) });
    const j = await r.json().catch(() => ({})); _tok = j.data && (j.data.token || j.data.accessToken);
  }
  const headers = { Authorization: `Bearer ${_tok}`, ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) };
  const r = await fetch(`${API}${p}`, { ...init, headers });
  const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body };
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
const sql = async (s, r) => (await _seq.query(s, { replacements: r }))[0];
const l23 = async () => {
  const r = await fetch(`${API}/api/internal/health/imagegate`, { headers: { 'x-internal-api-key': process.env.INTERNAL_API_KEY } });
  return (await r.json()).data.l23;
};

/** 화면의 본문 이미지 — src 와 실제로 그려졌는가 */
async function imgsIn(page, sel) {
  await page.waitForSelector(`${sel} img`, { timeout: 15000 }).catch(() => null);
  await page.waitForFunction((s) => [...document.querySelectorAll(`${s} img`)].every((i) => i.complete), { timeout: 10000 }, sel).catch(() => null);
  return page.evaluate((s) => [...document.querySelectorAll(`${s} img`)].map((i) => ({ src: i.getAttribute('src') || '', w: i.naturalWidth })), sel);
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')] });
  const made = { posts: [], files: [], links: [], sr: [] };
  let browser = null;
  try {
    const M = models();
    const me = await api('/api/auth/me');
    const biz = me.body?.data?.active_business_id ?? me.body?.data?.user?.active_business_id;
    const uid = me.body?.data?.id ?? me.body?.data?.user?.id;
    const [cv] = await sql("SELECT id, project_id FROM conversations WHERE business_id=? AND channel_type='customer' AND project_id IS NOT NULL ORDER BY id DESC LIMIT 1", [biz]);
    if (!cv) { results.push({ name: '픽스처', unmeasured: true, details: ['⚪ 프로젝트 고객 대화방이 없다'] }); return results; }
    const PROJ = cv.project_id;

    // 이미지 — L3(3단계에서 막힐 등급) 한 장. 실제 업로드로 만든다(저장 파일이 있어야 200 이다).
    const fd = new FormData();
    fd.append('file', new Blob([PNG], { type: 'image/png' }), `zzctx-${RUN}.png`);
    const up = await api(`/api/files/${biz}`, { method: 'POST', body: fd });
    const fid = up.body?.data?.id; if (!fid) throw new Error(`업로드 실패 ${up.status}`);
    made.files.push(fid);
    await sql("UPDATE files SET project_id=?, vlevel='L3', security_level='general' WHERE id=?", [PROJ, fid]);
    const [frow] = await sql('SELECT file_path FROM files WHERE id=?', [fid]);
    const stored = String(frow.file_path).split('/').pop();
    const doc = { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: `zz ctx ${RUN}` }] },
      { type: 'image', attrs: { src: `/api/files/public-image/${stored}?w=640` } },
    ] };
    const post = await M.Post.create({ business_id: biz, project_id: PROJ, title: `ZZ카나리-C ${RUN}`, author_id: uid, status: 'published', vlevel: 'L3', security_level: 'general', content_json: JSON.stringify(doc), content_text: '' });
    made.posts.push(post.id);
    const sh = await api(`/api/posts/${post.id}/share`, { method: 'POST', body: '{}' });
    const shareToken = (await M.Post.findByPk(post.id)).share_token;
    if (!shareToken) { push('공유 생성', false, `${sh.status}`); return results; }

    // 음성 대조군 — ctx 없이 부르면 would_deny 가 는다(계측이 살아 있다)
    {
      const a = await l23(); await fetch(`${API}/api/files/public-image/${stored}?w=640`); const b = await l23();
      push('② 대조군 — ctx 없는 익명 요청은 would_deny 로 센다', b.would_deny - a.would_deny === 1, JSON.stringify({ d: b.would_deny - a.would_deny }));
    }

    ({ browser } = await launch());
    const ctxPage = await browser.createBrowserContext();   // 익명 — 쿠키 없음
    const page = await ctxPage.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    const check = async (label, url, sel, prep) => {
      const a = await l23();
      await page.goto(url, { waitUntil: 'networkidle2' });
      if (prep) await prep();
      const imgs = (await imgsIn(page, sel)).filter((i) => i.src.includes(stored));
      const b = await l23();
      if (!imgs.length) { results.push({ name: `① ${label}`, unmeasured: true, details: ['⚪ 본문 이미지를 못 찾았다 — 잰 것이 없다'] }); return; }
      push(`① ${label} — 본문 이미지 src 에 ctx= · 그려졌다`, imgs.every((i) => /[?&]ctx=/.test(i.src) && i.w > 0),
        imgs.map((i) => `${i.src.replace(stored, '<img>').slice(0, 70)}… w=${i.w}`).join(' | '));
      push(`② ${label} — 서버가 ctx_ok 로 셌고 would_deny 는 안 늘었다`, b.ctx_ok - a.ctx_ok >= 1 && b.would_deny - a.would_deny === 0,
        JSON.stringify({ ok: b.ctx_ok - a.ctx_ok, bad: b.ctx_bad - a.ctx_bad, deny: b.would_deny - a.would_deny }));
    };

    await check('공유 링크', `${BASE}/public/posts/${shareToken}`, 'main, body');

    // 게스트 프로젝트 링크 — 문서 탭에서 그 문서를 연다
    const lk = await api(`/api/projects/${PROJ}/guest-links`, { method: 'POST', body: '{}' });
    if (lk.body?.data?.url) {
      if (lk.status === 201) made.links.push(lk.body.data.id);
      const gtoken = lk.body.data.url.split('/g/')[1];
      await check('게스트 문서', `${BASE}/g/${gtoken}?tab=docs`, '[data-testid="guest-doc-body"]', async () => {
        await page.waitForSelector(`[data-testid="guest-doc-${post.id}"]`, { timeout: 15000 });
        await page.click(`[data-testid="guest-doc-${post.id}"]`);
      });
      // 대조군 — 게스트는 그림자 사용자 **이미지 쿠키**를 갖는다. 쿠키만 있고 ctx 가 없으면 막혔을 것으로 세야 한다
      //   (쿠키 = 멤버로 봤다가 게스트 이미지를 0건으로 센 전례).
      const a = await l23();
      const st = await page.evaluate(async (u) => (await fetch(u, { credentials: 'include' })).status, `/api/files/public-image/${stored}?w=320`);
      const b = await l23();
      push('② 대조군 — 게스트 쿠키만 있고 ctx 없음 → would_deny', st === 200 && b.would_deny - a.would_deny === 1,
        JSON.stringify({ st, deny: b.would_deny - a.would_deny }));
    } else {
      results.push({ name: '① 게스트 문서', unmeasured: true, details: [`⚪ 링크 발급 불가 ${lk.status} ${lk.body?.message || ''}`] });
    }

    // 서명 화면 — 고정본에 같은 이미지
    const crypto = require('crypto');
    const sr = await M.SignatureRequest.create({ entity_type: 'post', entity_id: post.id, kind: 'sign', business_id: biz, requester_user_id: uid,
      signer_email: `zzctx-${RUN}@example.com`, token: crypto.randomBytes(32).toString('hex'), status: 'sent',
      expires_at: new Date(Date.now() + 86400000), content_snapshot: JSON.stringify(doc) });
    made.sr.push(sr.id);
    await check('서명 화면', `${BASE}/sign/${sr.token}`, 'body');

    return results;
  } catch (e) {
    push('카나리 실행', false, e.message);
    return results;
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      if (made.sr.length) await sql('DELETE FROM signature_requests WHERE id IN (?)', [made.sr]);
      if (made.posts.length) await sql('DELETE FROM posts WHERE id IN (?)', [made.posts]);
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
      const [left] = await sql('SELECT (SELECT COUNT(*) FROM posts WHERE title LIKE ?) p, (SELECT COUNT(*) FROM signature_requests WHERE signer_email LIKE ?) s', [`ZZ카나리-C ${RUN}%`, `zzctx-${RUN}%`]);
      results.push({ name: 'cleanup:image-ctx', hasCanary: true, fail: Number(left.p) + Number(left.s) ? 1 : 0,
        details: [`문서 ${made.posts.length} · 파일 ${made.files.length} · 링크 ${made.links.length} · 서명 ${made.sr.length} 정리 · 남음 ${Number(left.p) + Number(left.s)}`] });
    } catch (e) { results.push({ name: 'cleanup:image-ctx', fail: 1, details: [`🔴 ${e.message}`] }); }
  }
}

module.exports = { run };
