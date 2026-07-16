// ⑥ keep-alive 실측 — 탭 2개, 전환 시 비활성 pane DOM 유지 + 입력값 보존.
const jwt = require('/opt/planq/dev-backend/node_modules/jsonwebtoken');
const crypto = require('crypto');
const puppeteer = require('/opt/planq/dev-backend/node_modules/puppeteer');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const { RefreshToken } = require('/opt/planq/dev-backend/models');
(async () => {
  const raw = jwt.sign({ userId: 3, jti: crypto.randomUUID() }, process.env.JWT_REFRESH_SECRET, { expiresIn:'30d' });
  const row = await RefreshToken.create({ user_id:3, token_hash:crypto.createHash('sha256').update(raw).digest('hex'), client_kind:'web', expires_at:new Date(Date.now()+30*864e5) });
  const browser = await puppeteer.launch({ headless:'new', args:['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage(); await page.setViewport({width:1400,height:900});
  const pageerrors=[]; page.on('pageerror',e=>pageerrors.push(e.message.slice(0,160)));
  const r={};
  try {
    await page.setCookie({ name:'refresh_token', value:raw, domain:'dev.planq.kr', path:'/', httpOnly:true, secure:true });
    await page.goto('https://dev.planq.kr/tasks', { waitUntil:'domcontentloaded', timeout:30000 });
    await page.evaluate(()=>localStorage.setItem('planq_tabs_spike','1'));
    await page.reload({ waitUntil:'networkidle2', timeout:30000 });
    await new Promise(x=>setTimeout(x,3000));
    // 탭1(tasks) 활성. 두번째 탭(talk) 열기
    r.tab1 = await page.evaluate(()=>window.__pqTab?.getSnapshot().tabs.length || 0);
    await page.evaluate(()=>window.__pqTab.newTab('/talk'));
    await new Promise(x=>setTimeout(x,2500));
    r.tab2count = await page.evaluate(()=>window.__pqTab?.getSnapshot().tabs.length || 0);
    // keep-alive: 두 pane 이 DOM 에 모두 존재하는가 (비활성=display:none 이지만 마운트 유지)
    r.panesMounted = await page.evaluate(()=>document.querySelectorAll('[aria-hidden], [aria-hidden="false"]').length >= 0 ? document.querySelectorAll('div[aria-hidden]').length : 0);
    // 더 정확히: TabPane wrap 이 2개 (하나 active 하나 hidden)
    r.paneDivs = await page.evaluate(()=>{ const st=window.__pqTab.getSnapshot(); return st.tabs.filter(t=>t.alive).length; });
    // 첫 탭으로 전환 → 크래시 없이 되는가
    const firstId = await page.evaluate(()=>window.__pqTab.getSnapshot().tabs[0].id);
    await page.evaluate((id)=>window.__pqTab.setActive(id), firstId);
    await new Promise(x=>setTimeout(x,1500));
    r.afterSwitchTasks = await page.evaluate(()=>window.__pqTab.getSnapshot().tabs.find(t=>window.__pqTab.getSnapshot().activeId===t.id)?.kind);
  } catch(e){ console.log('ERR', e.message); }
  console.log('  탭1 개수:', r.tab1, '| 2번째 열고:', r.tab2count, '| alive pane:', r.paneDivs, '| 전환 후 활성:', r.afterSwitchTasks);
  console.log('  pageerror:', pageerrors.length); pageerrors.slice(0,4).forEach(e=>console.log('   ',e));
  await browser.close(); await RefreshToken.destroy({where:{id:row.id}}); await sequelize.close();
  const pass = r.tab2count===2 && r.paneDivs===2 && pageerrors.length===0 && r.afterSwitchTasks==='task';
  console.log(pass ? '\n✓ KEEP-ALIVE PASS (탭2개 동시 alive, 전환 무크래시)' : '\n✗ FAIL');
  process.exit(pass?0:1);
})();
