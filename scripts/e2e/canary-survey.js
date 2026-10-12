#!/usr/bin/env node
// canary-survey.js — 설문 v2 Phase 1 화면 여정 (docs/SURVEY_V2_DESIGN.md §9 Phase 1 검증 4·5) · 3폭(390·768·1440)
//
// 재는 것(좌표 + elementFromPoint — «그려졌고 내 것인가»):
//   ① + 드롭다운에 «설문» 이 보인다
//   ② 설문 상세 — 네 탭 · 질문지 카드 5개 · 밴드2 [보내기] · 가로 넘침 0
//   ③ 보내기 → 이메일 추가 → 다음 → 확인 단계에 **받는 주소가 보인다** → 보내기 → 발행 탭에 회차가 생긴다
//   ④ 공개 응답 화면(개인 링크) — 별·척도·예/아니오 터치 크기(폰 44) · 제출 → 완료 · 다시 열면 «이미 응답»
//   ⑤ 응답 탭에 응답자 이름 칸 · 통계 탭 NPS 카드(+100)
//   ⑥ 일반 표에는 «통계» 토글·«설문으로 받기» 가 없다(음성 대조군) — 설문에는 통계 탭이 있다(양성)
//   ⑦ 편집 모드 — «문항 추가» 로 별점 문항을 더하면 서버 칸이 6개가 된다
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
  return { found: true, w: Math.round(r.width), h: Math.round(r.height), text: (el.innerText || '').trim().slice(0, 200),
    painted: r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none',
    mine: !!(hit && (hit === el || el.contains(hit) || hit.contains(el))) };
}`;
const vis = (page, sel) => page.evaluate(`(${VIS})(document.querySelector(${JSON.stringify(sel)}))`);
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const WIDTHS = [{ w: 1440, h: 900, tag: '데스크탑' }, { w: 768, h: 1024, tag: '태블릿' }, { w: 390, h: 844, tag: '폰', mobile: true }];

async function run() {
  let token = null; let bizId = null; let surveyId = null; let rid = null; let tableId = null;
  const H = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });
  try {
    const lj = await api('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: b.CREDS.email, password: b.CREDS.password }) });
    token = lj.json?.data?.token || null;
    bizId = (await api('/businesses', { headers: H() })).json?.data?.[0]?.id || null;
    const c = await api('/posts', { method: 'POST', headers: H(), body: JSON.stringify({ business_id: bizId, title: '[카나리] 설문 v2', kind: 'survey', question_set: 'project_review' }) });
    surveyId = c.json?.data?.id || null; rid = c.json?.data?.q_record_id || null;
    const t = await api('/posts', { method: 'POST', headers: H(), body: JSON.stringify({ business_id: bizId, title: '[카나리] 설문 v2 — 일반 표', kind: 'table' }) });
    tableId = t.json?.data?.id || null;
  } catch { /* 아래 */ }
  if (!surveyId || !rid || !tableId) {
    P('픽스처 — 설문·표 만들기 (0건 = 판정 불가)', false, '🔴 픽스처를 못 만들어 한 항목도 재지 못했다');
    return { name: 'survey', results };
  }

  const { browser, page } = await b.launch({});
  try {
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await b.login(page);
    let sentEmail = null;
    for (const W of WIDTHS) {
      await page.setViewport({ width: W.w, height: W.h, isMobile: !!W.mobile, hasTouch: !!W.mobile });
      // ① + 드롭다운
      await b.goto(page, '/docs'); await b.sleep(2000); await b.dismissBlockers(page).catch(() => {});
      await page.click('[data-testid="docs-new"]').catch(() => {});
      await b.sleep(600);
      const nv = await vis(page, '[data-testid="docs-new-survey"]');
      P(`① [${W.tag}] + 드롭다운에 «설문» 이 보인다`, nv.found && nv.painted && nv.mine, nv.found ? `${nv.w}×${nv.h} "${nv.text.replace(/\n/g, ' ')}" mine=${nv.mine}` : '🔴 항목 없음');
      await page.keyboard.press('Escape').catch(() => {});

      // ② 상세
      await b.goto(page, `/docs?post=${surveyId}`); await b.sleep(2500); await b.dismissBlockers(page).catch(() => {});
      const d = await page.evaluate(() => ({
        tabs: [...document.querySelectorAll('[data-testid^="survey-tab-"]')].map((x) => x.getAttribute('data-testid')),
        cards: document.querySelectorAll('[data-testid^="survey-qcard-"]').length,
      }));
      const sv = await vis(page, '[data-testid="post-survey-send"]');
      const ox = await overflowX(page);
      P(`② [${W.tag}] 설문 상세 — 네 탭 · 문항 카드 5 · [보내기] 보임 · 가로 넘침 0`,
        d.tabs.length === 4 && d.cards === 5 && sv.found && sv.painted && sv.mine && ox <= 0,
        `탭 ${d.tabs.length} · 카드 ${d.cards} · 보내기 ${sv.found ? `${sv.w}×${sv.h} mine=${sv.mine}` : '없음'} · 가로넘침 ${ox}px`);

      // ③ 보내기 — 폭마다 한 번씩(주소 확인 단계가 폭마다 보이는지)
      const email = `survey-canary-${W.w}@example.org`;
      await page.click('[data-testid="post-survey-send"]').catch(() => {});
      await b.sleep(1500);
      const inp = await page.$('[aria-modal="true"] input[placeholder="name@company.com"]');
      if (inp) { await inp.click(); await inp.type(email); await page.keyboard.press('Enter'); await b.sleep(300); }
      await page.click('[data-testid="survey-send-next"]').catch(() => {});
      await b.sleep(700);
      const addr = await page.evaluate(`(() => { const el = document.querySelector('[data-testid="survey-send-addresses"]'); const v = (${VIS})(el); return Object.assign(v, { has: !!(el && el.innerText.includes(${JSON.stringify(email)})) }); })()`);
      const conf = await vis(page, '[data-testid="survey-send-confirm"]');
      P(`③ [${W.tag}] 확인 단계에 받는 주소가 보인다 (그려짐·가려지지 않음)`, addr.found && addr.painted && addr.mine && addr.has && conf.found && conf.mine,
        addr.found ? `주소상자 ${addr.w}×${addr.h} mine=${addr.mine} 주소포함=${addr.has} · 보내기 버튼 mine=${conf.mine}` : '🔴 확인 단계가 없다');
      await page.click('[data-testid="survey-send-confirm"]').catch(() => {});
      await b.sleep(2500);
      const round = await page.evaluate(() => ({ tab: document.querySelector('[data-testid="survey-tab-publish"]')?.getAttribute('aria-selected'), rounds: document.querySelectorAll('[data-testid^="survey-round-"]').length }));
      const inDb = dbq(`SELECT r.status FROM survey_recipients r JOIN survey_issues i ON i.id=r.issue_id WHERE i.q_record_id=${Number(rid)} AND r.email='${email}'`);
      P(`③-b [${W.tag}] 보내면 발행 탭으로 가고 회차가 보인다 · 받는 사람 status=sent`, round.tab === 'true' && round.rounds >= 1 && inDb[0]?.status === 'sent',
        `발행탭=${round.tab} · 회차 ${round.rounds} · DB ${JSON.stringify(inDb)}`);
      if (W.w === 390) sentEmail = email;

      // ④ 공개 응답 화면(개인 링크) — 각 폭에서 그 폭으로 보낸 사람의 링크
      const tok = dbq(`SELECT r.token FROM survey_recipients r JOIN survey_issues i ON i.id=r.issue_id WHERE i.q_record_id=${Number(rid)} AND r.email='${email}'`)[0]?.token;
      const pub = await browser.createBrowserContext();
      const pp = await pub.newPage();
      await pp.setViewport({ width: W.w, height: W.h, isMobile: !!W.mobile, hasTouch: !!W.mobile });
      await pp.goto(`${b.BASE}/public/survey/${tok}`, { waitUntil: 'networkidle2' }).catch(() => {});
      await b.sleep(1500);
      const star = await pp.evaluate(`(() => { const el = document.querySelector('[role="radiogroup"] button[role="radio"]'); return (${VIS})(el); })()`);
      const pill = await pp.evaluate(`(() => { const g = [...document.querySelectorAll('[role="radiogroup"]')].find((x) => x.querySelectorAll('button').length === 11); return g ? (${VIS})(g.querySelector('button')) : { found: false }; })()`);
      const need = W.mobile ? 44 : 40;
      P(`④ [${W.tag}] 응답 화면 — 별·척도 알약 터치 크기(≥${need}) · 가로 넘침 0`,
        star.found && star.w >= 44 && star.h >= 44 && pill.found && pill.h >= need && (await overflowX(pp)) <= 0,
        `별 ${star.w}×${star.h} · 척도 ${pill.w}×${pill.h} · 가로넘침 ${await overflowX(pp)}`);
      // 답하기: 별 5 · 척도 10 · 예
      await pp.evaluate(() => {
        const groups = [...document.querySelectorAll('[role="radiogroup"]')];
        for (const g of groups) {
          const bs = [...g.querySelectorAll('button')];
          if (bs.length === 5) bs[4].click(); else if (bs.length === 11) bs[10].click(); else if (bs.length === 2) bs[0].click();
        }
      });
      await b.sleep(300);
      await pp.click('[data-testid="survey-submit"]').catch(() => {});
      await b.sleep(2000);
      const done = await pp.evaluate(() => !!document.querySelector('[data-testid="survey-done"]') && !document.body.innerText.includes('응답 하나 더'));
      await pp.reload({ waitUntil: 'networkidle2' }).catch(() => {});
      await b.sleep(1200);
      const again = await pp.evaluate(() => !!document.querySelector('[data-testid="survey-answered"]'));
      P(`④-b [${W.tag}] 제출 → 완료(«하나 더» 없음) → 다시 열면 «이미 응답»`, done && again, `완료=${done} · 재방문 이미응답=${again}`);
      await pub.close().catch(() => {});
    }

    // ⑤ 응답·통계 탭 (1440)
    await page.setViewport({ width: 1440, height: 900 });
    await b.goto(page, `/docs?post=${surveyId}`); await b.sleep(2500); await b.dismissBlockers(page).catch(() => {});
    await page.click('[data-testid="survey-tab-responses"]').catch(() => {}); await b.sleep(2000);
    const resp = await page.evaluate((em) => document.body.innerText.includes(em) && document.body.innerText.includes('응답자'), sentEmail || 'survey-canary-390@example.org');
    P('⑤ 응답 탭 — 응답자(받는 사람) 칸이 보인다', resp, `응답자 칸·이메일 표시=${resp}`);
    await page.click('[data-testid="survey-tab-stats"]').catch(() => {}); await b.sleep(2000);
    const npsCard = await page.evaluate(() => { const el = document.querySelector('[data-testid^="stats-nps-"]'); return el ? el.innerText.trim() : null; });
    P('⑤-b 통계 탭 — NPS 카드 (+100: 3명 모두 10점)', npsCard === '+100', `NPS 표시 "${npsCard}"`);

    // ⑥ 일반 표 — 통계 토글·설문 버튼 없음 (음성 대조군)
    await b.goto(page, `/docs?post=${tableId}`); await b.sleep(2500);
    const tbl = await page.evaluate(() => ({ stats: !!document.querySelector('[data-testid="table-stats-tab"]'), survey: !!document.querySelector('[data-testid="table-survey-open"]'), grid: !!document.querySelector('[data-testid^="table-colhead-"]') }));
    P('⑥ 일반 표에는 «표|통계» 토글·«설문으로 받기» 가 없다 (설문에는 통계 탭이 있다 = 양성 대조군)', !tbl.stats && !tbl.survey && tbl.grid && npsCard !== null,
      `표: 통계토글=${tbl.stats} 설문버튼=${tbl.survey} 격자=${tbl.grid} · 설문 통계탭 동작=${npsCard !== null}`);

    // ⑦ 편집 — 문항 추가
    await b.goto(page, `/docs?post=${surveyId}`); await b.sleep(2500);
    await page.click('[data-testid="post-edit"]').catch(() => {}); await b.sleep(2000);
    await page.click('[data-testid="survey-add-question"]').catch(() => {}); await b.sleep(400);
    await page.click('[data-testid="survey-add-rating"]').catch(() => {}); await b.sleep(2000);
    const rec = await api(`/records/${rid}`, { headers: H() });
    const n = (rec.json?.data?.columns || []).length;
    P('⑦ 편집 모드 «문항 추가 → 별점» 이 서버에 저장된다 (칸 5 → 6)', n === 6, `서버 칸 수 ${n}`);
  } catch (e) {
    P('설문 검사 중 오류', false, `🔴 ${e.message}`);
  } finally {
    await browser.close().catch(() => {});
    // 확인용으로 남기지 않는다 — 카나리 픽스처는 지운다(회차·받는 사람·EmailLog 까지)
    try {
      const iss = `SELECT id FROM survey_issues WHERE q_record_id=${Number(rid)}`;
      dbq(`DELETE FROM email_logs WHERE related_entity_type='survey_recipient' AND related_entity_id IN (SELECT id FROM survey_recipients WHERE issue_id IN (${iss}))`);
      dbq(`DELETE FROM survey_recipients WHERE issue_id IN (${iss})`);
      dbq(`DELETE FROM survey_issues WHERE q_record_id=${Number(rid)}`);
    } catch { /* 정리 실패는 판정과 무관 */ }
    for (const id of [surveyId, tableId]) if (id) await api(`/posts/${id}`, { method: 'DELETE', headers: H() }).catch(() => {});
  }
  return { name: 'survey', results };
}

module.exports = { run: async () => (await run()).results, name: 'survey' };

if (require.main === module) {
  require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
  run().then((r) => {
    let fail = 0;
    console.log('\n=== 설문 v2 카나리 ===');
    for (const x of r.results) { console.log(`${x.fail ? '❌' : '✅'} ${x.name} — ${x.details[0]}`); fail += x.fail; }
    console.log(`\n검사 ${r.results.length}개 · 실패 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.stack || e.message); process.exit(2); });
}
