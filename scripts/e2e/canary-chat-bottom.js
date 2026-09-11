// canary-chat-bottom — 채팅방을 열면 **마지막 메시지가 실제로 보이는가** (2026-09-10)
//
//   Irene: "채팅 알림 누르면 딱 가장 아래 채팅내용이 보여야 하는데 이상한 위치로 데려가.
//           이건 다양한 디바이스에서 다양한 상황에서 계속 그래.
//           채팅방 열면 무조건 딱 가장 아래 최신댓글이 보여야 하는데."
//
// 왜 코드로 못 보는가: "바닥으로 스크롤한다" 는 코드는 예전에도 있었다. 문제는 그 판정이
//   시간창(진입 후 2.5초)·증감 방향(`grew`)·거리(240px) 같은 **추정**이라, 조건이 어긋나면
//   조용히 풀렸다. 스크롤을 호출했는지가 아니라 **마지막 메시지가 눈에 있는지**를 재야 한다.
//   (memory feedback_measure_the_screen_not_innertext — rect 크기도 innerText 도 속인다)
//
// 재는 것 (뷰포트 3종 — 폰·태블릿·데스크탑):
//   ① 진입 직후 마지막 메시지가 보인다 (조상 클리핑 + elementFromPoint)
//   ② **포그라운드 복귀** 후에도 보인다 — 알림을 눌러 앱이 깨어나면 visibility 복원이
//      메시지를 다시 불러 목록을 갈아끼운다. 그때 옛 scrollTop 이 남아 목록 중간을 가리켰다.
//   ③ 음성 대조군 — 손으로 위로 올린 뒤에는 **바닥으로 끌어내리지 않는다**(고정이 풀린다).
//      이게 없으면 "언제나 바닥" 이라는 둔한 코드도 초록이 된다.
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const b = require('./lib/browser');

const BIZ = 5;
const OWNER = 5;           // health-check@planq.kr — b.CREDS 로 로그인하는 그 사람
const MSG_COUNT = 60;      // 스크롤이 생길 만큼

const VIEWPORTS = [
  { key: '폰 375×667', vp: { width: 375, height: 667, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  { key: '태블릿 768×1024', vp: { width: 768, height: 1024, deviceScaleFactor: 2 } },
  { key: '데스크탑 1440×900', vp: { width: 1440, height: 900 } },
];

// 마지막 메시지가 **그려져 있는가** — 리스트 rect 안 + 그 좌표의 elementFromPoint 가 자신/자손
const MEASURE = () => {
  const list = document.querySelector('[data-testid="qtalk-messages"]');
  if (!list) return { err: 'no_list' };
  const items = list.querySelectorAll('[data-msg-id]');
  if (!items.length) return { err: 'no_messages' };
  const last = items[items.length - 1];
  const lr = last.getBoundingClientRect();
  const cr = list.getBoundingClientRect();
  if (lr.width === 0 || lr.height === 0) return { err: 'zero_rect' };
  // 리스트 안에 들어와 있는가 (아래로 잘려 나가지 않았는가)
  const insideBottom = lr.bottom <= cr.bottom + 2;
  const insideTop = lr.top >= cr.top - 2;
  // 그 좌표에 실제로 그려졌는가 — 조상 클리핑·다른 층에 덮임까지 걸린다
  const x = Math.min(Math.max(lr.left + lr.width / 2, cr.left + 2), cr.right - 2);
  const y = Math.min(Math.max(lr.top + Math.min(lr.height / 2, 20), cr.top + 2), cr.bottom - 2);
  const hit = document.elementFromPoint(x, y);
  const painted = !!hit && (hit === last || last.contains(hit) || hit.contains(last));
  const distance = Math.round(list.scrollHeight - list.scrollTop - list.clientHeight);
  return {
    visible: insideBottom && insideTop && painted,
    insideBottom, insideTop, painted, distance,
    msgId: last.getAttribute('data-msg-id'),
    text: (last.innerText || '').replace(/\s+/g, ' ').slice(0, 40),
    hit: hit ? (hit.tagName + '.' + String(hit.className || '').split(' ')[0]) : 'null',
  };
};

async function seed() {
  const [convId] = await sequelize.query(
    `INSERT INTO conversations (business_id, title, channel_type, status, last_message_at, created_at, updated_at)
     VALUES (?, '[카나리] 바닥 스크롤', 'internal', 'active', NOW(), NOW(), NOW())`,
    { replacements: [BIZ] },
  );
  await sequelize.query(
    `INSERT INTO conversation_participants (conversation_id, user_id, role, joined_at, created_at)
     VALUES (?, ?, 'member', NOW(), NOW())`,
    { replacements: [convId, OWNER] },
  );
  // 오래된 것부터 — 마지막 것이 눈에 보여야 하는 그 메시지다.
  for (let i = 1; i <= MSG_COUNT; i++) {
    await sequelize.query(
      `INSERT INTO messages (conversation_id, sender_id, content, kind, created_at, updated_at)
       VALUES (?, ?, ?, 'text', DATE_SUB(NOW(), INTERVAL ? MINUTE), NOW())`,
      { replacements: [convId, OWNER, `[카나리] 메시지 ${i}${i === MSG_COUNT ? ' — 마지막' : ''}`, MSG_COUNT - i + 1] },
    );
  }
  return convId;
}

async function cleanup(convId) {
  if (!convId) return;
  await sequelize.query('DELETE FROM messages WHERE conversation_id = ?', { replacements: [convId] });
  await sequelize.query('DELETE FROM conversation_participants WHERE conversation_id = ?', { replacements: [convId] });
  await sequelize.query('DELETE FROM conversations WHERE id = ?', { replacements: [convId] });
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg] });
  let convId = null, browser = null;
  try {
    convId = await seed();
    const launched = await b.launch();
    browser = launched.browser;
    const page = launched.page;
    await b.login(page);

    for (const { key, vp } of VIEWPORTS) {
      await page.setViewport(vp);
      await b.goto(page, `/talk?conv=${convId}`);
      // 메시지가 붙을 때까지
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="qtalk-messages"] [data-msg-id]').length > 0,
        { timeout: 20000 },
      ).catch(() => null);
      await b.sleep(1200);

      // ① 진입 직후
      let m = await page.evaluate(MEASURE);
      push(`${key} · 진입 시 마지막 메시지 보임`, !m.err && m.visible,
        m.err ? `측정 실패: ${m.err}` : `"${m.text}" 바닥거리=${m.distance} 안쪽=${m.insideBottom}/${m.insideTop} 그려짐=${m.painted} hit=${m.hit}`);

      // ② 포그라운드 복귀 (알림 탭 = 앱이 깨어나는 그 경로) — 목록을 다시 불러 갈아끼운다
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await b.sleep(400);
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
      });
      await b.sleep(2000);
      m = await page.evaluate(MEASURE);
      push(`${key} · 포그라운드 복귀 후에도 보임`, !m.err && m.visible,
        m.err ? `측정 실패: ${m.err}` : `"${m.text}" 바닥거리=${m.distance} 그려짐=${m.painted}`);

      // ③ 음성 대조군 — 손으로 위로 올린 뒤에는 끌어내리지 않는다
      //    ★ 합성 이벤트로는 고정이 풀리지 않는다(사람 제스처만 푼다) → 실제 휠을 쓴다.
      const box = await page.evaluate(() => {
        const l = document.querySelector('[data-testid="qtalk-messages"]');
        if (!l) return null;
        const r = l.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      });
      if (box) {
        await page.mouse.move(box.x, box.y);
        await page.mouse.wheel({ deltaY: -1200 });
        await b.sleep(600);
        const up = await page.evaluate(MEASURE);
        // 위로 올렸으니 지금은 안 보이는 게 정상. 그 상태에서 복원 이벤트를 또 줘도 그대로여야 한다.
        await page.evaluate(() => {
          document.dispatchEvent(new Event('visibilitychange'));
          window.dispatchEvent(new Event('focus'));
        });
        await b.sleep(1500);
        const still = await page.evaluate(MEASURE);
        const released = up.distance > 240 && still.distance > 240;
        push(`${key} · 위로 올리면 고정이 풀린다(대조군)`, released,
          `올린 직후 바닥거리=${up.distance} · 복원 이벤트 후 =${still.distance} (둘 다 >240 이어야 함)`);
      } else {
        push(`${key} · 위로 올리면 고정이 풀린다(대조군)`, false, '리스트를 못 찾음');
      }

      // ④ **과거를 불러온 뒤** 바닥으로 돌아와서 포그라운드 복귀 — 신고의 실제 모양이다.
      //    복원이 최신 50건으로 통째 교체하면 목록이 짧아지고(과거 페이지 유실) 옛 scrollTop 이
      //    목록 중간을 가리켰다. 그러니 **개수가 줄지 않는지**와 **바닥인지**를 같이 잰다.
      if (box) {
        // 맨 위까지 올려 과거 로드를 부른다
        for (let i = 0; i < 12; i++) {
          await page.mouse.wheel({ deltaY: -1500 });
          await b.sleep(250);
        }
        await b.sleep(1500);
        const afterOlder = await page.evaluate(() =>
          document.querySelectorAll('[data-testid="qtalk-messages"] [data-msg-id]').length);
        // 다시 바닥으로 (손으로) → 고정이 되살아난다
        for (let i = 0; i < 20; i++) {
          await page.mouse.wheel({ deltaY: 2000 });
          await b.sleep(120);
        }
        await b.sleep(800);
        await page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
          document.dispatchEvent(new Event('visibilitychange'));
        });
        await b.sleep(300);
        await page.evaluate(() => {
          Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
          document.dispatchEvent(new Event('visibilitychange'));
          window.dispatchEvent(new Event('focus'));
        });
        await b.sleep(2200);
        const after = await page.evaluate(MEASURE);
        const count = await page.evaluate(() =>
          document.querySelectorAll('[data-testid="qtalk-messages"] [data-msg-id]').length);
        push(`${key} · 과거 로드 후 복귀에도 바닥`, !after.err && after.visible,
          after.err ? `측정 실패: ${after.err}` : `"${after.text}" 바닥거리=${after.distance} 그려짐=${after.painted}`);
        push(`${key} · 복원이 과거를 버리지 않는다`, count >= afterOlder,
          `과거 로드 후 ${afterOlder}건 → 복원 후 ${count}건`);
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // ⑤~⑩ — 2026-09-11 운영 #409 · #410 + Irene:
    //   #409 "모바일 채팅에서 대화할 때 바로 바로 쳐지는대로 화면스크롤이 안돼"
    //   #410 "누가 보내든 새 메시지 올라오면 안정적이게 화면이 위로 이동해야 하는데"
    //   Irene "알림왔을 때 채팅 가면 바로 가장 아래 … 키보드는 열지 말자.
    //          보통 말하려고 할 때 알아서 클릭하지 않아?"
    //   ★ 여태 이 카나리는 **들어가서 바라보기만** 했다 — 치지도, 보내지도, 알림 경로를 밟지도
    //     않았다. 그래서 위 신고 셋이 전부 초록 아래로 지나갔다.
    const INPUT_SEL = '[data-testid="qtalk-input"], textarea[enterkeyhint="send"]';
    const SEND_SEL = '[data-testid="qtalk-send"], textarea[enterkeyhint="send"] + button';
    const inputFocused = (sel) => { const el = document.querySelector(sel); return !!el && document.activeElement === el; };
    const inputHeight = (sel) => { const el = document.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().height) : 0; };
    const lastText = () => {
      const items = document.querySelectorAll('[data-testid="qtalk-messages"] [data-msg-id]');
      return items.length ? (items[items.length - 1].innerText || '') : '';
    };
    const TOUCH_VIEWPORTS = [
      { key: '터치폰 375×667', vp: { width: 375, height: 667, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
      { key: '터치태블릿 820×1180', vp: { width: 820, height: 1180, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
    ];
    // 소켓 도착 경로 — 로그인 rate-limit 을 먹지 않게 토큰을 직접 서명한다(같은 사람, 다른 연결).
    const jwt = require('/opt/planq/dev-backend/node_modules/jsonwebtoken');
    const apiToken = jwt.sign({ id: OWNER }, process.env.JWT_SECRET, { expiresIn: '10m' });
    const API = process.env.E2E_API || 'http://127.0.0.1:3003';
    const openConv = async () => {
      await b.goto(page, `/talk?conv=${convId}`);
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="qtalk-messages"] [data-msg-id]').length > 0,
        { timeout: 20000 },
      ).catch(() => null);
      await b.sleep(1200);
    };
    const listCenter = () => page.evaluate(() => {
      const l = document.querySelector('[data-testid="qtalk-messages"]');
      if (!l) return null;
      const r = l.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });

    for (const { key, vp } of TOUCH_VIEWPORTS) {
      await page.setViewport(vp);
      await openConv();

      // ⑤ 터치 기기는 방에 들어가도 입력란에 포커스를 주지 않는다 (= 키보드가 안 뜬다)
      const touchMq = await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches);
      const f0 = await page.evaluate(inputFocused, INPUT_SEL);
      push(`${key} · 진입 시 키보드 안 띄움`, touchMq && !f0, `터치판정=${touchMq} 입력란포커스=${f0}`);

      // ⑥ 줄이 늘어 입력란이 자라도 마지막 메시지가 입력란 바로 위에 붙어 있다 (#409)
      await page.click(INPUT_SEL);
      const h0 = await page.evaluate(inputHeight, INPUT_SEL);
      // ★ 기준은 "지금 쉬고 있는 바닥거리" 다 — 목록 아래 여백 때문에 바닥에 붙어 있어도 0 이 아닐 수 있다.
      //   절대값(≤4)으로 쟀더니 옛 코드가 쉬는 자리(15px)부터 빨간불이 떴다(판정 기계 오류, 2026-09-11 실측).
      const rest0 = (await page.evaluate(MEASURE)).distance ?? 0;
      let worst = 0; let hidden = 0; const trail = [];
      for (let i = 1; i <= 4; i++) {
        await page.keyboard.type(`canary line ${i}`);
        await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift');
        await b.sleep(200);
        const m = await page.evaluate(MEASURE);
        worst = Math.max(worst, m.distance ?? 9999);
        if (!m.visible) hidden++;
        trail.push(m.distance);
      }
      const h1 = await page.evaluate(inputHeight, INPUT_SEL);
      const grew = h1 - h0 >= 30;   // 검사기가 실제로 입력란을 키웠는가 — 안 자랐으면 아무것도 안 잰 것이다
      push(`${key} · 타이핑 중 마지막 메시지 유지`, grew && hidden === 0 && worst <= rest0 + 4,
        `입력란 ${h0}→${h1}px(자람=${grew}) · 쉬는 바닥거리=${rest0} · 줄마다=[${trail.join(',')}] · 가림 ${hidden}회`);
      await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await b.sleep(250);

      // ⑦⑧ 공통 — **프레임마다** 바닥거리를 적는다.
      //   몇 번 찍어 보는 것으로는 "올라가다 멈춘다" 를 못 본다: 부드러운 스크롤은 수십 ms 안에
      //   끝나 버려 60ms 샘플에는 이미 도착해 있다. 새 메시지가 붙은 뒤 **한 프레임이라도** 쉬는
      //   자리보다 떨어져 그려졌다면 사용자는 그 움직임을 본다.
      const startRec = (needle, ms) => {
        const l = document.querySelector('[data-testid="qtalk-messages"]');
        window.__chatRec = [];
        if (!l) return;
        const t0 = performance.now();
        const tick = () => {
          const it = l.querySelectorAll('[data-msg-id]');
          const has = it.length > 0 && (it[it.length - 1].innerText || '').includes(needle);
          window.__chatRec.push({ d: Math.round(l.scrollHeight - l.scrollTop - l.clientHeight), has });
          if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      };
      const judgeRec = (rec, rest) => {
        const withMsg = rec.filter((f) => f.has);
        const lag = withMsg.filter((f) => f.d > rest + 4);
        return { frames: withMsg.length, lag: lag.length, maxD: withMsg.reduce((a, f) => Math.max(a, f.d), 0) };
      };
      // ★ 프레임 기록만으로는 **옛 코드도 초록**이었다(2026-09-11 반증 실측) — 헤드리스는 짧은
      //   smooth 스크롤을 중간 프레임 없이 끝낸다. 그래서 **기전**을 같이 센다:
      //   따라가기에 smooth 가 걸리는가 · 목록 안 요소에 scrollIntoView 를 거는가(조상까지 굴린다).
      //   둘 다 실기기(iOS)에서 "올라가다 멈춘다" 의 재료이고, 헤드리스에서도 참/거짓이 갈린다.
      const instrScroll = () => {
        window.__scrollCalls = { smooth: 0, intoViewInList: 0 };
        if (window.__scrollInstr) return;
        window.__scrollInstr = true;
        const list = () => document.querySelector('[data-testid="qtalk-messages"]');
        const oSIV = Element.prototype.scrollIntoView;
        Element.prototype.scrollIntoView = function (a) {
          const l = list();
          if (l && l.contains(this)) window.__scrollCalls.intoViewInList++;
          if (a && typeof a === 'object' && a.behavior === 'smooth') window.__scrollCalls.smooth++;
          return oSIV.apply(this, arguments);
        };
        const oST = Element.prototype.scrollTo;
        Element.prototype.scrollTo = function (a) {
          if (a && typeof a === 'object' && a.behavior === 'smooth') window.__scrollCalls.smooth++;
          return oST.apply(this, arguments);
        };
      };

      // ⑦ 내가 보내면 **곧바로** 바닥 — 부드러운 스크롤이 중간에 걸려 있지 않다 (#410)
      const sendText = `canary send ${vp.width}-${Date.now() % 100000}`;
      await page.keyboard.type(sendText);
      await b.sleep(300);
      const rest1 = (await page.evaluate(MEASURE)).distance ?? 0;
      await page.evaluate(instrScroll);
      await page.evaluate(startRec, sendText, 900);
      await page.click(SEND_SEL);
      await b.sleep(1100);
      const j7 = judgeRec(await page.evaluate(() => window.__chatRec || []), rest1);
      const c7 = await page.evaluate(() => window.__scrollCalls);
      const m7 = await page.evaluate(MEASURE);
      push(`${key} · 보내면 즉시 바닥`, j7.frames > 0 && j7.lag === 0 && m7.visible && c7.smooth === 0 && c7.intoViewInList === 0,
        `쉬는 바닥거리=${rest1} · 보낸 글 프레임 ${j7.frames} 중 떨어져 그려진 ${j7.lag} (최대 ${j7.maxD}px) · smooth ${c7.smooth}회 · 목록 scrollIntoView ${c7.intoViewInList}회 · 끝 보임=${m7.visible}`);

      // ⑧ 다른 연결(소켓)로 도착한 새 메시지도 따라간다 (#410 "누가 보내든")
      const sockText = `canary socket ${vp.width}-${Date.now() % 100000}`;
      const rest2 = (await page.evaluate(MEASURE)).distance ?? 0;
      await page.evaluate(instrScroll);
      await page.evaluate(startRec, sockText, 3500);
      const r = await fetch(`${API}/api/projects/conversations/${convId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
        body: JSON.stringify({ content: sockText }),
      }).catch((e) => ({ ok: false, status: e.message }));
      await b.sleep(3700);
      const j8 = judgeRec(await page.evaluate(() => window.__chatRec || []), rest2);
      const c8 = await page.evaluate(() => window.__scrollCalls);
      const m8 = await page.evaluate(MEASURE);
      push(`${key} · 소켓 도착 메시지도 바닥`, r.ok && j8.frames > 0 && j8.lag === 0 && m8.visible && c8.smooth === 0 && c8.intoViewInList === 0,
        `POST=${r.status} · 쉬는 바닥거리=${rest2} · 도착 프레임 ${j8.frames} 중 떨어져 그려진 ${j8.lag} (최대 ${j8.maxD}px) · smooth ${c8.smooth}회 · 목록 scrollIntoView ${c8.intoViewInList}회 · 끝 보임=${m8.visible}`);

      // ⑨ 알림 탭 — 입력 중이고 위로 올려 둔 상태에서 알림을 누르면: 키보드를 내리고 바닥으로
      await page.click(INPUT_SEL);
      const c = await listCenter();
      if (c) { await page.mouse.move(c.x, c.y); await page.mouse.wheel({ deltaY: -1500 }); await b.sleep(600); }
      const beforeTap = await page.evaluate(MEASURE);
      const focusedBefore = await page.evaluate(inputFocused, INPUT_SEL);
      await page.evaluate((id) => window.dispatchEvent(
        new CustomEvent('planq:navigate', { detail: { path: `/talk?conv=${id}` } }),
      ), convId);
      await b.sleep(1200);
      const afterTap = await page.evaluate(MEASURE);
      const focusedAfter = await page.evaluate(inputFocused, INPUT_SEL);
      const prepared = focusedBefore && beforeTap.distance > 240;   // 준비 상태를 실제로 만들었는가
      push(`${key} · 알림 탭 → 키보드 내림 + 바닥`, prepared && !focusedAfter && afterTap.visible,
        `준비(포커스=${focusedBefore}, 바닥거리=${beforeTap.distance}) → 탭 후 포커스=${focusedAfter} 바닥거리=${afterTap.distance} 보임=${afterTap.visible}`);
    }

    // ⑩ 대조군 — 마우스 기기(데스크탑)는 종전대로 들어가자마자 칠 수 있다.
    //    이게 없으면 "어디서도 포커스 안 줌" 같은 둔한 코드도 ⑤ 를 통과한다.
    await page.setViewport({ width: 1440, height: 900 });
    await openConv();
    const fd = await page.evaluate(inputFocused, INPUT_SEL);
    push('데스크탑 1440×900 · 진입 시 입력란 포커스(대조군)', fd, `입력란포커스=${fd}`);
  } catch (e) {
    results.push({ name: 'canary-chat-bottom', fail: 0, fatal: 1, details: ['FATAL ' + e.message] });
  } finally {
    if (browser) await browser.close().catch(() => null);
    await cleanup(convId).catch(() => null);
  }
  return results;
}

module.exports = { run, name: 'canary-chat-bottom' };

if (require.main === module) {
  run().then((res) => {
    let bad = 0;
    console.log('\n=== 채팅방 바닥 스크롤 카나리 ===\n');
    for (const r of res) {
      const isBad = (r.fail || 0) + (r.fatal || 0) > 0;
      if (isBad) bad++;
      console.log(`${isBad ? '❌' : '✅'} ${r.name}`);
      (r.details || []).forEach((d) => console.log('     └ ' + d));
    }
    console.log(`\n총 문제: ${bad}`);
    sequelize.close().catch(() => null);
    process.exit(bad > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.message); process.exit(2); });
}
