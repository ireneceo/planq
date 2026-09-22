#!/usr/bin/env node
// canary-signature-flow.js — 서명 **전체 여정**을 사용자처럼 걷는다 (2026-09-22)
//
// Irene: *"실제로 꼼꼼하게 버튼 다 눌러보고 다 적용해보고 유저 입장에서 멀쩡한지 확인하고."*
//
// `--suite signature` 는 «각 조각이 보이는가» 를 잰다. 이 카나리는 **끝까지 걸어본다**:
//   멤버가 서명 요청 → 우리 쪽 서명 → **고객이 메일 링크로 들어와 인증번호를 넣고 서명** →
//   양쪽 완료 → 문서·PDF 가 그 사실을 말하는가 → 그 뒤 원본을 고쳐도 서명본은 그대로인가.
//
// ★ 고객 흐름은 **로그인 없이** 걷는다(새 브라우저 컨텍스트). 로그인 상태로 재면
//   "링크만 받은 사람에게도 되는가" 를 영영 못 잰다.
// ★ 인증번호는 메일로만 간다 — 픽스처에서 **해시를 우리가 심는다**(코드를 아는 상태로 만든다).
//   실제 검증 라우트·화면은 그대로 탄다. 심지 않으면 이 흐름은 통째로 미측정이 된다.
const crypto = require('crypto');
const b = require('./lib/browser');

const API = (process.env.E2E_BASE || 'https://dev.planq.kr') + '/api';
const OTP = '246810';
const results = [];
const P = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg], hasCanary: true });

async function api(path, opts = {}) {
  const r = await fetch(API + path, opts);
  let json = {};
  try { json = JSON.parse(await r.text()); } catch { /* 비 JSON */ }
  return { status: r.status, json };
}

let sequelize = null;
function db() {
  if (!sequelize) ({ sequelize } = require('/opt/planq/dev-backend/config/database'));
  return sequelize;
}

const VISIBLE = `(el) => {
  if (!el) return { found: false };
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const hit = (r.width > 0 && r.height > 0)
    ? document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)) : null;
  return { found: true, w: Math.round(r.width), h: Math.round(r.height),
    painted: r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none',
    mine: !!(hit && (hit === el || el.contains(hit) || hit.contains(el))) };
}`;

/** 캔버스에 실제로 획을 긋는다 — 사용자가 하는 것과 같은 입력. */
async function draw(page, selector) {
  const box = await page.evaluate(`(() => {
    const c = document.querySelector(${JSON.stringify(selector)});
    if (!c) return null;
    c.scrollIntoView({ block: 'center' });
    const r = c.getBoundingClientRect();
    return { x: r.left + 24, y: r.top + r.height / 2, w: r.width };
  })()`);
  if (!box) return false;
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + i * (box.w / 14), box.y + (i % 2 ? -16 : 16));
  await page.mouse.up();
  await b.sleep(250);
  return true;
}

async function run() {
  let token = null, bizId = null, postId = null, meId = null, sigUs = null, sigThem = null, rejectPostId = null, cardPostId = null, cardMsgId = null, touchPostId = null;

  // ── 픽스처 ────────────────────────────────────────────────────
  try {
    const lj = await api('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: b.CREDS.email, password: b.CREDS.password }),
    });
    token = lj.json?.data?.token || null;
    const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    bizId = (await api('/businesses', { headers: H })).json?.data?.[0]?.id || null;
    meId = (await api('/auth/me', { headers: H })).json?.data?.id || null;
    const cr = await api('/posts', {
      method: 'POST', headers: H,
      body: JSON.stringify({
        business_id: bizId, title: '[카나리] 서명 전체 여정',
        content_json: { type: 'doc', content: [
          { type: 'paragraph', content: [{ type: 'text', text: '갑과 을은 아래와 같이 합의한다.' }] },
          { type: 'signatureField', attrs: { slot: 1, party: 'us', label: null } },
          { type: 'signatureField', attrs: { slot: 2, party: 'them', label: null } },
        ] },
        kind: 'doc', status: 'published', visibility: 'public', category: 'contract',
      }),
    });
    postId = cr.json?.data?.id || null;
    if (postId) {
      const sr = await api(`/posts/${postId}/signatures`, {
        method: 'POST', headers: H,
        body: JSON.stringify({
          signers: [
            { slot: 1, party: 'us', user_id: meId, email: '' },
            { slot: 2, party: 'them', email: 'canary-flow@example.com', name: '카나리 고객' },
          ], kind: 'sign', expires_in_days: 3, send_chat: false,
        }),
      });
      const list = sr.json?.data?.signatures || [];
      sigUs = list.find((s) => s.party === 'us') || null;
      sigThem = list.find((s) => s.party === 'them') || null;
    }
  } catch { /* 아래 0건 처리 */ }

  if (!postId || !sigUs || !sigThem) {
    P('픽스처 — 2칸 계약서 + 요청 2건 (0건 = 판정 불가)', false,
      `만들지 못해 여정을 한 걸음도 걷지 못했다 (post=${postId}) — 통과로 세지 않는다`);
    return { name: 'signflow', results };
  }

  const { browser, page } = await b.launch({});
  let guest = null;
  try {
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await b.login(page);

    // ── ① 멤버: 우리 쪽 서명을 화면에서 끝까지 누른다 ───────────
    await b.goto(page, `/docs?post=${postId}`);
    await b.sleep(2500); await b.dismissBlockers(page).catch(() => {});
    // ── ② 보내는 쪽 행에는 [URL 복사·재발송·취소] 메뉴가 없다 ──
    //    메일이 안 나가는 쪽에 «재발송» 을 두면 눌러도 아무 일이 없는 버튼이 된다.
    //    ★ **서명하기 전에** 잰다 — 서명을 마친 행은 어느 쪽이든 메뉴가 사라지므로,
    //      서명 뒤에 재면 «없다» 가 당연해져 아무것도 증명하지 못한다.
    //    ★ 손잡이는 `sign-row`(행) + `sign-row-actions`(⋯) — styled div 라 태그로는 못 찾는다(§17).
    const menus = await page.evaluate(`(() => {
      const rows = [...document.querySelectorAll('[data-testid="sign-row"]')];
      const us = rows.find((r) => r.getAttribute('data-party') === 'us');
      const them = rows.find((r) => r.getAttribute('data-party') === 'them');
      const cnt = (row) => row ? row.querySelectorAll('[data-testid="sign-row-actions"]').length : -1;
      return { rows: rows.length, usMenu: cnt(us), themMenu: cnt(them),
               usText: us ? (us.innerText || '').replace(/\\s+/g, ' ').slice(0, 60) : null };
    })()`);
    P('② 보내는 쪽 행엔 «재발송·URL복사» 메뉴가 없다 (대조군: 받는 쪽엔 있다)',
      menus.rows === 2 && menus.usMenu === 0 && menus.themMenu === 1,
      menus.rows === 2 ? `보내는 쪽 ⋯ ${menus.usMenu}개 · 받는 쪽 ⋯ ${menus.themMenu}개 — "${menus.usText}"`
        : `🔴 진행 표 행을 ${menus.rows}개만 찾았다(2개여야) — 판정 불가`);

    await page.click('[data-testid="sign-internal-open"]').catch(() => {});
    await b.sleep(1200);
    await draw(page, '[aria-modal="true"] canvas');
    await page.click('#internal-sign-consent').catch(() => {});
    await b.sleep(300);
    await page.click('[data-testid="internal-sign-submit"]').catch(() => {});
    await b.sleep(3500);
    const afterUs = await api(`/posts/${postId}/signed-html`, { headers: { Authorization: `Bearer ${token}` } });
    const usDone = afterUs.json?.data?.signed === 1 && afterUs.json?.data?.complete === false;
    P('① 우리 쪽 서명 — 눌러서 끝까지 된다', usDone,
      usDone ? `서명 ${afterUs.json.data.signed}/${afterUs.json.data.total} · 아직 완료 아님(맞다)`
        : `🔴 signed=${afterUs.json?.data?.signed} complete=${afterUs.json?.data?.complete}`);

    // ── ③ 고객: **로그인 없이** 링크 → 인증번호 → 서명 ──────────
    //    인증번호는 메일로만 가므로 해시를 심는다(코드를 아는 상태). 검증 라우트·화면은 그대로 탄다.
    guest = await b.launch({});
    guest.page.on('dialog', (d) => d.accept().catch(() => {}));
    await guest.page.goto(`${(process.env.E2E_BASE || 'https://dev.planq.kr')}/sign/${sigThem.token}`,
      { waitUntil: 'domcontentloaded', timeout: 30000 });
    await b.sleep(3000);

    const seesOther = await guest.page.evaluate(`(() => {
      const done = document.querySelector('.pq-sig-done');
      return { seesOurSignature: !!done, text: done ? (done.innerText || '').replace(/\\s+/g, ' ').slice(0, 50) : null };
    })()`);
    P('③ 고객이 링크를 열면 **우리가 먼저 한 서명**이 보인다', seesOther.seesOurSignature,
      seesOther.seesOurSignature ? `"${seesOther.text}"` : '🔴 먼저 한 서명이 안 보인다 — 누가 서명했는지 모른 채 서명하게 된다');

    await guest.page.click('[data-testid="sign-otp-send"]').catch(() => {});
    await b.sleep(2500);
    const otpUi = await guest.page.evaluate(`(() => {
      const boxes = [...document.querySelectorAll('input[maxlength="1"]')];
      return { boxes: boxes.length, v: boxes[0] ? (${VISIBLE})(boxes[0]) : { found: false } };
    })()`);
    P('④ [인증 코드 받기] → 6칸 입력창이 뜬다', otpUi.boxes === 6 && otpUi.v.painted,
      otpUi.boxes === 6 ? `6칸 · 첫 칸 ${otpUi.v.w}×${otpUi.v.h} 그려짐` : `🔴 입력칸 ${otpUi.boxes}개`);

    // 코드를 심는다 — 실제 verify 라우트가 이 해시를 본다
    await db().query(
      `UPDATE signature_requests SET otp_code_hash='${crypto.createHash('sha256').update(OTP).digest('hex')}',
       otp_expires_at=DATE_ADD(NOW(), INTERVAL 5 MINUTE), otp_attempts=0, otp_locked_until=NULL
       WHERE id=${sigThem.id}`);

    // 음성 대조군 — 틀린 코드는 막힌다
    for (const ch of '111111') await guest.page.keyboard.type(ch, { delay: 40 });
    await guest.page.click('[data-testid="sign-otp-verify"]').catch(() => {});
    await b.sleep(2000);
    const wrong = await guest.page.evaluate(`(() => ({
      stillOtp: !!document.querySelector('[data-testid="sign-otp-verify"]'),
      err: (document.body.innerText.match(/코드가 (올바르지|맞지)[^\\n]*/) || [null])[0],
    }))()`);
    P('⑤ 틀린 인증번호는 막힌다 (음성 대조군)', wrong.stillOtp === true,
      wrong.stillOtp ? `서명 단계로 넘어가지 않았다${wrong.err ? ` · 안내 "${wrong.err}"` : ''}`
        : '🔴 틀린 코드로도 통과했다');

    // 맞는 코드 — ★ `input.value = ''` 로 지우면 **React 상태는 그대로**라 다음 입력이 먹지 않는다
    //   (2026-09-22 실측: 이것 때문에 «인증해도 서명 칸이 안 열린다» 는 거짓 실패가 났다).
    //   사람이 하는 대로 Backspace 로 지운다.
    const boxes = await guest.page.$$('input[maxlength="1"]');
    if (boxes.length) await boxes[boxes.length - 1].click();
    for (let i = 0; i < 8; i++) { await guest.page.keyboard.press('Backspace'); await b.sleep(60); }
    const first = await guest.page.$('input[maxlength="1"]');
    if (first) await first.click();
    for (const ch of OTP) { await guest.page.keyboard.type(ch, { delay: 80 }); }
    await b.sleep(300);
    const typed = await guest.page.evaluate(`(() => [...document.querySelectorAll('input[maxlength="1"]')].map((i) => i.value).join(''))()`);
    if (typed !== OTP) console.warn(`  [하니스] 입력된 코드가 "${typed}" 다 — 기대 ${OTP}`);
    await b.sleep(400);
    await guest.page.click('[data-testid="sign-otp-verify"]').catch(() => {});
    await b.sleep(2500);
    const signPhase = await guest.page.evaluate(`(() => {
      const c = document.querySelector('canvas');
      const submit = document.querySelector('[data-testid="sign-submit"]');
      return { canvas: c ? (${VISIBLE})(c) : { found: false }, submitDisabled: submit ? !!submit.disabled : null };
    })()`);
    P('⑥ 맞는 인증번호 → 서명 칸이 열린다 (양성 대조군)',
      signPhase.canvas.found && signPhase.canvas.painted && signPhase.submitDisabled === true,
      signPhase.canvas.found ? `캔버스 ${signPhase.canvas.w}×${signPhase.canvas.h} · 그리기 전 제출 막힘=${signPhase.submitDisabled}`
        : '🔴 인증 후에도 서명 칸이 안 열린다');

    await draw(guest.page, 'canvas');
    await guest.page.evaluate(`(() => {
      const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
      boxes.forEach((c) => { if (!c.checked) c.click(); });
    })()`);
    await b.sleep(500);
    const readyToSign = await guest.page.evaluate(`(() => {
      const s = document.querySelector('[data-testid="sign-submit"]');
      return { enabled: s ? !s.disabled : false };
    })()`);
    await guest.page.click('[data-testid="sign-submit"]').catch(() => {});
    await b.sleep(4000);
    const doneScreen = await guest.page.evaluate(`(() => ({
      text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 160),
      noCanvas: !document.querySelector('canvas'),
    }))()`);
    const row = (await db().query(`SELECT status FROM signature_requests WHERE id=${sigThem.id}`))[0][0];
    P('⑦ 고객이 서명을 마친다 — 원장에 signed 로 남는다', row?.status === 'signed',
      row?.status === 'signed' ? `동의 후 제출 가능=${readyToSign.enabled} → status=signed · 완료 화면 "${doneScreen.text.slice(0, 70)}…"`
        : `🔴 status=${row?.status} (제출 가능=${readyToSign.enabled})`);

    // ── ⑧ 양쪽 끝났다 — 문서가 그렇게 말하는가 ──────────────────
    await b.goto(page, `/docs?post=${postId}`);
    await b.sleep(3000);
    const both = await page.evaluate(`(() => {
      const done = [...document.querySelectorAll('.pq-sig-done')];
      const imgs = [...document.querySelectorAll('.pq-sig-done .pq-sig-img')];
      return { done: done.length, empty: document.querySelectorAll('.pq-sig-empty').length,
               imgs: imgs.length, allPainted: imgs.every((i) => i.getBoundingClientRect().height > 4) };
    })()`);
    P('⑧ 양쪽 서명 후 문서에 서명 2개가 보인다', both.done === 2 && both.empty === 0 && both.imgs === 2 && both.allPainted,
      `서명된 칸 ${both.done} · 빈 칸 ${both.empty} · 이미지 ${both.imgs} 모두 그려짐=${both.allPainted}`);

    const sv = await api(`/posts/${postId}/signed-html`, { headers: { Authorization: `Bearer ${token}` } });
    P('⑨ 완료 판정 — 모든 칸이 차면 complete', sv.json?.data?.complete === true,
      `signed ${sv.json?.data?.signed}/${sv.json?.data?.total} · complete=${sv.json?.data?.complete}`);

    // ── ⑩ 서명 뒤 원본을 고쳐도 서명본은 그대로다 (계약의 기본) ──
    const beforeHtml = sv.json?.data?.html || '';
    await api(`/posts/${postId}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '[카나리] 서명 전체 여정 — 서명 뒤 수정',
        content_json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '몰래 바꾼 내용' }] }] } }),
    });
    const after = await api(`/posts/${postId}/signed-html`, { headers: { Authorization: `Bearer ${token}` } });
    const unchanged = (after.json?.data?.html || '') === beforeHtml && !(after.json?.data?.html || '').includes('몰래 바꾼');
    P('⑩ 서명 뒤 원본을 고쳐도 서명본은 바뀌지 않는다 (고정본)', unchanged,
      unchanged ? '본문을 통째로 바꿔도 서명본 HTML 이 한 글자도 안 변했다'
        : '🔴 서명본이 따라 바뀐다 — 무엇에 서명한 것인지 증명할 수 없다');

    // ── ⑪ PDF 가 실제로 내려온다 (버튼이 아니라 바이트) ─────────
    const pdf = await fetch(`${API}/posts/${postId}/pdf`, { headers: { Authorization: `Bearer ${token}` } });
    const buf = Buffer.from(await pdf.arrayBuffer());
    const isPdf = pdf.status === 200 && buf.slice(0, 4).toString() === '%PDF';
    P('⑪ 서명본 PDF 가 실제로 내려온다', isPdf && buf.length > 20000,
      `${pdf.status} · ${buf.length} bytes · 헤더 ${buf.slice(0, 4).toString()}`);
    // ── ⑫ 거절 — 문서가 «아직 안 함» 과 구별해서 말하는가 ──────
    //    2026-09-22 실측: 거절해도 문서·PDF·공유 링크에 «서명 전» 으로만 보였다.
    //    보내는 사람은 그 PDF 를 그대로 남에게 보낸다 — «기다리는 중» 과 «거부당했다» 는 다른 사실이다.
    const H2 = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const rj = await api('/posts', {
      method: 'POST', headers: H2,
      body: JSON.stringify({
        business_id: bizId, title: '[카나리] 거절 표시',
        content_json: { type: 'doc', content: [
          { type: 'paragraph', content: [{ type: 'text', text: '거절 표시 검증' }] },
          { type: 'signatureField', attrs: { slot: 1, party: 'them', label: null } },
        ] },
        kind: 'doc', status: 'published', visibility: 'public', category: 'contract',
      }),
    });
    const rjId = rj.json?.data?.id || null;
    if (rjId) {
      rejectPostId = rjId;
      const rs = await api(`/posts/${rjId}/signatures`, {
        method: 'POST', headers: H2,
        body: JSON.stringify({ signers: [{ slot: 1, party: 'them', email: 'canary-reject@example.com', name: '거절 고객' }],
          kind: 'sign', expires_in_days: 3, send_chat: false }),
      });
      const rsr = rs.json?.data?.signatures?.[0];
      await db().query(
        `UPDATE signature_requests SET otp_code_hash='${crypto.createHash('sha256').update(OTP).digest('hex')}',
         otp_expires_at=DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE id=${rsr.id}`);
      await api(`/sign/${rsr.token}/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: OTP }) });
      await api(`/sign/${rsr.token}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: '조건이 맞지 않습니다' }) });

      await b.goto(page, `/docs?post=${rjId}`);
      await b.sleep(2800);
      const rv = await page.evaluate(`(() => {
        const bad = document.querySelector('.pq-sig-rejected');
        const body = document.querySelector('[data-testid="doc-signed-body"]');
        return { rejected: bad ? (${VISIBLE})(bad) : { found: false },
                 empties: document.querySelectorAll('.pq-sig-empty').length,
                 // ★ 사유는 **서명본 본문**에 없어야 한다(공개 링크에도 같은 HTML 이 나간다).
                 //   멤버 진행 표에 뜨는 것은 의도다 — 요청한 사람은 왜 거절됐는지 알아야 한다.
                 reasonInDoc: !!(body && (body.innerText || '').includes('조건이 맞지 않습니다')),
                 reasonInProgress: (document.body.innerText || '').includes('조건이 맞지 않습니다') };
      })()`);
      P('⑫ 거절은 «서명 전» 이 아니라 «거절» 로 보인다 (사유는 서명본에 안 싣는다)',
        rv.rejected.found && rv.rejected.painted && rv.empties === 0 && rv.reasonInDoc === false,
        rv.rejected.found
          ? `거절 칸 ${rv.rejected.w}×${rv.rejected.h} 그려짐 · 빈 칸 ${rv.empties} · 사유: 서명본 ${rv.reasonInDoc ? '노출(버그)' : '없음'} / 진행 표 ${rv.reasonInProgress ? '있음(의도)' : '없음'}`
          : `🔴 거절인데 문서에는 빈 칸 ${rv.empties}개로만 보인다 — 기다리는 중과 구별이 안 된다`);
    } else {
      P('⑫ 거절은 «서명 전» 이 아니라 «거절» 로 보인다 (사유는 문서에 안 싣는다)', false, '🔴 픽스처를 못 만들어 미측정');
    }
    // ── ⑬ 채팅 카드 [서명하기] — 방에 링크를 안 올리고 본인 메일로 보낸다 ──
    const conv = (await db().query(
      `SELECT id FROM conversations WHERE business_id=${bizId} ORDER BY id DESC LIMIT 1`))[0][0];
    if (conv) {
      const cp = await api('/posts', {
        method: 'POST', headers: H2,
        body: JSON.stringify({
          business_id: bizId, title: '[카나리] 채팅 카드',
          content_json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '카드 검증' }] }] },
          kind: 'doc', status: 'published', category: 'contract',
        }),
      });
      cardPostId = cp.json?.data?.id || null;
      const cr2 = await api(`/posts/${cardPostId}/signatures`, {
        method: 'POST', headers: H2,
        body: JSON.stringify({ signers: [{ slot: 1, party: 'them', email: 'canary-card@example.com', name: '카드 고객' }],
          kind: 'sign', expires_in_days: 3, send_chat: true, conversation_id: conv.id }),
      });
      cardMsgId = cr2.json?.data?.chat_message_id || null;

      await b.goto(page, `/talk/${conv.id}`);
      await b.sleep(3500); await b.dismissBlockers(page).catch(() => {});
      await page.evaluate(`(() => { const c = document.querySelector('[data-testid="chat-sign-card"]'); if (c) c.scrollIntoView({ block: 'center' }); })()`);
      await b.sleep(400);
      await page.click('[data-testid="chat-sign-card"]').catch(() => {});
      await b.sleep(1200);
      const cardModal = await page.evaluate(`(() => {
        const dlg = document.querySelector('[aria-modal="true"]');
        const input = dlg && dlg.querySelector('input[type="email"]');
        return { open: !!dlg, input: input ? (${VISIBLE})(input) : { found: false },
                 // 링크가 방이나 창에 적혀 있으면 안 된다 (토큰 64자리)
                 tokenOnScreen: /[0-9a-f]{64}/.test(document.body.innerText || '') };
      })()`);
      P('⑬ 채팅 카드 [서명하기] → 이메일을 묻는 창이 뜬다 (링크는 화면에 없다)',
        cardModal.open && cardModal.input.found && cardModal.input.painted && !cardModal.tokenOnScreen,
        cardModal.open ? `입력칸 ${cardModal.input.w}×${cardModal.input.h} 그려짐 · 화면에 토큰 노출=${cardModal.tokenOnScreen}`
          : '🔴 카드를 눌러도 창이 안 뜬다');

      if (cardModal.open && cardModal.input.found) {
        await page.type('[aria-modal="true"] input[type="email"]', 'canary-card@example.com', { delay: 25 });
        await b.sleep(300);
        await page.click('[data-testid="sign-link-send"]').catch(() => {});
        await b.sleep(2500);
        const sent = await page.evaluate(`(() => {
          const el = document.querySelector('[data-testid="sign-link-sent"]');
          return { found: !!el, text: el ? (el.textContent || '').trim().slice(0, 60) : null };
        })()`);
        P('⑬-b 보내면 «보냈습니다» 로 답한다', sent.found,
          sent.found ? `"${sent.text}…"` : '🔴 눌러도 아무 말이 없다');
      } else {
        P('⑬-b 보내면 «보냈습니다» 로 답한다', false, '🔴 창이 안 떠 재지 못했다');
      }
    } else {
      P('⑬ 채팅 카드 [서명하기] → 이메일을 묻는 창이 뜬다 (링크는 화면에 없다)', false, '🔴 대화방이 없어 미측정');
      P('⑬-b 보내면 «보냈습니다» 로 답한다', false, '🔴 대화방이 없어 미측정');
    }

    // ── ⑭ 폰에서 **손가락으로** 서명이 그려지는가 ────────────────
    //    마우스로만 재면 `touch-action` · 포인터 이벤트 계열 결함을 영영 못 본다.
    if (touchPostId === null) {
      const tp = await api('/posts', {
        method: 'POST', headers: H2,
        body: JSON.stringify({
          business_id: bizId, title: '[카나리] 폰 터치 서명',
          content_json: { type: 'doc', content: [
            { type: 'paragraph', content: [{ type: 'text', text: '폰 터치 검증' }] },
            { type: 'signatureField', attrs: { slot: 1, party: 'them', label: null } },
          ] },
          kind: 'doc', status: 'published', visibility: 'public', category: 'contract',
        }),
      });
      touchPostId = tp.json?.data?.id || null;
    }
    if (touchPostId) {
      const ts = await api(`/posts/${touchPostId}/signatures`, {
        method: 'POST', headers: H2,
        body: JSON.stringify({ signers: [{ slot: 1, party: 'them', email: 'canary-touch@example.com', name: '폰 고객' }],
          kind: 'sign', expires_in_days: 3, send_chat: false }),
      });
      const tsr = ts.json?.data?.signatures?.[0];
      await db().query(
        `UPDATE signature_requests SET otp_code_hash='${crypto.createHash('sha256').update(OTP).digest('hex')}',
         otp_expires_at=DATE_ADD(NOW(), INTERVAL 5 MINUTE), otp_verified_at=NOW() WHERE id=${tsr.id}`);

      const phone = await b.launch({ mobile: true });
      try {
        phone.page.on('dialog', (d) => d.accept().catch(() => {}));
        await phone.page.goto(`${(process.env.E2E_BASE || 'https://dev.planq.kr')}/sign/${tsr.token}`,
          { waitUntil: 'domcontentloaded', timeout: 30000 });
        await b.sleep(3500);
        // 이미 본인 확인된 상태(otp_verified_at) → 서명 단계가 바로 열린다
        const box = await phone.page.evaluate(`(() => {
          const c = document.querySelector('canvas');
          if (!c) return null;
          c.scrollIntoView({ block: 'center' });
          const r = c.getBoundingClientRect();
          return { x: r.left + 20, y: r.top + r.height / 2, w: r.width, h: r.height };
        })()`);
        let drew = false;
        if (box) {
          const cdp = await phone.page.target().createCDPSession();
          const pt = (x, y) => [{ x, y, radiusX: 4, radiusY: 4, force: 1 }];
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(box.x, box.y) });
          for (let i = 1; i <= 8; i++) {
            await cdp.send('Input.dispatchTouchEvent', {
              type: 'touchMove', touchPoints: pt(box.x + i * (box.w / 10), box.y + (i % 2 ? -14 : 14)) });
          }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await b.sleep(500);
          drew = true;
        }
        await phone.page.evaluate(`(() => { document.querySelectorAll('input[type="checkbox"]').forEach((c) => { if (!c.checked) c.click(); }); })()`);
        await b.sleep(400);
        const phoneState = await phone.page.evaluate(`(() => {
          const s = document.querySelector('[data-testid="sign-submit"]');
          return { enabled: s ? !s.disabled : null, overflow: document.documentElement.scrollWidth - window.innerWidth };
        })()`);
        P('⑭ 폰에서 **손가락으로** 서명이 그려진다 (마우스가 아니라 터치)',
          drew && phoneState.enabled === true && phoneState.overflow <= 1,
          drew ? `터치 획 후 제출 가능=${phoneState.enabled} · 가로 넘침 ${phoneState.overflow}px`
            : '🔴 폰 화면에 캔버스를 못 찾았다');
      } finally { await phone.browser.close().catch(() => {}); }
    } else {
      P('⑭ 폰에서 **손가락으로** 서명이 그려진다 (마우스가 아니라 터치)', false, '🔴 픽스처를 못 만들어 미측정');
    }
  } catch (e) {
    P('여정 진행 중 오류', false, `🔴 ${e.message}`);
  } finally {
    await browser.close().catch(() => {});
    if (guest) await guest.browser.close().catch(() => {});
    const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    await api(`/posts/${postId}`, { method: 'DELETE', headers: H }).catch(() => {});
    if (rejectPostId) await api(`/posts/${rejectPostId}`, { method: 'DELETE', headers: H }).catch(() => {});
    if (cardPostId) await api(`/posts/${cardPostId}`, { method: 'DELETE', headers: H }).catch(() => {});
    if (touchPostId) await api(`/posts/${touchPostId}`, { method: 'DELETE', headers: H }).catch(() => {});
    // 카드 메시지도 치운다 — 카나리가 남긴 것이 다음 검사의 대화방을 어지럽힌다
    if (cardMsgId && sequelize) await sequelize.query(`DELETE FROM messages WHERE id=${cardMsgId}`).catch(() => {});
    if (sequelize) await sequelize.close().catch(() => {});
  }
  return { name: 'signflow', results };
}

module.exports = { run: async () => (await run()).results, name: 'signflow' };

if (require.main === module) {
  require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
  run().then((r) => {
    let fail = 0;
    console.log('\n=== 서명 전체 여정 카나리 ===');
    for (const x of r.results) { console.log(`${x.fail ? '❌' : '✅'} ${x.name} — ${x.details[0]}`); fail += x.fail; }
    console.log(`\n검사 ${r.results.length}개 · 실패 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.stack || e.message); process.exit(2); });
}
