// canary-guest-upload — 게스트 링크(로그인 없음) 고객이 사진·PDF 를 보내고, 직원이 보낸 그림을 본다 (2026-11-12)
//   설계 docs/GUEST_UPLOAD_DESIGN.md (Fable DESIGN: READY). 폰·태블릿·데스크탑.
//
// 재는 것:
//   ① 클립 버튼이 그려진다(서버 ctx.upload.enabled 일 때만)
//   ② 형식이 틀린 파일(.svg)을 고르면 보내지 않고 이유 한 줄 — 요청 0
//   ③ jpg 를 고르면 칩이 그려지고, 보내면 DB 에 첨부 1 · 칩 사라짐 · 말풍선에 썸네일이 **실제로 그려짐**(naturalWidth)
//   ④ 썸네일을 누르면 크게 보기가 뜬다
//   ⑤ 직원이 보낸 PDF 는 파일 칩(이름)으로 보인다
//   ⑥ 양성 대조군 — 썸네일을 숨기는 CSS 를 넣으면 ③ 의 «그려짐» 판정이 뒤집힌다
require('./lib/mem-slot');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const b = require('./lib/browser');

const BIZ = 5;
const OWNER = 5;           // health-check@planq.kr
const VIEWPORTS = [
  { key: '폰 390×844', touch: true, vp: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { key: '태블릿 834×1112', touch: true, vp: { width: 834, height: 1112, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { key: '데스크탑 1440×900', touch: false, vp: { width: 1440, height: 900 } },
];

const PAINTED = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return { ok: false, why: 'none' };
  for (let e = el; e && e !== document.body; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.opacity === '0' || cs.visibility === 'hidden' || cs.display === 'none') return { ok: false, why: 'hidden' };
  }
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return { ok: false, why: 'zero' };
  const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { ok: !!h && (h === el || el.contains(h)), why: h ? (h.getAttribute('data-testid') || h.tagName) : 'nohit' };
};

async function seed() {
  const [convId] = await sequelize.query(
    `INSERT INTO conversations (business_id, title, channel_type, status, last_message_at, created_at, updated_at)
     VALUES (?, '[카나리] 게스트 첨부', 'customer', 'active', NOW(), NOW(), NOW())`, { replacements: [BIZ] });
  await sequelize.query(`INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at, created_at) VALUES (?, ?, 'member', NOW(), NOW())`, { replacements: [convId, OWNER] });
  // 직원이 보낸 PDF(파일 칩으로 보여야 한다)
  const [msgId] = await sequelize.query(`INSERT INTO messages (conversation_id, sender_id, content, kind, created_at, updated_at) VALUES (?, ?, '[카나리] 견적서 보내드려요', 'text', NOW(), NOW())`, { replacements: [convId, OWNER] });
  await sequelize.query(`INSERT INTO message_attachments (message_id, file_name, file_path, file_size, mime_type, storage_provider, created_at) VALUES (?, '[카나리] 견적서.pdf', 'uploads/none.pdf', 1234, 'application/pdf', 'planq', NOW())`, { replacements: [msgId] }).catch(async () => {
    await sequelize.query(`INSERT INTO message_attachments (message_id, file_name, file_path, file_size, mime_type, storage_provider) VALUES (?, '[카나리] 견적서.pdf', 'uploads/none.pdf', 1234, 'application/pdf', 'planq')`, { replacements: [msgId] });
  });
  // 게스트 링크 — 서비스 한 함수로 발급(토큰 평문은 발급 때만 안다)
  const { User } = require('/opt/planq/dev-backend/models');
  const owner = await User.findByPk(OWNER);
  const { generateAccessToken } = require('/opt/planq/dev-backend/services/authTokens');
  const r = await fetch(`http://127.0.0.1:3003/api/conversations/${BIZ}/${convId}/guest-links`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${generateAccessToken(owner)}`, 'X-Workspace-Id': String(BIZ) },
    body: JSON.stringify({ replace: true }),
  }).then((x) => x.json());
  if (!r.success) throw new Error('guest link issue failed: ' + r.message);
  return { convId, token: r.data.url.split('/g/')[1].split(/[?#]/)[0] };
}
async function cleanup(ids) {
  if (!ids || !ids.convId) return;
  const id = ids.convId;
  const [rows] = await sequelize.query('SELECT ma.file_path FROM message_attachments ma JOIN messages m ON m.id = ma.message_id WHERE m.conversation_id = ?', { replacements: [id] });
  for (const r of rows) { if (r.file_path && r.file_path !== 'uploads/none.pdf') fs.unlink(path.join('/opt/planq/dev-backend', r.file_path), () => {}); }
  await sequelize.query('DELETE FROM message_attachments WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?)', { replacements: [id] });
  await sequelize.query('DELETE FROM messages WHERE conversation_id = ?', { replacements: [id] });
  await sequelize.query('DELETE FROM guest_links WHERE conversation_id = ?', { replacements: [id] }).catch(() => null);
  await sequelize.query('DELETE FROM conversation_participants WHERE conversation_id = ?', { replacements: [id] });
  await sequelize.query('DELETE FROM conversations WHERE id = ?', { replacements: [id] });
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  let ids = null, browser = null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-guest-up-'));
  try {
    ids = await seed();
    const sharp = require('/opt/planq/dev-backend/node_modules/sharp');
    const jpgPath = path.join(tmp, '사진.jpg');
    fs.writeFileSync(jpgPath, await sharp({ create: { width: 120, height: 80, channels: 3, background: '#3b82f6' } }).jpeg().toBuffer());
    const svgPath = path.join(tmp, 'a.svg');
    fs.writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const launched = await b.launch();
    browser = launched.browser;
    const page = launched.page;
    let uploads = 0;
    page.on('request', (rq) => { if (/\/messages\/upload$/.test(rq.url())) uploads += 1; });

    for (const { key, vp, touch } of VIEWPORTS) {
      await page.setViewport(vp);
      await page.goto(`${b.BASE}/g/${ids.token}`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('[data-testid="guest-input"]', { timeout: 15000 }).catch(() => null);
      await page.waitForSelector('[data-testid="guest-attach"]', { timeout: 5000 }).catch(() => null);
      const clip = await page.evaluate(PAINTED, '[data-testid="guest-attach"]');
      push(`${key} · 클립 버튼이 그려짐`, clip.ok, JSON.stringify(clip));
      if (!clip.ok) continue;

      // ② 형식 틀림 — 보내지 않는다
      const before = uploads;
      const input = await page.$('[data-testid="guest-file-input"]');
      await input.uploadFile(svgPath);
      await b.sleep(300);
      const errTxt = await page.evaluate(() => document.body.innerText.match(/사진\(jpg·png·webp·gif·heic\)과 PDF 만|photos \(jpg/)?.[0] || '');
      const pickedSvg = await page.evaluate(() => !!document.querySelector('[data-testid="guest-picked"]'));
      push(`${key} · .svg 는 안 담기고 이유 한 줄 · 요청 0`, !!errTxt && !pickedSvg && uploads === before, `이유=«${errTxt}» · 칩=${pickedSvg} · 요청 ${uploads - before}`);

      // ③ jpg 보내기
      await input.uploadFile(jpgPath);
      await b.sleep(300);
      const chip = await page.evaluate(PAINTED, '[data-testid="guest-picked"]');
      push(`${key} · 고른 파일 칩이 그려짐`, chip.ok, JSON.stringify(chip));
      const [[{ n: n0 }]] = await sequelize.query('SELECT COUNT(*) n FROM message_attachments ma JOIN messages m ON m.id = ma.message_id WHERE m.conversation_id = ? AND ma.file_name = ?', { replacements: [ids.convId, '사진.jpg'] });
      const sendBtn = await page.$('[data-testid="guest-send"]');
      if (touch) { const bx = await sendBtn.boundingBox(); await page.touchscreen.tap(bx.x + bx.width / 2, bx.y + bx.height / 2); } else await sendBtn.click();
      await b.sleep(500);
      // 처음 보낼 때 이름을 묻는다 — 건너뛰면 그대로 나간다
      const skip = await page.$('[data-testid="guest-name-skip"]');
      if (skip) await skip.click();
      await page.waitForFunction(() => !document.querySelector('[data-testid="guest-picked"]'), { timeout: 10000 }).catch(() => null);
      await b.sleep(1500);
      const [[{ n: n1 }]] = await sequelize.query('SELECT COUNT(*) n FROM message_attachments ma JOIN messages m ON m.id = ma.message_id WHERE m.conversation_id = ? AND ma.file_name = ?', { replacements: [ids.convId, '사진.jpg'] });
      const chipGone = await page.evaluate(() => !document.querySelector('[data-testid="guest-picked"]'));
      push(`${key} · 보내면 DB 첨부 +1 · 칩 사라짐`, Number(n1) === Number(n0) + 1 && chipGone, `DB ${n0}→${n1} · 칩 사라짐=${chipGone}`);
      const [[att]] = await sequelize.query('SELECT ma.id FROM message_attachments ma JOIN messages m ON m.id = ma.message_id WHERE m.conversation_id = ? AND ma.file_name = ? ORDER BY ma.id DESC LIMIT 1', { replacements: [ids.convId, '사진.jpg'] });
      const tsel = `[data-testid="guest-att-thumb-${att && att.id}"]`;
      await page.waitForFunction((s) => { const i = document.querySelector(`${s} img`); return i && i.complete && i.naturalWidth > 0; }, { timeout: 8000 }, tsel).catch(() => null);
      await page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'center' }), tsel);
      await b.sleep(300);
      const thumb = await page.evaluate((s) => { const i = document.querySelector(`${s} img`); return { nw: i ? i.naturalWidth : 0 }; }, tsel);
      const tp = await page.evaluate(PAINTED, tsel);
      push(`${key} · 말풍선 썸네일이 실제로 그려짐`, tp.ok && thumb.nw > 0, `${JSON.stringify(tp)} · naturalWidth=${thumb.nw}`);
      if (key.startsWith('폰')) {
        const h = await page.addStyleTag({ content: `${tsel}{visibility:hidden!important}` });
        const bad = await page.evaluate(PAINTED, tsel);
        push(`${key} · 대조군: 썸네일을 숨기면 판정이 뒤집힘`, !bad.ok, JSON.stringify(bad));
        await page.evaluate((el) => el.remove(), h);
      }
      // ④ 크게 보기
      if (tp.ok) {
        if (touch) { const bx = await (await page.$(tsel)).boundingBox(); await page.touchscreen.tap(bx.x + bx.width / 2, bx.y + bx.height / 2); } else await page.click(tsel);
        await b.sleep(800);
        const lb = await page.evaluate(() => !![...document.querySelectorAll('img')].find((i) => /\/preview\?w=1600/.test(i.getAttribute('src') || '')));
        push(`${key} · 썸네일 누르면 크게 보기`, lb, `큰 그림=${lb}`);
        await page.keyboard.press('Escape');
        await b.sleep(300);
      }
      // ⑤ 직원 PDF 칩
      const pdfChip = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="guest-att-file-"]')].some((e) => /견적서\.pdf/.test(e.textContent || '')));
      push(`${key} · 직원이 보낸 PDF 가 파일 칩으로 보임`, pdfChip, `칩=${pdfChip}`);
    }
  } catch (e) {
    results.push({ name: 'canary-guest-upload', fail: 0, fatal: 1, details: ['FATAL ' + e.message] });
  } finally {
    if (browser) await browser.close().catch(() => null);
    await cleanup(ids).catch(() => null);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return results;
}

module.exports = { run, name: 'canary-guest-upload' };
