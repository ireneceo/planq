// 파일 휴지통 카나리 — 2026-08-29 신설. ⚠️ **아직 run.js 스위트에 등록하지 않았다.**
//
//   이유: 깨끗한 통과를 한 번도 못 봤다. 실패는 전부 앱이 아니라 환경이었다 —
//   `/files` 는 파일 수만큼 썸네일을 요청해서, 검증하느라 여러 번 열면 그것만으로
//   API rate-limit(600회/분)을 넘긴다. 그러면 다음 부팅의 refresh 가 429 를 받아
//   **로그인 화면으로 튕기고**, 카나리는 그것을 "화면이 안 떴다" 로 읽는다(진단에 경로=/login).
//   원인을 알고 고쳤지만(파일 화면을 한 번만 연다) 그 뒤로도 rate-limit 창이 안 열려 미확인이다.
//
//   기능 자체는 실 HTTP 14/14 + 화면 실측(데스크탑 /files 에서 휴지통 버튼 존재)으로 검증했다.
//   한 번이라도 초록을 보면 그때 run.js 에 등록한다. **확인 안 된 게이트는 넣지 않는다** —
//   멀쩡한 화면을 빨갛게 만드는 게이트는 곧 무시되고, 그 순간 진짜 회귀도 같이 통과한다.
//
// 왜: 삭제가 되돌려지지 않는다는 것은 **화면이 없어서** 드러나지 않았다. DB 에 deleted_at 은
//   찍혔고 아무도 그것이 복구 불가라는 걸 몰랐다(2026-08-28 정정). 그래서 이 카나리는
//   "라우트가 있다" 가 아니라 **사용자가 실제로 되돌릴 수 있는가**를 화면에서 본다.
//
// ★ 자기 진단 필수 — 휴지통이 비어 있으면 "복구 버튼이 없다" 와 "정상" 이 같은 얼굴이다.
//   그래서 카나리가 **직접 파일을 올리고 지운 뒤** 그것이 목록에 오는지 본다.
const b = require('./lib/browser');
const BASE = process.env.E2E_BASE || 'https://dev.planq.kr';

async function run() {
  const results = [];
  const { browser, page } = await b.launch();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    // ★ 씨앗을 심는 동안 /files 를 열지 않는다. 파일 화면은 썸네일 요청이 파일 수만큼 나가서,
    //   한 세션에서 두 번 열면 그것만으로 API rate-limit(600회/분)을 넘긴다. 그러면 다음 부팅의
    //   refresh 가 429 를 받아 **로그인 화면으로 튕기고**, 카나리는 그것을 "화면이 안 떴다" 로
    //   읽는다(2026-08-29 실측 — 진단에 경로=/login 이 찍혀 드러났다).
    //   그래서 가벼운 화면에서 씨앗을 심고, /files 는 **딱 한 번만** 연다.
    await b.goto(page, '/inbox');
    await b.sleep(2000);

    // 0) 준비 — 카나리 전용 파일을 올리고 지운다 (판정 대상 확보)
    const seeded = await page.evaluate(async () => {
      const bizId = (window).__pqBizId || null;
      const me = await (await fetch('/api/auth/me', {
        headers: { Authorization: 'Bearer ' + (window.__pqGetToken ? window.__pqGetToken() : '') },
      })).json().catch(() => null);
      const biz = bizId || me?.data?.business_id;
      if (!biz) return { ok: false, why: 'business_id 없음' };
      const tok = window.__pqGetToken ? window.__pqGetToken() : null;
      if (!tok) return { ok: false, why: 'token 없음' };
      const name = 'canary-trash-' + Date.now() + '.txt';
      const fd = new FormData();
      fd.append('file', new Blob(['canary'], { type: 'text/plain' }), name);
      const up = await fetch(`/api/files/${biz}`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok }, body: fd });
      const uj = await up.json();
      const id = uj?.data?.id || uj?.data?.[0]?.id;
      if (!id) return { ok: false, why: '업로드 실패 ' + up.status };
      const del = await fetch(`/api/files/${biz}/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } });
      return { ok: del.ok, id, name, biz, why: del.ok ? '' : '삭제 실패 ' + del.status };
    });
    if (!seeded.ok) {
      results.push({ name: 'seed', ok: false, msg: `🔴 판정 대상을 못 만들었다 — ${seeded.why}` });
      return results;
    }

    // 1) 휴지통 진입점이 화면에 있는가 (백엔드만 있고 화면이 없던 것이 이 기능의 병이었다)
    //   ★ reload + 고정 sleep 으로 재면 안 된다 — 화면이 아직 안 그려진 것을 "버튼이 없다" 로
    //     읽어 **멀쩡한 기능을 빨갛게** 만든다(2026-08-29 실측 오탐). 화면이 준비됐다는
    //     양성 신호(files-ready)를 기다린 뒤에 본다.
    await b.goto(page, '/files');
    for (let i = 0; i < 24 && !(await page.$('[data-testid="files-ready"]')); i++) await b.sleep(500);
    if (!(await page.$('[data-testid="files-ready"]'))) {
      // 판정 불가일 때 **왜** 인지 같이 남긴다 — 안 그러면 앱 버그와 하니스 오염이 같은 얼굴이다.
      const diag = await page.evaluate(() => ({
        path: location.pathname,
        len: document.body.innerText.length,
        head: document.body.innerText.slice(0, 70).replace(/\s+/g, ' '),
        ids: [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')).slice(0, 8),
      }));
      results.push({
        name: 'trash/진입점', ok: false,
        msg: `🔴 파일 화면이 끝내 안 떴다 — 판정 불가 · 경로=${diag.path} 글자=${diag.len} "${diag.head}" ids=[${diag.ids.join(',')}]`,
      });
      return results;
    }
    const opener = await page.$('[data-testid="files-trash-open"]');
    results.push({
      name: 'trash/진입점', ok: !!opener,
      msg: opener ? '파일 화면에 휴지통 버튼이 있다' : '🔴 휴지통으로 들어갈 방법이 화면에 없다',
    });
    if (!opener) return results;

    // 2) 열면 방금 지운 파일이 보이는가
    await opener.click();
    await b.sleep(2500);
    const listed = await page.evaluate((nm) => {
      const rows = [...document.querySelectorAll('[data-testid="trash-row"]')];
      return { count: rows.length, mine: rows.some((r) => r.innerText.includes(nm)) };
    }, seeded.name);
    results.push({
      name: 'trash/목록', ok: listed.mine,
      msg: listed.mine ? `방금 지운 파일이 휴지통에 보인다 (행 ${listed.count})`
                       : `🔴 지운 파일이 휴지통에 없다 (행 ${listed.count})`,
    });

    // 3) 복구 버튼을 눌러 **실제로 되살아나는가** — 존재 검사로 끝내지 않는다
    const clicked = await page.evaluate((nm) => {
      const row = [...document.querySelectorAll('[data-testid="trash-row"]')].find((r) => r.innerText.includes(nm));
      if (!row) return false;
      const btn = row.querySelector('[data-testid="trash-restore"]');
      if (!btn) return false;
      btn.click(); return true;
    }, seeded.name);
    await b.sleep(3000);
    const restored = clicked && await page.evaluate(async (s) => {
      const tok = window.__pqGetToken ? window.__pqGetToken() : null;
      const r = await fetch(`/api/files/${s.biz}?limit=1000`, { headers: { Authorization: 'Bearer ' + tok } });
      const j = await r.json();
      return (j.data || []).some((f) => f.id === s.id || String(f.id) === `direct-${s.id}`);
    }, seeded);
    results.push({
      name: 'trash/복구', ok: !!restored,
      msg: restored ? '복구를 누르면 파일이 실제로 목록에 되살아난다'
                    : `🔴 복구가 되지 않았다 (버튼 클릭 ${clicked})`,
    });

    // 뒷정리 — 카나리가 만든 파일은 지운다(검증 데이터 원복)
    await page.evaluate(async (s) => {
      const tok = window.__pqGetToken ? window.__pqGetToken() : null;
      await fetch(`/api/files/${s.biz}/${s.id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } });
      await fetch(`/api/files/${s.biz}/${s.id}/purge`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + tok } });
    }, seeded);
  } finally { await browser.close(); }
  return results;
}

function toRunnerShape(rows) {
  return rows.map((r) => ({ name: r.name, fail: r.ok ? 0 : 1, details: [r.msg], hasCanary: true }));
}
module.exports = { run: async () => toRunnerShape(await run()), name: 'trash' };

if (require.main === module) {
  run().then((res) => {
    let fail = 0;
    console.log('\n=== 파일 휴지통 카나리 ===');
    for (const r of res) { console.log(`${r.ok ? '✅' : '❌'} ${r.name} — ${r.msg}`); if (!r.ok) fail++; }
    console.log(`\n검사 ${res.length}개 · 실패 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
