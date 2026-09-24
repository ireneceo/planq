// canary-guest-entry — 게스트 링크(`/g/:token`)가 **누가 보낸 것인지 말하는가** (2026-09-24, P0-①)
//
// 왜: 이 무인증 표면을 기계로 재는 검사가 **하나도 없었다**(Fable 2026-09-24 지적). 발신자 표시를
//   넣은 라운드는 Fable 이 손으로 쟀지만, 다음에 누가 응답을 넓히거나 헤더를 바꾸면 막을 것이 없다.
//   설계 docs/CLIENT_ENTRY_DESIGN.md §5 P0-① · §6 «카나리를 P1 **전에** 만든다».
//
// 재는 것
//   서버 — 응답 `workspace` 키가 정확히 {name, logo_url} · 옛 top-level 키 무변경 · 원문에 금지 문자열 0 ·
//          외부 로고 주소는 null(화이트리스트가 살아 있는가 — DB 를 바꿨다 되돌린다) · 회수하면 404
//   화면 — 폰·태블릿·데스크탑에서 로고·이름이 **그려져 있는가**(elementFromPoint) · 가로 스크롤 없음 · 밴드1 높이
//   대조군 — 응답에서 `workspace` 를 지운 채 같은 판정을 돌려 **빨간불이 켜지는가**(안 켜지면 검사기가 죽은 것)
//
// ★ 픽스처·판정용 호출은 **Node 에서** 한다(브라우저 안 fetch 는 서버가 느려지면 하니스를 죽인다 —
//   memory feedback_fixture_inside_browser_kills_harness). 브라우저는 화면을 재는 데만 쓴다.
// ★ 발급한 링크·그림자 사용자는 끝에서 **지운다**(회수만 하면 행이 쌓인다).
const { launch, sleep, BASE, CREDS } = require('./lib/browser');

const API = process.env.E2E_API || 'http://localhost:3003';
const OLD_KEYS = ['account_requested', 'can_write', 'client_name', 'conversation', 'guest_name', 'project', 'scope'];
// 응답 **원문**으로 판정한다 — 키 이름만 보면 중첩·새 경로로 빠져나간다(health-check --category=secrets 와 같은 이유).
const FORBIDDEN = [/business_id/, /"slug"/, /@/, /user_id/, /owner/, /"phone"/, /"email"/, /brand_/, /legal_/, /subscription/];
const SYMBOL = /^\/api\/businesses\/symbol\/[0-9a-f-]+\.(png|jpe?g|gif|webp|svg)$/i;
const VIEWPORTS = [
  { w: 375, h: 667, mobile: true },
  { w: 768, h: 1024, mobile: false },
  { w: 1440, h: 900, mobile: false },
];

let _tok = null;
async function api(path, init = {}) {
  if (!_tok) {
    const r = await fetch(`${API}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: CREDS.email, password: CREDS.password }),
    });
    const j = await r.json().catch(() => ({}));
    _tok = j.data && (j.data.token || j.data.accessToken);
  }
  const r = await fetch(`${API}${path}`, {
    ...init, headers: { Authorization: `Bearer ${_tok}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body, text };
}

let _seq = null;
async function sql(q, replacements) {
  if (!_seq) {
    require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
    ({ sequelize: _seq } = require('/opt/planq/dev-backend/config/database'));
  }
  const [rows] = await _seq.query(q, { replacements });
  return rows;
}

/** 한 화면을 잰다. strip=true 면 응답에서 workspace 를 지운다(대조군). */
async function measure(browser, token, vp, strip) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: vp.w, height: vp.h, isMobile: vp.mobile, hasTouch: vp.mobile });
    if (strip) {
      await page.setRequestInterception(true);
      page.on('request', async (req) => {
        if (req.method() === 'GET' && new RegExp(`/api/guest/${token}$`).test(req.url())) {
          try {
            const r = await fetch(req.url());
            const j = await r.json();
            if (j && j.data) delete j.data.workspace;
            return req.respond({ status: r.status, contentType: 'application/json', body: JSON.stringify(j) });
          } catch { return req.continue(); }
        }
        return req.continue();
      });
    }
    await page.goto(`${BASE}/g/${token}`, { waitUntil: 'networkidle2', timeout: 45000 });
    // 제목이 그려질 때까지 — 이름을 기다리면 대조군(이름 없음)이 늘 타임아웃까지 간다.
    await page.waitForFunction(() => /\S/.test(document.body.innerText || ''), { timeout: 20000 }).catch(() => null);
    await sleep(1200);
    return await page.evaluate(() => {
      const drawn = (sel) => {
        const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().height > 1);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 8), r.top + r.height / 2);
        return {
          x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
          hit: !!hit && (el === hit || el.contains(hit) || hit.contains(el)),
          inView: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
          text: (el.textContent || '').trim(),
        };
      };
      const mark = drawn('[data-testid="public-workspace-mark"]');
      const name = drawn('[data-testid="public-workspace-name"]');
      let band = null;
      const m = document.querySelector('[data-testid="public-workspace-mark"]');
      for (let b = m && m.parentElement; b; b = b.parentElement) {
        if (getComputedStyle(b).borderBottomWidth !== '0px') { band = Math.round(b.getBoundingClientRect().height); break; }
      }
      return { mark, name, band, hscroll: document.documentElement.scrollWidth > window.innerWidth + 1 };
    });
  } finally { await page.close().catch(() => {}); }
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')] });
  const unmeasured = (name, msg) => results.push({ name, unmeasured: true, details: [`⚪ ${msg}`] });
  const issued = [];   // { kind, id, convId, projId }
  let browser = null;
  let biz = null, origLogo;

  try {
    const me = await api('/api/auth/me');
    biz = me.body?.data?.active_business_id ?? me.body?.data?.user?.active_business_id ?? null;
    const convs = biz ? await sql(
      "SELECT id, project_id FROM conversations WHERE business_id=? AND channel_type='customer' AND project_id IS NOT NULL ORDER BY id DESC LIMIT 1",
      [biz]) : [];
    if (!convs.length) { unmeasured('게스트 링크 픽스처', '고객 대화방(프로젝트 연결)이 없어 링크를 못 만든다'); return results; }
    const conv = convs[0];

    // ── 발급 — 대화 링크 · 프로젝트 링크 (두 scope 가 같은 응답 모양이어야 한다)
    const links = {};
    for (const [kind, path] of [
      ['conversation', `/api/conversations/${biz}/${conv.id}/guest-links`],
      ['project', `/api/projects/${conv.project_id}/guest-links`],
    ]) {
      const r = await api(path, { method: 'POST', body: '{}' });
      const url = r.body?.data?.url;
      // ★ 발급은 멱등이다(2026-09-24 §B) — 이미 살아 있는 링크가 있으면 200 reused 로 **남의 링크**를 준다.
      //   그것은 읽기 검사에만 쓰고 **회수·삭제하지 않는다**(남이 보낸 주소가 죽는다). 내가 만든 것(201)만 치운다.
      if (!url || (r.status !== 201 && r.status !== 200)) { unmeasured(`${kind} 링크 발급`, `${r.status} ${r.body?.message || ''}`); continue; }
      if (r.status === 201) issued.push({ kind, id: r.body.data.id, convId: conv.id, projId: conv.project_id });
      links[kind] = url.split('/g/')[1];
    }
    if (!links.conversation) return results;

    // ── 서버 — 응답 모양
    for (const [kind, token] of Object.entries(links)) {
      const r = await fetch(`${API}/api/guest/${token}`);
      const raw = await r.text();
      let d = null; try { d = JSON.parse(raw).data; } catch { /* */ }
      if (r.status !== 200 || !d) { push(`[${kind}] 게스트 컨텍스트 200`, false, `${r.status}`); continue; }
      const wsKeys = Object.keys(d.workspace || {}).sort().join(',');
      push(`[${kind}] workspace 는 정확히 두 필드 (name, logo_url)`, wsKeys === 'logo_url,name', wsKeys || '없음');
      push(`[${kind}] 발신자 이름이 비어 있지 않다`, !!(d.workspace && d.workspace.name), JSON.stringify(d.workspace));
      push(`[${kind}] 로고는 우리 심볼 경로이거나 null`,
        d.workspace && (d.workspace.logo_url === null || SYMBOL.test(d.workspace.logo_url)), String(d.workspace && d.workspace.logo_url));
      const top = Object.keys(d).filter((k) => k !== 'workspace').sort();
      push(`[${kind}] 옛 top-level 키 무변경`, top.join(',') === OLD_KEYS.join(','), top.join(','));
      const hits = FORBIDDEN.filter((re) => re.test(raw)).map(String);
      push(`[${kind}] 응답 원문에 금지 문자열 0`, hits.length === 0, hits.length ? hits.join(' ') : `검사 ${FORBIDDEN.length}종 0건`);
    }

    // ── 서버 — 화이트리스트 양성 대조군: 외부 로고를 넣으면 null 이어야 한다
    const [row] = await sql('SELECT brand_logo_url FROM businesses WHERE id=?', [biz]);
    origLogo = row ? row.brand_logo_url : undefined;
    try {
      await sql('UPDATE businesses SET brand_logo_url=? WHERE id=?', ['https://evil.example/x.png', biz]);
      const r = await fetch(`${API}/api/guest/${links.conversation}`);
      const raw = await r.text();
      const ws = JSON.parse(raw).data?.workspace;
      push('외부 로고 주소는 내보내지 않는다 (null · 원문에도 없음)', ws && ws.logo_url === null && !raw.includes('evil.example'),
        JSON.stringify(ws));
    } finally {
      if (origLogo !== undefined) await sql('UPDATE businesses SET brand_logo_url=? WHERE id=?', [origLogo, biz]);
      const [back] = await sql('SELECT brand_logo_url FROM businesses WHERE id=?', [biz]);
      push('로고 원복', back && back.brand_logo_url === origLogo, String(back && back.brand_logo_url));
    }

    // ── 화면 — 3폭 × 두 scope
    ({ browser } = await launch());
    const BAND_MAX = 80;   // 제목+부제 두 줄 = 71~76 (2026-09-24 Fable 실측). 한 줄 더 쌓이면 걸린다.
    for (const [kind, token] of Object.entries(links)) {
      for (const vp of VIEWPORTS) {
        const m = await measure(browser, token, vp, false);
        const ok = m.mark && m.name && m.mark.hit && m.name.hit && m.mark.inView && m.name.inView
          && !m.hscroll && m.band !== null && m.band <= BAND_MAX;
        push(`[${kind}@${vp.w}] 로고·발신자 이름이 그려져 있다`, ok,
          `band=${m.band} mark=${m.mark ? `${m.mark.x},${m.mark.y} hit=${m.mark.hit}` : '없음'} ` +
          `name=${m.name ? `«${m.name.text}» hit=${m.name.hit}` : '없음'} hscroll=${m.hscroll}`);
      }
    }

    // ── 대조군 — workspace 를 지운 응답이면 **같은 판정이 빨간불**이어야 한다
    const ctl = await measure(browser, links.conversation, VIEWPORTS[0], true);
    const flipped = !ctl.mark && !ctl.name;
    push('대조군: workspace 없는 응답이면 판정이 뒤집힌다 (그리고 화면은 안 깨진다)', flipped && !ctl.hscroll,
      flipped ? '로고·이름 없음 — 검사기가 부재를 잡는다' : `mark=${!!ctl.mark} name=${!!ctl.name} — 검사기가 부재를 못 잡는다`);

    // ── 서버 — 회수하면 닫힌다
    for (const l of issued) {
      const path = l.kind === 'conversation'
        ? `/api/conversations/${biz}/${l.convId}/guest-links/${l.id}`
        : `/api/projects/${l.projId}/guest-links/${l.id}`;
      await api(path, { method: 'DELETE' });
    }
    for (const l of issued) {
      const r = await fetch(`${API}/api/guest/${links[l.kind]}`);
      push(`[${l.kind}] 회수 후 404`, r.status === 404, String(r.status));
    }
    for (const kind of Object.keys(links).filter((k) => !issued.some((l) => l.kind === k))) {
      results.push({ name: `[${kind}] 회수 후 404`, unmeasured: true, optional: true,
        details: ['⚪ 이미 살아 있던 링크를 재사용했다 — 남의 링크라 회수하지 않는다'] });
    }
    return results;
  } catch (e) {
    push('카나리 실행', false, e.message);
    return results;
  } finally {
    if (browser) await browser.close().catch(() => {});
    // 정리 — 링크 + 그림자 사용자(참여자 행 먼저). 그림자는 is_guest=1 이고 이 링크의 것만.
    try {
      if (issued.length) {
        const ids = issued.map((l) => l.id);
        const us = await sql('SELECT guest_user_id FROM guest_links WHERE id IN (?)', [ids]);
        const uids = us.map((u) => u.guest_user_id).filter(Boolean);
        await sql('DELETE FROM guest_links WHERE id IN (?)', [ids]);
        if (uids.length) {
          const talked = await sql('SELECT COUNT(*) n FROM messages WHERE sender_id IN (?)', [uids]);
          if (Number(talked[0].n) === 0) {
            await sql('DELETE FROM conversation_participants WHERE user_id IN (?)', [uids]);
            await sql('DELETE FROM users WHERE id IN (?) AND is_guest=1', [uids]);
          }
        }
        const left = await sql('SELECT COUNT(*) n FROM guest_links WHERE id IN (?)', [ids]);
        results.push({ name: 'cleanup:guest-links', fail: Number(left[0].n) ? 1 : 0, hasCanary: true,
          details: [`링크 ${ids.length} · 그림자 ${uids.length} 삭제 · 남음 ${left[0].n}`] });
      }
    } catch (e) {
      results.push({ name: 'cleanup:guest-links', fail: 1, details: [`🔴 정리 실패: ${e.message}`] });
    }
    // ★ 풀은 닫지 않는다 — 러너가 마지막에 한 번 닫는다.
  }
}

module.exports = { run };
