// canary-sale-intake — Q sales 상담 유입 모드 (#449·#450, 2026-10-02) · 설계 docs/SALES_INTAKE_DESIGN.md §6.4 P2
//
//   재는 것 (폰 390 · 태블릿 834 · 데스크탑 1440):
//     설정 › 권한 «상담 유입» 카드가 보이고, [자동] 을 누르면 PUT 이 **정확히 1건** 나가며 서버 값이 auto 가 된다
//     Q sales 상담 — 베타 안내 줄이 **보인다** · (수동) 자동 기준 안내 줄 숫자 = 서버 counts.auto_candidates
//                   · (자동) 메일 행에 이유 칩(「답장함 · …」/「개인 주소」)이 보인다
//     Q mail ?inquiry=1 — 「문의 후보만」 막대가 보이고 행마다 「문의 후보」 표시
//     폰 메일 상세 툴바 [상담으로 보내기] 가 보이고 눌린다(폰의 유일한 문 — D7)
//   대조군: 칩 판정은 자동 모드에서만 기대한다(수동이면 칩 대신 안내 줄) — 두 모드 판정이 뒤집혀야 의미가 있다.
//   ★ 설정은 원래 값으로 되돌린다.
const b = require('./lib/browser');
const jwt = require('/opt/planq/dev-backend/node_modules/jsonwebtoken');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const API = 'http://localhost:3003';
const sql = (s, r) => sequelize.query(s, { replacements: r }).then(([x]) => x);
const tok = (uid) => jwt.sign({ userId: uid, id: uid }, process.env.JWT_SECRET, { expiresIn: '10m' });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const VPS = [
  { key: '폰 390', vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, touch: true },
  { key: '태블릿 834', vp: { width: 834, height: 1112, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, touch: true },
  { key: '데스크탑 1440', vp: { width: 1440, height: 900 }, touch: false },
];

// 그 요소가 화면에 **보이는가**(크기 + 가운데 점이 그 요소)
const visible = (page, sel) => page.evaluate((s) => {
  const els = [...document.querySelectorAll(s)];
  for (const el of els) {
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom <= 0 || r.top >= innerHeight) continue;
    const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (h && (h === el || el.contains(h) || h.contains(el))) return { ok: true, text: el.textContent.trim().slice(0, 80), n: els.length };
  }
  return { ok: false, n: els.length };
}, sel);

async function run() {
  const results = [];
  const push = (name, ok, msg, extra = {}) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')], ...extra });
  const [owner] = await sql('SELECT id, active_business_id biz FROM users WHERE email=?', [b.CREDS.email]);
  const biz = owner.biz;
  const [bz] = await sql('SELECT permissions FROM businesses WHERE id=?', [biz]);
  const permBefore = bz.permissions;
  const setMode = (m) => fetch(`${API}/api/businesses/${biz}/sales-intake`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok(owner.id) }, body: JSON.stringify({ mail: m }) });
  const counts = async () => (await (await fetch(`${API}/api/sale/${biz}/inbox?hide_closed=false`, { headers: { Authorization: 'Bearer ' + tok(owner.id) } })).json()).data.counts;
  let browser = null;
  try {
    browser = (await b.launch()).browser;
    for (const v of VPS) {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      try {
        await page.setViewport(v.vp);
        if (v.touch) await page.setUserAgent(UA);
        await b.login(page);
        // ① 설정 카드 — 수동에서 시작해 [자동] 클릭 → PUT 1건
        await setMode('manual');
        await b.goto(page, '/business/settings/permissions');
        await b.dismissBlockers(page);
        await sleep(1500);
        const card = await visible(page, '[data-testid="sales-intake-card"]');
        push(`${v.key} · 설정 «상담 유입» 카드가 보인다`, card.ok, JSON.stringify(card));
        let puts = 0;
        const onReq = (r) => { if (r.method() === 'PUT' && r.url().includes('/sales-intake')) puts += 1; };
        page.on('request', onReq);
        await page.evaluate(() => document.querySelector('[data-testid="sales-intake-auto"]')?.click());
        await sleep(1500);
        page.off('request', onReq);
        const c1 = await counts();
        push(`${v.key} · [자동] 클릭 → PUT 정확히 1건 · 서버 auto`, puts === 1 && c1.intake_mode === 'auto', `PUT ${puts} · ${c1.intake_mode}`);
        // ② Q sales (자동) — 베타 안내 + 이유 칩
        await b.goto(page, '/sale');
        await b.dismissBlockers(page);
        await sleep(2000);
        const beta = await visible(page, '[data-testid="beta-notice"]');
        push(`${v.key} · Q sales 베타 안내 줄이 보인다`, beta.ok, JSON.stringify(beta));
        const why = await visible(page, '[data-testid^="sale-inbox-why-"]');
        push(`${v.key} · (자동) 메일 행 이유 칩이 보인다`, c1.email > 0 ? why.ok : true, c1.email > 0 ? JSON.stringify(why) : '상담 메일 0 — 대상 없음', c1.email > 0 ? {} : { unmeasured: true });
        const noteAuto = await page.evaluate(() => !!document.querySelector('[data-testid="sale-inbox-intake-note"]'));
        push(`${v.key} · (자동) 수동 안내 줄은 없다(대조군)`, !noteAuto, String(noteAuto));
        // ③ 수동으로 돌리고 안내 줄 숫자 = 서버
        await setMode('manual');
        await page.evaluate(() => { try { localStorage.removeItem(Object.keys(localStorage).find((k) => k.startsWith('pq:sale-intake-note:')) || '_'); } catch { /* */ } });
        await page.reload({ waitUntil: 'domcontentloaded' }); await sleep(2500); await b.dismissBlockers(page);
        const c2 = await counts();
        const note = await visible(page, '[data-testid="sale-inbox-intake-note"]');
        const num = note.ok ? Number((note.text.match(/\d+/) || [])[0]) : null;
        push(`${v.key} · (수동) 안내 줄이 보이고 숫자 = 서버 auto_candidates(${c2.auto_candidates})`, c2.auto_candidates > 0 ? (note.ok && num === c2.auto_candidates) : !note.ok, JSON.stringify(note));
        // ④ Q mail 문의 후보 필터
        await b.goto(page, '/mail?folder=all&inquiry=1');
        await b.dismissBlockers(page); await sleep(2500);
        const bar = await visible(page, '[data-testid="mail-inquiry-filter"]');
        const tag = await visible(page, '[data-testid="mail-inquiry-candidate"]');
        push(`${v.key} · Q mail 「문의 후보만」 막대 + 행 표시`, bar.ok && (c2.auto_candidates > 0 ? tag.ok : true), `bar ${bar.ok} · tag ${JSON.stringify(tag)}`);
        // ⑤ 폰 — 메일 상세 툴바 [상담으로 보내기] 가 보인다
        if (v.key === '폰 390') {
          const [th] = await sql("SELECT id FROM email_threads WHERE business_id=? AND client_id IS NULL AND status<>'spam' AND account_id IN (SELECT id FROM email_accounts WHERE business_id=?) ORDER BY id DESC LIMIT 1", [biz, biz]);
          await b.goto(page, `/mail?folder=all&thread=${th.id}`);
          await b.dismissBlockers(page); await sleep(2500);
          const btn = await visible(page, '[data-testid="mail-detail-promote-sale-inline"]');
          push('폰 390 · 메일 상세 [상담으로 보내기] 가 보인다(폰의 문)', btn.ok, JSON.stringify(btn));
        }
      } catch (e) {
        push(`${v.key} · 오류`, false, e.message.slice(0, 160));
      } finally { await page.close().catch(() => {}); await ctx.close().catch(() => {}); }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await sql('UPDATE businesses SET permissions=? WHERE id=?', [JSON.stringify(permBefore), biz]);
    await sql("DELETE FROM audit_logs WHERE business_id=? AND action='sales_intake.update' AND created_at > NOW() - INTERVAL 1 HOUR", [biz]);
    results.push({ name: 'cleanup: 설정 원복', fail: 0, details: ['permissions 원복'] });
  }
  return results;
}

module.exports = { name: 'Q sales 상담 유입 (#449·#450) — 설정·이유 칩·안내 줄·문의 후보·폰 문 3폭', run };
