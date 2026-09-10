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
