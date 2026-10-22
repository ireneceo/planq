// scripts/e2e/canary-mail-attach-order.js — 메일 상세 **카드 안 순서**.
//
// ★ 2026-09-18 (Irene): *"이메일 상세에 첨부파일 위치가 애매해. 내용에 바로 아래 첨부파일 있어야 할 것 같아."*
//   → 첨부는 본문 바로 아래.
// ★ 2026-10-22 (Irene): *"이메일에서 번역하기가 딱 방금 받은 내용 아래에 없어서 혼란스럽네 … 여러 번 대화한 경우
//   번역버튼 찾아가기 어렵고"* → Fable 판정 A: 번역 줄(언어·번역·이 메일 확인)은 **메시지 머리 바로 아래**.
//   그래서 계약이 «첨부 < 번역 줄» 에서 바뀌었다:
//     ① 번역 줄은 머리 바로 밑(간격 ≤16px) ② 번역 줄은 본문 위 ③ 첨부는 본문 아래
//     ④ 첨부가 카드의 끝 — 첨부 아래에 우리가 만든 블록(번역 줄·번역문·이 메일 확인)이 없다
//
// ★ **DOM 순서가 아니라 화면의 y 로 잰다**, 그리고 **한 카드 안에서** 잰다 — 문서 첫 요소끼리 비교하면
//   서로 다른 메일의 줄을 비교하게 된다(10-21 실측: 한 메일의 번역 줄이 다음 메일 머리 41px 위에 있었다).
//   손잡이는 확정 testid. 없으면 «미측정» — 못 쟀는데 통과로 세지 않는다.
// 폭 셋(1440·1024·390) — 한 폭만 재면 거짓 통과한다.
const b = require('./lib/browser');
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const BIZ = Number(process.env.E2E_BUSINESS_ID || 5);
const WIDTHS = [{ w: 1440, h: 900 }, { w: 1024, h: 768 }, { w: 390, h: 844, mobile: true }];

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: msg ? [msg] : [] });
  const unmeasured = (name, why) => results.push({ name, unmeasured: true, details: [why] });

  // 첨부가 실제로 달린 스레드 — 첨부 0건이면 «0건이라 통과» 가 된다.
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

  for (const vp of WIDTHS) {
    const { browser, page } = await b.launch({ mobile: !!vp.mobile });
    try {
      await page.setViewport({ width: vp.w, height: vp.h, ...(vp.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
      await b.login(page);
      await b.goto(page, `/mail?folder=all&thread=${threadId}`);
      await b.sleep(4500);

      const m = await page.evaluate(() => {
        const rect = (el) => {
          if (!el) return null;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return null;   // 안 그려진 것은 잰 것이 아니다
          return { top: Math.round(r.top), bottom: Math.round(r.bottom) };
        };
        // 첨부가 보이는 펼친 카드 하나
        const card = [...document.querySelectorAll('[data-testid="mail-message-card"]')]
          .find((c) => rect(c.querySelector('[data-testid="mail-attachments"]')));
        if (!card) return null;
        const q = (sel) => rect(card.querySelector(sel));
        return {
          id: card.getAttribute('data-message-id'),
          head: q('[data-testid="mail-message-header"]'),
          bar: q('[data-testid="mail-trans-bar"]'),
          body: q('[data-testid="mail-body-block"]'),
          attach: q('[data-testid="mail-attachments"]'),
          transBody: q('[data-testid="mail-trans-body"]'),
          brief: q('[data-testid="mail-brief-panel"]'),
          barBtnH: (() => { const el = card.querySelector('[data-testid="mail-trans-bar"] button'); return el ? Math.round(el.getBoundingClientRect().height) : null; })(),
        };
      });

      const tag = `${vp.w}`;
      if (!m || !m.head || !m.bar || !m.body || !m.attach) {
        unmeasured(`${tag} 카드 순서`, `손잡이를 못 찾았다 — ${JSON.stringify(m)} (thread ${threadId})`);
        continue;
      }
      const gap = m.bar.top - m.head.bottom;
      push(`${tag} ① 번역 줄은 머리 바로 밑`, gap >= 0 && gap <= 16, `머리 아래 ${m.head.bottom} · 번역 줄 ${m.bar.top} · 간격 ${gap}px`);
      push(`${tag} ② 번역 줄은 본문 위`, m.bar.top < m.body.top, `번역 줄 ${m.bar.top} · 본문 ${m.body.top}`);
      push(`${tag} ③ 첨부는 본문 아래`, m.attach.top > m.body.top, `본문 ${m.body.top} · 첨부 ${m.attach.top}`);
      const ours = Math.max(m.bar.bottom, m.transBody ? m.transBody.bottom : 0, m.brief ? m.brief.bottom : 0);
      push(`${tag} ④ 첨부가 카드 끝(아래에 우리 블록 없음)`, m.attach.top >= ours,
        `첨부 ${m.attach.top} · 우리 블록 끝 ${ours}${m.attach.top >= ours ? '' : ' ← ❌ 첨부 아래에 번역·확인 블록이 있다'}`);
      if (vp.mobile) push(`${tag} ⑤ 번역 버튼 터치 높이 ≥40`, (m.barBtnH || 0) >= 40, `버튼 높이 ${m.barBtnH}px`);
    } finally { try { await browser.close(); } catch { /* ignore */ } }
  }
  return results;
}

module.exports = { run, name: 'canary-mail-attach-order' };
