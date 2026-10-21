#!/usr/bin/env node
// canary-mail-search-reply — 검색 중 답장을 보내고, 보내는 사이 검색을 지우고 탭을 옮겨도
//   목록이 «지금 탭 · 검색 없음» 으로 남는가.
//
// 신고 (Irene 2026-10-21): "메일 검색 후 답변한 다음 탭을 이동해도 리스트가 맞게 안나왔어. 검색을 지웠는데도."
//
// 무엇이 문제였나 — 답장 발송은 await 뒤에 loadList() 를 부른다. 그 loadList 는 **보내기를 누른 순간의**
//   검색어·탭을 쥐고 있어서, 발송(SMTP, 수 초)이 끝나는 순간 옛 조건으로 목록을 다시 읽고 가장 새 순번을
//   받아 지금 화면을 덮어썼다. 그래서 검색을 지우고 탭을 옮긴 뒤에 옛 검색 결과가 다시 나타났다.
//
// ★ 진짜 메일이 나가면 안 되므로 답장 요청은 가로채 4초 늦게 «성공» 으로 답한다(외부 발송 0).
//   대조군: 고치기 전 빌드에서 마지막 두 판정이 FAIL 했다(2026-10-21 실측 — 마지막 목록 요청 folder=all&q=기율, 화면 30행 전부 옛 검색 결과).
const b = require('./lib/browser');

const QUERY = process.env.MSR_QUERY || '기율';
const FROM = 'all';
const TO = 'uncertain';
const DELAY_MS = 4000;

const results = [];
const P = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });

async function rowIds(page) {
  return page.$$eval('[data-thread-id]', (els) => els.map((e) => Number(e.getAttribute('data-thread-id'))));
}

async function run() {
  const { browser, page } = await b.launch();
  try {
    await b.login(page);
    await page.setViewport({ width: 1440, height: 900 });
    await page.setRequestInterception(true);
    let replyHits = 0;
    const listReqs = [];
    page.on('request', (req) => {
      if (req.method() === 'POST' && /\/email-threads\/\d+\/messages(\?|$)/.test(req.url())) {
        replyHits += 1;
        setTimeout(() => {
          req.respond({ status: 200, contentType: 'application/json',
            body: JSON.stringify({ success: true, data: { id: 0, delivery_status: 'sent', sent_at: new Date().toISOString() } }) }).catch(() => {});
        }, DELAY_MS);
        return;
      }
      if (req.method() === 'GET' && /\/email-threads\?folder=/.test(req.url()) && /offset=0/.test(req.url())) listReqs.push(req.url());
      req.continue().catch(() => {});
    });

    await b.goto(page, `/mail?folder=${FROM}`);
    await page.waitForSelector('[data-thread-id]', { timeout: 30000 });
    const search = await page.waitForSelector('input[aria-label="메일 검색"], input[placeholder*="메일 검색"]');
    await search.click();
    await search.type(QUERY);
    await new Promise((r) => setTimeout(r, 2500));
    const searched = await rowIds(page);
    if (!searched.length) { P(`'${QUERY}' 검색 결과가 있다 (0건 = 판정 불가)`, false, '0건'); return results; }

    await page.click(`[data-thread-id="${searched[0]}"]`);
    const openBtn = await page.waitForSelector('[data-testid="mail-reply-open"]', { timeout: 20000 });
    await openBtn.click();
    const editor = await page.waitForSelector('[data-testid="mail-reply-composer"] [contenteditable="true"]', { timeout: 20000 });
    await editor.click();
    await page.keyboard.type('[확인용] 검색 후 답장 카나리');
    const sendBtn = await page.evaluateHandle(() => Array.from(document.querySelectorAll('[data-testid="mail-reply-composer"] button'))
      .find((x) => x.textContent && x.textContent.trim() === '보내기'));
    if (!sendBtn || !(await sendBtn.asElement())) { P('보내기 버튼을 찾았다', false, '없음'); return results; }
    await sendBtn.asElement().click();

    // 보내는 사이: 검색 지우기 → 다른 탭
    await new Promise((r) => setTimeout(r, 400));
    await page.click('button[aria-label="검색 지우기"]');
    await new Promise((r) => setTimeout(r, 150));
    await page.click(`[data-testid="mail-folder-${TO}"]`);
    await new Promise((r) => setTimeout(r, DELAY_MS + 3500));

    P('답장 요청을 가로챘다(실제 발송 0)', replyHits === 1, `가로챈 수 ${replyHits}`);
    const val = await page.$eval('input[aria-label="메일 검색"], input[placeholder*="메일 검색"]', (e) => e.value);
    P('검색칸이 비어 있다', val === '', `값 «${val}»`);
    const url = new URL(page.url());
    P(`주소가 ${TO} 탭이다`, url.searchParams.get('folder') === TO, page.url());

    const shown = await rowIds(page);
    // 정답 = 서버가 지금 조건(검색 없음 · TO 탭)으로 주는 첫 쪽
    const API = 'http://127.0.0.1:3003/api';
    const lj = await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: b.CREDS.email, password: b.CREDS.password }) })).json();
    const H = { Authorization: `Bearer ${lj.data.token}` };
    const biz = lj.data.user?.active_business_id || lj.data.active_business_id || 5;
    const ej = await (await fetch(`${API}/businesses/${biz}/email-threads?folder=${TO}&limit=30&offset=0`, { headers: H })).json();
    const expected = (ej.data || []).map((t) => Number(t.id));
    const same = shown.length > 0 && shown.slice(0, expected.length).every((id, i) => id === expected[i]);
    P(`목록이 «${TO} 탭 · 검색 없음» 서버 응답과 같다`, same,
      `화면 앞 5 ${shown.slice(0, 5).join(',')} / 서버 앞 5 ${expected.slice(0, 5).join(',')} · 화면 ${shown.length}행 중 검색 결과와 겹침 ${shown.filter((id) => searched.includes(id)).length}`);
    const lastListReq = listReqs[listReqs.length - 1] || '';
    P('마지막 목록 요청이 지금 조건(검색 없음·새 탭)이다',
      /folder=uncertain/.test(lastListReq) && !/[?&]q=/.test(lastListReq), lastListReq.replace(/^.*\/api/, '/api'));
  } finally {
    await browser.close();
  }
  return results;
}

module.exports = { name: 'mailsearchreply', run };
if (require.main === module) {
  run().then((r) => {
    for (const x of r) console.log(`${x.fail ? '❌' : '✅'} ${x.name}${x.details.length ? ' — ' + x.details.join(' ') : ''}`);
    process.exit(r.some((x) => x.fail) ? 1 : 0);
  }).catch((e) => { console.error(e); process.exit(2); });
}
