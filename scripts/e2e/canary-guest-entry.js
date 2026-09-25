// canary-guest-entry — 게스트 링크(`/g/:token`)가 **누가 보낸 것인지 말하는가** (2026-09-24, P0-①)
//
// 왜: 이 무인증 표면을 기계로 재는 검사가 **하나도 없었다**(Fable 2026-09-24 지적). 발신자 표시를
//   넣은 라운드는 Fable 이 손으로 쟀지만, 다음에 누가 응답을 넓히거나 헤더를 바꾸면 막을 것이 없다.
//   설계 docs/CLIENT_ENTRY_DESIGN.md §5 P0-① · §6 «카나리를 P1 **전에** 만든다».
//
// 재는 것 (2026-09-25 — **워크스페이스 창구 scope='workspace'** 축 추가, docs/CLIENT_ENTRY_DESIGN.md §5 P1)
//   창구 — 발급 멱등(살아 있는 것 하나) · 공유 링크는 방이 없다(conversation null·쓰기 404) ·
//          `entry` 키가 **정확히** 4개(+contact 4개) · 프로젝트 탭 라우트 404 · 4탭이 **그려지는가**(3폭) ·
//          확인 전 「문의하기」가 **이유를 말하는가** · 옛 scope 응답에 `entry` 키 **없음**(양성 대조군)
//   서버 — 응답 `workspace` 키가 정확히 {name, logo_url} · 옛 top-level 키 무변경 · 원문에 금지 문자열 0 ·
//          외부 로고 주소는 null(화이트리스트가 살아 있는가 — DB 를 바꿨다 되돌린다) · 회수하면 404
//   화면 — 폰·태블릿·데스크탑에서 로고·이름이 **그려져 있는가**(elementFromPoint) · 가로 스크롤 없음 · 밴드1 높이
//   대조군 — 응답에서 `workspace` 를 지운 채 같은 판정을 돌려 **빨간불이 켜지는가**(안 켜지면 검사기가 죽은 것)
//
// ★ 픽스처·판정용 호출은 **Node 에서** 한다(브라우저 안 fetch 는 서버가 느려지면 하니스를 죽인다 —
//   memory feedback_fixture_inside_browser_kills_harness). 브라우저는 화면을 재는 데만 쓴다.
// ★ 발급한 링크·그림자 사용자는 끝에서 **지운다**(회수만 하면 행이 쌓인다).
const { launch, login, sleep, BASE, CREDS } = require('./lib/browser');

const API = process.env.E2E_API || 'http://localhost:3003';
const OLD_KEYS = ['account_requested', 'can_write', 'client_name', 'conversation', 'guest_name', 'project', 'scope'];
// 응답 **원문**으로 판정한다 — 키 이름만 보면 중첩·새 경로로 빠져나간다(health-check --category=secrets 와 같은 이유).
const FORBIDDEN = [/business_id/, /"slug"/, /@/, /user_id/, /owner/, /"phone"/, /"email"/, /brand_/, /legal_/, /subscription/];
const SYMBOL = /^\/api\/businesses\/symbol\/[0-9a-f-]+\.(png|jpe?g|gif|webp|svg)$/i;
// ★ 창구(scope='workspace')는 **연락처를 일부러 싣는다**(§4.2 안내 탭) — 그래서 위 FORBIDDEN 을
//   그대로 쓸 수 없다. 완화가 아니라 **다른 목록**이다: 옛 scope 는 위 목록 그대로 판정하고(그쪽은
//   연락처가 새면 안 된다), 창구는 아래 목록으로 판정한다. 한 목록을 느슨하게 고치면 옛 scope 의
//   빨간불을 끄는 것이 된다(memory feedback_red_check_may_be_real_bug).
// ★ 2026-09-25 Fable ⑤ — 처음에 `owner`·`brand_` 도 뺐는데 **둘 다 창구 원문에 0건**이었다.
//   걸리지도 않는 것을 뺀 것은 **이유 없는 완화**다(빨간불을 미리 끈 것). 되살렸다.
//   옛 FORBIDDEN 중 창구에서 실제로 걸리는 것은 `@`·`"phone"`·`"email"` 셋뿐이고 그건 설계상 의도된
//   연락처다(§4.2 안내 탭). 그 셋만 빠진다 — 그 외는 옛 목록과 같다.
const FORBIDDEN_WS = [/business_id/, /"slug"/, /user_id/, /legal_/, /tax_id/, /representative/,
  /biz_type/, /biz_item/, /"plan"/, /subscription/, /work_hours/, /token_hash/, /invite_token/,
  /owner/, /brand_/];
// 2026-09-25 P2 — `booking`({enabled, duration_minutes}) 이 더해졌다(예약 탭을 보일지). 의도한 확장이고
//   그 안의 키도 아래 ENTRY_BOOKING_KEYS 로 **정확히** 잰다(담당 멤버·하루 상한이 새면 실패).
const ENTRY_KEYS = 'booking,contact,intro,services,tagline';
const ENTRY_BOOKING_KEYS = 'duration_minutes,enabled';
const ENTRY_CONTACT_KEYS = 'address,email,phone,website';
const WS_TABS = ['info', 'chat', 'mine', 'projects'];
const VIEWPORTS = [
  { w: 375, h: 667, mobile: true },
  { w: 768, h: 1024, mobile: false },
  { w: 1440, h: 900, mobile: false },
];

let _tok = null;
async function api(path, init = {}) {
  if (!_tok) {
    const r = await fetch(`${API}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: CREDS.email, password: CREDS.password }),
    });
    const j = await r.json().catch(() => ({}));
    _tok = j.data && (j.data.token || j.data.accessToken);
  }
  const r = await fetch(`${API}${path}`, {
    ...init, headers: { Authorization: `Bearer ${_tok}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await r.text();
  let body = null; try { body = JSON.parse(text); } catch { /* */ }
  return { status: r.status, body, text };
}

// 검사가 만든 방문자 대화방 — 정리에서 지운다(안 지우면 Q Talk·Q sale 상담 탭에 쌓인다).
const createdRooms = [];
let _seq = null;
async function sql(q, replacements) {
  if (!_seq) {
    require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
    ({ sequelize: _seq } = require('/opt/planq/dev-backend/config/database'));
  }
  const [rows] = await _seq.query(q, { replacements });
  return rows;
}

/** 한 화면을 잰다. strip=true 면 응답에서 workspace 를 지운다(대조군). */
async function measure(browser, token, vp, strip) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: vp.w, height: vp.h, isMobile: vp.mobile, hasTouch: vp.mobile });
    if (strip) {
      await page.setRequestInterception(true);
      page.on('request', async (req) => {
        if (req.method() === 'GET' && new RegExp(`/api/guest/${token}$`).test(req.url())) {
          try {
            const r = await fetch(req.url());
            const j = await r.json();
            if (j && j.data) delete j.data.workspace;
            return req.respond({ status: r.status, contentType: 'application/json', body: JSON.stringify(j) });
          } catch { return req.continue(); }
        }
        return req.continue();
      });
    }
    await page.goto(`${BASE}/g/${token}`, { waitUntil: 'networkidle2', timeout: 45000 });
    // 제목이 그려질 때까지 — 이름을 기다리면 대조군(이름 없음)이 늘 타임아웃까지 간다.
    await page.waitForFunction(() => /\S/.test(document.body.innerText || ''), { timeout: 20000 }).catch(() => null);
    await sleep(1200);
    return await page.evaluate(() => {
      const drawn = (sel) => {
        const el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().height > 1);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 8), r.top + r.height / 2);
        return {
          x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
          hit: !!hit && (el === hit || el.contains(hit) || hit.contains(el)),
          inView: r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth,
          text: (el.textContent || '').trim(),
        };
      };
      const mark = drawn('[data-testid="public-workspace-mark"]');
      const name = drawn('[data-testid="public-workspace-name"]');
      let band = null;
      const m = document.querySelector('[data-testid="public-workspace-mark"]');
      for (let b = m && m.parentElement; b; b = b.parentElement) {
        if (getComputedStyle(b).borderBottomWidth !== '0px') { band = Math.round(b.getBoundingClientRect().height); break; }
      }
      return { mark, name, band, hscroll: document.documentElement.scrollWidth > window.innerWidth + 1 };
    });
  } finally { await page.close().catch(() => {}); }
}

/** 창구 화면 한 폭 — 4탭이 **그려져 있는가**(좌표 + elementFromPoint). */
async function measureDesk(browser, token, vp) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: vp.w, height: vp.h, isMobile: vp.mobile, hasTouch: vp.mobile });
    await page.goto(`${BASE}/g/${token}`, { waitUntil: 'networkidle2', timeout: 45000 });
    await page.waitForFunction(() => !!document.querySelector('[data-testid="guest-tab-info"]'), { timeout: 20000 })
      .catch(() => null);
    await sleep(900);
    return await page.evaluate((tabs) => {
      const shot = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        if (r.height < 1 || r.width < 1) return { drawn: false, w: Math.round(r.width), h: Math.round(r.height) };
        // ★ 크기만 재지 않는다 — 조상이 overflow:hidden 이면 rect 가 있어도 한 픽셀도 안 그려진다.
        const hit = document.elementFromPoint(r.left + Math.min(r.width / 2, 10), r.top + r.height / 2);
        return {
          drawn: true, x: Math.round(r.left), y: Math.round(r.top),
          w: Math.round(r.width), h: Math.round(r.height),
          hit: !!hit && (el === hit || el.contains(hit) || hit.contains(el)),
          text: (el.textContent || '').trim().slice(0, 30),
        };
      };
      const t = {};
      for (const k of tabs) t[k] = shot(`[data-testid="guest-tab-${k}"]`);
      return {
        tabs: t,
        body: shot('[data-testid="guest-tab-body-info"]'),
        mark: shot('[data-testid="public-workspace-mark"]'),
        notify: shot('[data-testid="guest-notify"]'),
        // 창구에서는 신원 띠에 닫기(×)가 없어야 한다 — 닫으면 방문자가 갈 곳이 없다.
        hasClose: !!document.querySelector('[data-testid="guest-notify"] button[aria-label]'),
        hscroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    }, WS_TABS);
  } finally { await page.close().catch(() => {}); }
}

/**
 * E6 — 옛 scope 링크의 방이 비면 **부모도 자식도** 닫히는가.
 *   픽스처: 살아 있는 공유 링크가 없는 customer 대화방에 conversation 링크를 새로 발급하고
 *   개인 링크 자식을 하나 만든 뒤(확인 상태로 토큰을 붙인다) 부모의 방을 NULL 로 만든다.
 *   ★ 정상 상태에서 둘 다 200 인 것을 **먼저** 확인한다 — 안 그러면 «원래 안 열리는 것» 을
 *     닫혔다고 오판한다(음성 대조군).
 */
async function runE6(push, unmeasured, biz, issuedWs) {
  // ★ **내 워크스페이스 안에서만** 고른다. 전에 전체에서 골라 남의 워크스페이스 대화방을 집었고
  //   발급이 403 이 되어 검사가 **미측정**으로 빠졌다(초록으로 새지는 않았다 — 러너가 미측정을
  //   통과로 세지 않는다). 범위 인자를 빠뜨리면 전체를 훑는다(memory feedback_scoped_call_optional_means_leaky).
  const cv = await sql(
    "SELECT c.id, c.business_id FROM conversations c WHERE c.business_id=? AND c.channel_type='customer'"
    + " AND (c.status IS NULL OR c.status<>'archived') AND c.archived_at IS NULL"
    + " AND NOT EXISTS (SELECT 1 FROM guest_links g WHERE g.conversation_id=c.id"
    + "   AND g.kind='shared' AND g.revoked_at IS NULL AND g.expires_at > NOW()) LIMIT 1", [biz]);
  if (!cv.length) { unmeasured('E6 회귀', '이 워크스페이스에 살아 있는 링크가 없는 customer 대화방이 없다'); return; }
  const r = await api(`/api/conversations/${cv[0].business_id}/${cv[0].id}/guest-links`, { method: 'POST', body: '{}' });
  const tok = (r.body?.data?.url || '').split('/g/')[1];
  if (r.status !== 201 || !tok) { unmeasured('E6 회귀', `대화 링크 발급 ${r.status}`); return; }
  issuedWs.push(r.body.data.id);   // 정리 루프가 자식까지 같이 지운다

  const mail = `e6-canary-${Date.now()}@example.com`;
  await fetch(`${API}/api/guest/${tok}/notify/request`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'E6', email: mail, consent: true, locale: 'ko' }),
  });
  const kid = await sql('SELECT id FROM guest_links WHERE contact_email=? ORDER BY id DESC LIMIT 1', [mail]);
  if (!kid.length) { unmeasured('E6 회귀', '개인 링크 생성 실패'); return; }

  // 확인을 마친 것과 같은 상태로 토큰을 붙인다(파생 토큰이라 저장하지 않는다).
  const dbg = require('/opt/planq/dev-backend/services/guest_link');
  const { GuestLink } = require('/opt/planq/dev-backend/models');
  const kl = await GuestLink.findByPk(kid[0].id);
  await kl.update({ email_verified_at: new Date() });
  const ktok = await dbg.mintPersonalToken(kl);
  if (!ktok) { unmeasured('E6 회귀', 'personal 토큰 생성 실패(GUEST_LINK_SECRET?)'); return; }

  const p0 = await fetch(`${API}/api/guest/${tok}`);
  const k0 = await fetch(`${API}/api/guest/${ktok}`);
  push('E6 (음성 대조) 정상 상태에서는 부모·자식 둘 다 200',
    p0.status === 200 && k0.status === 200, `부모=${p0.status} 자식=${k0.status}`);

  await sql('UPDATE guest_links SET conversation_id=NULL WHERE id=?', [r.body.data.id]);
  const p1 = await fetch(`${API}/api/guest/${tok}`);
  const k1 = await fetch(`${API}/api/guest/${ktok}`);
  push('E6: 옛 scope 부모의 방이 비면 **자식도** 404 (부모만 닫히면 실패)',
    p1.status === 404 && k1.status === 404, `부모=${p1.status} 자식=${k1.status}`);
}

/**
 * D1 — 창구 개인 링크가 **남의 방**을 가리키면 닫히는가(참여자 소유 검사).
 *   사용자가 이 값을 정할 HTTP 경로는 없지만, 창구에서 «부모와 같은 방» 검사를 면제했으므로
 *   링크와 방을 잇는 검사가 **무엇이든** 있어야 한다.
 */
async function runD1(push, unmeasured, biz, deskToken, issuedWs) {
  void issuedWs;
  if (!deskToken) { unmeasured('D1 회귀', '창구 토큰 없음'); return; }
  const mail = `d1-canary-${Date.now()}@example.com`;
  await fetch(`${API}/api/guest/${deskToken}/notify/request`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'D1', email: mail, consent: true, locale: 'ko' }),
  });
  const kid = await sql('SELECT id FROM guest_links WHERE contact_email=? ORDER BY id DESC LIMIT 1', [mail]);
  if (!kid.length) { unmeasured('D1 회귀', '개인 링크 생성 실패'); return; }

  // OTP 를 아는 값으로 심고 정상 확인 흐름을 지난다 — 그래야 방·참여자가 실제로 생긴다.
  const crypto = require('crypto');
  const code = '135791';
  await sql('UPDATE guest_links SET otp_hash=?, otp_expires_at=DATE_ADD(NOW(), INTERVAL 5 MINUTE),'
    + ' otp_attempts=0, otp_locked_until=NULL WHERE id=?',
  [crypto.createHash('sha256').update(code).digest('hex'), kid[0].id]);
  const ver = await fetch(`${API}/api/guest/${deskToken}/notify/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: mail, code }),
  });
  const vj = await ver.json().catch(() => null);
  const ptok = vj?.data?.personal_token;
  const row = await sql('SELECT conversation_id FROM guest_links WHERE id=?', [kid[0].id]);
  const room = row[0]?.conversation_id;
  if (room) createdRooms.push(room);
  if (!ptok || !room) { unmeasured('D1 회귀', `확인 실패 token=${!!ptok} room=${room}`); return; }

  const other = await sql(
    "SELECT id FROM conversations WHERE business_id=? AND channel_type='customer' AND id<>? LIMIT 1",
    [biz, room]);
  if (!other.length) { unmeasured('D1 회귀', '비교할 다른 customer 대화방이 없다'); return; }

  await sql('UPDATE guest_links SET conversation_id=? WHERE id=?', [other[0].id, kid[0].id]);
  const hop = await fetch(`${API}/api/guest/${ptok}`);
  const hopMsg = await fetch(`${API}/api/guest/${ptok}/messages`);
  push('D1: 창구 개인 링크가 남의 방을 가리키면 404 (ctx·메시지 둘 다)',
    hop.status === 404 && hopMsg.status === 404, `ctx=${hop.status} messages=${hopMsg.status}`);

  await sql('UPDATE guest_links SET conversation_id=? WHERE id=?', [room, kid[0].id]);
  const back = await fetch(`${API}/api/guest/${ptok}`);
  push('D1 (음성 대조) 자기 방으로 되돌리면 다시 200', back.status === 200, `ctx=${back.status}`);
}

/** D2 회복 — 방에서 빠진 방문자는 404, **이메일을 다시 확인하면** 자기 방으로 돌아온다(Fable 설계). */
async function runD2(push, unmeasured, deskToken) {
  if (!deskToken) { unmeasured('D2 회복', '창구 토큰 없음'); return; }
  const crypto = require('crypto');
  const mail = `d2-canary-${Date.now()}@example.com`;
  const verify = async (code) => {
    await sql('UPDATE guest_links SET otp_hash=?, otp_expires_at=DATE_ADD(NOW(), INTERVAL 5 MINUTE),'
      + ' otp_attempts=0, otp_locked_until=NULL WHERE contact_email=?',
    [crypto.createHash('sha256').update(code).digest('hex'), mail]);
    const r = await fetch(`${API}/api/guest/${deskToken}/notify/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: mail, code }),
    });
    return r.json().catch(() => null);
  };
  await fetch(`${API}/api/guest/${deskToken}/notify/request`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'D2', email: mail, consent: true, locale: 'ko' }),
  });
  const v1 = await verify('246813');
  const ptok = v1?.data?.personal_token;
  const [row] = await sql('SELECT conversation_id, guest_user_id FROM guest_links WHERE contact_email=?', [mail]);
  if (row?.conversation_id) createdRooms.push(row.conversation_id);
  if (!ptok || !row?.conversation_id) { unmeasured('D2 회복', `확인 실패 token=${!!ptok}`); return; }
  await sql('DELETE FROM conversation_participants WHERE conversation_id=? AND user_id=?', [row.conversation_id, row.guest_user_id]);
  const gone = await fetch(`${API}/api/guest/${ptok}`);
  push('D2: 방에서 빠진 방문자 링크는 404', gone.status === 404, String(gone.status));
  await verify('135792');
  const back = await fetch(`${API}/api/guest/${ptok}`);
  const [again] = await sql('SELECT conversation_id FROM guest_links WHERE contact_email=?', [mail]);
  push('D2: 이메일을 다시 확인하면 **같은 방**으로 돌아온다(200)',
    back.status === 200 && again?.conversation_id === row.conversation_id, `ctx=${back.status} room ${row.conversation_id}→${again?.conversation_id}`);
}

/** D3 — 오너가 방문자 **한 사람만** 막는다. 막힌 사람은 재확인해도 못 들어오고, 다른 방문자는 그대로다. */
async function runD3(push, unmeasured, biz, deskToken) {
  if (!deskToken) { unmeasured('D3 방문자 막기', '창구 토큰 없음'); return; }
  const crypto = require('crypto');
  const mk = async (tag) => {
    const mail = `d3${tag}-canary-${Date.now()}@example.com`;
    await fetch(`${API}/api/guest/${deskToken}/notify/request`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: `D3${tag}`, email: mail, consent: true, locale: 'ko' }),
    });
    const code = tag === 'a' ? '112233' : '445566';
    await sql('UPDATE guest_links SET otp_hash=?, otp_expires_at=DATE_ADD(NOW(), INTERVAL 5 MINUTE), otp_attempts=0, otp_locked_until=NULL WHERE contact_email=?',
      [crypto.createHash('sha256').update(code).digest('hex'), mail]);
    const r = await fetch(`${API}/api/guest/${deskToken}/notify/verify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: mail, code }) });
    const j = await r.json().catch(() => null);
    const [row] = await sql('SELECT id, conversation_id FROM guest_links WHERE contact_email=?', [mail]);
    if (row?.conversation_id) createdRooms.push(row.conversation_id);
    return { mail, code, ptok: j?.data?.personal_token, id: row?.id };
  };
  const A = await mk('a'); const Bv = await mk('b');
  if (!A.ptok || !Bv.ptok) { unmeasured('D3 방문자 막기', '확인 실패'); return; }
  const wrong = await api(`/api/businesses/${biz === 1 ? 2 : 1}/customer-entry/contacts/${A.id}`, { method: 'DELETE' });
  push('D3: 남의 워크스페이스 경로로 막기 → 403/404', [403, 404].includes(wrong.status), String(wrong.status));
  const blk = await api(`/api/businesses/${biz}/customer-entry/contacts/${A.id}`, { method: 'DELETE' });
  const aCtx = await fetch(`${API}/api/guest/${A.ptok}`);
  const bCtx = await fetch(`${API}/api/guest/${Bv.ptok}`);
  push('D3: 막기 200 → 그 사람 링크 404 · 다른 방문자 200', blk.status === 200 && aCtx.status === 404 && bCtx.status === 200,
    `block=${blk.status} A=${aCtx.status} B=${bCtx.status}`);
  await sql('UPDATE guest_links SET otp_hash=?, otp_expires_at=DATE_ADD(NOW(), INTERVAL 5 MINUTE), otp_attempts=0 WHERE contact_email=?',
    [crypto.createHash('sha256').update(A.code).digest('hex'), A.mail]);
  const re = await fetch(`${API}/api/guest/${deskToken}/notify/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: A.mail, code: A.code }) });
  const aAfter = await fetch(`${API}/api/guest/${A.ptok}`);
  push('D3: 막힌 사람은 이메일을 다시 확인해도 못 들어온다(D2 회복과 짝)', re.status === 400 && aAfter.status === 404,
    `verify=${re.status} ctx=${aAfter.status}`);
  const shared = await api(`/api/businesses/${biz}/customer-entry/contacts/${(await sql("SELECT parent_link_id p FROM guest_links WHERE id=?", [A.id]))[0].p}`, { method: 'DELETE' });
  push('D3: 공유 창구 링크 id 로는 막기 경로가 안 먹는다(404)', shared.status === 404, String(shared.status));
}

/** 창구 축 — 발급 → 서버 응답 모양 → 화면 → 회수. `issued` 에 만든 것을 적어 둔다(정리용). */
// 설정 «고객 창구» 카드의 QR (설계 §4.5) — 창구 주소가 살아 있는 동안 3폭에서 잰다.
//   크기만 재지 않고 **그 좌표가 QR 자신인지**(elementFromPoint) 와 **이미지가 실제로 디코드됐는지**
//   (naturalWidth) 를 같이 본다. 내용 일치(디코드 == 주소)는 저장소에 QR 디코더가 없어 여기서 재지 않는다.
async function measureEntryQr(browser, vp) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: vp.w, height: vp.h, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
    await login(page);
    await page.goto(BASE + '/business/settings/permissions', { waitUntil: 'networkidle2' });
    await page.waitForSelector('[data-testid="entry-qr"]', { timeout: 15000 }).catch(() => null);
    return await page.evaluate(() => {
      const img = document.querySelector('[data-testid="entry-qr"]');
      if (!img) return null;
      img.scrollIntoView({ block: 'center' });
      const r = img.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === img;
      return { w: Math.round(r.width), h: Math.round(r.height), hit, png: /^data:image\/png;base64,/.test(img.src),
        decoded: img.complete && img.naturalWidth > 0, alt: !!img.getAttribute('alt') };
    });
  } finally { await page.close().catch(() => {}); }
}

async function runDesk(browser, biz, push, unmeasured, issuedWs) {
  const a = await api(`/api/businesses/${biz}/customer-entry/link`, { method: 'POST', body: '{}' });
  if (!a.body?.data?.url || (a.status !== 200 && a.status !== 201)) {
    unmeasured('창구 링크 발급', `${a.status} ${a.body?.message || ''}`);
    return;
  }
  if (a.status === 201) issuedWs.push(a.body.data.id);
  const token = a.body.data.url.split('/g/')[1];
  push('창구: 공유 링크는 열람 전용으로 강제된다', a.body.data.can_write === false, `can_write=${a.body.data.can_write}`);

  // 멱등 — 두 번 눌러도 하나다(자리의 주인이 워크스페이스이므로 businesses 행을 잠근다)
  const b2 = await api(`/api/businesses/${biz}/customer-entry/link`, { method: 'POST', body: '{}' });
  push('창구: 다시 눌러도 같은 링크 (멱등)',
    b2.status === 200 && b2.body?.data?.id === a.body.data.id,
    `status=${b2.status} id=${b2.body?.data?.id} vs ${a.body.data.id}`);
  const live = await sql(
    "SELECT COUNT(*) n FROM guest_links WHERE business_id=? AND scope='workspace' AND kind='shared' AND revoked_at IS NULL",
    [biz]);
  push('창구: 워크스페이스에 살아 있는 창구는 1개', String(live[0].n) === '1', `n=${live[0].n}`);

  // ── 서버 응답 모양
  const r = await fetch(`${API}/api/guest/${token}`);
  const raw = await r.text();
  let d = null; try { d = JSON.parse(raw).data; } catch { /* */ }
  if (r.status !== 200 || !d) { push('창구: ctx 200', false, String(r.status)); return; }
  push('창구: scope=workspace', d.scope === 'workspace', String(d.scope));
  push('창구: 공유 링크에는 방이 없다 (conversation null)', d.conversation === null, JSON.stringify(d.conversation));
  const ek = Object.keys(d.entry || {}).sort().join(',');
  push('창구: entry 키가 정확히 5개', ek === ENTRY_KEYS, ek || '없음');
  const bk = Object.keys(d.entry?.booking || {}).sort().join(',');
  push('창구: entry.booking 키가 정확히 2개', bk === ENTRY_BOOKING_KEYS, bk || '없음');
  const ck = Object.keys(d.entry?.contact || {}).sort().join(',');
  push('창구: entry.contact 키가 정확히 4개', ck === ENTRY_CONTACT_KEYS, ck || '없음');
  const top = Object.keys(d).filter((k) => k !== 'workspace' && k !== 'entry').sort();
  push('창구: 옛 top-level 키 무변경 (entry 만 더해졌다)', top.join(',') === OLD_KEYS.join(','), top.join(','));
  const hits = FORBIDDEN_WS.filter((re) => re.test(raw)).map(String);
  push('창구: 응답 원문에 금지 문자열 0', hits.length === 0,
    hits.length ? hits.join(' ') : `검사 ${FORBIDDEN_WS.length}종 0건`);

  // ── 무인증으로 쓸 수 없다 · 프로젝트 탭은 안 열린다
  const w = await fetch(`${API}/api/guest/${token}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'x' }) });
  push('창구: 공유 링크로 글쓰기 차단 (404 — 방이 없다)', w.status === 404, String(w.status));
  const tk = await fetch(`${API}/api/guest/${token}/tasks`);
  const ps = await fetch(`${API}/api/guest/${token}/posts`);
  push('창구: 프로젝트 탭 라우트 404 (업무·문서)', tk.status === 404 && ps.status === 404,
    `tasks=${tk.status} posts=${ps.status}`);

  // ── 화면 — 3폭
  for (const vp of VIEWPORTS) {
    const m = await measureDesk(browser, token, vp);
    const drawn = WS_TABS.filter((k) => m.tabs[k] && m.tabs[k].drawn && m.tabs[k].hit);
    const ok = drawn.length === WS_TABS.length && m.body && m.body.drawn && m.mark && m.mark.drawn && !m.hscroll;
    push(`창구@${vp.w}: 4탭·본문·로고가 그려져 있다`, ok,
      `그려진탭=${drawn.length}/${WS_TABS.length} body=${m.body ? m.body.drawn : '없음'} `
      + `mark=${m.mark ? m.mark.drawn : '없음'} hscroll=${m.hscroll}`);
    if (vp.w === 375) {
      push('창구@375: 신원 띠에 닫기(×)가 없다 (닫으면 갈 곳이 없다)', m.notify && !m.hasClose,
        `notify=${!!m.notify} hasClose=${m.hasClose}`);
    }
  }

  // ── 설정 카드 QR — 3폭
  for (const vp of VIEWPORTS) {
    const q = await measureEntryQr(browser, vp);
    push(`창구 설정@${vp.w}: QR 이 보인다 (PNG·디코드·가림 없음)`,
      !!q && q.png && q.decoded && q.hit && q.alt && q.w >= 120,
      q ? `w=${q.w} h=${q.h} png=${q.png} decoded=${q.decoded} hit=${q.hit} alt=${q.alt}` : 'entry-qr 없음');
  }

  // ── ★ E6 회귀 (2026-09-25 Fable FAIL) ─────────────────────────────────────
  //   옛 scope(conversation) **공유** 링크의 `conversation_id` 가 비면 부모도 자식도 닫혀야 한다.
  //   첫 구현은 `parent.conversation_id && …` 라 부모 방이 비면 일치검사를 **건너뛰어**
  //   부모는 404 인데 **자식(개인 링크)이 200** 으로 열렸다. 그 상태는 이번 마이그레이션이
  //   `conversation_id` 를 NULL 로 허용하면서 **새로 가능해진 것**이다.
  //   → 지금은 `parent.scope !== 'workspace'` 로 가른다(옛 scope 는 HEAD 와 같은 판정).
  await runE6(push, unmeasured, biz, issuedWs);

  // ── ★ D1 회귀 (2026-09-25 Fable FAIL) ─────────────────────────────────────
  //   창구 개인 링크의 `conversation_id` 를 **남의 방**으로 바꾸면 닫혀야 한다.
  //   창구는 «부모와 같은 방» 검사를 면제하므로, 그 대체로 **참여자 소유 검사**를 둔다.
  await runD1(push, unmeasured, biz, token, issuedWs);

  // ── ★ D2 회복 (2026-09-25 Fable 관찰 → 설계대로 반영) ─────────────────────
  await runD2(push, unmeasured, token);
  // ── D3 방문자 한 사람 막기 (2026-09-25 Fable 관찰 → 반영)
  await runD3(push, unmeasured, biz, token);

  // ── 회수 → 404
  if (issuedWs.length) {
    await api(`/api/businesses/${biz}/customer-entry/link/${issuedWs[0]}`, { method: 'DELETE' });
    const gone = await fetch(`${API}/api/guest/${token}`);
    push('창구: 회수 후 404', gone.status === 404, String(gone.status));
  } else {
    unmeasured('창구: 회수 후 404', '이미 있던 창구를 재사용했다 — 남의 주소라 회수하지 않는다');
  }
}

async function run() {
  const results = [];
  const push = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [String(msg ?? '')] });
  const unmeasured = (name, msg) => results.push({ name, unmeasured: true, details: [`⚪ ${msg}`] });
  const issued = [];   // { kind, id, convId, projId }
  const issuedWs = [];  // 창구 링크 id (내가 만든 것만 — 재사용한 남의 것은 건드리지 않는다)
  let browser = null;
  let biz = null, origLogo;

  try {
    const me = await api('/api/auth/me');
    biz = me.body?.data?.active_business_id ?? me.body?.data?.user?.active_business_id ?? null;
    const convs = biz ? await sql(
      "SELECT id, project_id FROM conversations WHERE business_id=? AND channel_type='customer' AND project_id IS NOT NULL ORDER BY id DESC LIMIT 1",
      [biz]) : [];
    if (!convs.length) { unmeasured('게스트 링크 픽스처', '고객 대화방(프로젝트 연결)이 없어 링크를 못 만든다'); return results; }
    const conv = convs[0];

    // ── 발급 — 대화 링크 · 프로젝트 링크 (두 scope 가 같은 응답 모양이어야 한다)
    const links = {};
    for (const [kind, path] of [
      ['conversation', `/api/conversations/${biz}/${conv.id}/guest-links`],
      ['project', `/api/projects/${conv.project_id}/guest-links`],
    ]) {
      const r = await api(path, { method: 'POST', body: '{}' });
      const url = r.body?.data?.url;
      // ★ 발급은 멱등이다(2026-09-24 §B) — 이미 살아 있는 링크가 있으면 200 reused 로 **남의 링크**를 준다.
      //   그것은 읽기 검사에만 쓰고 **회수·삭제하지 않는다**(남이 보낸 주소가 죽는다). 내가 만든 것(201)만 치운다.
      if (!url || (r.status !== 201 && r.status !== 200)) { unmeasured(`${kind} 링크 발급`, `${r.status} ${r.body?.message || ''}`); continue; }
      if (r.status === 201) issued.push({ kind, id: r.body.data.id, convId: conv.id, projId: conv.project_id });
      links[kind] = url.split('/g/')[1];
    }
    if (!links.conversation) return results;

    // ── 서버 — 응답 모양
    for (const [kind, token] of Object.entries(links)) {
      const r = await fetch(`${API}/api/guest/${token}`);
      const raw = await r.text();
      let d = null; try { d = JSON.parse(raw).data; } catch { /* */ }
      if (r.status !== 200 || !d) { push(`[${kind}] 게스트 컨텍스트 200`, false, `${r.status}`); continue; }
      const wsKeys = Object.keys(d.workspace || {}).sort().join(',');
      push(`[${kind}] workspace 는 정확히 두 필드 (name, logo_url)`, wsKeys === 'logo_url,name', wsKeys || '없음');
      push(`[${kind}] 발신자 이름이 비어 있지 않다`, !!(d.workspace && d.workspace.name), JSON.stringify(d.workspace));
      push(`[${kind}] 로고는 우리 심볼 경로이거나 null`,
        d.workspace && (d.workspace.logo_url === null || SYMBOL.test(d.workspace.logo_url)), String(d.workspace && d.workspace.logo_url));
      const top = Object.keys(d).filter((k) => k !== 'workspace').sort();
      push(`[${kind}] 옛 top-level 키 무변경`, top.join(',') === OLD_KEYS.join(','), top.join(','));
      const hits = FORBIDDEN.filter((re) => re.test(raw)).map(String);
      push(`[${kind}] 응답 원문에 금지 문자열 0`, hits.length === 0, hits.length ? hits.join(' ') : `검사 ${FORBIDDEN.length}종 0건`);
    }

    // ── 서버 — 화이트리스트 양성 대조군: 외부 로고를 넣으면 null 이어야 한다
    const [row] = await sql('SELECT brand_logo_url FROM businesses WHERE id=?', [biz]);
    origLogo = row ? row.brand_logo_url : undefined;
    try {
      await sql('UPDATE businesses SET brand_logo_url=? WHERE id=?', ['https://evil.example/x.png', biz]);
      const r = await fetch(`${API}/api/guest/${links.conversation}`);
      const raw = await r.text();
      const ws = JSON.parse(raw).data?.workspace;
      push('외부 로고 주소는 내보내지 않는다 (null · 원문에도 없음)', ws && ws.logo_url === null && !raw.includes('evil.example'),
        JSON.stringify(ws));
    } finally {
      if (origLogo !== undefined) await sql('UPDATE businesses SET brand_logo_url=? WHERE id=?', [origLogo, biz]);
      const [back] = await sql('SELECT brand_logo_url FROM businesses WHERE id=?', [biz]);
      push('로고 원복', back && back.brand_logo_url === origLogo, String(back && back.brand_logo_url));
    }

    // ── 화면 — 3폭 × 두 scope
    ({ browser } = await launch());
    // 제목+부제 두 줄 = 71~76 (2026-09-24 Fable 실측). 한 줄 더 쌓이면 걸린다.
    // ★ 폰만 110 — 프로젝트 헤더 오른쪽에 «고객으로 등록» 문이 생겨(§G) 좁은 폭에서는 **제목이 두 줄로 감긴다**
    //   (실측 98). 제목은 자르지 않는다는 계약이라 감기는 것이 맞다. 세 줄째(=부제가 또 감김)부터 걸린다.
    const bandMax = (w) => (w <= 640 ? 110 : 80);
    for (const [kind, token] of Object.entries(links)) {
      for (const vp of VIEWPORTS) {
        const m = await measure(browser, token, vp, false);
        const ok = m.mark && m.name && m.mark.hit && m.name.hit && m.mark.inView && m.name.inView
          && !m.hscroll && m.band !== null && m.band <= bandMax(vp.w);
        push(`[${kind}@${vp.w}] 로고·발신자 이름이 그려져 있다`, ok,
          `band=${m.band} mark=${m.mark ? `${m.mark.x},${m.mark.y} hit=${m.mark.hit}` : '없음'} ` +
          `name=${m.name ? `«${m.name.text}» hit=${m.name.hit}` : '없음'} hscroll=${m.hscroll}`);
      }
    }

    // ── 대조군 — workspace 를 지운 응답이면 **같은 판정이 빨간불**이어야 한다
    const ctl = await measure(browser, links.conversation, VIEWPORTS[0], true);
    const flipped = !ctl.mark && !ctl.name;
    push('대조군: workspace 없는 응답이면 판정이 뒤집힌다 (그리고 화면은 안 깨진다)', flipped && !ctl.hscroll,
      flipped ? '로고·이름 없음 — 검사기가 부재를 잡는다' : `mark=${!!ctl.mark} name=${!!ctl.name} — 검사기가 부재를 못 잡는다`);

    // ── 워크스페이스 창구 (2026-09-25, P1) — 같은 브라우저를 쓴다
    try {
      await runDesk(browser, biz, push, unmeasured, issuedWs);
    } catch (e) {
      push('창구 축 실행', false, e.message);
    }

    // ── 서버 — 회수하면 닫힌다
    for (const l of issued) {
      const path = l.kind === 'conversation'
        ? `/api/conversations/${biz}/${l.convId}/guest-links/${l.id}`
        : `/api/projects/${l.projId}/guest-links/${l.id}`;
      await api(path, { method: 'DELETE' });
    }
    for (const l of issued) {
      const r = await fetch(`${API}/api/guest/${links[l.kind]}`);
      push(`[${l.kind}] 회수 후 404`, r.status === 404, String(r.status));
    }
    for (const kind of Object.keys(links).filter((k) => !issued.some((l) => l.kind === k))) {
      results.push({ name: `[${kind}] 회수 후 404`, unmeasured: true, optional: true,
        details: ['⚪ 이미 살아 있던 링크를 재사용했다 — 남의 링크라 회수하지 않는다'] });
    }
    return results;
  } catch (e) {
    push('카나리 실행', false, e.message);
    return results;
  } finally {
    if (browser) await browser.close().catch(() => {});
    // 정리 — 링크 + 그림자 사용자(참여자 행 먼저). 그림자는 is_guest=1 이고 이 링크의 것만.
    try {
      if (issued.length) {
        const ids = issued.map((l) => l.id);
        const us = await sql('SELECT guest_user_id FROM guest_links WHERE id IN (?)', [ids]);
        const uids = us.map((u) => u.guest_user_id).filter(Boolean);
        await sql('DELETE FROM guest_links WHERE id IN (?)', [ids]);
        if (uids.length) {
          const talked = await sql('SELECT COUNT(*) n FROM messages WHERE sender_id IN (?)', [uids]);
          if (Number(talked[0].n) === 0) {
            await sql('DELETE FROM conversation_participants WHERE user_id IN (?)', [uids]);
            await sql('DELETE FROM users WHERE id IN (?) AND is_guest=1', [uids]);
          }
        }
        const left = await sql('SELECT COUNT(*) n FROM guest_links WHERE id IN (?)', [ids]);
        results.push({ name: 'cleanup:guest-links', fail: Number(left[0].n) ? 1 : 0, hasCanary: true,
          details: [`링크 ${ids.length} · 그림자 ${uids.length} 삭제 · 남음 ${left[0].n}`] });
      }
    } catch (e) {
      results.push({ name: 'cleanup:guest-links', fail: 1, details: [`🔴 정리 실패: ${e.message}`] });
    }
    // 창구 링크 정리 — **자식(개인 링크)을 먼저** 지운다(parent_link_id FK 에 막히면 부모가 남는다).
    try {
      if (issuedWs.length) {
        const us = await sql('SELECT guest_user_id FROM guest_links WHERE id IN (?) OR parent_link_id IN (?)',
          [issuedWs, issuedWs]);
        const uids = [...new Set(us.map((u) => u.guest_user_id).filter(Boolean))];
        await sql('DELETE FROM guest_links WHERE parent_link_id IN (?)', [issuedWs]);
        await sql('DELETE FROM guest_links WHERE id IN (?)', [issuedWs]);
        if (uids.length) {
          const talked = await sql('SELECT COUNT(*) n FROM messages WHERE sender_id IN (?)', [uids]);
          if (Number(talked[0].n) === 0) {
            await sql('DELETE FROM conversation_participants WHERE user_id IN (?)', [uids]);
            await sql('DELETE FROM users WHERE id IN (?) AND is_guest=1', [uids]);
          }
        }
        const left = await sql("SELECT COUNT(*) n FROM guest_links WHERE id IN (?)", [issuedWs]);
        results.push({ name: 'cleanup:customer-entry', fail: Number(left[0].n) ? 1 : 0, hasCanary: true,
          details: [`창구 ${issuedWs.length} · 그림자 ${uids.length} 삭제 · 남음 ${left[0].n}`] });
      }
      // 방문자 대화방 — **링크를 지운 뒤에** 지운다(FK). 환영 메시지·참여자가 딸려 있다.
      if (createdRooms.length) {
        await sql('DELETE FROM messages WHERE conversation_id IN (?)', [createdRooms]);
        await sql('DELETE FROM conversation_participants WHERE conversation_id IN (?)', [createdRooms]);
        await sql('DELETE FROM conversations WHERE id IN (?)', [createdRooms]);
        const rleft = await sql('SELECT COUNT(*) n FROM conversations WHERE id IN (?)', [createdRooms]);
        results.push({ name: 'cleanup:visitor-rooms', fail: Number(rleft[0].n) ? 1 : 0, hasCanary: true,
          details: [`방 ${createdRooms.length} 삭제 · 남음 ${rleft[0].n}`] });
      }
    } catch (e) {
      results.push({ name: 'cleanup:customer-entry', fail: 1, details: [`🔴 창구 정리 실패: ${e.message}`] });
    }
    // ★ 풀은 닫지 않는다 — 러너가 마지막에 한 번 닫는다.
  }
}

module.exports = { run };
