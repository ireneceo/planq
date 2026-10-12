// scripts/e2e/canary-post-history.js — 문서 변경 기록: 누가·언제 · 처음 버전 · 미리보기 · 확인 후 되돌리기 (2026-10-12)
//
// Irene: *"같은 문서 수정하면 히스토리 저장되고 있어? 수정한 일시랑 수정한 사람 저장되고 되돌리는거 되는지 확인하고
//          제대로 구성된 ui/ux인지 체크해서 제대로 만들어"*
//
// 서버(실호출)
//   A1 처음 고칠 때 «고치기 전» 내용이 1번(처음 버전)으로 남는다 — 예전엔 첫 수정이 곧 1번이라 원래 내용이 없었다
//   A2 같은 사람이 10분 안에 이어 고친 것은 합쳐지되 1번에는 합쳐지지 않는다
//   A3 다른 사람이 고치면 새 버전 · 목록이 사람·마지막 저장 시각·글자 수 차이를 준다
//   A4 되돌리기 → 본문이 그 버전이 되고 «되돌림» 버전이 맨 위 · 되돌리기 전 내용도 남아 다시 되돌릴 수 있다
// 화면(폰 390 · 태블릿 820 · 데스크탑 1440)
//   ① ⋯ > 변경 기록 → 우측 표준 패널이 보이고 행마다 사람·시각
//   ② 행을 누르면 그 버전 본문 미리보기(옛 글자) · 맨 위(현재)에는 되돌리기 버튼 없음
//   ③ [이 버전으로 되돌리기] → 확인창(시각·사람이 적힘) → 확인 → 본문이 옛 글자 · 목록 맨 위 «현재·되돌림»
//   ④ 가로넘침 0
// 픽스처는 Node 에서 만들고 끝나면 지운다.
const { launch, login, goto, sleep, dismissBlockers, CREDS } = require('./lib/browser');
const { sequelize } = require('/opt/planq/dev-backend/config/database');

const API = 'http://127.0.0.1:3003';
const results = [];
const push = (name, pass, detail) => results.push({ name, fail: !pass, details: detail ? [detail] : [] });

async function api(path, opt = {}, tok) {
  const r = await fetch(API + path, { ...opt, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) } });
  const j = await r.json().catch(() => ({}));
  j.__status = r.status;
  return j;
}
const para = (txt) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: txt }] }] });
const q = (sql, rep) => sequelize.query(sql, { replacements: rep });
// 마지막 버전을 15분 전으로 — 합치기 창(10분)을 넘긴 것처럼
const age = (postId) => q('UPDATE post_revisions SET created_at = DATE_SUB(created_at, INTERVAL 15 MINUTE), updated_at = DATE_SUB(updated_at, INTERVAL 15 MINUTE) WHERE post_id = ?', [postId]);

async function clickVisible(page, sel) {
  const box = await page.evaluate((s) => {
    const el = [...document.querySelectorAll(s)].find((e) => { const r = e.getBoundingClientRect(); return (e.checkVisibility ? e.checkVisibility() : e.offsetParent !== null) && r.width > 0 && r.height > 0; });
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, sel);
  if (!box) throw new Error(`보이는 요소 없음: ${sel}`);
  await sleep(150);
  await page.mouse.click(box.x, box.y);
}
async function clickText(page, scopeSel, text) {
  const box = await page.evaluate((s, t) => {
    const root = document.querySelector(s) || document;
    const el = [...root.querySelectorAll('button, [role="menuitem"]')].find((e) => e.textContent.trim().includes(t) && e.getBoundingClientRect().width > 0);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, scopeSel, text);
  if (!box) throw new Error(`버튼 없음: ${text}`);
  await page.mouse.click(box.x, box.y);
}

async function part(width, postId, otherName) {
  const tag = `[${width}]`;
  const { browser, page } = await launch();
  try {
    await page.setViewport({ width, height: width < 700 ? 844 : 900 });
    await login(page);
    await goto(page, `/docs?post=${postId}`);
    await sleep(2600);
    await dismissBlockers(page).catch(() => {});
    await clickVisible(page, '[data-testid="post-more"]');
    await sleep(400);
    await clickVisible(page, '[data-testid="post-history"]');
    await sleep(1500);
    const p1 = await page.evaluate((other) => {
      const p = document.querySelector('[data-testid="post-history-panel"]');
      if (!p) return { ok: false, why: 'no panel' };
      const r = p.getBoundingClientRect();
      const rows = [...p.querySelectorAll('[data-testid^="post-history-row-"]')];
      const txt = rows.map((x) => x.innerText.replace(/\s+/g, ' '));
      const c = { x: r.left + Math.min(40, r.width / 2), y: r.top + 20 };
      const hit = document.elementFromPoint(c.x, c.y);
      return { ok: rows.length >= 3 && txt.some((t) => t.includes(other)) && txt.every((t) => /\d{1,2}:\d{2}/.test(t)) && !!hit && p.contains(hit) && r.right <= innerWidth + 1,
        rows: txt, r: [r.left, r.top, r.right].map(Math.round) };
    }, otherName);
    push(`${tag} ① 변경 기록 패널 보임 · 행마다 사람·시각`, p1.ok, JSON.stringify(p1));
    // 처음 버전(1번) 행을 눌러 미리보기
    await clickVisible(page, '[data-testid="post-history-row-1"]');
    await sleep(1500);
    const p2 = await page.evaluate(() => {
      const pv = document.querySelector('[data-testid="post-history-preview"]');
      const btn = document.querySelector('[data-testid="post-history-restore"]');
      return { ok: !!pv && pv.innerText.includes('zqhist 처음 내용') && !!btn && btn.getBoundingClientRect().width > 0, text: pv ? pv.innerText.slice(0, 80) : null, btn: !!btn };
    });
    push(`${tag} ② 처음 버전 미리보기에 옛 글자 · 되돌리기 버튼`, p2.ok, JSON.stringify(p2));
    await clickVisible(page, '[data-testid="post-history-restore"]');
    await sleep(600);
    const dlg = await page.evaluate((other) => {
      const d = [...document.querySelectorAll('[aria-modal="true"]')].find((x) => x.innerText.includes('되돌릴까요') || x.innerText.includes('Restore this version?'));
      return d ? { ok: true, text: d.innerText.replace(/\s+/g, ' ').slice(0, 160) } : { ok: false };
    }, otherName);
    push(`${tag} ③a 확인창이 뜨고 시각·사람을 말한다`, dlg.ok && /\d{1,2}:\d{2}/.test(dlg.text || ''), JSON.stringify(dlg));
    const before = (await q('SELECT content_text FROM posts WHERE id = ?', [postId]))[0][0].content_text;
    // 확인창의 확인 버튼(마지막 [aria-modal] 안의 «되돌리기» 글자)
    await page.evaluate(() => {
      const d = [...document.querySelectorAll('[aria-modal="true"]')].reverse().find((x) => x.innerText.includes('되돌릴까요'));
      const b = d && [...d.querySelectorAll('button')].find((x) => x.textContent.includes('이 버전으로 되돌리기'));
      if (b) b.click();
    });
    await sleep(2200);
    const after = (await q('SELECT content_text FROM posts WHERE id = ?', [postId]))[0][0].content_text;
    const p3 = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid^="post-history-row-"]')];
      const top = rows[0] ? rows[0].innerText.replace(/\s+/g, ' ') : '';
      const body = [...document.querySelectorAll('.ProseMirror')].some((e) => e.innerText.includes('zqhist 처음 내용') && !e.closest('[data-testid="post-history-panel"]'));
      return { top, body, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    push(`${tag} ③b 확인 → 본문이 처음 내용 · 맨 위 «현재·되돌림»`, after.includes('zqhist 처음 내용') && !before.includes('zqhist 처음 내용') && p3.top.includes('현재') && p3.top.includes('되돌림') && p3.body,
      JSON.stringify({ before: before.slice(0, 40), after: after.slice(0, 40), ...p3 }));
    push(`${tag} ④ 가로넘침 0`, p3.overflow <= 1, `넘침 ${p3.overflow}px`);
  } finally { await browser.close().catch(() => {}); }
}

async function setupFixture(tok, biz, otherId) {
  const d = await api('/api/posts', { method: 'POST', body: JSON.stringify({ business_id: biz, title: 'zqhist-doc', content_json: para('zqhist 처음 내용'), kind: 'doc', status: 'published' }) }, tok);
  const id = d.data && d.data.id;
  if (!id) return null;
  await q('DELETE FROM post_revisions WHERE post_id = ?', [id]);
  await q('UPDATE posts SET updated_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?', [id]);
  await api(`/api/posts/${id}`, { method: 'PUT', body: JSON.stringify({ content_json: para('zqhist 둘째 내용입니다') }) }, tok);
  await age(id);
  // 다른 사람의 편집 — 서비스를 같은 방식으로 부른다(다른 계정 비밀번호를 건드리지 않으려고)
  const { Post } = require('/opt/planq/dev-backend/models');
  const { recordRevision } = require('/opt/planq/dev-backend/services/postRevisions');
  const post = await Post.findByPk(id);
  await post.update({ content_json: JSON.stringify(para('zqhist 셋째 — 다른 사람이 고침 길게 길게')), content_text: 'zqhist 셋째 — 다른 사람이 고침 길게 길게', editor_id: otherId });
  await recordRevision({ post, editorUserId: otherId, source: 'autosave' });
  await age(id);
  await api(`/api/posts/${id}`, { method: 'PUT', body: JSON.stringify({ content_json: para('zqhist 넷째 최신') }) }, tok);
  return id;
}

async function run() {
  const lg = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(CREDS) });
  const tok = lg.data && (lg.data.token || lg.data.access_token || lg.data.accessToken);
  const u = lg.data && lg.data.user;
  const biz = u && (u.active_business_id || u.business_id);
  const made = [];
  try {
    if (!tok || !biz) { push('픽스처 로그인', false, '토큰·워크스페이스 없음'); return results; }
    const [others] = await q("SELECT bm.user_id, COALESCE(NULLIF(bm.name,''), u.name) AS name FROM business_members bm JOIN users u ON u.id = bm.user_id WHERE bm.business_id = ? AND bm.user_id <> ? AND bm.role IN ('owner','admin','member') LIMIT 1", [biz, u.id]);
    if (!others.length) { push('다른 멤버', false, '없음'); return results; }
    const other = others[0];
    const [unameRow] = await q('SELECT name FROM users WHERE id = ?', [other.user_id]);
    const otherName = unameRow[0].name;

    // ── 서버 ──
    const d = await api('/api/posts', { method: 'POST', body: JSON.stringify({ business_id: biz, title: 'zqhist-api', content_json: para('원래 내용 A'), kind: 'doc', status: 'published' }) }, tok);
    const id = d.data && d.data.id;
    if (!id) { push('픽스처 만들기', false, JSON.stringify(d)); return results; }
    made.push(id);
    await q('DELETE FROM post_revisions WHERE post_id = ?', [id]);   // 기능 생기기 전 문서처럼
    await q('UPDATE posts SET updated_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = ?', [id]);
    await api(`/api/posts/${id}`, { method: 'PUT', body: JSON.stringify({ content_json: para('바뀐 내용 B') }) }, tok);
    let list = await api(`/api/posts/${id}/revisions`, {}, tok);
    const first = (list.data || []).find((r) => r.revision_number === 1);
    const firstBody = first ? await api(`/api/posts/${id}/revisions/${first.id}`, {}, tok) : null;
    const firstTxt = JSON.stringify(firstBody && firstBody.data && firstBody.data.content_json);
    push('A1 처음 고칠 때 고치기 전 내용이 1번으로 남는다', (list.data || []).length === 2 && firstTxt.includes('원래 내용 A') && first.is_first,
      JSON.stringify((list.data || []).map((r) => [r.revision_number, r.editor && r.editor.name, r.saved_at])));
    await api(`/api/posts/${id}`, { method: 'PUT', body: JSON.stringify({ content_json: para('바뀐 내용 B 이어서 C') }) }, tok);
    list = await api(`/api/posts/${id}/revisions`, {}, tok);
    push('A2 10분 안 이어쓰기는 합쳐지고 1번은 그대로', list.data.length === 2 && list.data[1].revision_number === 1, `버전 ${list.data.length}개`);
    await age(id);
    // 다른 사람
    const { Post } = require('/opt/planq/dev-backend/models');
    const { recordRevision } = require('/opt/planq/dev-backend/services/postRevisions');
    const pp = await Post.findByPk(id);
    await pp.update({ content_json: JSON.stringify(para('다른 사람이 고친 내용 D 조금 더')), content_text: 'x', editor_id: other.user_id });
    await recordRevision({ post: pp, editorUserId: other.user_id, source: 'autosave' });
    list = await api(`/api/posts/${id}/revisions`, {}, tok);
    const top = list.data[0];
    push('A3 다른 사람이 고치면 새 버전 · 사람·저장 시각·글자 차이', list.data.length === 3 && top.editor && top.editor.id === other.user_id && !!top.saved_at && typeof top.text_delta === 'number' && top.text_delta > 0,
      JSON.stringify(list.data.map((r) => ({ n: r.revision_number, who: r.editor && r.editor.name, at: r.saved_at, d: r.text_delta }))));
    // 되돌리기 → 1번
    const rs = await api(`/api/posts/${id}/revisions/${first.id}/restore`, { method: 'POST' }, tok);
    const [[row]] = await q('SELECT content_text, editor_id FROM posts WHERE id = ?', [id]);
    list = await api(`/api/posts/${id}/revisions`, {}, tok);
    const hasD = await Promise.all(list.data.map(async (r) => JSON.stringify((await api(`/api/posts/${id}/revisions/${r.id}`, {}, tok)).data.content_json).includes('내용 D')));
    push('A4 되돌리기 → 본문 = 처음 내용 · 맨 위 restore · 되돌리기 전(D)도 남음 · 고친 사람 = 되돌린 사람',
      rs.__status === 200 && row.content_text.includes('원래 내용 A') && list.data[0].source === 'restore' && hasD.some(Boolean) && row.editor_id === u.id,
      JSON.stringify({ status: rs.__status, text: row.content_text, top: list.data[0].source, keptD: hasD.some(Boolean), editor: row.editor_id }));

    // ── 화면 ──
    for (const w of [1440, 820, 390]) {
      const pid = await setupFixture(tok, biz, other.user_id);
      if (!pid) { push(`[${w}] 픽스처`, false, 'none'); continue; }
      made.push(pid);
      await part(w, pid, otherName).catch((e) => push(`[${w}] 실행`, false, e.message));
    }
  } finally {
    for (const id of made) {
      await q('DELETE FROM post_revisions WHERE post_id = ?', [id]).catch(() => {});
      await q('DELETE FROM posts WHERE id = ?', [id]).catch(() => {});
    }
    push('정리 — 검사 문서 삭제', true, `${made.length}건`);
  }
  return results;
}

module.exports = { name: '문서 변경 기록 — 누가·언제 · 처음 버전 · 미리보기 · 확인 후 되돌리기', run };
