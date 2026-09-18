// scripts/e2e/canary-mail-attach-order.js — 메일 상세에서 **첨부가 본문 바로 아래**인가.
//
// ★ 2026-09-18 신고 (Irene): *"이메일 상세에 첨부파일 위치가 애매해. 내용에 바로 아래 첨부파일
//   있어야 할 것 같아. 이전 대화보기가 본문이라면 그 아래에 첨부파일 나와야지.
//   번역이랑 메일내용 요약정리 하는 것보다 첨부파일이 아래에 나와야 하지 않아?"*
//
//   첨부는 **받은 메일에 딸려 온 것**이고 번역·요약은 우리가 덧붙이는 것이다. 받은 것이 먼저다.
//   여태는 [본문 → 번역줄 → 번역문 → 요약 → 첨부] 라 긴 메일에서 첨부를 찾으려면 한참 내려야 했다.
//
// ★ **DOM 순서가 아니라 화면의 y 로 잰다.** JSX 순서만 보면 CSS(order·flex-direction·grid-row·
//   position)로 뒤집혀 있어도 초록이다 — 이 저장소에서 여러 번 겪은 계열이다.
//   손잡이도 휴리스틱이 아니라 **확정 testid**를 쓴다(§17). 없으면 «미측정» 으로 실패시킨다 —
//   못 쟀는데 통과로 세는 것이 가장 나쁘다.
const b = require('./lib/browser');
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const BIZ = Number(process.env.E2E_BUSINESS_ID || 5);

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: msg ? [msg] : [] });
  const unmeasured = (name, why) => results.push({ name, unmeasured: true, details: [why] });

  // 첨부가 실제로 달린 스레드를 고른다 — 첨부 0건 스레드로 재면 «0건이라 통과» 가 된다.
  const [rows] = await sequelize.query(
    `SELECT m.thread_id AS tid, COUNT(a.id) n
       FROM email_attachments a
       JOIN email_messages m ON m.id = a.message_id
       JOIN email_threads t ON t.id = m.thread_id
      WHERE t.business_id = ?
      GROUP BY m.thread_id
      HAVING n BETWEEN 1 AND 6
      ORDER BY n DESC LIMIT 1`, { replacements: [BIZ] });
  if (!rows.length) return [{ name: 'canary-mail-attach-order', unmeasured: true, details: ['첨부 달린 스레드가 없다 — 판정 불가'] }];
  const threadId = rows[0].tid;

  const { browser, page } = await b.launch();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    await b.goto(page, `/mail?folder=all&thread=${threadId}`);
    await b.sleep(4000);

    const m = await page.evaluate(() => {
      const yOf = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        // 보이지 않는 것은 잰 것이 아니다 — 크기 0 이면 없는 것으로 본다.
        if (r.width === 0 || r.height === 0) return null;
        return Math.round(r.top + window.scrollY);
      };
      return {
        body: yOf('[data-testid="mail-body-block"]'),
        attach: yOf('[data-testid="mail-attachments"]'),
        trans: yOf('[data-testid="mail-trans-bar"]'),
      };
    });

    if (m.body === null || m.attach === null || m.trans === null) {
      unmeasured('첨부 위치', `손잡이를 못 찾았다 — body=${m.body} attach=${m.attach} trans=${m.trans} (thread ${threadId})`);
    } else {
      push('첨부는 본문 **아래**', m.attach > m.body, `본문 y=${m.body} · 첨부 y=${m.attach}`);
      push('첨부는 번역/요약 줄 **위**', m.attach < m.trans,
        `첨부 y=${m.attach} · 번역줄 y=${m.trans}${m.attach < m.trans ? '' : ' ← ❌ 첨부가 번역·요약 뒤에 있다'}`);
    }
  } finally { try { await browser.close(); } catch { /* ignore */ } }
  return results;
}

module.exports = { run, name: 'canary-mail-attach-order' };
