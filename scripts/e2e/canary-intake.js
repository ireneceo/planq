#!/usr/bin/env node
// canary-intake.js — 접수 양식 응답 → [사건 만들기] 화면 여정 (docs/INTAKE_AUTO_CASE_DESIGN.md §6) · 3폭(1440·768·390)
//
// 재는 것(좌표 + elementFromPoint — «그려졌고 내 것인가»):
//   ① 질문지 탭 설정에 «접수 처리» 칸이 보이고 스위치가 켜져 있다
//   ② 응답 탭 위에 접수함 · 응답 줄마다 [사건 만들기] 가 보인다 · 가로 넘침 0
//   ③ [사건 만들기] → 창에 만들 프로젝트·템플릿·고객 연결 선택이 보이고 [만들기] 가 화면 안에 있다
//   ④ (폭마다 다른 응답 1줄) [만들기] → 줄이 «사건 보기 →» 로 바뀐다 · DB intake_cases done + 프로젝트 업무 수 = 템플릿 항목 수
//   ⑤ 이메일이 기존 고객과 같은 응답 → 창에 «기존 고객과 연결» 후보가 보이되 기본 선택은 «연결 안 함»(자동 연결 금지 대조)
//   ⑥ 음성 대조군: 접수 처리를 끄면 응답 탭에 접수함이 없다
const b = require('./lib/browser');
const { execFileSync } = require('child_process');

const API = (process.env.E2E_BASE || 'https://dev.planq.kr') + '/api';
const results = [];
const P = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg], hasCanary: true });
async function api(path, opts = {}) {
  const r = await fetch(API + path, opts);
  let json = {};
  try { json = JSON.parse(await r.text()); } catch { /* 비 JSON */ }
  return { status: r.status, json };
}
const dbq = (sql) => {
  const out = execFileSync('node', ['-e', "require('dotenv').config();const {sequelize}=require('./config/database');(async()=>{const [r]=await sequelize.query(process.argv[1]);console.log('OUT='+JSON.stringify(r));process.exit(0)})();", sql], { cwd: '/opt/planq/dev-backend', encoding: 'utf8', timeout: 30000 });
  return JSON.parse((out.match(/OUT=(.*)/) || [])[1] || '[]');
};
const VIS = `(el) => {
  if (!el) return { found: false };
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  const hit = (r.width > 0 && r.height > 0) ? document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)) : null;
  return { found: true, w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom), vh: innerHeight, text: (el.innerText || '').trim().slice(0, 160),
    painted: r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none',
    mine: !!(hit && (hit === el || el.contains(hit) || hit.contains(el))) };
}`;
const vis = (page, sel) => page.evaluate(`(${VIS})(document.querySelector(${JSON.stringify(sel)}))`);
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const WIDTHS = [{ w: 1440, h: 900, tag: '데스크탑' }, { w: 768, h: 1024, tag: '태블릿' }, { w: 390, h: 844, tag: '폰', mobile: true }];

async function run() {
  let token = null; let bizId = null; let postId = null; let rid = null; let tplId = null; let items = 0;
  const projects = [];
  const H = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
  const tag = Date.now().toString(36);
  let rowIds = []; let matchRow = null;
  try {
    const lj = await api('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: b.CREDS.email, password: b.CREDS.password }) });
    token = lj.json?.data?.token || null;
    bizId = (await api('/businesses', { headers: H() })).json?.data?.[0]?.id || null;
    const tpl = dbq('SELECT t.id, (SELECT COUNT(*) FROM task_template_items i WHERE i.template_id=t.id) n FROM task_templates t WHERE t.is_system=1 HAVING n>0 ORDER BY t.id LIMIT 1')[0];
    tplId = tpl?.id || null; items = Number(tpl?.n || 0);
    const c = await api('/posts', { method: 'POST', headers: H(), body: JSON.stringify({ business_id: bizId, title: `[카나리] 접수 ${tag}`, kind: 'survey' }) });
    postId = c.json?.data?.id || null; rid = c.json?.data?.q_record_id || null;
    const cols = [{ id: 'cname', name: '이름', type: 'text' }, { id: 'cmail', name: '이메일', type: 'email' }, { id: 'cneed', name: '상담 내용', type: 'longtext' }];
    await api(`/records/${rid}`, { method: 'PUT', headers: H(), body: JSON.stringify({ columns: cols }) });
    const en = await api(`/records/${rid}/survey`, { method: 'PUT', headers: H(), body: JSON.stringify({ enabled: true, settings: { intake: { mode: 'review', template_id: tplId, name_cols: ['cname'], map: { name: 'cname', email: 'cmail' } } } }) });
    const stoken = en.json?.data?.token;
    // 기존 고객 하나(이메일 일치 대조용)
    const mail = `intake-${tag}@example.com`;
    dbq(`INSERT INTO clients (business_id, display_name, invite_email, kind, status, created_at, updated_at) VALUES (${Number(bizId)}, '[카나리] 기존 고객 ${tag}', '${mail}', 'customer', 'prospect', NOW(), NOW())`);
    const send = (v) => fetch(`${API}/survey/${stoken}/responses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers: v }) });
    for (const W of WIDTHS) await send({ cname: `[카나리] ${W.tag} 접수`, cneed: '상담' });
    await send({ cname: `[카나리] 일치 ${tag}`, cmail: mail, cneed: '일치' });
    const rows = dbq(`SELECT id FROM q_record_rows WHERE q_record_id=${Number(rid)} ORDER BY id`);
    rowIds = rows.slice(0, 3).map((x) => x.id); matchRow = rows[3]?.id || null;
  } catch { /* 아래 */ }
  if (!postId || !rid || !tplId || rowIds.length !== 3) {
    P('픽스처 — 설문·응답·템플릿 (0건 = 판정 불가)', false, `🔴 픽스처를 못 만들었다 post=${postId} rec=${rid} tpl=${tplId} rows=${rowIds.length}`);
    return { name: 'intake', results };
  }

  const { browser, page } = await b.launch({});
  try {
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await b.login(page);
    for (let i = 0; i < WIDTHS.length; i++) {
      const W = WIDTHS[i];
      await page.setViewport({ width: W.w, height: W.h, isMobile: !!W.mobile, hasTouch: !!W.mobile });
      await b.goto(page, `/docs?post=${postId}`); await b.sleep(2500); await b.dismissBlockers(page).catch(() => {});
      // ② 접수함
      await page.click('[data-testid="survey-tab-responses"]').catch(() => {}); await b.sleep(1500);
      const lv = await vis(page, '[data-testid="survey-intake-list"]');
      const mk = await vis(page, `[data-testid="intake-make-${rowIds[i]}"]`);
      const ox = await overflowX(page);
      P(`② [${W.tag}] 응답 탭 접수함 · [사건 만들기] 보임 · 가로 넘침 0`, lv.found && lv.painted && mk.found && mk.painted && mk.mine && ox <= 0,
        `접수함 ${lv.found ? `${lv.w}×${lv.h}` : '없음'} · 버튼 ${mk.found ? `${mk.w}×${mk.h} mine=${mk.mine}` : '없음'} · 넘침 ${ox}px`);
      // ③ 창
      await page.click(`[data-testid="intake-make-${rowIds[i]}"]`).catch(() => {}); await b.sleep(1500);
      const pv = await vis(page, '[data-testid="intake-preview"]');
      const cf = await vis(page, '[data-testid="intake-confirm"]');
      P(`③ [${W.tag}] 창 — 만들 프로젝트·템플릿 보임 · [만들기] 화면 안`, pv.found && pv.painted && /접수/.test(pv.text) && cf.found && cf.mine && cf.bottom <= cf.vh,
        `미리보기 ${pv.found ? `"${pv.text.replace(/\n/g, ' ').slice(0, 80)}"` : '없음'} · 만들기 ${cf.found ? `mine=${cf.mine} bottom=${cf.bottom}/${cf.vh}` : '없음'}`);
      // ④ 만들기
      await page.click('[data-testid="intake-confirm"]').catch(() => {}); await b.sleep(3000);
      const op = await vis(page, `[data-testid="intake-open-${rowIds[i]}"]`);
      const ic = dbq(`SELECT status, project_id, task_count FROM intake_cases WHERE q_record_row_id=${Number(rowIds[i])}`)[0] || {};
      if (ic.project_id) projects.push(ic.project_id);
      const tc = ic.project_id ? Number(dbq(`SELECT COUNT(*) n FROM tasks WHERE project_id=${Number(ic.project_id)}`)[0]?.n || 0) : -1;
      P(`④ [${W.tag}] [만들기] → «사건 보기» · DB done · 업무 ${items}개`, op.found && op.painted && ic.status === 'done' && tc === items,
        `사건보기 ${op.found ? 'O' : 'X'} · DB ${JSON.stringify(ic)} · 업무 ${tc}/${items}`);
    }
    // ⑤ 이메일 일치 — 후보는 보이되 기본은 «연결 안 함»
    if (matchRow) {
      await page.setViewport({ width: 1440, height: 900 });
      await b.goto(page, `/docs?post=${postId}`); await b.sleep(2500); await b.dismissBlockers(page).catch(() => {});
      await page.click('[data-testid="survey-tab-responses"]').catch(() => {}); await b.sleep(1500);
      await page.click(`[data-testid="intake-make-${matchRow}"]`).catch(() => {}); await b.sleep(1500);
      const st = await page.evaluate(() => ({
        link: !!document.querySelector('[data-testid="intake-choice-link"]'),
        linkChecked: !!document.querySelector('[data-testid="intake-choice-link"] input')?.checked,
        noneChecked: !!document.querySelector('[data-testid="intake-choice-none"] input')?.checked,
      }));
      P('⑤ 이메일 일치 응답 — «기존 고객과 연결» 후보 보임 · 기본 선택은 «연결 안 함»', st.link && !st.linkChecked && st.noneChecked, JSON.stringify(st));
      await page.keyboard.press('Escape').catch(() => {});
    }
    // ① 설정 칸(편집 모드 — 설문 설정은 편집할 때만 보인다) · 3폭 · 스위치를 눌러 저장되는지(끔 → 켬, PUT 결과를 DB 로)
    for (const W of WIDTHS) {
      await page.setViewport({ width: W.w, height: W.h, isMobile: !!W.mobile, hasTouch: !!W.mobile });
      await b.goto(page, `/docs?post=${postId}`); await b.sleep(2500); await b.dismissBlockers(page).catch(() => {});
      await page.click('[data-testid="post-edit"]').catch(() => {}); await b.sleep(2000);
      await page.click('[data-testid="survey-tab-questions"]').catch(() => {}); await b.sleep(1000);
      const sv = await vis(page, '[data-testid="survey-intake"]');
      const tg = await vis(page, '[data-testid="survey-intake-toggle"]');
      const on = await page.evaluate(() => document.querySelector('[data-testid="survey-intake-toggle"]')?.getAttribute('aria-checked'));
      P(`① [${W.tag}] 편집 모드 설정에 «접수 처리» · 스위치 켜짐·누를 수 있음`, sv.found && sv.painted && on === 'true' && tg.mine,
        sv.found ? `${sv.w}×${sv.h} 켜짐=${on} 스위치 mine=${tg.mine}` : '🔴 칸 없음');
      if (W.tag === '데스크탑') {
        const modeOf = () => (dbq(`SELECT JSON_UNQUOTE(JSON_EXTRACT(survey_settings,'$.intake.mode')) m FROM q_records WHERE id=${Number(rid)}`)[0] || {}).m;
        await page.click('[data-testid="survey-intake-toggle"]').catch(() => {}); await b.sleep(1800);
        const off = modeOf();
        await page.click('[data-testid="survey-intake-toggle"]').catch(() => {}); await b.sleep(1800);
        const back = modeOf();
        P('①-b 스위치를 누르면 저장된다 (끔 → 켬, DB)', off === 'off' && back === 'review', `끔 뒤 ${off} · 켬 뒤 ${back}`);
      }
    }
    // ⑥ 음성 대조군 — 끄면 접수함이 없다
    await api(`/records/${rid}/survey`, { method: 'PUT', headers: H(), body: JSON.stringify({ settings: { intake: { mode: 'off', template_id: tplId, name_cols: ['cname'], map: { name: 'cname' } } } }) });
    await b.goto(page, `/docs?post=${postId}`); await b.sleep(2500); await b.dismissBlockers(page).catch(() => {});
    await page.click('[data-testid="survey-tab-responses"]').catch(() => {}); await b.sleep(1500);
    const gone = await page.evaluate(() => !document.querySelector('[data-testid="survey-intake-list"]'));
    P('⑥ 대조군: 접수 처리를 끄면 접수함이 없다', gone, `접수함 없음=${gone}`);
  } catch (e) {
    P('접수 검사 중 오류', false, `🔴 ${e.message}`);
  } finally {
    await browser.close().catch(() => {});
    // 카나리 픽스처는 지운다(사건·프로젝트·업무·응답 표)
    try {
      for (const p of projects) {
        dbq(`DELETE FROM tasks WHERE project_id=${Number(p)}`);
        await api(`/projects/${p}`, { method: 'DELETE', headers: H() }).catch(() => {});
      }
      dbq(`DELETE FROM intake_cases WHERE q_record_id=${Number(rid)}`);
      dbq(`DELETE FROM clients WHERE business_id=${Number(bizId)} AND display_name LIKE '[카나리] 기존 고객 ${tag}'`);
    } catch { /* 정리 실패는 판정과 무관 */ }
    if (postId) await api(`/posts/${postId}`, { method: 'DELETE', headers: H() }).catch(() => {});
  }
  return { name: 'intake', results };
}

module.exports = { run: async () => (await run()).results, name: 'intake' };

if (require.main === module) {
  require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
  run().then((r) => {
    let fail = 0;
    console.log('\n=== 접수 → 사건 카나리 ===');
    for (const x of r.results) { console.log(`${x.fail ? '❌' : '✅'} ${x.name} — ${x.details[0]}`); fail += x.fail; }
    console.log(`\n검사 ${r.results.length}개 · 실패 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.stack || e.message); process.exit(2); });
}
