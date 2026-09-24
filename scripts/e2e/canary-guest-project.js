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
//
// ★ 픽스처는 Node 에서 만든다(브라우저 안 fetch 는 하니스를 죽인다). 끝나면 전부 **지운다.**
// ★ 링크는 발급이 멱등이라 이미 살아 있으면 남의 것을 받는다 — 그건 회수하지 않는다(내가 만든 201 만).
const fs = require('fs');
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

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')] });
  const made = { tasks: [], posts: [], files: [], links: [] };
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
    const up = async (name, patch) => {
      const fd = new FormData();
      fd.append('file', new Blob([PNG, Buffer.from(RUN + name)], { type: 'image/png' }), name);
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

    const lk = await api(`/api/projects/${PROJ}/guest-links`, { method: 'POST', body: '{}' });
    if (!lk.body?.data?.url) { push('링크 발급', false, `${lk.status} ${lk.body?.message || ''}`); return results; }
    if (lk.status === 201) made.links.push(lk.body.data.id);
    const token = lk.body.data.url.split('/g/')[1];

    // ── ③ preview_url
    const fr = await fetch(`${API}/api/guest/${token}/files`); const fj = await fr.json();
    const items = fj.data?.items || [];
    const pick = (id) => items.find((x) => x.id === id);
    push('③ L4·general·png 에 preview_url', !!pick(fL4)?.preview_url, JSON.stringify(pick(fL4) && { dl: pick(fL4).downloadable, p: pick(fL4).preview_url }));
    push('③ L2·general·png 에는 preview_url 키 없음', pick(fL2) && !('preview_url' in pick(fL2)), JSON.stringify(pick(fL2)));
    push('③ internal 에는 preview_url 키 없음', pick(fIn) && !('preview_url' in pick(fIn)), JSON.stringify(pick(fIn)));
    for (const [label, id] of [['비밀번호 공유', fPw], ['만료된 공유', fEx]]) {
      const row = pick(id);
      const op = await fetch(`${API}/api/guest/${token}/files/${id}/open`, { redirect: 'manual' });
      push(`③ ${label} L4 → 받기 불가 · preview_url 없음 · /open 404`, row && row.downloadable === false && !('preview_url' in row) && op.status === 404,
        `${JSON.stringify(row && { dl: row.downloadable, p: row.preview_url })} · open ${op.status}`);
    }
    const okOpen = await fetch(`${API}/api/guest/${token}/files/${fL4}/open`, { redirect: 'manual' });
    push('③ 대조군 — 조건 없는 L4 공유는 /open 302', okOpen.status === 302, String(okOpen.status));
    if (pick(fL4)?.preview_url) {
      const ir = await fetch(`${API}${pick(fL4).preview_url}`);
      push('③ preview_url 이 실제 이미지 200', ir.status === 200 && /image\//.test(ir.headers.get('content-type') || ''), `${ir.status} ${ir.headers.get('content-type')}`);
    }
    push('③ 응답에 파일 경로·저장소 칸이 안 나간다', !/file_path|external_id|storage_provider|share_token/.test(JSON.stringify(fj)), '원문 검사');

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
      for (const tab of ['overview', 'tasks', 'docs', 'files', 'chat']) {
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
      // 다섯 탭 버튼이 **화면 안에** 다 보이는가 — 잘리면 가로로 밀어야 한다는 걸 알 수 없다(2026-09-24 영어 폰 Chat 잘림).
      const tabsFit = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="guest-tab-"][role="tab"]')]
        .filter((e) => e.getBoundingClientRect().height > 1).map((e) => Math.round(e.getBoundingClientRect().right)));
      push(`① @${vp.w} 다섯 탭이 한 화면에 다 보인다`, tabsFit.length === 5 && Math.max(...tabsFit) <= vp.w,
        `탭 오른쪽 끝 ${tabsFit.join(',')} · 화면 ${vp.w}`);
      const set = new Set(Object.values(lefts).filter((x) => x !== null));
      push(`① @${vp.w} 다섯 탭 본문 left 가 하나`, set.size === 1 && Object.values(lefts).every((x) => x !== null), JSON.stringify(lefts));
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
    await page.click(`[data-testid="guest-file-${fL2}"]`).catch(() => null); await sleep(600);
    const s2 = await page.evaluate(() => !!document.querySelector('[data-testid="guest-login-sheet"]'));
    push('⑦ 로그인 후 받기 파일 → 같은 시트', s2, s2 ? '떴다' : '안 떴다');
    await page.keyboard.press('Escape'); await sleep(300);

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
    await page2.close();
    return results;
  } catch (e) {
    push('카나리 실행', false, e.message);
    return results;
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      if (made.tasks.length) { await sql('DELETE FROM task_status_history WHERE task_id IN (?)', [made.tasks]).catch(() => null); await sql('DELETE FROM tasks WHERE id IN (?)', [made.tasks]); }
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
      const [left] = await sql('SELECT (SELECT COUNT(*) FROM tasks WHERE title LIKE ?) t, (SELECT COUNT(*) FROM posts WHERE title LIKE ?) p', [`ZZ카나리-G ${RUN}%`, `ZZ카나리-G ${RUN}%`]);
      results.push({ name: 'cleanup:guest-project', hasCanary: true, fail: Number(left.t) + Number(left.p) ? 1 : 0,
        details: [`업무 ${made.tasks.length} · 문서 ${made.posts.length} · 파일 ${made.files.length} · 링크 ${made.links.length} 정리 · 남음 ${Number(left.t) + Number(left.p)}`] });
    } catch (e) { results.push({ name: 'cleanup:guest-project', fail: 1, details: [`🔴 ${e.message}`] }); }
  }
}

module.exports = { run };
