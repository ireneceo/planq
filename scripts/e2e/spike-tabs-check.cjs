// ⑥ 트리 스왑 SPIKE — 인증 세션(user 3) + spike on 부팅 → 형제 MemoryRouter 무크래시 + 탭 스트립 렌더.
const jwt = require('/opt/planq/dev-backend/node_modules/jsonwebtoken');
const crypto = require('crypto');
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const { RefreshToken } = require('/opt/planq/dev-backend/models');
(async () => {
  const USER = 3;
  const raw = jwt.sign({ userId: USER, jti: crypto.randomUUID() }, process.env.JWT_REFRESH_SECRET, { expiresIn: '30d' });
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  let row;
  try { row = await RefreshToken.create({ user_id: USER, token_hash: hash, client_kind: 'web', expires_at: new Date(Date.now()+30*864e5) }); }
  catch(e){ console.log('token row ERR', e.message); await sequelize.close(); process.exit(1); }
  const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });
  const pageerrors = [];
  page.on('pageerror', e => pageerrors.push(e.message.slice(0,200)));
  const r = { boot:false, strip:false, tabs:0 };
  try {
    await page.setCookie({ name:'refresh_token', value: raw, domain:'dev.planq.kr', path:'/', httpOnly:true, secure:true });
    await page.goto('https://dev.planq.kr/dashboard', { waitUntil:'domcontentloaded', timeout:30000 });
    await page.evaluate(() => localStorage.setItem('planq_tabs_spike','1'));
    await page.reload({ waitUntil:'networkidle2', timeout:30000 });
    await new Promise(x=>setTimeout(x,3000));
    r.boot = await page.evaluate(() => { const el=document.querySelector('#root'); return !!el && el.children.length>0 && document.body.innerText.length>20; });
    r.strip = await page.evaluate(() => !!document.querySelector('[data-testid="tabstrip"]'));
    r.tabs = await page.evaluate(() => document.querySelectorAll('[data-testid^="tabstrip-tab-"]').length);
  } catch(e){ console.log('nav ERR', e.message); }
  console.log('  boot(렌더+무크래시):', r.boot);
  console.log('  탭 스트립 렌더:', r.strip, '| 탭 개수:', r.tabs);
  console.log('  pageerror(크래시):', pageerrors.length); pageerrors.slice(0,6).forEach(e=>console.log('    ',e));
  await browser.close();
  try { await RefreshToken.destroy({ where: { id: row.id } }); } catch {}
  await sequelize.close();
  const pass = r.boot && r.strip && pageerrors.length===0;
  console.log(pass ? '\n✓ TREE-SWAP BOOT PASS — 형제 MemoryRouter 무크래시, 탭 렌더' : '\n✗ TREE-SWAP FAIL');
  process.exit(pass?0:1);
})();
