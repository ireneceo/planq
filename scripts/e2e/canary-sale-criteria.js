// canary-sale-criteria — Q sale 상담에 **무엇이 들어오는가**, 그리고 사람이 올리는 문 (2026-09-16)
//
//   Irene: *"Q sale에서 상담리스트에서 메일이 너무 쓸데없이 많이 들어와. 그냥 신청하라는 홍보메일도
//           가져오면 어떻게 해? 영업 상담으로 가져오는 기준설정 좀 잡아봐.
//           그리고 메일목록에서, 채팅 메시지에서, 상담리스트로 보내기 기능이 있어야 할 것 같아. 그치?"*
//
//   기준을 **관계**로 바꿨다(services/saleMailCriteria) — 우리가 답했거나 · 개인 주소에서 온 것만
//   자동으로 들어오고, 나머지는 「후보」로 간다. 좁힌 기준과 [상담으로 보내기] 는 **한 벌**이다.
//
//   ★ 판정만 재면 절반만 재는 것이다 — 기준이 옳아도 **화면에 후보 칸이 없으면** 걸러진 것을
//     볼 길이 없고, 그때 사용자는 "메일이 사라졌다" 로 읽는다. 그래서 서버 판정 + 화면 + 왕복을 같이 잰다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const { mailThreadVerdict } = require('/opt/planq/dev-backend/services/saleMailCriteria');
const { launch, login } = require('./lib/browser');

const BASE = process.env.E2E_BASE || 'https://dev.planq.kr';
const API = process.env.E2E_API || 'http://localhost:3003';
const CREDS = { email: 'health-check@planq.kr', password: 'HealthCheck2026!' };

async function run() {
  const results = [];
  const push = (name, ok, detail) => results.push({ name, route: name, leaked: !ok, detail });
  let browser = null;
  const promoted = [];          // 정리 대상 — 이 검사가 만든 판단 기록

  try {
    // ── ① 술어 자체 — 실제로 들어왔던 주소로 가른다(지어낸 예로 재지 않는다) ──
    const real = [
      ['tradekorea@kita.net', 0, 'candidate'],          // "수출상담회 참가 신청" — 신고의 그 홍보메일
      ['help@withmin.info', 0, 'candidate'],            // 쇼핑몰 주문 알림 10건
      ['savings@mp1.tripadvisor.com', 0, 'candidate'],  // 광고
      ['email_center@lottecardmailcenter.net', 0, 'candidate'], // 역할어 두 토막 — 이름처럼 보이는 함정
      ['11st@ems.11st.co.kr', 0, 'candidate'],          // local 이 도메인 이름
      ['joannelow98@gmail.com', 0, 'inquiry'],          // 진짜 문의(임대차 초안)
      ['tropicanaavenue21@gmail.com', 0, 'inquiry'],    // 진짜 문의(수도요금)
      ['ahmadaqmalbin.shaifulkharidan@concentrix.com', 0, 'inquiry'], // 이름 두 토막
      ['bandarutama@anytimefitness.my', 2, 'inquiry'],  // 우리가 답한 스레드 = 관계
    ];
    const wrong = real.filter(([e, o, want]) => mailThreadVerdict({ email: e, outboundCount: o }).kind !== want);
    push('기준이 운영 실측 9건을 정확히 가른다 (홍보 5 · 문의 4)', wrong.length === 0,
      wrong.length ? `틀린 것: ${wrong.map((w) => w[0]).join(', ')}` : '9/9 일치');

    // 양성 대조군 — 관계가 생기면(우리가 답하면) 같은 주소도 상담이 된다
    push('양성 대조군 — 답장하면 같은 주소도 상담이 된다',
      mailThreadVerdict({ email: 'tradekorea@kita.net', outboundCount: 1 }).kind === 'inquiry',
      '기준은 주소가 아니라 **관계**다');
    // 음성 대조군 — 사람이 올리지 않았는데 저절로 올라오지 않는다
    push('음성 대조군 — 올리지 않은 홍보메일은 그대로 후보',
      mailThreadVerdict({ email: 'tradekorea@kita.net', outboundCount: 0, promoted: false }).kind === 'candidate', '');

    // ── ② 서버 — 두 칸이 겹치지 않고, 숫자와 목록이 같은 것을 센다 ──
    const lg = await (await fetch(API + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(CREDS),
    })).json();
    const token = lg?.data?.token || lg?.data?.accessToken;
    const [[biz]] = await sequelize.query(
      `SELECT bm.business_id id FROM business_members bm JOIN users u ON u.id = bm.user_id
       WHERE u.email = ? AND bm.removed_at IS NULL ORDER BY bm.business_id LIMIT 1`,
      { replacements: [CREDS.email] });
    const bizId = biz && biz.id;
    const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const get = async (qs) => (await (await fetch(`${API}/api/sale/${bizId}/inbox${qs}`, { headers: H })).json()).data;

    const inbox = await get('?limit=200');
    const cands = await get('?source=candidate&limit=200');
    const inboxIds = new Set((inbox.items || []).filter((x) => x.ref.kind === 'email_thread').map((x) => x.ref.id));
    const candIds = (cands.items || []).map((x) => x.ref.id);
    const overlap = candIds.filter((id) => inboxIds.has(id));
    push('한 메일은 한 칸에만 있다 (상담 ∩ 후보 = 0)', overlap.length === 0,
      `상담 ${inbox.counts.email} · 후보 ${inbox.counts.candidate} · 겹침 ${overlap.length}`);
    push('후보 숫자가 응답에 있다 (없으면 칩이 영원히 0이다)',
      typeof inbox.counts.candidate === 'number', `candidate=${inbox.counts.candidate}`);
    push('후보는 «답할 차례» 로 세지 않는다 (그 숫자는 할 일의 수다)',
      (cands.items || []).every((x) => !x.needs_reply), `후보 ${candIds.length}건 중 needs_reply 0`);

    // ── ③ 사람이 올리는 문 — 실제로 목록이 바뀌는가 ──
    const target = (cands.items || [])[0];
    if (target) {
      const pr = await fetch(`${API}/api/sale/${bizId}/inbox/promote`, {
        method: 'POST', headers: H, body: JSON.stringify({ kind: 'email_thread', id: target.ref.id }),
      });
      promoted.push(target.ref.id);
      const after = await get('?limit=200');
      const afterIds = new Set((after.items || []).filter((x) => x.ref.kind === 'email_thread').map((x) => x.ref.id));
      push('★ [상담으로 보내기] 가 그 메일을 실제로 상담에 올린다', pr.status === 200 && afterIds.has(target.ref.id),
        `status=${pr.status} · 상담 ${inbox.counts.email} → ${after.counts.email}`);
      push('올린 만큼 후보에서 빠진다 (두 칸의 합이 보존된다)',
        after.counts.candidate === inbox.counts.candidate - 1,
        `후보 ${inbox.counts.candidate} → ${after.counts.candidate}`);
    } else {
      push('후보가 있어야 승격을 잴 수 있다', false, '후보 0건 — 이 검사는 무효다(빈 픽스처로 통과시키지 않는다)');
    }

    // ── ④ 화면 — 후보 칸이 실제로 보이고 눌리는가 ──
    const b = await launch();          // 러너 계약 — launch() 는 { browser, page } 를 준다
    browser = b.browser;
    const page = b.page;
    await login(page, CREDS);
    await page.goto(`${BASE}/sale?tab=inbox`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1200));
    const chip = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="sale-inbox-source-candidate"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const mid = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { text: (el.textContent || '').trim(), w: Math.round(r.width), h: Math.round(r.height),
        hit: !!mid && (el === mid || el.contains(mid)) };
    });
    push('후보 칩이 화면에 그려지고 실제로 눌린다', !!chip && chip.w > 0 && chip.h > 0 && chip.hit,
      chip ? `"${chip.text}" ${chip.w}x${chip.h} 클릭가능=${chip.hit}` : '칩 없음');

    if (chip && chip.hit) {
      await page.click('[data-testid="sale-inbox-source-candidate"]');
      await new Promise((r) => setTimeout(r, 1200));
      const promoteBtn = await page.evaluate(() => {
        const b = document.querySelector('[data-testid^="sale-inbox-promote-"]');
        if (!b) return null;
        const r = b.getBoundingClientRect();
        return { label: (b.textContent || '').trim(), w: Math.round(r.width), h: Math.round(r.height) };
      });
      push('후보 칸의 행에 [상담으로 보내기] 가 있다', !!promoteBtn && promoteBtn.w > 0,
        promoteBtn ? `"${promoteBtn.label}" ${promoteBtn.w}x${promoteBtn.h}` : '버튼 없음 — 후보를 볼 수만 있고 올릴 수 없다');
    }

    // ── ⑤ 메일 목록 — 우클릭 메뉴에 [상담으로 보내기] 가 나온다 ──
    await page.goto(`${BASE}/mail`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1800));
    const menu = await page.evaluate(async () => {
      const row = document.querySelector('[data-testid="mail-thread-row"][data-pq-context]');
      if (!row) return { reason: '우클릭 선언이 붙은 행이 없다' };
      const r = row.getBoundingClientRect();
      row.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 10,
      }));
      await new Promise((res) => setTimeout(res, 300));
      const texts = [...document.querySelectorAll('button, [role="menuitem"]')]
        .map((b) => (b.textContent || '').trim()).filter(Boolean);
      return { items: texts.filter((x) => x.includes('상담으로')) };
    });
    push('메일 목록 행을 우클릭하면 [상담으로 보내기] 가 나온다',
      !!menu.items && menu.items.length > 0, menu.reason || `항목: ${(menu.items || []).join(' / ') || '없음'}`);
  } catch (e) {
    push('카나리 실행', false, String((e && e.message) || e));
  } finally {
    if (browser) { try { await browser.close(); } catch { /* 이미 닫힘 */ } }
    // 이 검사가 만든 판단 기록만 지운다 — 남기면 다음 회차의 기준선이 달라진다
    for (const id of promoted) {
      await sequelize.query(
        `DELETE FROM audit_logs WHERE action='mail.triage_correct' AND target_type='email_thread'
           AND target_id = ? AND JSON_EXTRACT(new_value,'$.origin')='sale_inbox_promote'
           AND created_at >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)`,
        { replacements: [id] }).catch(() => {});
    }
  }
  return results;
}

module.exports = { run, name: 'salecriteria' };
