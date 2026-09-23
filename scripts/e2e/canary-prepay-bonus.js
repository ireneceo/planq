// 「지금 결제하면 1개월 추가」 (2026-09-23) — 선불 2개월 선택지.
//   API 는 맞는데 **화면에 안 보이는** 계열이라 rect 가 아니라 «그려지는가» 로 잰다
//   (조상 클리핑 + elementFromPoint). 문구는 서버가 내려준 개월 수와 대조한다 —
//   화면이 «1개월» 을 하드코딩하면 정책을 바꿔도 안 따라오는데 눈으로는 구별이 안 된다.
//   ★ 모달 진입이 **실제 pending 결제를 만든다** → 검사기가 만든 행만 되돌린다.
const { launch, login, BASE, CREDS } = require('./lib/browser');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'phone', width: 375, height: 667 },
];

// 검사기가 이번 실행에서 만든 pending 결제/구독만 되돌린다 (since 로 좁혀 남의 행을 안 건드린다).
async function cleanupPending(bizId, since) {
  try {
    const [rows] = await sequelize.query(
      "SELECT id, subscription_id FROM payments WHERE business_id = ? AND status = 'pending' AND created_at >= ?",
      { replacements: [bizId, new Date(since)] }
    );
    if (!rows.length) return { clean: true, msg: '검사기가 남긴 pending 결제 없음' };
    for (const r of rows) {
      await sequelize.query('DELETE FROM payments WHERE id = ?', { replacements: [r.id] });
      if (r.subscription_id) {
        await sequelize.query("DELETE FROM subscriptions WHERE id = ? AND status = 'pending'", { replacements: [r.subscription_id] });
      }
    }
    const [left] = await sequelize.query(
      "SELECT COUNT(*) n FROM payments WHERE business_id = ? AND status = 'pending' AND created_at >= ?",
      { replacements: [bizId, new Date(since)] }
    );
    return Number(left[0].n) === 0
      ? { clean: true, msg: `pending 결제 ${rows.length}건 되돌림` }
      : { clean: false, msg: `🔴 ${left[0].n}건 남음 — 화면에 «미결제 청구» 가 뜬다` };
  } catch (e) { return { clean: false, msg: '🔴 정리 중 오류: ' + e.message }; }
}

// 요소가 붙고 **높이가 생길 때까지** 기다린다. 고정 sleep 으로 재면 거짓 실패가 난다
//   (2026-09-23 실측: 같은 코드가 1200ms 에선 미검출, 폴링하면 정상. 기능이 아니라 판정기가 틀린 것)
async function waitPainted(page, sel, ms = 8000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const ok = await page.evaluate((x) => {
      const el = document.querySelector(x);
      return !!el && el.getBoundingClientRect().height > 1;
    }, sel).catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// 실제로 그려지는가 — rect 만 보면 부모 height:0 + overflow:hidden 을 놓친다.
async function reallyVisible(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return { found: true, painted: false, reason: 'zero-rect' };
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0)
      return { found: true, painted: false, reason: 'css-hidden' };
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
    const cy = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
    const hit = document.elementFromPoint(cx, cy);
    const mine = hit && (el.contains(hit) || hit.contains(el));
    return {
      found: true, painted: !!mine, reason: mine ? 'ok' : 'covered',
      r: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  }, sel);
}

async function run() {
  const results = [];
  const add = (name, fail, msg) => results.push({ name, fail: fail ? 1 : 0, details: [msg], hasCanary: true });
  const startedAt = Date.now();
  let bizId = null;
  const { browser, page } = await launch();

  try {
    await login(page);
    // access token 은 프론트 메모리에만 있다 — 날 fetch 에 Authorization 을 직접 붙이지 않으면
    // 401 이 빈 객체로 돌아와 «자격 없음» 으로 **거짓 판정**된다(실제로 한 번 겪었다).
    const token = await page.evaluate(async (c) => {
      const r = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include', body: JSON.stringify(c),
      });
      const j = await r.json();
      return (j && j.data && (j.data.token || j.data.accessToken)) || null;
    }, CREDS);

    const api = await page.evaluate(async (tok) => {
      const H = { Authorization: `Bearer ${tok}` };
      const meR = await fetch('/api/auth/me', { credentials: 'include', headers: H });
      const me = await meR.json();
      const biz = me?.data?.business_id;
      if (!biz) return { biz: null, meStatus: meR.status };
      const st = await (await fetch(`/api/plan/${biz}/status`, { credentials: 'include', headers: H })).json();
      return { biz, prepay: st?.data?.prepay_bonus || null, exempt: st?.data?.exempt };
    }, token);

    if (!api.biz) {
      // 못 쟀으면 통과가 아니다 — 미측정을 실패로 낸다.
      add('prepay:측정', 1, `🔴 활성 워크스페이스를 못 읽었다 (me HTTP ${api.meStatus}) — 미측정`);
      return { results };
    }
    bizId = api.biz;
    add('prepay:status 필드', !api.prepay, `prepay_bonus=${JSON.stringify(api.prepay)}`);
    add('prepay:정책 개월', api.prepay?.months !== 1, `months=${api.prepay?.months} (정책 1)`);

    const shouldShow = !!api.prepay?.available && !api.exempt;

    for (const vp of VIEWPORTS) {
      await page.setViewport({ width: vp.width, height: vp.height });
      await page.goto(`${BASE}/business/settings/plan`, { waitUntil: 'networkidle2' }).catch(() => {});
      await waitPainted(page, '[data-testid="plan-prepay-bonus"]');
      const vis = await reallyVisible(page, '[data-testid="plan-prepay-bonus"]');

      if (!shouldShow) {
        // 자격이 없으면 «안 보이는 것» 이 정답이다 (음성 대조군).
        add(`prepay:${vp.name} 미노출`, !(vis.found && vis.painted), `자격없음 → ${vis.reason || 'absent'}`);
        continue;
      }
      add(`prepay:${vp.name} 그려짐`, !(vis.found && vis.painted),
        `${vis.reason || 'missing'} ${vis.r ? JSON.stringify(vis.r) : ''}`);
      if (!vis.painted) continue;

      const txt = await page.evaluate(() => {
        const b = document.querySelector('[data-testid="plan-prepay-bonus"]');
        const card = b && b.closest('div')?.parentElement?.parentElement;
        return card ? card.innerText.replace(/\s+/g, ' ').trim() : '';
      });
      add(`prepay:${vp.name} 문구 보간`,
        !(/개월|month/i.test(txt) && !/prepay\.|\{\{/.test(txt)), txt.slice(0, 100));
      add(`prepay:${vp.name} 환불 안내`, !/환불|refund/i.test(txt),
        /환불|refund/i.test(txt) ? '있음' : '🔴 없음 — 「취소하면 된다」만 남으면 오인된다');
      if (vp.name === 'phone') {
        add('prepay:폰 터치타겟', (vis.r?.h || 0) < 40, `h=${vis.r?.h} (≥40)`);
      }
    }

    if (shouldShow) {
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(`${BASE}/business/settings/plan`, { waitUntil: 'networkidle2' }).catch(() => {});
      await waitPainted(page, '[data-testid="plan-prepay-bonus"]');
      await page.click('[data-testid="plan-prepay-bonus"]').catch(() => {});
      // 모달은 열리자마자 checkout 을 친다 — **응답이 와야** 「이용 기간 2개월」이 그려진다.
      //   고정 대기로 재면 «모달은 열렸는데 2개월을 말하지 않는다» 로 거짓 실패한다.
      await waitPainted(page, '[aria-modal="true"]');
      for (let i = 0; i < 40; i++) {
        const said = await page.evaluate(() => {
          const m = document.querySelector('[aria-modal="true"]');
          return !!m && /2개월|2 months/.test(m.innerText || '');
        }).catch(() => false);
        if (said) break;
        await new Promise((r) => setTimeout(r, 250));
      }
      const modal = await page.evaluate(() => {
        const m = document.querySelector('[aria-modal="true"]');
        return m ? m.innerText.replace(/\s+/g, ' ').trim() : null;
      });
      add('prepay:모달 열림', !modal, modal ? modal.slice(0, 80) : '🔴 안 열림');
      // 서버가 보너스를 붙였으면 모달이 «2개월» 을 말해야 한다. 말 안 하면 사용자는 1개월로 안다.
      add('prepay:모달이 2개월을 말한다', !(modal && /2개월|2 months/.test(modal)),
        modal ? (modal.match(/이용 기간[^·]*/)?.[0] || modal.slice(0, 90)) : 'n/a');
    }
  } catch (e) {
    add('prepay:실행', 1, `🔴 ${e.message}`);
  } finally {
    await browser.close().catch(() => {});
    const c = await cleanupPending(bizId || 5, startedAt);
    add('prepay:원복', !c.clean, c.msg);
    // ★ 러너는 여러 카나리를 **한 프로세스**에서 돌린다. 여기서 닫으면 뒤 카나리가
    //   «연결이 닫혔다» 로 죽는다(2026-09-23 실측: leavelink 다음 prepay 의 원복이 실패했다).
    //   단독 실행일 때만 닫는다.
    if (require.main === module) await sequelize.close().catch(() => {});
  }
  return { results };
}

module.exports = { run: async () => (await run()).results, name: 'prepay' };

if (require.main === module) {
  run().then((r) => {
    let fail = 0;
    console.log('\n=== 선불 1개월 추가 카나리 ===');
    for (const x of r.results) { console.log(`${x.fail ? '❌' : '✅'} ${x.name} — ${x.details[0]}`); fail += x.fail; }
    console.log(`\n검사 ${r.results.length}개 · 실패 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.stack || e.message); process.exit(2); });
}
