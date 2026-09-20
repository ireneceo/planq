// 좌측 트리 — 프로젝트 1줄 · 캐럿 펼침 · 캐럿 클릭이 목록을 안 바꾼다.
// ★ 픽스처를 **먼저** 만들고 /files 는 **한 번만** 연다 — 파일이 1400건이라 여는 것 자체가 무겁다.
// ★ 대상 프로젝트는 «파일이 있는 프로젝트» 다. 그래야 좌측 목록에 실제로 뜬다
//   (DB 에서 아무거나 집었다가 캐럿 없음을 결함으로 잘못 읽었다).
// ★ 열 정렬도 잰다 — 이름의 왼쪽 끝 / 숫자의 오른쪽 끝이 전 행에서 같은 x 인가.
//   행마다 그리드 칸 수가 다르면 열이 갈라진다. 2026-09-20 에 프로젝트 행에만 펼침 칸을 더해
//   **동그라미가 «이름 칸»(1fr)을 차지**했고, 이름이 오른쪽으로 밀려 «우측정렬» 로 보였다.
//
// ★★ **양성 대조군은 «끄는» 방식이어야 하고, 넣은 뒤 빌드 종료코드를 먼저 본다.**
//   같은 날 대조군이 네 번 헛돌았고 **둘이 같은 원인**이었다 — «코드를 지우는» 대조군은
//   미사용 변수(TS6133)로 **빌드가 실패**하고, 그러면 옛 번들이 그대로 서빙돼 판정이
//   **거짓 초록**이 된다. "검사기가 결함을 못 잡는다" 로 결론 낼 뻔했다.
//   이 검사의 올바른 대조군: `FolderRow` 의 `grid-template-columns` 를 옛 4칸으로 되돌린다.
//   변수는 전부 쓰이므로 빌드가 통과하고, 이름 왼쪽 끝이 **408/393/312/433 으로 흩어진다**(실측).
//   (나머지 둘: 화면에 안 뜨는 프로젝트를 DB 에서 골랐다 · 그려지지 않는 분기를 건드렸다.)
const b = require('/opt/planq/scripts/e2e/lib/browser');
require('/opt/planq/dev-backend/node_modules/dotenv').config({ path: '/opt/planq/dev-backend/.env' });
const { sequelize } = require('/opt/planq/dev-backend/config/database');
const TAG = 'ZTR' + Date.now();
async function run() {
  const results = [];
  const [top] = await sequelize.query(`SELECT f.project_id pid, f.business_id biz, COUNT(*) n
      FROM files f WHERE f.project_id IS NOT NULL AND f.deleted_at IS NULL AND f.business_id IN (5,73)
      GROUP BY f.project_id, f.business_id ORDER BY n DESC LIMIT 1`);
  if (!top.length) { results.push({ name: '좌측 트리', fail: 0, details: ['⬜ 미측정 — 파일이 달린 프로젝트가 없다'] }); return results; }
  const { pid, biz } = top[0];
  const [me] = await sequelize.query('SELECT user_id FROM business_members WHERE business_id=:b LIMIT 1', { replacements: { b: biz } });
  await sequelize.query('INSERT INTO file_folders (business_id,project_id,parent_id,name,sort_order,created_by,created_at,updated_at) VALUES (:b,:p,NULL,:n,0,:u,NOW(),NOW())',
    { replacements: { b: biz, p: pid, n: TAG + '-상위', u: me[0].user_id } });
  const [f1] = await sequelize.query('SELECT id FROM file_folders WHERE name=:n', { replacements: { n: TAG + '-상위' } });
  await sequelize.query('INSERT INTO file_folders (business_id,project_id,parent_id,name,sort_order,created_by,created_at,updated_at) VALUES (:b,:p,:pa,:n,0,:u,NOW(),NOW())',
    { replacements: { b: biz, p: pid, pa: f1[0].id, n: TAG + '-하위', u: me[0].user_id } });
  

  const { browser, page } = await b.launch();
  const judge = (n, ok, d) => results.push({ name: n, fail: ok ? 0 : 1, details: [d] });
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await b.login(page);
    await b.goto(page, '/inbox');
    await b.sleep(1000);
    await b.goto(page, '/files');
    await b.sleep(5000);
    const before = await page.evaluate((p, nm) => {
      const rows = [...document.querySelectorAll('[data-testid^="docs-project-row-"]')];
      const mine = rows.filter(r => r.getAttribute('data-testid') === `docs-project-row-${p}`);
      const nameEl = mine[0] ? mine[0].querySelector('[title]') : null;
      const projName = nameEl ? nameEl.getAttribute('title') : null;
      const leaves = [...document.querySelectorAll('div')].map(d => d.children.length === 0 ? (d.textContent || '').trim() : '').filter(Boolean);
      return { rowsForThis: mine.length, projName,
        sameNameCount: projName ? leaves.filter(t => t === projName).length : null,
        hasCaret: !!(mine[0] && mine[0].querySelector('span[role="button"]')),
        subShown: document.body.innerText.includes(nm),
        files: document.querySelectorAll('[data-file-id]').length };
    }, pid, TAG + '-상위');

    judge('프로젝트는 한 줄', before.rowsForThis === 1, `${before.rowsForThis}줄`);
    judge('같은 이름이 트리에 한 번만 (중복 제거)', before.sameNameCount === 1, `"${before.projName}" ×${before.sameNameCount}`);
    judge('폴더가 있으면 캐럿이 붙는다', before.hasCaret, String(before.hasCaret));
    judge('누르기 전에는 하위 폴더가 안 보인다 (음성 대조군)', !before.subShown, String(before.subShown));
    // ★ 열 정렬 — 이름의 **왼쪽 끝**과 숫자의 **오른쪽 끝**이 전 행에서 같은 x 에 서는가.
    //   Irene 2026-09-20: *"프로젝트 이름이 좌측정렬이어야지 왜 우측정렬이야?"* ·
    //   *"전체, 내 파일, 채팅 업무 회의 등의 폴더이름이랑 오른쪽도 맞춰야지"*
    //   ★ 행마다 칸 수가 다르면 그리드가 갈라진다 — 그게 이름이 «우측정렬» 로 보인 원인이었다
    //     (동그라미가 1fr 칸을 차지해 이름을 밀었다). 그래서 **결과 좌표**로 잰다.
    //   ★ 하위 폴더는 들여쓰기가 목적이므로 **제외**한다(같은 x 면 계층이 안 보인다).
    const cols = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-testid^="docs-project-row-"]')]
        .concat([...document.querySelectorAll('div')].filter(d => d.dataset && d.dataset.testid === undefined && false));
      // 트리의 **최상위 행들** — 프로젝트 행과 같은 부모를 공유하고 들여쓰기(padding-left 8px)가 기본인 것
      const proj = document.querySelector('[data-testid^="docs-project-row-"]');
      if (!proj) return null;
      const tree = proj.parentElement.parentElement;
      const out = [];
      [...tree.querySelectorAll('div')].forEach((r) => {
        if (getComputedStyle(r).display !== 'grid') return;
        if (Math.round(parseFloat(getComputedStyle(r).paddingLeft)) !== 8) return;   // 들여쓴 하위 폴더 제외
        const kids = [...r.children];
        if (kids.length < 3) return;
        const name = kids[2].getBoundingClientRect();
        const cnt = kids[3] ? kids[3].getBoundingClientRect() : null;
        const label = (kids[2].textContent || '').trim().slice(0, 14);
        if (!label) return;
        out.push({ label, nameLeft: Math.round(name.left), countRight: cnt && cnt.width ? Math.round(cnt.right) : null });
      });
      return out;
    });
    if (!cols || cols.length < 3) {
      results.push({ name: '열 정렬', fail: 0, details: [`⬜ 미측정 — 최상위 행 ${cols ? cols.length : 0}개`] });
    } else {
      const lefts = [...new Set(cols.map(c => c.nameLeft))];
      const rights = [...new Set(cols.filter(c => c.countRight !== null).map(c => c.countRight))];
      judge('이름의 왼쪽 끝이 전 행에서 같다', lefts.length === 1,
        `${cols.length}행 · x=${lefts.join('/')} (${cols.slice(0, 4).map(c => c.label).join(', ')}…)`);
      judge('숫자의 오른쪽 끝이 전 행에서 같다', rights.length <= 1,
        `x=${rights.join('/') || '(숫자 없음)'}`);
    }

    if (before.hasCaret) {
      const pos = await page.evaluate((p) => {
        const c = document.querySelector(`[data-testid="docs-project-row-${p}"] span[role="button"]`);
        const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, pid);
      await page.mouse.click(pos.x, pos.y);
      await b.sleep(1200);
      const after = await page.evaluate((nm1, nm2) => ({
        top: document.body.innerText.includes(nm1), sub: document.body.innerText.includes(nm2),
        files: document.querySelectorAll('[data-file-id]').length,
      }), TAG + '-상위', TAG + '-하위');
      judge('캐럿을 누르면 하위 폴더가 열린다', after.top, `상위 ${after.top} · 그 아래 ${after.sub}`);
      judge('캐럿 클릭이 목록을 바꾸지 않는다', after.files === before.files, `파일 ${before.files} → ${after.files}`);
    }
  } finally {
    await sequelize.query('DELETE FROM file_folders WHERE name LIKE :t', { replacements: { t: TAG + '%' } });
    const [l] = await sequelize.query('SELECT COUNT(*) n FROM file_folders WHERE name LIKE :t', { replacements: { t: TAG + '%' } });
    judge('픽스처 원복', Number(l[0].n) === 0, `잔여 ${l[0].n}`);
    await browser.close();
  }
  return results;
}

module.exports = { run };
