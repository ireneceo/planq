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
    const inboxIds = new Set((inbox.items || []).filter((x) => x.ref.kind === 'email_thread').map((x) => x.ref.id));
    // ★ 2026-09-17 — **후보 칸을 뺐다.** 운영 22건 전수에 진짜 문의가 0건이었고(자동메일 오판),
    //   [상담으로 보내기] 0회 · [보관/무시] 7회 — 열어서 버리기만 했다.
    //   그래서 이제 «후보 칸이 있는가» 가 아니라 **«관계 없는 메일이 상담에 안 들어오는가»** 를 잰다.
    //   좁히는 기준(①)과 사람이 올리는 문(⑤ Q mail 우클릭)은 그대로 재므로 계약은 줄지 않았다.
    push('후보(관계 없음)는 상담 목록에 들어오지 않는다',
      typeof inbox.counts.candidate === 'undefined',
      `counts 에 candidate 키 없음 = ${typeof inbox.counts.candidate === 'undefined'} · 상담 ${inbox.counts.email}`);
    // ★ **확인완료한 것은 «행위로 증명된 관계» 일 때만 들어온다** (2026-09-17, Fable 15차 차단).
    //   주소 모양(personal)만으로 들이면 Q mail 에서 치운 은행 알림·회람·스팸이 되살아난다
    //   (운영 실측 owner 화면 4 → 48). 판정 단위로 양방향을 잰다.
    const V = (o) => mailThreadVerdict(o).kind;
    push('확인완료 + 답 없음 + 개인주소 → 상담에 안 들어온다',
      V({ email: 'hong.gildong@bank.co.kr', outboundCount: 0, archived: true }) === 'candidate');
    push('확인완료여도 **우리가 답했으면** 들어온다 (양성 대조군)',
      V({ email: 'hong.gildong@bank.co.kr', outboundCount: 1, archived: true }) === 'inquiry');
    push('확인완료여도 **사람이 올렸으면** 들어온다 (양성 대조군)',
      V({ email: 'hong.gildong@bank.co.kr', outboundCount: 0, archived: true, promoted: true }) === 'inquiry');
    push('확인완료가 아니면 개인주소 추정이 그대로 산다 (음성 대조군)',
      V({ email: 'hong.gildong@bank.co.kr', outboundCount: 0, archived: false }) === 'inquiry');

    // ── ③ 사람이 올리는 문 — 여전히 작동하는가 (진입점은 Q mail 이다) ──
    //   후보 칸이 없어졌어도 **문은 닫히면 안 된다.** 관계 없는 메일 하나를 직접 올려 본다.
    const noRel = await sequelize.query(
      // ★ `archived` 는 집지 않는다 — 승격이 dev 스레드 상태를 바꾸면 다음 검사가 오염된다
      //   (memory `feedback_canary_pollutes_next_suite`). 되돌릴 수 있는 것만 고른다.
      `SELECT t.id FROM email_threads t WHERE t.business_id = ? AND t.client_id IS NULL
         AND t.triage = 'human' AND t.status NOT IN ('spam','archived') LIMIT 50`,
      { replacements: [bizId], type: sequelize.QueryTypes.SELECT });
    const notInInbox = (noRel || []).map((r) => r.id).find((id) => !inboxIds.has(id));
    if (notInInbox) {
      const pr = await fetch(`${API}/api/sale/${bizId}/inbox/promote`, {
        method: 'POST', headers: H, body: JSON.stringify({ kind: 'email_thread', id: notInInbox }),
      });
      promoted.push(notInInbox);
      const after = await get('?limit=200');
      const afterIds = new Set((after.items || []).filter((x) => x.ref.kind === 'email_thread').map((x) => x.ref.id));
      push('★ [상담으로 보내기] 가 그 메일을 실제로 상담에 올린다',
        pr.status === 200 && afterIds.has(notInInbox),
        `status=${pr.status} · 상담 ${inbox.counts.email} → ${after.counts.email}`);
    } else {
      push('올릴 대상(상담 밖 메일)을 찾지 못했다', null, '픽스처 없음 — 재지 못했다');
    }

    // ── ④ 화면 — **후보 칩이 없어야 한다** (있으면 지운 기능이 되살아난 것이다) ──
    const b2 = await launch();          // 러너 계약 — launch() 는 { browser, page } 를 준다
    browser = b2.browser;
    const page = b2.page;
    await login(page, CREDS);
    await page.goto(`${BASE}/sale?tab=inbox`, { waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1200));
    const chipGone = await page.evaluate(() =>
      !document.querySelector('[data-testid="sale-inbox-source-candidate"]'));
    push('후보 칩이 화면에 없다 (지운 기능이 되살아나지 않았다)', chipGone);

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
