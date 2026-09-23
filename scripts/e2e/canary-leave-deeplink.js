// 휴가 알림 딥링크 (#424, 2026-09-23) — `?leave=<id>` 를 **읽는 곳이 0곳**이라 알림을 눌러도
//   그 신청이 어디 있는지 알 수 없었다(사용자에겐 «알림은 오는데 화면이 안 뜬다»).
//   ★ 링크는 서버가 만들고(services/leaveTransition.js) 화면이 읽는다 — 양쪽을 같이 잰다.
//   ★ 이미 처리된 신청은 대기 목록에 없다 → 그때도 막다른 길이 아닌지 확인한다.
const { launch, login, BASE, CREDS } = require('./lib/browser');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');

async function apiToken(page) {
  return page.evaluate(async (c) => {
    const r = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      credentials: 'include', body: JSON.stringify(c),
    });
    const j = await r.json();
    return (j && j.data && (j.data.token || j.data.accessToken)) || null;
  }, CREDS);
}

// 행이 붙을 때까지 기다린다. **고정 sleep 으로 재면 거짓 실패가 난다** —
//   2026-09-23 실측: 2000ms 로 재니 h=0 이었는데 2500ms 프로브에선 y=434·h=62 로 멀쩡했다.
//   기능이 아니라 판정기가 틀린 것이었다(memory feedback_false_fail_suspect_the_judge).
async function waitForRow(page, id, ms = 8000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const ok = await page.evaluate((rid) => {
      const el = document.querySelector(`[data-row-id="${rid}"]`);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.height > 1;           // DOM 에 있는 것만으로는 부족 — 실제 높이가 생겨야 한다
    }, id).catch(() => false);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

// 행이 실제로 그려지고 강조됐는가 — rect 만 보면 부모 클리핑을 놓친다.
//   ★ **탭 keep-alive 때문에 같은 `data-row-id` 가 여러 개 있을 수 있다.**
//     앞서 본 화면이 숨겨진 채 트리에 남아 있어서, `querySelector` 하나만 보면
//     **숨은 사본**을 집어 h=0 으로 읽는다(2026-09-23 실측: 직접 열면 y=434·h=62 인데
//     관리자 화면을 거쳐 오면 h=0). 기능이 아니라 판정기가 틀린 것이다.
//     그래서 전부 훑어 **보이는 것**으로 판정하고, 몇 개였는지도 같이 남긴다.
async function rowState(page, id) {
  return page.evaluate((rid) => {
    const all = [...document.querySelectorAll(`[data-row-id="${rid}"]`)];
    if (!all.length) return { found: false, count: 0 };
    const seen = all.map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const painted = r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none';
      return {
        painted, border: cs.borderTopColor, shadow: cs.boxShadow,
        r: { y: Math.round(r.y), h: Math.round(r.height) },
        inViewport: r.top < innerHeight && r.bottom > 0,
      };
    });
    const vis = seen.find((x) => x.painted) || seen[0];
    return { found: true, count: all.length, ...vis };
  }, id);
}

async function run() {
  const results = [];
  const add = (name, fail, msg) => results.push({ name, fail: fail ? 1 : 0, details: [msg], hasCanary: true });
  let leaveId = null;
  const { browser, page } = await launch();

  try {
    await login(page);
    const token = await apiToken(page);
    const biz = await page.evaluate(async (tok) => {
      const me = await (await fetch('/api/auth/me', { credentials: 'include', headers: { Authorization: `Bearer ${tok}` } })).json();
      return me?.data?.business_id || null;
    }, token);
    if (!biz) { add('leave:측정', 1, '🔴 활성 워크스페이스를 못 읽었다 — 미측정'); return { results }; }

    // ── 픽스처: 휴가 신청 1건 (dev 에 0건이라 만들어야 한다. 빈 목록으로는 «0건=정상» 이 되어 버린다) ──
    const d = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const made = await page.evaluate(async (tok, b, day) => {
      const r = await fetch('/api/leave/requests', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ business_id: b, leave_type: 'paid', unit: 'full_day', start_date: day, end_date: day, reason: '딥링크 검사' }),
      });
      const j = await r.json().catch(() => null);
      return { status: r.status, id: j?.data?.id || null, body: JSON.stringify(j).slice(0, 160) };
    }, token, biz, d);
    add('leave:픽스처 생성', !made.id, `HTTP ${made.status} id=${made.id} ${made.id ? '' : made.body}`);
    if (!made.id) return { results };
    leaveId = made.id;

    // ── 서버가 만드는 링크 형태가 화면이 읽는 것과 같은가 (양쪽 계약) ──
    const fs = require('fs');
    const src = fs.readFileSync('/opt/planq/dev-backend/services/leaveTransition.js', 'utf8');
    add('leave:서버 링크 형태', !/settings\/attendance\?leave=/.test(src) || !/attendance\?tab=leave&leave=/.test(src),
      '관리자·신청자 링크 둘 다 `?leave=` 를 만든다');

    // ── ① 관리자 화면 (대기 중) ──
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${BASE}/business/settings/attendance?leave=${leaveId}`, { waitUntil: 'networkidle2' }).catch(() => {});
    await waitForRow(page, leaveId);
    const admin = await rowState(page, leaveId);
    add('leave:관리자 행 보임', !(admin.found && admin.painted), `${JSON.stringify(admin.r || {})} found=${admin.found} count=${admin.count}`);
    add('leave:관리자 강조', !(admin.border && admin.border !== 'rgb(226, 232, 240)'),
      `border=${admin.border} shadow=${(admin.shadow || '').slice(0, 40)}`);
    add('leave:관리자 화면 안', !admin.inViewport, `inViewport=${admin.inViewport}`);

    // ── 음성 대조군: leave 파라미터가 없으면 강조가 없어야 한다 ──
    await page.goto(`${BASE}/business/settings/attendance`, { waitUntil: 'networkidle2' }).catch(() => {});
    await waitForRow(page, leaveId);
    const plain = await rowState(page, leaveId);
    add('leave:파라미터 없으면 강조 없음(음성)', !(plain.found && plain.border === 'rgb(226, 232, 240)'),
      `border=${plain.border}`);

    // ── ② 신청자 화면 ──
    await page.goto(`${BASE}/attendance?tab=leave&leave=${leaveId}`, { waitUntil: 'networkidle2' }).catch(() => {});
    await waitForRow(page, leaveId);
    const mine = await rowState(page, leaveId);
    add('leave:신청자 행 보임', !(mine.found && mine.painted), `found=${mine.found} count=${mine.count} ${JSON.stringify(mine.r || {})}`);
    add('leave:신청자 강조', !(mine.border && mine.border !== 'rgb(226, 232, 240)'), `border=${mine.border}`);

    // ── ②-b 운영에 실제로 남아 있는 **옛 링크 형태** (`?tab=team&leave=`) ──
    //   운영 알림 #1848 이 이 모양이다(2026-09-21). `tab=team` 은 폐기돼 설정으로 리다이렉트되는데,
    //   그때 `leave=` 를 **들고 가지 않으면** 옛 알림은 여전히 막다른 길이다
    //   (memory feedback_legacy_data_sample_verify — 신규 형식만 통과시키면 옛 데이터가 샌다).
    await page.goto(`${BASE}/attendance?tab=team&leave=${leaveId}`, { waitUntil: 'networkidle2' }).catch(() => {});
    await waitForRow(page, leaveId);
    const legacy = await rowState(page, leaveId);
    const landed = await page.evaluate(() => location.pathname + location.search);
    add('leave:옛 링크(tab=team)도 닿는다', !(legacy.found && legacy.painted), `→ ${landed}`);
    add('leave:옛 링크에서도 강조', !(legacy.border && legacy.border !== 'rgb(226, 232, 240)'), `border=${legacy.border}`);

    // ── ③ 이미 처리된 신청도 막다른 길이 아닌가 (승인 후 같은 링크) ──
    // ★ 승인이 아니라 **반려**로 처리한다 — 승인은 잔여 연차가 있어야 통과한다
    //   (`insufficient_leave_balance`, 제품 규칙). 검사 목적은 «pending 이 아니게 만드는 것» 이다.
    const decided = await page.evaluate(async (tok, id) => {
      const r = await fetch(`/api/leave/requests/${id}/reject`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ decide_note: '검사' }),
      });
      return r.status;
    }, token, leaveId);
    add('leave:반려 처리', decided !== 200, `HTTP ${decided}`);
    await page.goto(`${BASE}/business/settings/attendance?leave=${leaveId}`, { waitUntil: 'networkidle2' }).catch(() => {});
    // 안내 줄이 붙을 때까지 기다린다(여기도 고정 sleep 으로 재지 않는다).
    for (let i = 0; i < 32; i++) {
      const seen = await page.evaluate(() => !!document.querySelector('[data-testid="leave-linked-decided"]')).catch(() => false);
      if (seen) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const note = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="leave-linked-decided"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { text: el.innerText.trim(), painted: r.width > 1 && r.height > 1 };
    });
    add('leave:처리된 건 안내 표시', !(note && note.painted), note ? note.text.slice(0, 80) : '🔴 없음 — 링크가 막다른 길');
    add('leave:안내가 키 노출 아님', !(note && !/linkedDecided|\{\{/.test(note.text)), note ? note.text.slice(0, 60) : 'n/a');
  } catch (e) {
    add('leave:실행', 1, `🔴 ${e.message}`);
  } finally {
    await browser.close().catch(() => {});
    // 픽스처 원복 — 남기면 다음 사람 화면에 «검사용 휴가» 가 뜬다.
    if (leaveId) {
      try {
        await sequelize.query('DELETE FROM leave_requests WHERE id = ?', { replacements: [leaveId] });
        const [[left]] = await sequelize.query('SELECT COUNT(*) n FROM leave_requests WHERE id = ?', { replacements: [leaveId] });
        add('leave:원복', Number(left.n) !== 0, Number(left.n) === 0 ? '픽스처 삭제됨' : '🔴 남아 있다');
      } catch (e) { add('leave:원복', 1, '🔴 ' + e.message); }
    }
    // 러너는 한 프로세스에서 여러 카나리를 돌린다 — 단독 실행일 때만 닫는다.
    if (require.main === module) await sequelize.close().catch(() => {});
  }
  return { results };
}

module.exports = { run: async () => (await run()).results, name: 'leavelink' };

if (require.main === module) {
  run().then((r) => {
    let fail = 0;
    console.log('\n=== 휴가 딥링크 카나리 ===');
    for (const x of r.results) { console.log(`${x.fail ? '❌' : '✅'} ${x.name} — ${x.details[0]}`); fail += x.fail; }
    console.log(`\n검사 ${r.results.length}개 · 실패 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.stack || e.message); process.exit(2); });
}
