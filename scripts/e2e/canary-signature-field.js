#!/usr/bin/env node
// canary-signature-field.js — 서명란·서명본·우리 측 서명·공개 링크 (2026-09-22)
//
// Irene: *"문서에 서명이 어떻게 나오는지 알 수 없어서 서명란을 입력하게 된다고 했는데"* → *"고쳐줘."*
//        *"실제 테스트 하면서 일일이 검증해놔."*
//
// 왜 실브라우저인가: 이 계열은 **API 가 맞는데 화면에 안 보이는** 방식으로 샌다
//   (memory `feedback_backend_done_ui_missing` · `feedback_measure_the_screen_not_innertext`).
//   그래서 있음/없음이 아니라 **rect + elementFromPoint + 실제 색**으로 잰다.
//
// 대조군을 반드시 같이 둔다:
//   · 음성 — 동의 전 [서명 완료]는 눌리지 않는다 / 내 칸이 아닌 칸은 강조색이 아니다 / 공개 화면에 증명서가 없다
//   · 양성 — 같은 자리에서 조건을 채우면 판정이 뒤집힌다
const b = require('./lib/browser');

const API = (process.env.E2E_BASE || 'https://dev.planq.kr') + '/api';
const HILITE = 'rgb(244, 63, 94)';   // 내 칸 강조 — Coral #F43F5E
const results = [];
const P = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg], hasCanary: true });

async function api(path, opts = {}) {
  const r = await fetch(API + path, opts);
  try { return { status: r.status, json: JSON.parse(await r.text()) }; } catch { return { status: r.status, json: {} }; }
}

/** 화면에 **그려졌는가** — 크기만 재면 부모 overflow:hidden 에 0px 로 눌린 것을 놓친다. */
const VISIBLE = `(el) => {
  if (!el) return { found: false };
  // ★ 재기 전에 화면 안으로 끌어온다. 안 그러면 뷰포트 밖 요소는 elementFromPoint 가 늘 null 이라
  //   «좌표는 있는데 안 그려졌다» 로 **거짓 실패**한다(2026-09-22 실측: 진행 표 버튼).
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
  const hit = (r.width > 0 && r.height > 0) ? document.elementFromPoint(cx, cy) : null;
  return {
    found: true, w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top),
    painted: r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.01,
    mine: !!(hit && (hit === el || el.contains(hit) || hit.contains(el))),
    border: cs.borderTopColor, bg: cs.backgroundColor,
  };
}`;

const docJson = () => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '본 계약(카나리)은 서명란 검증을 위한 문서입니다. 아래 두 칸에 각각 서명합니다.' }] },
    { type: 'signatureField', attrs: { slot: 1, party: 'us', label: null } },
    { type: 'signatureField', attrs: { slot: 2, party: 'them', label: null } },
  ],
});

async function run() {
  let token = null, bizId = null, postId = null, postEditId = null, sigUs = null, sigThem = null, themToken = null;

  // ── 픽스처 (실 API) ──────────────────────────────────────────────
  try {
    const lj = await api('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: b.CREDS.email, password: b.CREDS.password }),
    });
    token = lj.json?.data?.token || null;
    const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    bizId = (await api('/businesses', { headers: H })).json?.data?.[0]?.id || null;
    const me = (await api('/auth/me', { headers: H })).json?.data;
    const cr = await api('/posts', {
      method: 'POST', headers: H,
      body: JSON.stringify({
        business_id: bizId, title: '[카나리] 서명란 검증 문서',
        content_json: docJson(), kind: 'doc', status: 'published', visibility: 'public', category: 'contract',
      }),
    });
    postId = cr.json?.data?.id || null;
    // 편집기 검사 전용 빈 문서 — 픽스처 문서에 칸을 더하면 «빈 칸 2개» 검사가 무너진다
    const cr2 = await api('/posts', {
      method: 'POST', headers: H,
      body: JSON.stringify({
        business_id: bizId, title: '[카나리] 서명란 편집기 검증',
        content_json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '편집기 검증' }] }] },
        kind: 'doc', status: 'published', visibility: 'public', category: 'contract',
      }),
    });
    postEditId = cr2.json?.data?.id || null;
    if (postId && me?.id) {
      const sr = await api(`/posts/${postId}/signatures`, {
        method: 'POST', headers: H,
        body: JSON.stringify({
          signers: [
            { slot: 1, party: 'us', user_id: me.id, email: '' },
            { slot: 2, party: 'them', email: 'canary-signer@example.com', name: '카나리 수신자' },
          ],
          kind: 'sign', expires_in_days: 3, send_chat: false,
        }),
      });
      const list = sr.json?.data?.signatures || [];
      sigUs = list.find((s) => s.party === 'us') || null;
      sigThem = list.find((s) => s.party === 'them') || null;
      themToken = sigThem?.token || null;
    }
  } catch { /* 아래 0건 처리 */ }

  if (!postId || !sigUs || !sigThem) {
    P('픽스처 — 서명란 문서 + 요청 2건 (0건 = 판정 불가)', false,
      `문서/요청을 못 만들어 한 항목도 재지 못했다 (post=${postId} us=${!!sigUs} them=${!!sigThem}) — 통과로 세지 않는다`);
    return { name: 'signature', results };
  }
  P('픽스처 — 서명란 2칸 문서 + 요청 2건', true,
    `post=${postId} · 보내는쪽 slot${sigUs.slot}(${sigUs.status}) · 받는쪽 slot${sigThem.slot}(${sigThem.status})`);

  // 보내는 쪽에는 메일이 나가지 않으므로 'sent' 가 아니라 'pending' 이어야 한다
  P('보내는 쪽 요청은 «발송됨» 이 아니다', sigUs.status === 'pending',
    sigUs.status === 'pending' ? "status='pending' — 메일이 안 나갔으므로 발송됨이라고 말하지 않는다"
      : `🔴 status='${sigUs.status}' — 메일을 안 보냈는데 발송됨으로 남는다`);

  const { browser, page } = await b.launch({});
  try {
    // ★ 편집기를 열면 문서가 «고쳐진 상태» 가 되고, 그 상태로 페이지를 떠나면 브라우저가
    //   이탈 확인 대화상자를 띄운다. puppeteer 는 그걸 자동으로 닫지 않아 **이동이 영원히 멈춘다**
    //   (2026-09-22 실측: 출력 한 줄 없이 9분 정지). 대화상자는 받아 넘긴다.
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await b.login(page);

    // ── ① 편집기 [서명란] 버튼이 **보이는 칸을 그린다** ─────────────
    //   ★ 편집 모드는 URL 인자가 아니라 [수정] 버튼으로 들어간다 — 그걸 안 누르면 툴바가 아예 없어
    //     "버튼이 없다" 는 **하니스 탓의 거짓 실패**가 된다(2026-09-22 실측).
    //   ★ 빈 문서를 따로 쓴다. 픽스처 문서에 칸을 더하면 뒤의 «빈 칸 2개» 검사가 3개가 되어 무너진다.
    await b.goto(page, `/docs?post=${postEditId}`);
    await b.sleep(2500); await b.dismissBlockers(page).catch(() => {});
    await page.click('[data-testid="post-edit"]').catch(() => {});
    await b.sleep(2000);
    let ed = await page.evaluate(`(() => {
      const btn = document.querySelector('[data-testid="editor-insert-signature"]');
      if (!btn) return { noBtn: true };
      const before = document.querySelectorAll('.pq-sig-field').length;
      btn.click();
      return { noBtn: false, before };
    })()`);
    if (!ed.noBtn) {
      await b.sleep(900);
      ed = { ...ed, ...await page.evaluate(`(() => {
        const list = [...document.querySelectorAll('.pq-sig-field')];
        const el = list[list.length - 1];
        const v = (${VISIBLE})(el);
        return { after: list.length, v, label: el ? (el.textContent || '').trim().slice(0, 30) : null };
      })()`) };
    }
    P('편집기 [서명란] — 누르면 문서에 «보이는» 칸이 생긴다',
      !ed.noBtn && ed.after > ed.before && ed.v?.painted && ed.v?.mine,
      ed.noBtn ? '🔴 툴바에 버튼이 없다'
        : (ed.after > ed.before && ed.v?.painted && ed.v?.mine)
          ? `칸 ${ed.before}→${ed.after} · ${ed.v.w}×${ed.v.h} 실제로 그려짐 · 이름표 "${ed.label}"`
          : `🔴 칸 ${ed.before}→${ed.after} · painted=${ed.v?.painted} hit=${ed.v?.mine} (좌표는 있는데 안 그려졌을 수 있다)`);

    await page.keyboard.press('Escape').catch(() => {});
    await b.sleep(500);

    // ── ①-b 서명 요청 창 — 칸마다 서명자를 배정하는 UI 가 실제로 뜬다 ──
    //   Irene 결정: 보내는 쪽 = 멤버 선택(기본 = 요청자) · 받는 쪽 = 이메일 입력.
    //   여기서 칸이 안 보이면 «서명란을 넣어도 짝지을 방법이 없는» 상태다.
    await b.goto(page, `/docs?post=${postId}`);
    await b.sleep(2500); await b.dismissBlockers(page).catch(() => {});
    await page.click('[data-testid="post-sign"]').catch(() => {});
    await b.sleep(1500);
    const req = await page.evaluate(`(() => {
      const list = document.querySelector('[data-testid="sign-slot-list"]');
      if (!list) return { found: false, modal: !!document.querySelector('[aria-modal="true"]') };
      const rows = [...list.children];
      const v = (${VISIBLE})(list);
      const emails = list.querySelectorAll('input[type="email"]').length;
      // 보내는 쪽 칸에는 멤버 선택 컨트롤이 있어야 한다(이메일 입력이 아니라)
      const usRow = rows.find((r) => (r.textContent || '').includes('보내는 쪽'));
      const themRow = rows.find((r) => (r.textContent || '').includes('받는 쪽'));
      return {
        found: true, rows: rows.length, v, emails,
        usHasEmail: usRow ? usRow.querySelectorAll('input[type="email"]').length : -1,
        usText: usRow ? (usRow.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70) : null,
        themHasEmail: themRow ? themRow.querySelectorAll('input[type="email"]').length : -1,
      };
    })()`);
    P('서명 요청 창 — 문서의 칸마다 서명자를 배정하는 줄이 보인다',
      req.found && req.rows === 2 && req.v?.painted,
      req.found ? `칸 ${req.rows}줄 · ${req.v?.w}×${req.v?.h} 그려짐`
        : `🔴 칸 배정 목록이 없다 (모달 열림=${req.modal}) — 서명란을 넣어도 짝지을 방법이 없다`);
    P('보내는 쪽 칸은 «이메일» 이 아니라 «멤버 선택» 이다 (대조군: 받는 쪽은 이메일)',
      req.found && req.usHasEmail === 0 && req.themHasEmail === 1,
      req.found ? `보내는 쪽 이메일칸 ${req.usHasEmail}개 · 받는 쪽 ${req.themHasEmail}개 · 보내는 쪽 줄 "${req.usText}"`
        : '🔴 칸 배정 목록이 없어 재지 못했다');
    await page.keyboard.press('Escape').catch(() => {});
    await b.sleep(600);

    // ── ② 문서 보기 — 서명 «전» 에는 빈 칸이 보인다 (양성 대조군의 기준선) ──
    await b.goto(page, `/docs?post=${postId}`);
    await b.sleep(2500); await b.dismissBlockers(page).catch(() => {});
    const before = await page.evaluate(`(() => {
      const body = document.querySelector('[data-testid="doc-signed-body"]');
      const empty = [...document.querySelectorAll('.pq-sig-empty')];
      const done = [...document.querySelectorAll('.pq-sig-done')];
      return { hasBody: !!body, empty: empty.length, done: done.length,
               first: empty[0] ? (${VISIBLE})(empty[0]) : null };
    })()`);
    P('문서 보기 — 서명 전에는 빈 칸 2개가 보인다',
      before.hasBody && before.empty === 2 && before.done === 0 && before.first?.painted,
      before.hasBody
        ? `빈 칸 ${before.empty} · 서명된 칸 ${before.done} · 첫 칸 ${before.first?.w}×${before.first?.h} 그려짐`
        : '🔴 서명본 본문(doc-signed-body)이 화면에 없다 — 서버는 주는데 화면이 안 그린다');

    // ── ③ 진행 표 — «보내는 쪽» 칩 + 칸 번호 + [서명하기] 가 보인다 ──
    const prog = await page.evaluate(`(() => {
      const btn = document.querySelector('[data-testid="sign-internal-open"]');
      const txt = document.body.innerText;
      return {
        btn: btn ? (${VISIBLE})(btn) : { found: false },
        hasParty: txt.includes('보내는 쪽'),
        hasSlot: !!document.querySelector('[data-testid="sign-internal-open"]'),
      };
    })()`);
    P('진행 표 — 내 칸에 [서명하기] 가 보인다',
      prog.btn.found && prog.btn.painted && prog.btn.mine && prog.hasParty,
      prog.btn.found
        ? (prog.btn.painted && prog.btn.mine
          ? `버튼 ${prog.btn.w}×${prog.btn.h} 그려짐 · «보내는 쪽» 표시 ${prog.hasParty}`
          : `🔴 버튼이 DOM 에만 있다 painted=${prog.btn.painted} hit=${prog.btn.mine}`)
        : '🔴 [서명하기] 버튼이 없다 — 우리 측 서명으로 가는 문이 없다');

    // ── ④ 서명 모달 — 동의 전에는 제출이 **막혀 있다** (음성 대조군) ──
    let modal = { open: false };
    if (prog.btn.found) {
      await page.click('[data-testid="sign-internal-open"]');
      await b.sleep(1200);
      modal = await page.evaluate(`(() => {
        const dlg = document.querySelector('[aria-modal="true"]');
        const canvas = dlg && dlg.querySelector('canvas');
        const submit = document.querySelector('[data-testid="internal-sign-submit"]');
        const consent = dlg && dlg.querySelector('#internal-sign-consent');
        return {
          open: !!dlg, canvas: canvas ? (${VISIBLE})(canvas) : { found: false },
          submitDisabled: submit ? !!submit.disabled : null, hasConsent: !!consent,
        };
      })()`);
    }
    P('서명 창 — 캔버스가 보이고, 동의 전에는 [서명 완료]가 막혀 있다',
      modal.open && modal.canvas?.painted && modal.submitDisabled === true && modal.hasConsent,
      modal.open
        ? `캔버스 ${modal.canvas?.w}×${modal.canvas?.h} 그려짐 · 제출 disabled=${modal.submitDisabled} · 동의칸 ${modal.hasConsent}`
        : '🔴 서명 창이 열리지 않았다');

    // ── ⑤ 그리고 동의하면 제출이 열린다 (양성 대조군 — 같은 자리에서 판정이 뒤집힌다) ──
    let signed = { ok: false };
    if (modal.open && modal.canvas?.painted) {
      const box = await page.evaluate(`(() => {
        const c = document.querySelector('[aria-modal="true"] canvas');
        const r = c.getBoundingClientRect();
        return { x: r.left + 20, y: r.top + r.height / 2, w: r.width };
      })()`);
      await page.mouse.move(box.x, box.y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + i * (box.w / 12), box.y + (i % 2 ? -14 : 14));
      await page.mouse.up();
      await b.sleep(300);
      const midway = await page.evaluate(`(() => {
        const s = document.querySelector('[data-testid="internal-sign-submit"]');
        return { disabledAfterDraw: s ? !!s.disabled : null };
      })()`);
      await page.click('#internal-sign-consent');
      await b.sleep(400);
      const after = await page.evaluate(`(() => {
        const s = document.querySelector('[data-testid="internal-sign-submit"]');
        return { enabled: s ? !s.disabled : false };
      })()`);
      P('동의 체크가 실제로 문을 연다 (그리기만으로는 안 열린다)',
        midway.disabledAfterDraw === true && after.enabled === true,
        `그리기만 했을 때 disabled=${midway.disabledAfterDraw} → 동의 후 enabled=${after.enabled}`);

      if (after.enabled) {
        await page.click('[data-testid="internal-sign-submit"]');
        await b.sleep(3500);
        const st = await api(`/signatures/${sigUs.id}/image`, { headers: { Authorization: `Bearer ${token}` } });
        signed = { ok: st.status === 200 };
      }
    } else {
      P('동의 체크가 실제로 문을 연다 (그리기만으로는 안 열린다)', false, '🔴 서명 창을 못 열어 재지 못했다');
    }
    P('서명 완료 — 서버에 서명 이미지가 실제로 남는다', signed.ok,
      signed.ok ? 'GET /api/signatures/:id/image 200 — 화면에서 그린 것이 서버에 저장됐다'
        : '🔴 서명 후에도 이미지가 없다 (화면만 바뀌고 저장이 안 된 계열)');

    // ── ⑥ 문서 보기 — 서명본에 «서명된 칸» 이 보인다 (②의 양성 대조군) ──
    await b.goto(page, `/docs?post=${postId}`);
    await b.sleep(2800); await b.dismissBlockers(page).catch(() => {});
    const after6 = await page.evaluate(`(() => {
      const done = [...document.querySelectorAll('.pq-sig-done')];
      const img = document.querySelector('.pq-sig-done .pq-sig-img');
      return {
        done: done.length, empty: document.querySelectorAll('.pq-sig-empty').length,
        box: done[0] ? (${VISIBLE})(done[0]) : null,
        img: img ? (${VISIBLE})(img) : { found: false },
        imgIsData: img ? /^data:image\\//.test(img.getAttribute('src') || '') : false,
      };
    })()`);
    P('문서 보기 — 서명한 칸이 문서 안에 «이미지로» 보인다',
      after6.done === 1 && after6.empty === 1 && after6.img.found && after6.img.painted && after6.imgIsData,
      `서명된 칸 ${after6.done} · 빈 칸 ${after6.empty} · 서명 이미지 ${after6.img.w}×${after6.img.h} 그려짐(data URL ${after6.imgIsData})`);

    // ── ⑦ 공개 서명 페이지 — 내 칸만 강조된다 (음성 대조군 = 남의 칸) ──
    await b.goto(page, `/sign/${themToken}`);
    await b.sleep(2800);
    const pub = await page.evaluate(`(() => {
      const note = document.querySelector('[data-testid="sign-my-slot"]');
      const mine = document.querySelector('.pq-sig[data-slot="2"]');
      const other = document.querySelector('.pq-sig[data-slot="1"]');
      return {
        note: note ? (${VISIBLE})(note) : { found: false },
        noteText: note ? (note.textContent || '').trim().slice(0, 60) : null,
        mine: mine ? (${VISIBLE})(mine) : { found: false },
        other: other ? (${VISIBLE})(other) : { found: false },
        cert: document.body.innerHTML.includes('pq-cert'),
        ip: /\\b\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\b/.test(document.body.innerText),
      };
    })()`);
    P('공개 서명 화면 — «내 칸» 안내가 보인다',
      pub.note.found && pub.note.painted,
      pub.note.found ? `"${pub.noteText}…"` : '🔴 내 칸 안내가 없다 — 어디에 서명하는지 모른 채 서명한다');
    P('공개 서명 화면 — 내 칸만 강조색, 남의 칸은 아니다 (대조군)',
      pub.mine.found && pub.mine.border === HILITE && pub.other.found && pub.other.border !== HILITE,
      `내 칸(slot2) 테두리 ${pub.mine.border} · 남의 칸(slot1) ${pub.other.border} — 기준 ${HILITE}`);
    P('공개 서명 화면 — 증명서(이메일·IP)가 실리지 않는다',
      !pub.cert && !pub.ip,
      !pub.cert && !pub.ip ? '증명서 블록 없음 · IP 문자열 없음'
        : `🔴 공개 화면에 증명서=${pub.cert} IP노출=${pub.ip}`);

    // ── ⑧ 공개 문서 공유 링크 — 서명본이 그려진다 ─────────────────
    const shareTok = await page.evaluate(async (p) => {
      const tok = window.__pqGetToken ? window.__pqGetToken() : null;
      const r = await fetch(`/api/posts/${p}/share`, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: '{}' });
      const j = await r.json().catch(() => null);
      return j?.data?.share_token || j?.data?.token || null;
    }, postId).catch(() => null);
    if (shareTok) {
      await b.goto(page, `/public/posts/${shareTok}`);
      await b.sleep(2500);
      const sh = await page.evaluate(`(() => {
        const body = document.querySelector('[data-testid="public-signed-body"]');
        const img = document.querySelector('[data-testid="public-signed-body"] .pq-sig-img');
        return { hasBody: !!body, img: img ? (${VISIBLE})(img) : { found: false },
                 cert: document.body.innerHTML.includes('pq-cert') };
      })()`);
      P('공개 문서 링크 — 서명본이 그려지고 증명서는 없다',
        sh.hasBody && sh.img.found && sh.img.painted && !sh.cert,
        sh.hasBody ? `서명 이미지 ${sh.img.w}×${sh.img.h} 그려짐 · 증명서 ${sh.cert}`
          : '🔴 공개 문서에 서명본이 안 그려진다');
    } else {
      P('공개 문서 링크 — 서명본이 그려지고 증명서는 없다', false, '🔴 공유 토큰을 못 만들어 재지 못했다');
    }

    // ── ⑨ 폰 — 서명 창이 화면 안에 들어오는가 (폭을 하나만 재면 거짓 통과) ──
    await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await b.goto(page, `/sign/${themToken}`);
    await b.sleep(2500);
    const phone = await page.evaluate(`(() => {
      const mine = document.querySelector('.pq-sig[data-slot="2"]');
      const v = mine ? (${VISIBLE})(mine) : { found: false };
      return { v, overflow: document.documentElement.scrollWidth - window.innerWidth };
    })()`);
    P('폰(375) — 내 칸이 보이고 가로로 넘치지 않는다',
      phone.v.found && phone.v.painted && phone.overflow <= 1,
      `칸 ${phone.v.w}×${phone.v.h} 그려짐=${phone.v.painted} · 가로 넘침 ${phone.overflow}px`);
  } finally {
    await browser.close().catch(() => {});
    // ── 뒷정리 — 카나리가 만든 것은 지운다 ────────────────────────
    const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    await api(`/posts/${postId}`, { method: 'DELETE', headers: H }).catch(() => {});
    if (postEditId) await api(`/posts/${postEditId}`, { method: 'DELETE', headers: H }).catch(() => {});
  }
  return { name: 'signature', results };
}

module.exports = { run: async () => (await run()).results, name: 'signature' };

if (require.main === module) {
  require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
  run().then((r) => {
    let fail = 0;
    console.log('\n=== 서명란 카나리 ===');
    for (const x of r.results) { console.log(`${x.fail ? '❌' : '✅'} ${x.name} — ${x.details[0]}`); fail += x.fail; }
    console.log(`\n검사 ${r.results.length}개 · 실패 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.stack || e.message); process.exit(2); });
}
