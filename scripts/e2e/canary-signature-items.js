#!/usr/bin/env node
// canary-signature-items.js — 서명 항목(2026-10-05, docs/SIGNATURE_ITEMS_DESIGN.md §9)을 **사용자 화면으로** 잰다
//
// Irene: *"UI UX에서 바로 알아야 하는 거야"* · *"사인이랑 회사스탬프 둘다 들어가야 하면?"*
//   ① 서명 요청 1단계 — 손으로 적은 «서명: ____ / 회사 스탬프: / 서명일:» 을 찾아 [바꾸기] → 서명자가 생긴다
//   ② 서명 자리가 없는 문서 — 보낼 수 없다고 말하고 [다음] 이 잠긴다(음성 대조군)
//   ③ 받는 사람 화면 — 서명 칸 2개(사인 + 스탬프) · 하나는 그리기 · 하나는 이미지 올리기 · 둘 다 채워야 제출이 열린다
// 각 판정은 폰 375 · 태블릿 820 · 데스크탑 1440 에서 «보이는가» 까지 잰다.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const b = require('./lib/browser');

const API = (process.env.E2E_BASE || 'https://dev.planq.kr') + '/api';
const OTP = '864201';
const results = [];
const P = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg], hasCanary: true });
const WIDTHS = [{ w: 375, h: 760, m: true }, { w: 820, h: 1100, m: false }, { w: 1440, h: 900, m: false }];
// 스탬프처럼 생긴 120×60 PNG(빨간 사각) — 1×1 이면 미리보기가 1px 이라 «보이는가» 를 못 잰다
function stampPng(w = 120, h = 60) {
  const zlib = require('zlib');
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = y * (w * 4 + 1) + 1 + x * 4; const edge = x < 4 || y < 4 || x >= w - 4 || y >= h - 4;
    raw[o] = 220; raw[o + 1] = 38; raw[o + 2] = 38; raw[o + 3] = edge ? 255 : 40;
  }
  const crc = (buf) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    let r = 0xffffffff; for (const v of buf) r = t[(r ^ v) & 0xff] ^ (r >>> 8); return (r ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PNG = stampPng();

async function api(p, o = {}) { const r = await fetch(API + p, o); let j = {}; try { j = JSON.parse(await r.text()); } catch { /* */ } return { status: r.status, json: j }; }
let sequelize = null;
const db = () => { if (!sequelize) ({ sequelize } = require('/opt/planq/dev-backend/config/database')); return sequelize; };

const VISIBLE = `(el) => {
  if (!el) return { found: false };
  el.scrollIntoView({ block: 'center' });
  const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  const hit = (r.width > 0 && r.height > 0) ? document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)) : null;
  return { found: true, w: Math.round(r.width), h: Math.round(r.height),
    painted: r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none',
    mine: !!(hit && (hit === el || el.contains(hit) || hit.contains(el))),
    overflowX: document.documentElement.scrollWidth - window.innerWidth };
}`;

async function draw(page, sel) {
  const box = await page.evaluate(`(() => { const c = document.querySelector(${JSON.stringify(sel)}); if (!c) return null;
    c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.left + 20, y: r.top + r.height / 2, w: r.width }; })()`);
  if (!box) return false;
  await page.mouse.move(box.x, box.y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + i * (box.w / 12), box.y + (i % 2 ? -20 : 20));
  await page.mouse.up(); await b.sleep(300);
  return true;
}

async function run() {
  const para = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
  let H = null, bizId = null, meId = null;
  const made = [];
  try {
    const lj = await api('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: b.CREDS.email, password: b.CREDS.password }) });
    H = { Authorization: `Bearer ${lj.json.data.token}`, 'Content-Type': 'application/json' };
    bizId = (await api('/businesses', { headers: H })).json?.data?.[0]?.id;
    meId = (await api('/auth/me', { headers: H })).json?.data?.id;
  } catch { /* 아래 */ }
  if (!H || !bizId) { P('픽스처 — 로그인 (판정 불가)', false, '로그인 못 함 — 통과로 세지 않는다'); return { name: 'signitems', results }; }
  const mk = async (title, content) => {
    const r = await api('/posts', { method: 'POST', headers: H, body: JSON.stringify({ business_id: bizId, title, content_json: { type: 'doc', content }, kind: 'doc', status: 'published', visibility: 'public', category: 'contract' }) });
    if (r.json?.data?.id) made.push(r.json.data.id);
    return r.json?.data?.id;
  };
  // 운영 문서 77 과 같은 모양 — 서명자별로 «서명: ____» · «회사 스탬프:» · «서명일:»
  const manual = () => [para('제1조 목적'), para('본 계약은 …'), para('가맹본부'), para('대표: 김미정'),
    para('서명: ________'), para('회사 스탬프:'), para('서명일: ____년 __월 __일'),
    para('가맹점'), para('대표: 홍길동'), para('서명: ________'), para('회사 스탬프:'), para('서명일: ____년 __월 __일')];

  const { browser, page } = await b.launch({});
  let guest = null;
  try {
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await b.login(page);
    for (const W of WIDTHS) {
      await page.setViewport({ width: W.w, height: W.h, isMobile: W.m, hasTouch: W.m, deviceScaleFactor: W.m ? 2 : 1 });
      const tag = `${W.w}`;
      // ── ① 손으로 적은 자리 → [바꾸기] ──
      const pid = await mk(`[카나리] 서명 항목 ${tag}`, manual());
      await b.goto(page, `/docs?post=${pid}`); await b.sleep(2500); await b.dismissBlockers(page).catch(() => {});
      await page.click('[data-testid="post-sign"]').catch(() => {});
      await b.sleep(1500);
      const f1 = await page.evaluate(`(() => {
        const box = document.querySelector('[data-testid="sign-spots-found"]');
        const btn = document.querySelector('[data-testid="sign-spots-convert"]');
        const next = document.querySelector('[data-testid="sign-step-next"]');
        return { box: (${VISIBLE})(box), btn: (${VISIBLE})(btn), text: box ? box.innerText.replace(/\\s+/g, ' ').slice(0, 90) : null, nextDisabled: !!next?.disabled };
      })()`);
      P(`[${tag}] ① 손으로 적은 서명 자리를 찾아 보여준다 · [다음] 은 잠김`,
        f1.box.painted && f1.btn.painted && f1.btn.mine && f1.nextDisabled && f1.box.overflowX <= 0,
        f1.box.found ? `"${f1.text}" · 버튼 ${f1.btn.w}×${f1.btn.h} 눌림=${f1.btn.mine} · 다음 잠김=${f1.nextDisabled} · 가로넘침 ${f1.box.overflowX}px` : '🔴 찾은 자리 상자가 없다');
      await page.click('[data-testid="sign-spots-convert"]').catch(() => {});
      await b.sleep(1800);
      const f2 = await page.evaluate(`(() => ({
        spots: [...document.querySelectorAll('[data-testid^="sign-spot-"]')].filter((e) => /^sign-spot-\\d+$/.test(e.getAttribute('data-testid'))).map((e) => e.innerText.replace(/\\s+/g, ' ').slice(0, 60)),
        nextDisabled: !!document.querySelector('[data-testid="sign-step-next"]')?.disabled,
      }))()`);
      const saved = await api(`/posts/${pid}`, { headers: H });
      const nodes = JSON.stringify(saved.json?.data?.content_json || '').match(/signatureField/g) || [];
      P(`[${tag}] ① [바꾸기] → 서명자 2명(서명 2칸·서명일) · 문서에 저장 · [다음] 열림`,
        f2.spots.length === 2 && f2.spots.every((s) => /서명 2/.test(s) && /서명일/.test(s)) && nodes.length === 6 && !f2.nextDisabled,
        `서명자 ${f2.spots.length} ${JSON.stringify(f2.spots)} · 저장된 서명 항목 ${nodes.length}개 · 다음 잠김=${f2.nextDisabled}`);
      await page.keyboard.press('Escape').catch(() => {}); await b.sleep(400);

      // ── ② 서명 자리 없는 문서 (음성 대조군) ──
      const pe = await mk(`[카나리] 서명 자리 없음 ${tag}`, [para('그냥 본문')]);
      await b.goto(page, `/docs?post=${pe}`); await b.sleep(2500); await b.dismissBlockers(page).catch(() => {});
      await page.click('[data-testid="post-sign"]').catch(() => {});
      await b.sleep(1500);
      const e1 = await page.evaluate(`(() => {
        const box = document.querySelector('[data-testid="sign-spots-empty"]');
        return { box: (${VISIBLE})(box), add: (${VISIBLE})(document.querySelector('[data-testid="sign-spots-add-end"]')),
          nextDisabled: !!document.querySelector('[data-testid="sign-step-next"]')?.disabled };
      })()`);
      P(`[${tag}] ② 서명 자리 없는 문서 — «보낼 수 없다» 안내 + [문서 끝에 추가] · [다음] 잠김`,
        e1.box.painted && e1.add.painted && e1.add.mine && e1.nextDisabled,
        `안내 ${e1.box.painted} · 추가 버튼 ${e1.add.w}×${e1.add.h} 눌림=${e1.add.mine} · 다음 잠김=${e1.nextDisabled}`);
      await page.keyboard.press('Escape').catch(() => {}); await b.sleep(400);
    }

    // ── ③ 받는 사람: 서명 칸 2개(사인 + 스탬프) — 그리기 + 이미지 ──
    const F = (slot, party, item) => ({ type: 'signatureField', attrs: { slot, party, label: null, item } });
    const ps = await mk('[카나리] 서명 칸 2개', [para('본문'), F(1, 'us', 'sign'), F(1, 'us', 'date'), F(2, 'them', 'sign'), F(2, 'them', 'sign'), F(2, 'them', 'date'), F(2, 'them', 'name')]);
    const sr = await api(`/posts/${ps}/signatures`, { method: 'POST', headers: H, body: JSON.stringify({
      signers: [{ slot: 1, party: 'us', user_id: meId, email: '' }, { slot: 2, party: 'them', email: 'canary-items@example.com', name: '스탬프 고객' }],
      kind: 'sign', send_chat: false, expires_in_days: 3 }) });
    const them = (sr.json?.data?.signatures || []).find((s) => s.party === 'them');
    if (!them) { P('③ 픽스처 — 서명 칸 2개 요청 (판정 불가)', false, `요청 실패 ${sr.status} ${sr.json?.message}`); }
    else {
      await db().query(`UPDATE signature_requests SET otp_code_hash='${crypto.createHash('sha256').update(OTP).digest('hex')}', otp_expires_at=DATE_ADD(NOW(), INTERVAL 5 MINUTE), otp_attempts=0, otp_locked_until=NULL, otp_verified_at=NOW() WHERE id=${them.id}`);
      const pngPath = path.join(require('os').tmpdir(), `canary-stamp-${process.pid}.png`);
      fs.writeFileSync(pngPath, PNG);
      for (const W of WIDTHS) {
        guest = await b.launch({});
        const gp = guest.page;
        await gp.setViewport({ width: W.w, height: W.h, isMobile: W.m, hasTouch: W.m, deviceScaleFactor: W.m ? 2 : 1 });
        await gp.goto(`${b.BASE}/sign/${them.token}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await b.sleep(3000);
        const s0 = await gp.evaluate(`(() => ({
          items: document.querySelectorAll('[data-testid^="sign-item-"][data-testid$="-draw"]').length,
          imageTab: (${VISIBLE})(document.querySelector('[data-testid="sign-item-1-image"]')),
          submitDisabled: !!document.querySelector('[data-testid="sign-submit"]')?.disabled,
        }))()`);
        await draw(gp, '[data-testid="sign-item-0"] canvas');
        await gp.click('#consent').catch(() => {});
        await b.sleep(300);
        const halfDisabled = await gp.evaluate(`!!document.querySelector('[data-testid="sign-submit"]')?.disabled`);
        await gp.click('[data-testid="sign-item-1-image"]').catch(() => {});
        await b.sleep(300);
        const input = await gp.$('[data-testid="sign-item-1-file"]');
        if (input) await input.uploadFile(pngPath);
        await b.sleep(1200);
        const s1 = await gp.evaluate(`(() => ({
          preview: (${VISIBLE})(document.querySelector('[data-testid="sign-item-1"] img')),
          submitDisabled: !!document.querySelector('[data-testid="sign-submit"]')?.disabled,
        }))()`);
        P(`[${W.w}] ③ 서명 칸 2개 — 칸마다 [그리기|이미지] · 하나만 채우면 제출 잠김 · 둘 다 채우면 열림`,
          s0.items === 2 && s0.imageTab.painted && s0.imageTab.mine && s0.submitDisabled && halfDisabled && s1.preview.painted && !s1.submitDisabled && s1.preview.overflowX <= 0,
          `칸 ${s0.items} · 이미지 탭 ${s0.imageTab.w}×${s0.imageTab.h} 눌림=${s0.imageTab.mine} · 처음 잠김=${s0.submitDisabled} · 하나만=${halfDisabled ? '잠김' : '🔴열림'} · 이미지 미리보기 ${s1.preview.painted} · 둘 다=${s1.submitDisabled ? '🔴잠김' : '열림'} · 가로넘침 ${s1.preview.overflowX}px`);
        if (W.w === 1440) {
          await gp.click('[data-testid="sign-submit"]').catch(() => {});
          await b.sleep(3000);
          const sh = await api(`/posts/${ps}/signed-html`, { headers: H });
          const html = sh.json?.data?.html || '';
          // 받는 쪽 칸(data-party="them")부터 다음 칸 전까지의 이미지 수
          const imgs = html.split('data-party="them"').slice(1).map((seg) => seg.split('data-party=')[0]).join('').match(/<img/g) || [];
          const [[row]] = await db().query(`SELECT status, JSON_LENGTH(item_images) n FROM signature_requests WHERE id=${them.id}`);
          P('③ 제출 → 원장에 서명 2장(그리기·이미지) · 서명본 받는 쪽 칸에 이미지 2장 · 이름·서명일 자리 채움',
            row.status === 'signed' && Number(row.n) === 2 && imgs.length === 2 && /pq-sig-item[^"]*name[^"]*pq-sig-filled|pq-sig-filled[^"]*name/.test(html),
            `status=${row.status} · item_images ${row.n} · 받는 쪽 이미지 ${imgs.length} · 이름 채움=${/스탬프 고객/.test(html)}`);
        }
        await guest.browser.close().catch(() => {}); guest = null;
      }
      fs.unlinkSync(pngPath);
    }
  } finally {
    if (guest) await guest.browser.close().catch(() => {});
    await browser.close().catch(() => {});
    if (made.length) {
      await db().query(`DELETE FROM signature_requests WHERE entity_type='post' AND entity_id IN (${made.join(',')})`).catch(() => {});
      for (const id of made) await api(`/posts/${id}`, { method: 'DELETE', headers: H }).catch(() => {});
    }
    // ★ sequelize 는 닫지 않는다 — config/database 는 공용 싱글턴이라 뒤의 cleanup:sweep 이 같은 연결을 쓴다
  }
  return { name: 'signitems', results };
}

if (require.main === module) run().then((r) => { for (const x of r.results) console.log(`${x.fail ? '❌' : '✅'} ${x.name}\n     └ ${x.details[0]}`); process.exit(r.results.some((x) => x.fail) ? 1 : 0); });
module.exports = { run: async () => (await run()).results, name: 'signitems' };
