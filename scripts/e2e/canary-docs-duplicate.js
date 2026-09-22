#!/usr/bin/env node
// canary-docs-duplicate.js — 문서 복사 · 상단 버튼 정리 (2026-09-22)
//
// Irene: *"문서 복사기능이 없네? 그리고 + 버튼 아래로 템플릿을 넣어줘. Q docs가 제대로 안보여.
//         버튼이 많아서. 그리고 편집버튼 옆에 복사버튼 넣어줘. 아이콘만 있으면 될 것 같아."*
//
// 재는 것:
//   ① 상단 액션 버튼 수가 줄었다 — [템플릿] 이 + 드롭다운 안으로 들어갔다
//   ② + 를 누르면 «템플릿에서 시작» 이 보인다 (문이 사라지지 않았다)
//   ③ 상세 밴드2 에 **아이콘만** 복사 버튼이 편집 옆에 있다 (글자 없음 · 32px)
//   ④ 눌러 보면 복사본이 만들어지고 **그 문서가 열린다**
//   ⑤ 복사본에 서명·공유 링크는 따라가지 않는다 (음성 대조군)
const b = require('./lib/browser');

const API = (process.env.E2E_BASE || 'https://dev.planq.kr') + '/api';
const results = [];
const P = (name, ok, msg) => results.push({ name, fail: ok ? 0 : 1, details: [msg], hasCanary: true });

async function api(path, opts = {}) {
  const r = await fetch(API + path, opts);
  let json = {};
  try { json = JSON.parse(await r.text()); } catch { /* 비 JSON */ }
  return { status: r.status, json };
}

const VISIBLE = `(el) => {
  if (!el) return { found: false };
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const hit = (r.width > 0 && r.height > 0)
    ? document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)) : null;
  return { found: true, w: Math.round(r.width), h: Math.round(r.height),
    text: (el.innerText || '').trim(),
    painted: r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none',
    mine: !!(hit && (hit === el || el.contains(hit) || hit.contains(el))) };
}`;

async function run() {
  let token = null, bizId = null, srcId = null, copyId = null;
  try {
    const lj = await api('/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: b.CREDS.email, password: b.CREDS.password }),
    });
    token = lj.json?.data?.token || null;
    const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    bizId = (await api('/businesses', { headers: H })).json?.data?.[0]?.id || null;
    const meId = (await api('/auth/me', { headers: H })).json?.data?.id || null;
    const cr = await api('/posts', {
      method: 'POST', headers: H,
      body: JSON.stringify({
        business_id: bizId, title: '[카나리] 복사 원본',
        content_json: { type: 'doc', content: [
          { type: 'paragraph', content: [{ type: 'text', text: '복사되어야 하는 본문입니다.' }] },
          { type: 'signatureField', attrs: { slot: 1, party: 'us', label: null } },
        ] },
        kind: 'doc', status: 'published', visibility: 'public', category: 'contract',
      }),
    });
    srcId = cr.json?.data?.id || null;
    if (srcId && meId) {
      // 원본에 서명 요청 + 공유 토큰 — 복사본에 따라가면 안 된다(음성 대조군의 재료)
      await api(`/posts/${srcId}/signatures`, {
        method: 'POST', headers: H,
        body: JSON.stringify({ signers: [{ slot: 1, party: 'us', user_id: meId, email: '' }],
          kind: 'sign', expires_in_days: 3, send_chat: false }),
      });
      await api(`/posts/${srcId}/share`, { method: 'POST', headers: H, body: '{}' });
    }
  } catch { /* 아래 0건 처리 */ }

  if (!srcId) {
    P('픽스처 — 복사할 문서 (0건 = 판정 불가)', false, '문서를 못 만들어 한 항목도 재지 못했다');
    return { name: 'docsdup', results };
  }

  const { browser, page } = await b.launch({});
  try {
    page.on('dialog', (d) => d.accept().catch(() => {}));
    await b.login(page);

    // ── ①② 목록 상단 — 버튼이 줄고, 템플릿은 + 안으로 ──────────
    await b.goto(page, '/docs');
    await b.sleep(2500); await b.dismissBlockers(page).catch(() => {});
    const head = await page.evaluate(`(() => {
      const plus = document.querySelector('[data-testid="docs-new"]');
      // 헤더 줄 안의 «글자 있는» 버튼만 센다(+ 는 아이콘이라 제외되지 않게 따로 본다)
      const row = plus ? plus.closest('div') : null;
      const bar = row ? row.parentElement : null;
      const labels = bar ? [...bar.querySelectorAll('button')].map((x) => (x.innerText || '').trim()).filter(Boolean) : [];
      return { hasPlus: !!plus, labels, tplBtn: labels.some((x) => x === '템플릿' || x === 'Templates') };
    })()`);
    P('① 상단에 별도 [템플릿] 버튼이 없다 (+ 안으로 들어갔다)',
      head.hasPlus && !head.tplBtn,
      head.hasPlus ? `헤더 글자 버튼 ${JSON.stringify(head.labels)} · 별도 템플릿 버튼=${head.tplBtn}`
        : '🔴 + 버튼을 못 찾았다');

    await page.click('[data-testid="docs-new"]').catch(() => {});
    await b.sleep(700);
    const dd = await page.evaluate(`(() => {
      const item = document.querySelector('[data-testid="docs-new-template"]');
      const blank = document.querySelector('[data-testid="docs-new-blank"]');
      return { tpl: item ? (${VISIBLE})(item) : { found: false }, blank: !!blank };
    })()`);
    P('② + 를 누르면 «템플릿에서 시작» 이 보인다 (문이 사라지지 않았다)',
      dd.tpl.found && dd.tpl.painted && dd.blank,
      dd.tpl.found ? `"${dd.tpl.text.replace(/\\n/g, ' ')}" ${dd.tpl.w}×${dd.tpl.h} 그려짐`
        : '🔴 드롭다운에 템플릿 항목이 없다 — 템플릿으로 가는 문이 사라졌다');
    await page.keyboard.press('Escape').catch(() => {});

    // ── ③ 상세 — 편집 옆 **아이콘만** 복사 버튼 ─────────────────
    await b.goto(page, `/docs?post=${srcId}`);
    await b.sleep(2500); await b.dismissBlockers(page).catch(() => {});
    const dup = await page.evaluate(`(() => {
      const el = document.querySelector('[data-testid="post-duplicate"]');
      const edit = document.querySelector('[data-testid="post-edit"]');
      if (!el) return { found: false };
      const v = (${VISIBLE})(el);
      const er = edit ? edit.getBoundingClientRect() : null;
      const r = el.getBoundingClientRect();
      return { found: true, v,
        label: (el.getAttribute('aria-label') || ''),
        hasText: (el.innerText || '').trim().length > 0,
        sameRowAsEdit: !!(er && Math.abs(er.top - r.top) < 6),
        rightOfEdit: !!(er && r.left > er.left) };
    })()`);
    P('③ 편집 옆에 **아이콘만** 복사 버튼이 있다 (같은 줄 · 글자 없음)',
      dup.found && dup.v.painted && dup.v.mine && !dup.hasText && dup.sameRowAsEdit && dup.rightOfEdit,
      dup.found ? `${dup.v.w}×${dup.v.h} 그려짐 · 글자 ${dup.hasText ? '있음(아이콘만이어야)' : '없음'} · 편집과 같은 줄=${dup.sameRowAsEdit} · aria="${dup.label}"`
        : '🔴 복사 버튼이 없다');

    // ── ④ 눌러 보면 복사본이 만들어지고 그 문서가 열린다 ─────────
    let opened = { ok: false };
    if (dup.found) {
      await page.click('[data-testid="post-duplicate"]').catch(() => {});
      await b.sleep(4000);
      opened = await page.evaluate(`(() => {
        const t = document.querySelector('[data-testid="docs-detail-bands"]');
        const url = new URL(location.href);
        return { title: t ? (t.innerText || '').split('\\n')[0].trim() : null, post: url.searchParams.get('post') };
      })()`);
      const list = await api(`/posts?business_id=${bizId}&limit=500`, { headers: { Authorization: `Bearer ${token}` } });
      const made = (list.json?.data || []).find((p) => p.title === '[카나리] 복사 원본 (복사)');
      copyId = made?.id || null;
      P('④ 복사 버튼을 누르면 복사본이 생기고 **그 문서가 열린다**',
        !!copyId && String(opened.post) === String(copyId),
        copyId ? `복사본 #${copyId} "${made.title}" · 화면이 연 문서 ?post=${opened.post}`
          : `🔴 복사본이 만들어지지 않았다 (화면 제목 "${opened.title}")`);
    } else {
      P('④ 복사 버튼을 누르면 복사본이 생기고 **그 문서가 열린다**', false, '🔴 버튼이 없어 재지 못했다');
    }

    // ── ⑤ 복사본에 서명·공유 링크는 따라가지 않는다 (음성 대조군) ──
    if (copyId) {
      const sv = await api(`/posts/${copyId}/signed-html`, { headers: { Authorization: `Bearer ${token}` } });
      const det = await api(`/posts/${copyId}`, { headers: { Authorization: `Bearer ${token}` } });
      const srcSv = await api(`/posts/${srcId}/signed-html`, { headers: { Authorization: `Bearer ${token}` } });
      const noSig = sv.json?.data?.has_signatures === false;
      const noShare = !det.json?.data?.share_token && det.json?.data?.share_url == null;
      P('⑤ 복사본에 서명·공유 링크가 따라가지 않는다 (원본에는 있다 = 양성 대조군)',
        noSig && noShare && srcSv.json?.data?.has_signatures === true,
        `복사본 서명 ${sv.json?.data?.has_signatures} · 공유토큰 ${!noShare ? '있음(누수)' : '없음'} · 원본 서명 ${srcSv.json?.data?.has_signatures}`);
    } else {
      P('⑤ 복사본에 서명·공유 링크가 따라가지 않는다 (원본에는 있다 = 양성 대조군)', false, '🔴 복사본이 없어 재지 못했다');
    }
  } catch (e) {
    P('복사 검사 중 오류', false, `🔴 ${e.message}`);
  } finally {
    await browser.close().catch(() => {});
    const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    if (copyId) await api(`/posts/${copyId}`, { method: 'DELETE', headers: H }).catch(() => {});
    if (srcId) await api(`/posts/${srcId}`, { method: 'DELETE', headers: H }).catch(() => {});
  }
  return { name: 'docsdup', results };
}

module.exports = { run: async () => (await run()).results, name: 'docsdup' };

if (require.main === module) {
  require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
  run().then((r) => {
    let fail = 0;
    console.log('\n=== 문서 복사 카나리 ===');
    for (const x of r.results) { console.log(`${x.fail ? '❌' : '✅'} ${x.name} — ${x.details[0]}`); fail += x.fail; }
    console.log(`\n검사 ${r.results.length}개 · 실패 ${fail}`);
    process.exit(fail > 0 ? 1 : 0);
  }).catch((e) => { console.error('FATAL', e.stack || e.message); process.exit(2); });
}
