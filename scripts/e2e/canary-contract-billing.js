#!/usr/bin/env node
// canary-contract-billing.js — 서명 완료 계약서 → 청구서 초안 «화면» 검사 (2026-10-23, docs/CONTRACT_AUTO_INVOICE_DESIGN.md)
//
// 재는 것(폰 390 · 태블릿 820 · 데스크탑 1440):
//   ① 조건 없는 문서 — «청구 조건» 칸과 [+ 청구 조건 적기] 가 **보인다**(elementFromPoint) · 눌러서 창이 뜬다(aria-modal) · 창 안 항목 표
//   ② 조건 있는 문서(서명 전) — 합계 금액이 보이고 [고치기] 가 있다
//   ③ 서명이 끝난 문서 — [청구서 열기] 가 보인다(자동 초안이 만들어졌다)
//   ④ 받는 쪽 서명 화면 — 청구 조건 상자와 합계가 보인다 · 메모는 안 보인다
//   ⑤ 청구서 발행 창(공용으로 뺀 항목 칸) — 항목 표가 그려지고, 단가를 치면 합계가 바뀐다
//   ⑥ 가로 넘침 0 (문서·서명 화면)
//   양성 대조군: ③ 은 조건 없는 문서(①)에서 [청구서 열기] 가 **없음**을 같이 본다.
//   ★ 2026-10-27(de11a753) 부터 빈 칸 안내 ①은 설정 «기능 사용» doc_billing_terms 를 켠 워크스페이스에서만 보인다(기본 끔) —
//     검사 동안 ws6 을 켜고 끝나면 원래 값으로 되돌린다. 대조: 끈 상태에서는 ① 버튼이 **없다**(데스크탑 1회).
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const crypto = require('crypto');
const b = require('./lib/browser');
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const BASE = process.env.E2E_BASE || 'https://dev.planq.kr';
const API = BASE + '/api';
const results = [];
const P = (name, ok, msg) => results.push({ name: `contractbilling:${name}`, fail: ok ? 0 : 1, details: [msg], hasCanary: true });
const sql = (s, r) => sequelize.query(s, { replacements: r }).then(([x]) => x);
const OTP = '482913';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const b64u = (x) => Buffer.from(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function devCode(as, next = '/') {
  const p = b64u(JSON.stringify({ as, scope: { ws: 6 }, exp: Date.now() + 90000, n: crypto.randomUUID(), next }));
  return `v1.${p}.${b64u(crypto.createHmac('sha256', process.env.DEV_LOGIN_SECRET).update(p).digest())}`;
}
async function api(path, opts = {}) {
  const r = await fetch(API + path, opts);
  let json = {}; try { json = JSON.parse(await r.text()); } catch { /* */ }
  return { status: r.status, json };
}
const VISIBLE = `(el) => {
  if (!el) return { found: false };
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  const hit = (r.width > 0 && r.height > 0) ? document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)) : null;
  return { found: true, w: Math.round(r.width), h: Math.round(r.height), text: (el.innerText || '').trim().slice(0, 120),
    mine: !!(hit && (hit === el || el.contains(hit) || hit.contains(el))) };
}`;
const OVERFLOW = `(() => { const se = document.scrollingElement; return Math.max(0, se.scrollWidth - window.innerWidth); })()`;
const TERMS = { client_id: 1, currency: 'KRW', vat_rate: 0.1, items: [{ description: '디자인 시스템', quantity: 2, unit_price: 1234567 }], installment_mode: 'split',
  installments: [{ label: '선금', percent: 30 }, { label: '잔금', percent: 70 }], notes: '카나리 내부 메모' };
// 2,469,134 + 246,913.4 → 246,913 = 2,716,047
const TOTAL_TEXT = '2,716,047';

async function run() {
  let H = null; let me = null;
  const ids = {};
  try {
    const lj = await api('/auth/dev-login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: devCode('owner') }) });
    H = { Authorization: `Bearer ${lj.json?.data?.token}`, 'Content-Type': 'application/json', 'X-Workspace-Id': '6' };
    me = lj.json?.data?.user?.id;
    const mk = async (title, them) => {
      const content = [{ type: 'paragraph', content: [{ type: 'text', text: '계약 본문' }] }, { type: 'signatureField', attrs: { slot: 1, party: 'us', label: null } }];
      if (them) content.push({ type: 'signatureField', attrs: { slot: 2, party: 'them', label: null } });
      return (await api('/posts', { method: 'POST', headers: H, body: JSON.stringify({ business_id: 6, project_id: 35, title, content_json: { type: 'doc', content }, kind: 'doc', status: 'published', category: 'contract' }) })).json?.data?.id;
    };
    const st = Date.now();
    ids.empty = await mk(`[카나리] 청구 조건 없음 ${st}`, false);
    ids.open = await mk(`[카나리] 청구 조건 서명 전 ${st}`, false);
    await api(`/posts/${ids.open}/billing-terms`, { method: 'PUT', headers: H, body: JSON.stringify(TERMS) });
    ids.done = await mk(`[카나리] 청구 조건 서명 완료 ${st}`, false);
    await api(`/posts/${ids.done}/billing-terms`, { method: 'PUT', headers: H, body: JSON.stringify(TERMS) });
    const sd = (await api(`/posts/${ids.done}/signatures`, { method: 'POST', headers: H, body: JSON.stringify({ signers: [{ slot: 1, party: 'us', user_id: me, email: '' }], kind: 'sign', expires_in_days: 3 }) })).json?.data?.signatures || [];
    await api(`/signatures/${sd[0]?.id}/sign-internal`, { method: 'POST', headers: H, body: JSON.stringify({ item_images: [{ mode: 'draw', b64: PNG }], consent: true }) });
    ids.sign = await mk(`[카나리] 청구 조건 서명 화면 ${st}`, true);
    await api(`/posts/${ids.sign}/billing-terms`, { method: 'PUT', headers: H, body: JSON.stringify(TERMS) });
    const ss = (await api(`/posts/${ids.sign}/signatures`, { method: 'POST', headers: H, body: JSON.stringify({ signers: [{ slot: 1, party: 'us', user_id: me, email: '' }, { slot: 2, party: 'them', email: 'canary-billing@example.com', name: '카나리 고객' }], kind: 'sign', expires_in_days: 3 }) })).json?.data?.signatures || [];
    const them = ss.find((s) => s.party === 'them');
    if (them) ids.token = (await sql('SELECT token FROM signature_requests WHERE id=?', [them.id]))[0]?.token;
  } catch (e) { P('픽스처', false, e.message); }
  await new Promise((r) => setTimeout(r, 2000));
  const inv = ids.done ? (await sql('SELECT invoice_id FROM post_billing_terms WHERE post_id=?', [ids.done]))[0]?.invoice_id : null;
  P('픽스처 — 서명 완료 문서에 초안', !!inv, `invoice ${inv}`);
  if (!ids.empty || !ids.open || !ids.done || !ids.token) {
    P('픽스처 (0건 = 판정 불가)', false, JSON.stringify(ids));
    return { name: 'contractbilling', results };
  }

  const prevMod = (await sql('SELECT modules FROM businesses WHERE id=6'))[0]?.modules;
  const prevOn = !!(prevMod && (typeof prevMod === 'string' ? JSON.parse(prevMod) : prevMod).doc_billing_terms === true);
  const setMod = async (on) => (await api('/businesses/6/modules', { method: 'PUT', headers: H, body: JSON.stringify({ doc_billing_terms: on }) })).status;
  const onSt = await setMod(true);
  P('픽스처 — 문서 청구 조건 안내 켬(ws6)', onSt === 200, `status ${onSt}`);

  const VPS = [['phone', { width: 390, height: 844, isMobile: true, hasTouch: true }], ['tablet', { width: 820, height: 1180 }], ['desktop', { width: 1440, height: 900 }]];
  for (const [label, vp] of VPS) {
    const { browser, page } = await b.launch({});
    try {
      await page.setViewport(vp);
      await page.goto(`${BASE}/dev-login#code=${devCode('owner', `/docs?post=${ids.empty}`)}`, { waitUntil: 'domcontentloaded' });
      await b.sleep(5000);
      await b.dismissBlockers?.(page).catch(() => {});
      if (!/post=/.test(page.url())) { await page.goto(`${BASE}/docs?post=${ids.empty}`, { waitUntil: 'domcontentloaded' }); await b.sleep(4000); }
      // ①
      let v = await page.evaluate(`(${VISIBLE})(document.querySelector('[data-testid="billing-terms-open"]'))`);
      P(`${label} ① 조건 없음 — [+ 청구 조건 적기] 보임`, v.found && v.mine, JSON.stringify(v));
      const noLink = await page.evaluate(`!document.querySelector('[data-testid="billing-terms-invoice-link"]')`);
      P(`${label} ③대조 — 조건 없는 문서엔 [청구서 열기] 없음`, noLink, String(noLink));
      P(`${label} ⑥ 문서 가로 넘침 0`, (await page.evaluate(OVERFLOW)) <= 1, `${await page.evaluate(OVERFLOW)}px`);
      if (v.found) {
        await page.click('[data-testid="billing-terms-open"]');
        await b.sleep(1500);
        const m = await page.evaluate(`(() => { const d = document.querySelector('[aria-modal="true"]'); if (!d) return { modal: false };
          const r = d.getBoundingClientRect(); return { modal: true, items: d.querySelectorAll('input').length, save: !!d.querySelector('[data-testid="billing-terms-save"]'),
          fits: r.left >= -1 && r.right <= window.innerWidth + 1, w: Math.round(r.width) }; })()`);
        P(`${label} ① 창 열림 — 항목 칸·저장 버튼·화면 안`, m.modal && m.items >= 3 && m.save && m.fits, JSON.stringify(m));
        // 저장 버튼을 고객 없이 누르면 막힌다(서버까지 가지 않음)
        await page.click('[data-testid="billing-terms-save"]').catch(() => {});
        await b.sleep(600);
        const errShown = await page.evaluate(`!!document.querySelector('[aria-modal="true"] [role="alert"]')`);
        P(`${label} ① 빈 칸 저장 → 안내`, errShown, String(errShown));
      }
      // ②
      await page.goto(`${BASE}/docs?post=${ids.open}`, { waitUntil: 'domcontentloaded' }); await b.sleep(4500);
      v = await page.evaluate(`(${VISIBLE})(document.querySelector('[data-testid="billing-terms-total"]'))`);
      P(`${label} ② 서명 전 — 합계 ${TOTAL_TEXT} 보임`, v.found && v.mine && v.text.includes(TOTAL_TEXT), JSON.stringify(v));
      const ed = await page.evaluate(`(${VISIBLE})(document.querySelector('[data-testid="billing-terms-edit"]'))`);
      P(`${label} ② [고치기] 보임`, ed.found && ed.mine, JSON.stringify(ed));
      // ③
      await page.goto(`${BASE}/docs?post=${ids.done}`, { waitUntil: 'domcontentloaded' }); await b.sleep(4500);
      v = await page.evaluate(`(${VISIBLE})(document.querySelector('[data-testid="billing-terms-invoice-link"]'))`);
      P(`${label} ③ 서명 완료 — [청구서 열기] 보임`, v.found && v.mine, JSON.stringify(v));
      // ④ 서명 화면(로그인 무관 공개)
      await page.goto(`${BASE}/sign/${ids.token}`, { waitUntil: 'domcontentloaded' }); await b.sleep(4000);
      v = await page.evaluate(`(${VISIBLE})(document.querySelector('[data-testid="sign-billing-terms"]'))`);
      const memo = await page.evaluate(`document.body.innerText.includes('카나리 내부 메모')`);
      P(`${label} ④ 서명 화면 — 청구 조건·합계 보임 · 메모 없음`, v.found && v.mine && v.text.length > 0 && (await page.evaluate(`document.querySelector('[data-testid="sign-billing-terms"]')?.innerText.includes('${TOTAL_TEXT}')`)) && !memo, JSON.stringify(v) + ` memo=${memo}`);
      P(`${label} ⑥ 서명 화면 가로 넘침 0`, (await page.evaluate(OVERFLOW)) <= 1, `${await page.evaluate(OVERFLOW)}px`);
      // ⑤ 청구서 발행 창 — 데스크탑만(공용 칸 회귀)
      if (label === 'desktop') {
        await page.goto(`${BASE}/bills?tab=invoices&new=1`, { waitUntil: 'domcontentloaded' }); await b.sleep(5000);
        const before = await page.evaluate(`(() => { const d = document.querySelector('[aria-modal="true"]') || document; return (d.innerText.match(/(?:총액|합계)[^\\n]*\\n?[^\\n]*/) || [''])[0]; })()`);
        const priceSel = 'input[type="number"][min="0"]';
        const has = await page.$(priceSel);
        if (has) { await has.click({ clickCount: 3 }); await page.keyboard.type('12345'); await b.sleep(500); }
        const after = await page.evaluate(`(() => { const d = document.querySelector('[aria-modal="true"]') || document; return (d.innerText.match(/(?:총액|합계)[^\\n]*\\n?[^\\n]*/) || [''])[0]; })()`);
        P('desktop ⑤ 발행 창 항목 칸 — 단가 입력 → 합계 바뀜(13,580원)', !!has && after.includes('13,580'), `before="${before}" after="${after}"`);
      }
    } catch (e) {
      P(`${label} 실행`, false, e.message);
    } finally { await browser.close().catch(() => {}); }
  }
  const offSt = await setMod(prevOn);
  P('정리 — 문서 청구 조건 안내 원래 값으로', offSt === 200, `status ${offSt} → ${prevOn}`);
  if (!prevOn) {
    const { browser, page } = await b.launch({});
    try {
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(`${BASE}/dev-login#code=${devCode('owner', `/docs?post=${ids.empty}`)}`, { waitUntil: 'domcontentloaded' });
      await b.sleep(5000);
      if (!/post=/.test(page.url())) { await page.goto(`${BASE}/docs?post=${ids.empty}`, { waitUntil: 'domcontentloaded' }); await b.sleep(4000); }
      const shown = await page.evaluate(`!!document.querySelector('[data-testid="billing-terms-open"]')`);
      const loaded = await page.evaluate(`document.body.innerText.includes('계약 본문')`);
      P('desktop ①대조 — 끈 워크스페이스는 [+ 청구 조건 적기] 없음', loaded && !shown, `loaded=${loaded} shown=${shown}`);
    } catch (e) { P('desktop ①대조 실행', false, e.message); } finally { await browser.close().catch(() => {}); }
  }
  return { name: 'contractbilling', results };
}

// 러너(run.js)는 결과 배열을 기대한다 — 형제 카나리(canary-signature-field)와 같은 모양으로 푼다
module.exports = { run: async () => (await run()).results, name: 'contractbilling' };
if (require.main === module) {
  run().then((r) => {
    let f = 0;
    for (const x of r.results) { if (x.fail) f += 1; console.log(`${x.fail ? '❌' : '✅'} ${x.name} — ${x.details[0]}`); }
    console.log(`\n${r.results.length - f} 통과 / ${f} 실패`);
    sequelize.close().finally(() => process.exit(f ? 1 : 0));
  });
}
