// canary-project-refs — 문서·파일을 다른 프로젝트에도 «연결» (2026-10-27, docs/PROJECT_REFS_DESIGN.md · Fable GO-WITH-CHANGES)
//
//   Irene: «같은 문서가 여러 프로젝트에 연결되는 거면 어떻게 해? … 프로젝트 연결도 여러 개 연결해야 할 것 같아.»
//   재는 것(폰 390 · 태블릿 820 · 데스크탑 1440):
//     ① 프로젝트 문서 탭 — «연결됨» 표시가 실제로 보임(elementFromPoint) · [전체|소속|연결됨] 거르기가 뒤집힘(연결됨 → 전부 연결 행 / 소속 → 0)
//     ② 문서 보기 밴드2 — 연결 프로젝트 칩 보임 · 편집 밴드2 — «다른 프로젝트에 연결» 칸 보임 · L2 안내 줄
//     ③ 프로젝트 파일 탭 — 좌측 «연결됨» 칸 → 연결 파일 행 보임
//     ④ 가로 넘침 0
//     ⑤ 음성 대조군(API) — P1 멤버가 아닌 member2 는 같은 탭에 P1 팀 비공개 문서가 안 온다 · 고객은 연결 목록 0
const b = require('./lib/browser');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const OWNER = { email: 'owner@test.planq.kr', password: 'Test1234!' };
const API = 'http://localhost:3003';
const WS = 6, P1 = 36, P2 = 35;   // P1 패키지 디자인(owner·member1) · P2 브랜드 리뉴얼(owner·member1·member2 · 고객 18)
const TITLE = '[확인용] 연결 화면 확인 — 패키지 디자인 소속';
const results = [];
const push = (name, pass, detail) => { results.push({ name, fail: !pass, details: detail ? [detail] : [] }); if (require.main === module) console.log(`${pass ? '✅' : '❌'} ${name}${!pass && detail ? ' — ' + detail : ''}`); };

async function tokenOf(email) {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Test1234!' }) });
  return (await r.json()).data?.token;
}
const call = (tok) => async (method, path, body) => {
  const r = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => null) };
};

// 시험 자료 — 이름이 같은 것이 있으면 다시 쓴다([확인용] — 7일 뒤 정리 스크립트가 치운다)
async function ensureFixtures() {
  const o = call(await tokenOf(OWNER.email));
  const list = await o('GET', `/api/posts?business_id=${WS}&project_id=${P1}&q=${encodeURIComponent('[확인용] 연결 화면 확인')}`);
  let post = (list.j?.data || []).find((p) => p.title === TITLE);
  if (!post) post = (await o('POST', '/api/posts', { business_id: WS, project_id: P1, title: TITLE, vlevel: 'L2', status: 'published',
    content_json: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '브랜드 리뉴얼 프로젝트에도 연결된 문서입니다.' }] }] } })).j?.data;
  await o('POST', `/api/projects/${P2}/refs`, { entity_type: 'post', entity_id: post.id });   // 이미 있으면 409 — 괜찮다
  const files = await o('GET', `/api/projects/${P1}/files`);
  let file = (files.j?.data || []).find((f) => f.source === 'direct' && f.file_name === 'confirm-linked-file.txt');
  let fileId = file ? Number(String(file.id).replace('direct-', '')) : null;
  if (!fileId) {
    const tok = await tokenOf(OWNER.email);
    const fd = new FormData();
    fd.append('file', new Blob(['[확인용] 연결 파일'], { type: 'text/plain' }), 'confirm-linked-file.txt');
    const up = await (await fetch(`${API}/api/files/${WS}`, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd })).json();
    fileId = up.data.id;
    await o('PUT', `/api/files/${WS}/${fileId}/visibility`, { level: 'L2', project_id: P1 });
  }
  await o('POST', `/api/projects/${P2}/refs`, { entity_type: 'file', entity_id: fileId });
  return { postId: post.id, fileId };
}

const visible = (page, sel) => page.evaluate((s) => {
  const els = Array.from(document.querySelectorAll(s));
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const x = Math.min(window.innerWidth - 1, Math.max(0, r.left + Math.min(r.width / 2, 20)));
    const y = Math.min(window.innerHeight - 1, Math.max(0, r.top + r.height / 2));
    const hit = document.elementFromPoint(x, y);
    if (hit && (el === hit || el.contains(hit))) return true;
  }
  return false;
}, sel);
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

async function run() {
  const fx = await ensureFixtures();
  // ⑤ API 대조군
  {
    const m2 = call(await tokenOf('member2@test.planq.kr'));
    const r = await m2('GET', `/api/projects/${P2}/refs?type=post`);
    push('⑤ member2(P1 비멤버) 연결 목록에 P1 팀 비공개 문서 없음', r.s === 200 && !(r.j.data || []).some((d) => d.id === fx.postId), String(r.s));
    const o = call(await tokenOf(OWNER.email));
    const ro = await o('GET', `/api/projects/${P2}/refs?type=post`);
    push('⑤ 양성 대조군 — owner 연결 목록에는 있음', (ro.j?.data || []).some((d) => d.id === fx.postId));
    const c = call(await tokenOf('client@test.planq.kr'));
    const rc = await c('GET', `/api/projects/${P2}/refs?type=post`);
    push('⑤ 고객 연결 목록 0', rc.s === 200 && (rc.j.data || []).length === 0, JSON.stringify(rc.j).slice(0, 120));
  }
  for (const [label, width, height] of [['폰', 390, 844], ['태블릿', 820, 1180], ['데스크탑', 1440, 900]]) {
    const { browser } = await b.launch();
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    await page.setViewport({ width, height });
    try {
      await b.login(page, OWNER);
      // ① 문서 탭
      await page.goto(`${b.BASE}/projects/p/${P2}?tab=docs`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-testid="docs-row-linked"]', { timeout: 20000 }).catch(() => null);
      await b.dismissBlockers(page).catch(() => {}); await sleep(1200);
      push(`① ${label} 문서 탭 «연결됨» 표시 보임`, await visible(page, '[data-testid="docs-row-linked"]'));
      // 프로젝트 문서 탭은 좌측 분류 + 카드다 — «연결됨» 칸을 누르면 카드가 전부 연결 문서여야 한다(대조: «전체» 는 소속 카드도 섞임)
      const cardCount = () => page.evaluate(() => { const c = Array.from(document.querySelectorAll('[data-testid="docs-card"]')); return { n: c.length, linked: c.filter((r) => r.querySelector('[data-testid="docs-row-linked"]')).length }; });
      const all = await cardCount();
      push(`① ${label} 좌측 «연결됨» 칸 보임`, await visible(page, '[data-testid="docs-filter-linked"]'));
      await page.click('[data-testid="docs-filter-linked"]').catch(() => null); await sleep(500);
      const onlyLinked = await cardCount();
      push(`① ${label} «연결됨» 칸 → 전부 연결 카드 (${onlyLinked.linked}/${onlyLinked.n}) · 전체였을 때 ${all.linked}/${all.n}`, onlyLinked.n > 0 && onlyLinked.n === onlyLinked.linked && all.n > all.linked);
      await page.click('[data-testid="docs-filter-linked"]').catch(() => null); await sleep(400);   // 다시 누르면 풀림
      const back = await cardCount();
      push(`① ${label} 다시 누르면 전체로 (${back.n})`, back.n === all.n);
      push(`④ ${label} 문서 탭 가로 넘침 0`, (await overflowX(page)) <= 0, String(await overflowX(page)));
      // ② 문서 보기·편집
      await page.click(`[data-testid="docs-card"][data-row-id="${fx.postId}"]`).catch(() => null);
      await page.waitForSelector('[data-testid="project-refs-chips"]', { timeout: 15000 }).catch(() => null); await sleep(800);
      push(`② ${label} 보기 밴드2 연결 칩 보임`, await visible(page, `[data-testid="project-ref-chip-${P2}"]`));
      await page.click('[data-testid="post-edit"]').catch(() => null);
      await page.waitForSelector('[data-testid="project-refs-field"]', { timeout: 15000 }).catch(() => null); await sleep(800);
      // 폰은 «분류·연결» 요약을 눌러야 칸이 펼쳐진다
      if (width <= 640) { await page.click('[data-testid="docs-meta-summary"]').catch(() => null); await sleep(500); }
      await page.evaluate(() => document.querySelector('[data-testid="project-refs-field"]')?.scrollIntoView({ block: 'center', inline: 'center' }));
      await sleep(300);
      push(`② ${label} 편집 «다른 프로젝트에 연결» 칸 보임`, await visible(page, '[data-testid="project-refs-picker"]'));
      push(`② ${label} 편집 연결 칩 + × 보임`, await visible(page, `[data-testid="project-ref-remove-${P2}"]`));
      push(`② ${label} L2 안내 «공개 범위는 그대로» 있음`, !!(await page.$('[data-testid="project-refs-scope-hint"]')));
      push(`④ ${label} 편집 화면 가로 넘침 0`, (await overflowX(page)) <= 0, String(await overflowX(page)));
      if (width === 1440) await page.screenshot({ path: '/home/irene/.claude/jobs/9c1f0313/tmp/refs-edit-1440.png' }).catch(() => null);
      if (width === 390) await page.screenshot({ path: '/home/irene/.claude/jobs/9c1f0313/tmp/refs-edit-390.png' }).catch(() => null);
      // ③ 파일 탭 — 편집을 떠나도 바뀐 것이 없으니 확인창이 없다
      await page.goto(`${b.BASE}/projects/p/${P2}?tab=files`, { waitUntil: 'domcontentloaded' });
      await sleep(2500); await b.dismissBlockers(page).catch(() => {});
      const clicked = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length < 4 && /^(연결됨|Linked)$/.test((e.textContent || '').trim()));
        const t = rows.find((e) => e.getBoundingClientRect().width > 0);
        if (!t) return false; (t.closest('[role="treeitem"],button,div') || t).click(); return true;
      });
      await sleep(800);
      const fileShown = await page.evaluate(() => Array.from(document.querySelectorAll('*')).some((e) => e.children.length === 0 && (e.textContent || '').includes('confirm-linked-file') && e.getBoundingClientRect().width > 0));
      push(`③ ${label} 파일 탭 «연결됨» 칸 → 연결 파일 보임`, clicked && fileShown, `칸 ${clicked} · 파일 ${fileShown}`);
      push(`④ ${label} 파일 탭 가로 넘침 0`, (await overflowX(page)) <= 0, String(await overflowX(page)));
    } catch (e) {
      push(`${label} 실행 오류`, false, e.message);
    } finally { await browser.close().catch(() => {}); }
  }
  return results;
}

module.exports = { name: '프로젝트 연결 — 문서·파일 연결 표시·거르기·칩·칸 · 대조군(member2·고객)', run };
if (require.main === module) {
  require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env', quiet: true });
  run().then((r) => { const f = r.filter((x) => x.fail).length; console.log(`\n${r.length - f} 통과 / ${f} 실패`); process.exit(f ? 1 : 0); }).catch((e) => { console.error(e); process.exit(1); });
}
