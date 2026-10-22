// 휴가 종류 설정 (2026-10-22) — docs/LEAVE_TYPES_DESIGN.md §9.2
//   ① 설정 › 근태 관리에서 «휴가 설정» 이 맨 위(휴일 섹션보다 위)이고 실제로 그려지는가 — 3폭
//   ② 이름 입력 → 2초 뒤 PATCH 가 **정확히 1건** · 비우면 기본 이름으로 돌아온다
//   ③ 신청 드로어에 유급/무급 고르는 칸이 없고(읽기 전용 칩) 종류 옵션 수 == 활성 종류 수
//   ④ 연간 부여 폼에서 종류의 «연간 기본 일수» 가 일수 칸에 채워진다
//   ⑤ 폰 390 가로 넘침 0
//   ⑥ 휴가 현황 표 3폭 · 줄을 누르면 부여 이력 · 일수 고치기 PATCH 정확히 1건  ⑦ 내 휴가 카드에 종류별 줄
//   양성 대조군: 섹션 순서를 화면에서 뒤집으면 ① 판정이 뒤집히는가(뒤집히지 않으면 판정기가 거짓이다).
const { launch, login, BASE } = require('./lib/browser');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiToken(page) {
  return page.evaluate(async () => {
    const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    const j = await r.json().catch(() => null);
    return (j && j.data && (j.data.token || j.data.accessToken)) || null;
  });
}
async function call(page, tok, method, path, body) {
  return page.evaluate(async (m, p, b, t) => {
    const r = await fetch(p, { method: m, credentials: 'include', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, j: await r.json().catch(() => null) };
  }, method, path, body || null, tok);
}
async function waitFor(page, sel, ms = 10000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const ok = await page.evaluate((s) => [...document.querySelectorAll(s)].some((el) => el.getBoundingClientRect().height > 1), sel).catch(() => false);
    if (ok) return true;
    await sleep(250);
  }
  return false;
}
// 보이는 사본만 — keep-alive 탭에 숨은 사본이 남을 수 있다
const ORDER_JUDGE = () => {
  const vis = (s) => [...document.querySelectorAll(s)].find((el) => el.getBoundingClientRect().height > 1);
  const lt = vis('[data-testid="leave-types-section"]');
  const hol = vis('[data-testid="holiday-section"]');
  if (!lt || !hol) return { ok: false, why: `섹션 없음 lt=${!!lt} hol=${!!hol}` };
  const a = lt.getBoundingClientRect(); const b = hol.getBoundingClientRect();
  lt.scrollIntoView({ block: 'center' });
  const r = lt.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + Math.min(40, r.width / 2), r.top + Math.min(20, r.height / 2));
  const painted = !!hit && lt.contains(hit);
  return { ok: a.top < b.top && a.height > 1 && painted, why: `lt.top=${Math.round(a.top)} hol.top=${Math.round(b.top)} h=${Math.round(a.height)} painted=${painted}` };
};

async function run() {
  const results = [];
  const add = (name, fail, msg) => results.push({ name, fail: fail ? 1 : 0, details: [msg], hasCanary: true });
  const { browser, page } = await launch();
  let restore = null;
  try {
    await login(page);
    const tok = await apiToken(page);
    const biz = await page.evaluate(async (t) => {
      const me = await (await fetch('/api/auth/me', { credentials: 'include', headers: { Authorization: `Bearer ${t}` } })).json();
      return me?.data?.business_id || null;
    }, tok);
    if (!biz) { add('leavetypes:측정', 1, '🔴 활성 워크스페이스를 못 읽었다 — 미측정'); return { results }; }
    const list = await call(page, tok, 'GET', `/api/businesses/${biz}/leave-types?include_inactive=1`);
    const types = list.j?.data?.types || [];
    if (!types.length || !list.j?.data?.can_edit) { add('leavetypes:측정', 1, `🔴 종류 목록/편집권 없음 status=${list.status} — 미측정`); return { results }; }
    const annual = types.find((x) => x.code === 'annual');
    // 픽스처: 연차 기본 일수 15 — 끝나면 원래 값으로
    restore = { id: annual.id, name: annual.name, default_days: annual.default_days };
    await call(page, tok, 'PATCH', `/api/businesses/${biz}/leave-types/${annual.id}`, { default_days: 15 });

    // ① 3폭 — 맨 위 · 그려짐 / ⑤ 폰 가로 넘침
    for (const [w, h] of [[1440, 900], [900, 1000], [390, 844]]) {
      await page.setViewport({ width: w, height: h });
      await page.goto(`${BASE}/business/settings/attendance`, { waitUntil: 'networkidle2' }).catch(() => {});
      const got = await waitFor(page, '[data-testid="leave-types-section"]');
      const o = got ? await page.evaluate(ORDER_JUDGE) : { ok: false, why: '섹션이 안 그려짐' };
      add(`leavetypes:맨위@${w}`, !o.ok, `${o.ok ? '✅' : '🔴'} ${o.why}`);
      if (w === 390) {
        const over = await page.evaluate(() => {
          const s = [...document.querySelectorAll('[data-testid="leave-types-section"]')].find((el) => el.getBoundingClientRect().height > 1);
          return { doc: document.documentElement.scrollWidth - innerWidth, sec: s ? Math.round(s.scrollWidth - s.clientWidth) : -1 };
        });
        add('leavetypes:폰가로넘침', over.doc > 0 || over.sec > 0, `${over.doc > 0 || over.sec > 0 ? '🔴' : '✅'} 문서 ${over.doc}px · 섹션 ${over.sec}px`);
      }
      if (w === 1440) {
        // 양성 대조군 — 휴일 섹션을 앞으로 옮기면 판정이 실패로 뒤집혀야 한다
        const flipped = await page.evaluate((judgeSrc) => {
          const vis = (s) => [...document.querySelectorAll(s)].find((el) => el.getBoundingClientRect().height > 1);
          const lt = vis('[data-testid="leave-types-section"]'); const hol = vis('[data-testid="holiday-section"]');
          if (!lt || !hol) return null;
          lt.parentNode.insertBefore(hol, lt);
          // eslint-disable-next-line no-new-func
          const res = new Function(`return (${judgeSrc})()`)();
          hol.parentNode.insertBefore(lt, hol);
          return res.ok;
        }, ORDER_JUDGE.toString());
        add('leavetypes:대조군(순서)', flipped !== false, `${flipped === false ? '✅ 순서를 뒤집으면 판정 실패' : '🔴 순서를 뒤집어도 판정이 안 뒤집힘 — 판정기 거짓'}`);
      }
    }

    // ② 이름 입력 → PATCH 정확히 1건, 비우면 기본 이름
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${BASE}/business/settings/attendance`, { waitUntil: 'networkidle2' }).catch(() => {});
    await waitFor(page, `[data-testid="leave-type-name-${annual.id}"]`);
    const patches = [];
    const onReq = (r) => { if (r.method() === 'PATCH' && r.url().includes(`/leave-types/${annual.id}`)) patches.push(r.postData()); };
    page.on('request', onReq);
    const sel = `[data-testid="leave-type-name-${annual.id}"]`;
    await page.evaluate((s) => { const el = [...document.querySelectorAll(s)].find((x) => x.getBoundingClientRect().height > 1); el.scrollIntoView({ block: 'center' }); }, sel);
    await page.click(sel, { clickCount: 3 });
    await page.keyboard.type('[확인용] 연차');
    await sleep(3200);
    const after1 = await call(page, tok, 'GET', `/api/businesses/${biz}/leave-types`);
    const nm = after1.j?.data?.types?.find((x) => x.id === annual.id)?.name;
    add('leavetypes:이름저장', patches.length !== 1 || nm !== '[확인용] 연차', `${patches.length === 1 && nm === '[확인용] 연차' ? '✅' : '🔴'} PATCH ${patches.length}건 · 저장값 ${nm}`);
    patches.length = 0;
    await page.click(sel, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await sleep(3200);
    const after2 = await call(page, tok, 'GET', `/api/businesses/${biz}/leave-types`);
    const nm2 = after2.j?.data?.types?.find((x) => x.id === annual.id)?.name;
    const ph = await page.evaluate((s) => [...document.querySelectorAll(s)].find((x) => x.getBoundingClientRect().height > 1)?.placeholder, sel);
    add('leavetypes:이름비우기', nm2 !== null || !ph, `${nm2 === null && ph ? '✅' : '🔴'} PATCH ${patches.length}건 · 저장값 ${nm2} · 자리글자 «${ph}»`);
    page.off('request', onReq);

    // ④ 부여 폼 — 기본 일수가 채워지는가 (첫 유급 종류 = 연차)
    const days = await page.evaluate(() => [...document.querySelectorAll('[data-testid="leave-grant-days"]')].find((x) => x.getBoundingClientRect().height > 1)?.value);
    add('leavetypes:부여기본일수', days !== '15', `${days === '15' ? '✅' : '🔴'} 일수 칸 «${days}» (기대 15)`);

    // ⑥ 휴가 현황 표(멤버 × 종류) · 줄을 누르면 부여 이력 · 일수 고치기 PATCH 1건 — 3폭
    const me = await page.evaluate(async (t) => (await (await fetch('/api/auth/me', { credentials: 'include', headers: { Authorization: `Bearer ${t}` } })).json())?.data?.id, tok);
    const gr = await call(page, tok, 'POST', '/api/leave/grants', { business_id: biz, user_id: me, year: new Date().getFullYear(), days: 2, leave_type_id: annual.id, note: '[확인용] 카나리' });
    const gid = gr.j?.data?.id;
    restore.grant = gid;
    for (const [w, h] of [[1440, 900], [900, 1000], [390, 844]]) {
      await page.setViewport({ width: w, height: h });
      await page.goto(`${BASE}/business/settings/attendance`, { waitUntil: 'networkidle2' }).catch(() => {});
      const shown = await waitFor(page, `[data-testid="leave-balance-row-${me}"]`);
      add(`leavetypes:현황표@${w}`, !shown, `${shown ? '✅' : '🔴'} 내 줄이 그려짐 ${shown}`);
      if (!shown) continue;
      await page.evaluate((id) => { const el = [...document.querySelectorAll(`[data-testid="leave-balance-row-${id}"]`)].find((x) => x.getBoundingClientRect().height > 1); el.scrollIntoView({ block: 'center' }); el.click(); }, me);
      const hist = await waitFor(page, `[data-testid="leave-grant-${gid}"]`);
      add(`leavetypes:부여이력@${w}`, !hist, `${hist ? '✅' : '🔴'} 줄을 누르면 부여 이력(이번 부여 ${gid})`);
      if (w === 390) {
        const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        add('leavetypes:현황폰넘침', over > 0, `${over > 0 ? '🔴' : '✅'} 문서 가로 ${over}px`);
      }
      if (w === 1440 && hist) {
        const pt = [];
        const onR = (r) => { if (r.method() === 'PATCH' && r.url().includes(`/api/leave/grants/${gid}`)) pt.push(1); };
        page.on('request', onR);
        const s2 = `[data-testid="leave-grant-days-${gid}"]`;
        await page.click(s2, { clickCount: 3 });
        await page.keyboard.type('3');
        await sleep(3200);
        page.off('request', onR);
        const g2 = await call(page, tok, 'GET', `/api/leave/grants?business_id=${biz}&user_id=${me}`);
        const d = g2.j?.data?.find((x) => x.id === gid)?.days;
        add('leavetypes:부여수정', pt.length !== 1 || d !== 3, `${pt.length === 1 && d === 3 ? '✅' : '🔴'} PATCH ${pt.length}건 · 저장값 ${d}`);
      }
    }
    // ⑦ 내 휴가 카드 — 종류별 줄
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${BASE}/attendance?tab=leave`, { waitUntil: 'networkidle2' }).catch(() => {});
    const byT = await waitFor(page, '[data-testid="leave-by-type"]');
    const txt = byT ? await page.evaluate(() => [...document.querySelectorAll('[data-testid="leave-by-type"]')].find((x) => x.getBoundingClientRect().height > 1)?.innerText || '') : '';
    add('leavetypes:내종류별', !byT || !/연차|Annual/.test(txt), `${byT && /연차|Annual/.test(txt) ? '✅' : '🔴'} «${txt.replace(/\n/g, ' / ').slice(0, 80)}»`);

    // ③ 신청 드로어
    const active = (await call(page, tok, 'GET', `/api/businesses/${biz}/leave-types`)).j?.data?.types || [];
    await page.goto(`${BASE}/attendance?tab=leave`, { waitUntil: 'networkidle2' }).catch(() => {});
    await waitFor(page, '[data-testid="leave-new"]');
    await page.evaluate(() => [...document.querySelectorAll('[data-testid="leave-new"]')].find((x) => x.getBoundingClientRect().height > 1)?.click());
    const chip = await waitFor(page, '[data-testid="leave-pay-chip"]');
    const dr = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[aria-modal="true"]')].find((x) => x.getBoundingClientRect().height > 1);
      if (!d) return null;
      const labels = [...d.querySelectorAll('label')].map((l) => l.textContent.trim());
      return { labels };
    });
    const hasPaySelect = !!dr && dr.labels.some((l) => l === '유형' || l === 'Type');
    add('leavetypes:드로어', !chip || hasPaySelect, `${chip && !hasPaySelect ? '✅' : '🔴'} 칩 ${chip} · 유급/무급 칸 ${hasPaySelect} · 라벨 ${JSON.stringify(dr?.labels || [])}`);
    // 종류 옵션 수 — 셀렉트를 열어 센다
    const opts = await page.evaluate(async () => {
      const d = [...document.querySelectorAll('[aria-modal="true"]')].find((x) => x.getBoundingClientRect().height > 1);
      const ctl = d && d.querySelector('[class*="control"]');
      if (!ctl) return -1;
      ctl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
      return document.querySelectorAll('[class*="option"]').length;
    });
    add('leavetypes:종류옵션수', opts !== active.length, `${opts === active.length ? '✅' : '🔴'} 옵션 ${opts} · 활성 종류 ${active.length}`);
  } catch (e) {
    add('leavetypes:실행', 1, `🔴 ${e.message}`);
  } finally {
    if (restore) {
      try {
        const tok = await apiToken(page);
        const biz = await page.evaluate(async (t) => (await (await fetch('/api/auth/me', { credentials: 'include', headers: { Authorization: `Bearer ${t}` } })).json())?.data?.business_id, tok);
        await call(page, tok, 'PATCH', `/api/businesses/${biz}/leave-types/${restore.id}`, { name: restore.name || '', default_days: restore.default_days });
        if (restore.grant) await call(page, tok, 'DELETE', `/api/leave/grants/${restore.grant}`);
      } catch (e) { /* 원복 실패는 다음 실행이 덮는다 */ }
    }
    await browser.close();
  }
  return { results };
}

module.exports = { run: async () => (await run()).results, name: 'leavetypes' };

if (require.main === module) {
  run().then((r) => {
    let fail = 0;
    for (const x of r.results) { console.log(`${x.fail ? '❌' : '✅'} ${x.name} — ${x.details[0]}`); fail += x.fail; }
    console.log(`\n검사 ${r.results.length}개 · 실패 ${fail}`);
    process.exit(fail ? 1 : 0);
  });
}
